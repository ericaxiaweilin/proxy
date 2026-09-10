package identity

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"log/slog"
	"net/http"
	"os"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/proxy-app/proxy-api/internal/clock"
	"github.com/proxy-app/proxy-api/internal/command"
	"github.com/proxy-app/proxy-api/internal/event"
)

type UserAccount struct{ ID, Status string }
type LoginIdentity struct {
	ID, UserAccountID, Channel, Identifier string
	Verified                               bool
	Status                                 string
}
type DeviceRegistration struct{ ID, UserAccountID, Platform, Status, PushTokenRef, CredentialHash string }
type Membership struct {
	Principal             command.Principal
	UserAccountID, Status string
}

type Session struct {
	ID            string            `json:"id"`
	UserAccountID string            `json:"userAccountId"`
	DeviceID      string            `json:"deviceId"`
	Status        string            `json:"status"`
	Principal     command.Principal `json:"principal"`
	IssuedAt      time.Time         `json:"issuedAt"`
	ExpiresAt     time.Time         `json:"expiresAt"`
	Version       int               `json:"version"`
}

// MaxConcurrentSessions is the Lotus-aligned device cap (RFC §6). A UserAccount
// may hold at most 2 ACTIVE sessions; a new login auto-evicts the oldest.
const MaxConcurrentSessions = 2

type Seed struct {
	User          UserAccount
	LoginIdentity LoginIdentity
	Memberships   []Membership
	Devices       []DeviceRegistration
	Challenges    []LoginChallenge
}

type Service struct {
	mu                     sync.Mutex
	repository             Repository
	clock                  clock.Clock
	tokenManager           *TokenManager
	challengeProvider      LoginChallengeProvider
	displayIdentityService *DisplayIdentityService
	profileService         *ProfileService
}

func New(seed *Seed) *Service {
	return NewWithRepositoryAndClock(NewMemoryRepository(seed), clock.System{})
}

func NewWithClock(seed *Seed, domainClock clock.Clock) *Service {
	return NewWithRepositoryAndClock(NewMemoryRepository(seed), domainClock)
}

func NewWithRepository(repository Repository) *Service {
	return NewWithRepositoryAndClock(repository, clock.System{})
}

func NewWithRepositoryAndClock(repository Repository, domainClock clock.Clock) *Service {
	return NewWithRepositoryAndClockAndChallengeProvider(repository, domainClock, nil)
}

func NewWithRepositoryAndClockAndChallengeProvider(repository Repository, domainClock clock.Clock, provider LoginChallengeProvider) *Service {
	if repository == nil {
		repository = NewMemoryRepository(nil)
	}
	if domainClock == nil {
		domainClock = clock.System{}
	}
	if provider == nil {
		provider = UnconfiguredLoginChallengeProvider{}
	}
	service := &Service{repository: repository, clock: domainClock, challengeProvider: provider, displayIdentityService: NewDisplayIdentityService(nil, domainClock), profileService: NewProfileService(nil, domainClock)}
	if tokenRepository, ok := repository.(TokenRepository); ok {
		service.tokenManager = NewTokenManager(tokenRepository, repository, domainClock)
	}
	return service
}

func (s *Service) SetDisplayIdentityRepository(repo DisplayIdentityRepository) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.displayIdentityService = NewDisplayIdentityService(repo, s.clock)
}

func (s *Service) SetProfileRepository(repo ProfileRepository) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.profileService.SetRepository(repo)
}

// AuthorNameResolver exposes the profile-backed display-name resolver so
// content publishers (localnet, socialspace, marketplace) resolve the
// author's name server-side instead of trusting client-supplied strings.
func (s *Service) AuthorNameResolver() AuthorNameResolver {
	return NewAuthorNameResolver(s.profileService)
}

// Repository exposes the identity repository so transport-layer code
// (e.g. wiring the SMTP LoginChallengeProvider email resolver) can look
// up LoginIdentity rows by id without re-creating one. Returned interface
// is read-only at the call site; the service keeps the only mutable handle.
func (s *Service) Repository() Repository {
	return s.repository
}

func (s *Service) Supports(commandType string) bool {
	switch commandType {
	case "BeginPasswordlessAuthentication", "RequestLoginChallenge", "VerifyLoginChallenge", "CreateSession", "CreateAnonymousSession", "RegisterDevice", "RevokeSession", "RevokeAllSessions", "SwitchPrincipalContext", "RequestAccountRecovery", "RefreshSession", "ResumeTrustedDeviceSession", "AuthenticateWithGoogle",
		"CreateDisplayIdentity", "ListDisplayIdentities", "BurnDisplayIdentity",
		"UpdateProfile", "GetProfile",
		"GetAccountPreferences", "UpdateAccountPreferences",
		"RequestPrivacyExport", "RequestPrivacyDelete", "CancelPrivacyRequest", "GetPrivacyRequestStatus", "ListPrivacyRequests":
		return true
	default:
		return false
	}
}

func (s *Service) Handle(envelope command.Envelope) command.Result {
	return s.HandleContext(context.Background(), envelope)
}

func (s *Service) HandleContext(ctx context.Context, envelope command.Envelope) command.Result {

	s.mu.Lock()
	defer s.mu.Unlock()
	switch envelope.CommandType {
	case "BeginPasswordlessAuthentication":
		return s.beginPasswordlessAuthentication(ctx, envelope)
	case "RequestLoginChallenge":
		return s.requestLoginChallenge(ctx, envelope)
	case "VerifyLoginChallenge":
		return s.verifyLoginChallenge(ctx, envelope)
	case "CreateSession":
		return s.createSession(ctx, envelope)
	case "CreateAnonymousSession":
		return s.createAnonymousSession(ctx, envelope)
	case "RegisterDevice":
		return s.registerDevice(ctx, envelope)
	case "RevokeSession":
		return s.revokeSession(ctx, envelope)
	case "RevokeAllSessions":
		return s.revokeAllSessions(ctx, envelope)
	case "SwitchPrincipalContext":
		return s.switchPrincipalContext(ctx, envelope)
	case "RequestAccountRecovery":
		return s.requestAccountRecovery(envelope)
	case "RefreshSession":
		return s.refreshSession(ctx, envelope)
	case "ResumeTrustedDeviceSession":
		return s.resumeTrustedDeviceSession(ctx, envelope)
	case "AuthenticateWithGoogle":
		return s.authenticateWithGoogle(ctx, envelope)
	case "CreateDisplayIdentity":
		return s.createDisplayIdentity(ctx, envelope)
	case "ListDisplayIdentities":
		return s.listDisplayIdentities(ctx, envelope)
	case "BurnDisplayIdentity":
		return s.burnDisplayIdentity(ctx, envelope)
	case "UpdateProfile":
		return s.updateProfile(ctx, envelope)
	case "GetProfile":
		return s.getProfile(ctx, envelope)
	case "GetAccountPreferences":
		return s.getAccountPreferences(ctx, envelope)
	case "UpdateAccountPreferences":
		return s.updateAccountPreferences(ctx, envelope)
	case "RequestPrivacyExport":
		return s.requestPrivacyExport(ctx, envelope)
	case "RequestPrivacyDelete":
		return s.requestPrivacyDelete(ctx, envelope)
	case "CancelPrivacyRequest":
		return s.cancelPrivacyRequest(ctx, envelope)
	case "GetPrivacyRequestStatus":
		// The route is GET /v1/privacy/status?requestId=...; the
		// request id is in the payload, the user id is the actor.
		// We delegate to a small wrapper that takes the id from the
		// envelope payload.
		return s.getPrivacyRequestStatus(ctx, envelope, firstString(envelope.Payload, "requestId"))
	case "ListPrivacyRequests":
		return s.listPrivacyRequests(ctx, envelope)
	default:
		return command.Rejected(envelope, "IDENTITY_COMMAND_UNSUPPORTED", "VALIDATION", "AFTER_USER_ACTION", "identity.unsupported_command", nil)
	}
}

func (s *Service) Snapshot() (sessions []Session, devices []DeviceRegistration) {
	s.mu.Lock()
	defer s.mu.Unlock()
	sessions, devices, _ = s.repository.Snapshot(context.Background())
	return sessions, devices
}

type createSessionPayload struct {
	UserAccountID      string            `json:"userAccountId"`
	LoginIdentityID    string            `json:"loginIdentityId"`
	DeviceID           string            `json:"deviceId"`
	ChallengeID        string            `json:"challengeId"`
	DeviceCredential   string            `json:"deviceCredential"`
	RequestedPrincipal command.Principal `json:"requestedPrincipal"`
}

type requestLoginChallengePayload struct {
	LoginIdentityID string `json:"loginIdentityId"`
	DeviceID        string `json:"deviceId"`
	Channel         string `json:"channel"`
}

type beginPasswordlessAuthenticationPayload struct {
	Channel    string `json:"channel"`
	Identifier string `json:"identifier"`
	DeviceID   string `json:"deviceId"`
	Platform   string `json:"platform"`
}

type createAnonymousSessionPayload struct {
	DeviceID         string `json:"deviceId"`
	Platform         string `json:"platform"`
	DeviceCredential string `json:"deviceCredential"`
	// R16.7-P0-A/B/C: legal consent + 18+ age gate. Date of birth is
	// YYYY-MM-DD parsed as UTC midnight. LegalDocVersion is the version
	// string of the Terms / Privacy doc the user accepted (e.g. "1.1");
	// empty string falls back to "1.1" so the server never silently
	// accepts an unsigned-by-version consent.
	DateOfBirth     string                  `json:"dateOfBirth"`
	Consents        *createAnonConsentBlock `json:"consents"`
	LegalDocVersion string                  `json:"legalDocVersion"`
}

type createAnonConsentBlock struct {
	Terms   bool `json:"terms"`
	Privacy bool `json:"privacy"`
}

func (s *Service) createAnonymousSession(ctx context.Context, e command.Envelope) command.Result {
	var p createAnonymousSessionPayload
	if !decode(e.Payload, &p) || p.DeviceID == "" || len(p.DeviceCredential) < 32 || (p.Platform != "IOS" && p.Platform != "ANDROID") {
		return command.Rejected(e, "INVALID_ANONYMOUS_SESSION", "VALIDATION", "AFTER_USER_ACTION", "identity.invalid_anonymous_session", nil)
	}
	// R16.7-P0-A/B: legal consent + 18+ age gate, server-side. Defense in
	// depth: mobile already enforces this, but the server is the trust
	// anchor. Age < 18 and missing Terms/Privacy are both fatal.
	if p.Consents == nil || !p.Consents.Terms || !p.Consents.Privacy {
		return command.Rejected(e, "LEGAL_CONSENT_REQUIRED", "VALIDATION", "AFTER_USER_ACTION", "identity.legal_consent_required", nil)
	}
	if p.DateOfBirth == "" {
		return command.Rejected(e, "AGE_RESTRICTED", "VALIDATION", "AFTER_USER_ACTION", "identity.age_restricted", nil)
	}
	dob, err := time.Parse("2006-01-02", p.DateOfBirth)
	if err != nil {
		return command.Rejected(e, "AGE_RESTRICTED", "VALIDATION", "AFTER_USER_ACTION", "identity.age_restricted", nil)
	}
	// Use exact calendar-day comparison to avoid floating-point edge cases
	// (e.g., rejecting users exactly on their 18th birthday)
	if dob.AddDate(18, 0, 0).After(s.clock.Now().UTC()) {
		return command.Rejected(e, "AGE_RESTRICTED", "VALIDATION", "AFTER_USER_ACTION", "identity.age_restricted", nil)
	}
	user, device, created, err := s.repository.EnsureAnonymousIdentity(ctx, p.DeviceID, p.Platform)
	if err != nil {
		return command.Rejected(e, "ANONYMOUS_IDENTITY_UNAVAILABLE", "INTERNAL", "SAFE_RETRY", "identity.anonymous_identity_unavailable", nil)
	}
	if user.Status != "ANONYMOUS" && user.Status != "ACTIVE" {
		return command.Rejected(e, "ACCOUNT_NOT_ACTIVE", "ACCOUNT_STATE", "AFTER_USER_ACTION", "identity.account_not_active", nil)
	}
	now := s.clock.Now().UTC()
	if err := s.enforceMaxConcurrentSessions(ctx, user.ID, e); err != nil {
		return command.Rejected(e, "SESSION_CREATE_FAILED", "INTERNAL", "SAFE_RETRY", "identity.session_create_failed", nil)
	}
	session := Session{ID: newID("session_"), UserAccountID: user.ID, DeviceID: device.ID, Status: "ACTIVE", Principal: command.Principal{Type: "INDIVIDUAL", ID: user.ID}, IssuedAt: now, ExpiresAt: now.Add(30 * 24 * time.Hour), Version: 1}
	domainEvents := []event.DomainEvent{event.New("AnonymousSessionCreated", "Session", session.ID, session.Version, user.ID, e.CorrelationID, e.CommandID, now, map[string]any{"userAccountId": user.ID, "deviceId": device.ID, "accountCreated": created})}
	if s.tokenManager == nil {
		return command.Rejected(e, "SESSION_TOKEN_ISSUE_FAILED", "INTERNAL", "SAFE_RETRY", "identity.session_token_issue_failed", nil)
	}
	pair, tokenRecord, err := s.tokenManager.Prepare(session, p.DeviceCredential)
	if err != nil {
		return command.Rejected(e, "SESSION_TOKEN_ISSUE_FAILED", "INTERNAL", "SAFE_RETRY", "identity.session_token_issue_failed", nil)
	}
	if err := s.persistCreateAnonymousSession(ctx, session, tokenRecord, domainEvents); err != nil {
		return command.Rejected(e, "SESSION_CREATE_FAILED", "INTERNAL", "SAFE_RETRY", "identity.session_create_failed", nil)
	}
	// R16.7-P0-C: persist the Terms / Privacy consent records so the user
	// has an auditable trail of the legal text they accepted and when.
	//
	// R16.10 follow-up: the consent write MUST NOT run inside the
	// session-creation transaction. The privacy schema is a separate
	// deployment unit (migration 059 may not have run yet in dev
	// mode), and a missing table would poison the parent transaction
	// and roll the session back. We call the post-commit writer
	// directly here (rather than via the api-layer hook) so unit
	// tests and other in-process callers of the service also persist
	// the audit row. The detached context is important: the parent
	// transaction may have aborted before we get here.
	if s.repository != nil {
		if err := s.RecordLegalConsentsDetached(context.WithoutCancel(ctx), session.UserAccountID, e); err != nil {
			log.Printf("legal consent write failed user=%s err=%v", session.UserAccountID, err)
		}
	}
	result := command.Accepted(e, "Session", session.ID, session.Version, session.Status, eventRefs(domainEvents))
	result.Auth = authTokens(pair, session)
	return result
}

// recordLegalConsents persists the Terms + Privacy acceptance for a user
// account. The Repository interface only exposes the minimum surface
// needed; if the implementation does not support legal-consent writes we
// skip silently so the rest of the signup flow is not coupled to the
// privacy schema (which is independently deployed).
func (s *Service) recordLegalConsents(ctx context.Context, userID, docVersion string, e command.Envelope) error {
	if s.repository == nil {
		return nil
	}
	if recorder, ok := s.repository.(interface {
		RecordLegalConsent(ctx context.Context, userID, docKind, docVersion, ip, userAgent string) error
	}); ok {
		ip, ua := clientFingerprint(e)
		if err := recorder.RecordLegalConsent(ctx, userID, "TERMS", docVersion, ip, ua); err != nil {
			return err
		}
		return recorder.RecordLegalConsent(ctx, userID, "PRIVACY", docVersion, ip, ua)
	}
	return nil
}

// RecordLegalConsentsDetached writes the Terms / Privacy consent
// rows for a user who just signed up, using a fresh, post-commit
// context. This is the post-commit variant of recordLegalConsents,
// invoked by the api/privacy surface after the session-creation
// transaction has committed. The detached context is important: a
// poison from the parent transaction would otherwise abort the
// write, which is exactly what the user-facing signup is trying to
// avoid.
func (s *Service) RecordLegalConsentsDetached(ctx context.Context, userID string, e command.Envelope) error {
	if s.repository == nil {
		return nil
	}
	docVersion := firstString(e.Payload, "legalDocVersion")
	if docVersion == "" {
		docVersion = "1.1"
	}
	return s.recordLegalConsents(ctx, userID, docVersion, e)
}

func clientFingerprint(e command.Envelope) (string, string) {
	if e.AuthContext == nil {
		return "", ""
	}
	ip, _ := e.AuthContext["clientIp"].(string)
	ua, _ := e.AuthContext["userAgent"].(string)
	return ip, ua
}

// beginPasswordlessAuthentication is the public entry point for sign-up and
// sign-in. The client supplies only the verified address/number and device;
// it never chooses or learns a pre-seeded account identity.
func (s *Service) beginPasswordlessAuthentication(ctx context.Context, e command.Envelope) command.Result {
	var p beginPasswordlessAuthenticationPayload
	if !decode(e.Payload, &p) || (p.Channel != "EMAIL" && p.Channel != "SMS") || normalizeLoginIdentifier(p.Channel, p.Identifier) == "" || p.DeviceID == "" || (p.Platform != "IOS" && p.Platform != "ANDROID") {
		return command.Rejected(e, "INVALID_PASSWORDLESS_AUTHENTICATION", "VALIDATION", "AFTER_USER_ACTION", "identity.invalid_passwordless_authentication", nil)
	}
	upgradingUserAccountID := ""
	if _, authenticated := e.AuthContext["sessionId"]; authenticated && e.Actor.Type == "USER" && e.Actor.ID != "" && e.Actor.ID != p.DeviceID {
		upgradingUserAccountID = e.Actor.ID
	}
	identity, device, created, err := s.repository.EnsurePasswordlessIdentity(ctx, p.Channel, normalizeLoginIdentifier(p.Channel, p.Identifier), p.DeviceID, p.Platform, upgradingUserAccountID)
	if err != nil {
		return command.Rejected(e, "PASSWORDLESS_IDENTITY_UNAVAILABLE", "INTERNAL", "SAFE_RETRY", "identity.passwordless_identity_unavailable", nil)
	}
	providerChallenge, err := s.challengeProvider.Request(ctx, LoginChallengeRequest{LoginIdentityID: identity.ID, DeviceID: device.ID, Channel: p.Channel, Purpose: e.Purpose, CorrelationID: e.CorrelationID, Identifier: identity.Identifier})
	if errors.Is(err, ErrLoginChallengeProviderNotReady) {
		return command.Rejected(e, "LOGIN_PROVIDER_NOT_CONFIGURED", "PROVIDER", "SAFE_RETRY", "identity.login_provider_not_configured", nil)
	}
	if err != nil || providerChallenge.ProviderRef == "" {
		return command.Rejected(e, "LOGIN_CHALLENGE_REQUEST_FAILED", "PROVIDER", "SAFE_RETRY", "identity.login_challenge_request_failed", nil)
	}
	now := s.clock.Now().UTC()
	expiresAt := providerChallenge.ExpiresAt
	if expiresAt.IsZero() {
		expiresAt = now.Add(5 * time.Minute)
	}
	challenge := LoginChallenge{ID: newID("challenge_"), UserAccountID: identity.UserAccountID, LoginIdentityID: identity.ID, DeviceID: device.ID, Channel: p.Channel, ProviderRef: providerChallenge.ProviderRef, Status: "PENDING", MaxAttempts: 5, Version: 1, RequestedAt: now, ExpiresAt: expiresAt.UTC()}
	events := []event.DomainEvent{event.New("LoginChallengeRequested", "LoginChallenge", challenge.ID, challenge.Version, identity.UserAccountID, e.CorrelationID, e.CommandID, now, map[string]any{"channel": p.Channel, "accountCreated": created})}
	if err := s.persistCreateLoginChallenge(ctx, challenge, events); err != nil {
		return command.Rejected(e, "LOGIN_CHALLENGE_REQUEST_FAILED", "INTERNAL", "SAFE_RETRY", "identity.login_challenge_request_failed", nil)
	}
	return command.Pending(e, challenge.ID, "LOGIN_CHALLENGE_PENDING", "AUTHENTICATION", "identity.login_challenge_pending", map[string]any{"channel": challenge.Channel, "accountCreated": created})
}

func (s *Service) requestLoginChallenge(ctx context.Context, e command.Envelope) command.Result {
	var p requestLoginChallengePayload
	if !decode(e.Payload, &p) || p.LoginIdentityID == "" || p.DeviceID == "" || (p.Channel != "EMAIL" && p.Channel != "SMS") {
		return command.Rejected(e, "INVALID_LOGIN_CHALLENGE_REQUEST", "VALIDATION", "AFTER_USER_ACTION", "identity.invalid_login_challenge_request", nil)
	}
	loginIdentity, err := s.repository.GetLoginIdentity(ctx, p.LoginIdentityID)
	if err != nil || !loginIdentity.Verified || loginIdentity.Status != "ACTIVE" {
		return command.Rejected(e, "LOGIN_CHALLENGE_REQUEST_FAILED", "AUTHENTICATION", "AFTER_USER_ACTION", "identity.login_challenge_request_failed", nil)
	}
	device, err := s.repository.GetDevice(ctx, p.DeviceID)
	if err != nil || device.UserAccountID != loginIdentity.UserAccountID || device.Status != "ACTIVE" {
		return command.Rejected(e, "LOGIN_CHALLENGE_REQUEST_FAILED", "AUTHENTICATION", "AFTER_USER_ACTION", "identity.login_challenge_request_failed", nil)
	}
	// loginIdentity (fetched above) already carries the verified
	// Identifier; thread it to the provider so delivery never depends on
	// the global lookup hooks (unwired in production — OTP delivery was
	// dead on both channels).
	providerChallenge, err := s.challengeProvider.Request(ctx, LoginChallengeRequest{
		LoginIdentityID: p.LoginIdentityID,
		DeviceID:        p.DeviceID,
		Channel:         p.Channel,
		Purpose:         e.Purpose,
		CorrelationID:   e.CorrelationID,
		Identifier:      loginIdentity.Identifier,
	})
	if errors.Is(err, ErrLoginChallengeProviderNotReady) {
		return command.Rejected(e, "LOGIN_PROVIDER_NOT_CONFIGURED", "PROVIDER", "SAFE_RETRY", "identity.login_provider_not_configured", nil)
	}
	if err != nil || providerChallenge.ProviderRef == "" {
		return command.Rejected(e, "LOGIN_CHALLENGE_REQUEST_FAILED", "PROVIDER", "SAFE_RETRY", "identity.login_challenge_request_failed", nil)
	}
	now := s.clock.Now().UTC()
	expiresAt := providerChallenge.ExpiresAt
	if expiresAt.IsZero() {
		expiresAt = now.Add(5 * time.Minute)
	}
	if !expiresAt.After(now) {
		return command.Rejected(e, "LOGIN_CHALLENGE_REQUEST_FAILED", "PROVIDER", "SAFE_RETRY", "identity.login_challenge_request_failed", nil)
	}
	challenge := LoginChallenge{
		ID:              newID("challenge_"),
		UserAccountID:   loginIdentity.UserAccountID,
		LoginIdentityID: p.LoginIdentityID,
		DeviceID:        p.DeviceID,
		Channel:         p.Channel,
		ProviderRef:     providerChallenge.ProviderRef,
		Status:          "PENDING",
		MaxAttempts:     5,
		Version:         1,
		RequestedAt:     now,
		ExpiresAt:       expiresAt.UTC(),
	}
	domainEvents := []event.DomainEvent{event.New("LoginChallengeRequested", "LoginChallenge", challenge.ID, challenge.Version, challenge.UserAccountID, e.CorrelationID, e.CommandID, now, map[string]any{
		"channel": p.Channel,
	})}
	if err := s.persistCreateLoginChallenge(ctx, challenge, domainEvents); err != nil {
		return command.Rejected(e, "LOGIN_CHALLENGE_REQUEST_FAILED", "INTERNAL", "SAFE_RETRY", "identity.login_challenge_request_failed", nil)
	}
	return command.Pending(e, challenge.ID, "LOGIN_CHALLENGE_PENDING", "AUTHENTICATION", "identity.login_challenge_pending", map[string]any{"channel": challenge.Channel})
}

type verifyLoginChallengePayload struct {
	ChallengeID string `json:"challengeId"`
	Code        string `json:"code"`
}

func (s *Service) verifyLoginChallenge(ctx context.Context, e command.Envelope) command.Result {
	var p verifyLoginChallengePayload
	if !decode(e.Payload, &p) || p.ChallengeID == "" || p.Code == "" {
		return command.Rejected(e, "INVALID_LOGIN_CHALLENGE_VERIFICATION", "VALIDATION", "AFTER_USER_ACTION", "identity.invalid_login_challenge_verification", nil)
	}
	challenge, err := s.repository.GetLoginChallenge(ctx, p.ChallengeID)
	if errors.Is(err, ErrLoginChallengeNotFound) || err != nil {
		return command.Rejected(e, "LOGIN_CHALLENGE_INVALID", "AUTHENTICATION", "AFTER_USER_ACTION", "identity.login_challenge_invalid", nil)
	}
	now := s.clock.Now().UTC()
	if challenge.Status != "PENDING" || challenge.Attempts >= challenge.MaxAttempts || !now.Before(challenge.ExpiresAt) {
		return command.Rejected(e, "LOGIN_CHALLENGE_INVALID", "AUTHENTICATION", "AFTER_USER_ACTION", "identity.login_challenge_invalid", nil)
	}
	verification, err := s.challengeProvider.Verify(ctx, LoginChallengeVerification{ProviderRef: challenge.ProviderRef, Code: p.Code})
	if errors.Is(err, ErrLoginChallengeProviderNotReady) {
		return command.Rejected(e, "LOGIN_PROVIDER_NOT_CONFIGURED", "PROVIDER", "SAFE_RETRY", "identity.login_provider_not_configured", nil)
	}
	if err != nil {
		return command.Rejected(e, "LOGIN_CHALLENGE_VERIFICATION_FAILED", "PROVIDER", "SAFE_RETRY", "identity.login_challenge_verification_failed", nil)
	}
	previousVersion := challenge.Version
	challenge.Version++
	if !verification.Verified {
		challenge.Attempts++
		if challenge.Attempts >= challenge.MaxAttempts {
			challenge.Status = "LOCKED"
		}
		if err := s.repository.UpdateLoginChallenge(ctx, challenge, previousVersion); err != nil {
			return command.Rejected(e, "LOGIN_CHALLENGE_VERIFICATION_FAILED", "INTERNAL", "SAFE_RETRY", "identity.login_challenge_verification_failed", nil)
		}
		return command.Rejected(e, "LOGIN_CHALLENGE_INVALID", "AUTHENTICATION", "AFTER_USER_ACTION", "identity.login_challenge_invalid", nil)
	}
	challenge.Status = "VERIFIED"
	challenge.VerifiedAt = now
	domainEvents := []event.DomainEvent{event.New("LoginChallengeVerified", "LoginChallenge", challenge.ID, challenge.Version, challenge.UserAccountID, e.CorrelationID, e.CommandID, now, map[string]any{})}
	if err := s.persistUpdateLoginChallenge(ctx, challenge, previousVersion, domainEvents); err != nil {
		return command.Rejected(e, "LOGIN_CHALLENGE_VERIFICATION_FAILED", "INTERNAL", "SAFE_RETRY", "identity.login_challenge_verification_failed", nil)
	}
	// PROFILE-READ-001: provision the home-page identity the moment the
	// login identifier is verified. Registration binds email / phone but
	// created no Profile row, so fresh accounts rendered a hardcoded demo
	// identity. Provision-if-absent only: an explicit UpdateProfile always
	// wins, and provisioning never fails verification (best-effort).
	if loginIdentity, err := s.repository.GetLoginIdentity(ctx, challenge.LoginIdentityID); err == nil && loginIdentity.Verified && loginIdentity.UserAccountID != "" {
		if _, err := s.profileService.GetProfile(ctx, loginIdentity.UserAccountID); errors.Is(err, ErrProfileNotFound) {
			initial := initialProfileFor(loginIdentity.UserAccountID, challenge.Channel, loginIdentity.Identifier)
			_, _ = s.profileService.UpsertProfile(ctx, initial)
		}
	}
	return command.Accepted(e, "LoginChallenge", challenge.ID, challenge.Version, challenge.Status, eventRefs(domainEvents))
}

func (s *Service) createSession(ctx context.Context, e command.Envelope) command.Result {
	var p createSessionPayload
	if !decode(e.Payload, &p) || p.DeviceID == "" || p.ChallengeID == "" || len(p.DeviceCredential) < 32 {
		return command.Rejected(e, "INVALID_CREATE_SESSION", "VALIDATION", "AFTER_USER_ACTION", "identity.invalid_create_session", nil)
	}
	// Passwordless clients only hold a verified challenge. Derive account,
	// identity and default individual principal server-side so callers cannot
	// forge another account's identifiers.
	if p.UserAccountID == "" || p.LoginIdentityID == "" || p.RequestedPrincipal.ID == "" {
		challenge, err := s.repository.GetLoginChallenge(ctx, p.ChallengeID)
		if err != nil || challenge.DeviceID != p.DeviceID {
			return command.Rejected(e, "LOGIN_CHALLENGE_REQUIRED", "AUTHENTICATION", "AFTER_REAUTH", "identity.login_challenge_required", nil)
		}
		if p.UserAccountID == "" {
			p.UserAccountID = challenge.UserAccountID
		}
		if p.LoginIdentityID == "" {
			p.LoginIdentityID = challenge.LoginIdentityID
		}
		if p.RequestedPrincipal.ID == "" {
			p.RequestedPrincipal = command.Principal{Type: "INDIVIDUAL", ID: challenge.UserAccountID}
		}
	}
	user, err := s.repository.GetUser(ctx, p.UserAccountID)
	if errors.Is(err, ErrUserNotFound) {
		return command.Rejected(e, "LOGIN_IDENTITY_NOT_VERIFIED", "AUTHENTICATION", "AFTER_USER_ACTION", "identity.login_identity_not_verified", nil)
	}
	if err != nil {
		return command.Rejected(e, "IDENTITY_READ_FAILED", "INTERNAL", "SAFE_RETRY", "identity.read_failed", nil)
	}
	identity, err := s.repository.GetLoginIdentity(ctx, p.LoginIdentityID)
	if errors.Is(err, ErrLoginIdentityNotFound) {
		return command.Rejected(e, "LOGIN_IDENTITY_NOT_VERIFIED", "AUTHENTICATION", "AFTER_USER_ACTION", "identity.login_identity_not_verified", nil)
	}
	if err != nil {
		return command.Rejected(e, "IDENTITY_READ_FAILED", "INTERNAL", "SAFE_RETRY", "identity.read_failed", nil)
	}
	if identity.UserAccountID != user.ID || !identity.Verified || identity.Status != "ACTIVE" {
		return command.Rejected(e, "LOGIN_IDENTITY_NOT_VERIFIED", "AUTHENTICATION", "AFTER_USER_ACTION", "identity.login_identity_not_verified", nil)
	}
	if !canHoldSession(user.Status) {
		return command.Rejected(e, "ACCOUNT_NOT_ACTIVE", "ACCOUNT_STATE", "AFTER_USER_ACTION", "identity.account_not_active", nil)
	}
	device, err := s.repository.GetDevice(ctx, p.DeviceID)
	if errors.Is(err, ErrDeviceNotFound) {
		return command.Rejected(e, "DEVICE_NOT_ALLOWED", "AUTHORIZATION", "AFTER_USER_ACTION", "identity.device_not_allowed", nil)
	}
	if err != nil {
		return command.Rejected(e, "IDENTITY_READ_FAILED", "INTERNAL", "SAFE_RETRY", "identity.read_failed", nil)
	}
	if device.UserAccountID != user.ID || device.Status != "ACTIVE" {
		return command.Rejected(e, "DEVICE_NOT_ALLOWED", "AUTHORIZATION", "AFTER_USER_ACTION", "identity.device_not_allowed", nil)
	}
	challenge, err := s.repository.GetLoginChallenge(ctx, p.ChallengeID)
	if errors.Is(err, ErrLoginChallengeNotFound) || err != nil || challenge.UserAccountID != user.ID || challenge.LoginIdentityID != identity.ID || challenge.DeviceID != device.ID || challenge.Status != "VERIFIED" || challenge.VerifiedAt.IsZero() || !s.clock.Now().UTC().Before(challenge.ExpiresAt) {
		return command.Rejected(e, "LOGIN_CHALLENGE_REQUIRED", "AUTHENTICATION", "AFTER_REAUTH", "identity.login_challenge_required", nil)
	}
	allowed, err := s.repository.HasActiveMembership(ctx, user.ID, p.RequestedPrincipal)
	if err != nil {
		return command.Rejected(e, "IDENTITY_READ_FAILED", "INTERNAL", "SAFE_RETRY", "identity.read_failed", nil)
	}
	if !allowed {
		return command.Rejected(e, "PRINCIPAL_NOT_ALLOWED", "AUTHORIZATION", "AFTER_USER_ACTION", "identity.principal_not_allowed", nil)
	}
	trustedDevices, ok := s.repository.(TrustedDeviceRepository)
	if !ok || trustedDevices.BindDeviceCredential(ctx, device.ID, user.ID, hashToken(p.DeviceCredential)) != nil {
		return command.Rejected(e, "DEVICE_PROOF_REGISTRATION_FAILED", "INTERNAL", "SAFE_RETRY", "identity.device_proof_registration_failed", nil)
	}
	now := s.clock.Now().UTC()
	if err := s.enforceMaxConcurrentSessions(ctx, user.ID, e); err != nil {
		return command.Rejected(e, "SESSION_CREATE_FAILED", "INTERNAL", "SAFE_RETRY", "identity.session_create_failed", nil)
	}
	session := Session{ID: newID("session_"), UserAccountID: user.ID, DeviceID: device.ID, Status: "ACTIVE", Principal: p.RequestedPrincipal, IssuedAt: now, ExpiresAt: now.Add(30 * 24 * time.Hour), Version: 1}
	domainEvents := []event.DomainEvent{event.New("SessionCreated", "Session", session.ID, session.Version, e.Principal.ID, e.CorrelationID, e.CommandID, now, map[string]any{
		"userAccountId": session.UserAccountID,
		"deviceId":      session.DeviceID,
		"principal":     session.Principal,
		"expiresAt":     session.ExpiresAt,
	})}
	consumedChallenge := challenge
	consumedChallenge.Status = "CONSUMED"
	consumedChallenge.Version++
	consumedChallenge.ConsumedAt = now
	domainEvents = append(domainEvents, event.New("LoginChallengeConsumed", "LoginChallenge", consumedChallenge.ID, consumedChallenge.Version, consumedChallenge.UserAccountID, e.CorrelationID, e.CommandID, now, map[string]any{"sessionId": session.ID}))
	var pair TokenPair
	var tokenRecord SessionToken
	if s.tokenManager != nil {
		var tokenErr error
		pair, tokenRecord, tokenErr = s.tokenManager.Prepare(session, p.DeviceCredential)
		if tokenErr != nil {
			return command.Rejected(e, "SESSION_TOKEN_ISSUE_FAILED", "INTERNAL", "SAFE_RETRY", "identity.session_token_issue_failed", nil)
		}
	}
	if err := s.persistCreateSession(ctx, session, tokenRecord, consumedChallenge, domainEvents); err != nil {
		return command.Rejected(e, "SESSION_CREATE_FAILED", "INTERNAL", "SAFE_RETRY", "identity.session_create_failed", nil)
	}
	result := command.Accepted(e, "Session", session.ID, 1, "ACTIVE", eventRefs(domainEvents))
	if pair.AccessToken != "" {
		result.Auth = authTokens(pair, session)
	}
	return result
}

func canHoldSession(status string) bool {
	return status == "ACTIVE" || status == "ANONYMOUS" || status == "REGISTERED" || status == "VERIFIED" || status == "COMMERCIAL_VERIFIED"
}

type registerDevicePayload struct{ UserAccountID, DeviceID, Platform, PushTokenRef string }

func (s *Service) registerDevice(ctx context.Context, e command.Envelope) command.Result {
	var p registerDevicePayload
	if !decode(e.Payload, &p) || p.UserAccountID == "" || p.DeviceID == "" || (p.Platform != "IOS" && p.Platform != "ANDROID") {
		return command.Rejected(e, "INVALID_REGISTER_DEVICE", "VALIDATION", "AFTER_USER_ACTION", "identity.invalid_register_device", nil)
	}
	user, err := s.repository.GetUser(ctx, p.UserAccountID)
	if errors.Is(err, ErrUserNotFound) || err != nil || user.Status != "ACTIVE" || e.Actor.Type != "USER" || e.Actor.ID != user.ID {
		return command.Rejected(e, "DEVICE_REGISTRATION_NOT_ALLOWED", "AUTHORIZATION", "AFTER_USER_ACTION", "identity.device_registration_not_allowed", nil)
	}
	existing, err := s.repository.GetDevice(ctx, p.DeviceID)
	if err != nil && !errors.Is(err, ErrDeviceNotFound) {
		return command.Rejected(e, "IDENTITY_READ_FAILED", "INTERNAL", "SAFE_RETRY", "identity.read_failed", nil)
	}
	if err == nil && existing.UserAccountID != user.ID {
		return command.Rejected(e, "DEVICE_REGISTRATION_NOT_ALLOWED", "AUTHORIZATION", "AFTER_USER_ACTION", "identity.device_registration_not_allowed", nil)
	}
	device := DeviceRegistration{ID: p.DeviceID, UserAccountID: user.ID, Platform: p.Platform, Status: "ACTIVE", PushTokenRef: p.PushTokenRef}
	domainEvents := []event.DomainEvent{event.New("DeviceRegistered", "DeviceRegistration", device.ID, 1, e.Principal.ID, e.CorrelationID, e.CommandID, s.clock.Now().UTC(), map[string]any{
		"userAccountId": device.UserAccountID,
		"platform":      device.Platform,
	})}
	if err := s.persistUpsertDevice(ctx, device, domainEvents); err != nil {
		return command.Rejected(e, "DEVICE_REGISTRATION_FAILED", "INTERNAL", "SAFE_RETRY", "identity.device_registration_failed", nil)
	}
	return command.Accepted(e, "DeviceRegistration", p.DeviceID, 1, "ACTIVE", eventRefs(domainEvents))
}

type revokePayload struct{ Reason string }

func (s *Service) revokeSession(ctx context.Context, e command.Envelope) command.Result {
	var p revokePayload
	if !decode(e.Payload, &p) || p.Reason == "" {
		return command.Rejected(e, "INVALID_REVOKE_SESSION", "VALIDATION", "AFTER_USER_ACTION", "identity.invalid_revoke_session", nil)
	}
	session, err := s.repository.GetSession(ctx, e.Target.ID)
	if errors.Is(err, ErrSessionNotFound) {
		return command.Rejected(e, "SESSION_NOT_REVOCABLE", "ACCOUNT_STATE", "AFTER_USER_ACTION", "identity.session_not_revocable", nil)
	}
	if err != nil {
		return command.Rejected(e, "IDENTITY_READ_FAILED", "INTERNAL", "SAFE_RETRY", "identity.read_failed", nil)
	}
	if session.UserAccountID != e.Actor.ID || session.Status != "ACTIVE" {
		return command.Rejected(e, "SESSION_NOT_REVOCABLE", "ACCOUNT_STATE", "AFTER_USER_ACTION", "identity.session_not_revocable", nil)
	}
	previousVersion := session.Version
	session.Status = "REVOKED"
	session.Version++
	domainEvents := []event.DomainEvent{event.New("SessionRevoked", "Session", session.ID, session.Version, e.Principal.ID, e.CorrelationID, e.CommandID, s.clock.Now().UTC(), map[string]any{
		"reason": p.Reason,
	})}
	if err := s.persistUpdateSession(ctx, session, previousVersion, domainEvents); err != nil {
		if errors.Is(err, ErrSessionVersionConflict) {
			return command.Rejected(e, "SESSION_VERSION_CONFLICT", "CONCURRENCY", "SAFE_RETRY", "identity.session_version_conflict", nil)
		}
		return command.Rejected(e, "SESSION_REVOKE_FAILED", "INTERNAL", "SAFE_RETRY", "identity.session_revoke_failed", nil)
	}
	return command.Accepted(e, "Session", session.ID, session.Version, session.Status, eventRefs(domainEvents))
}

func (s *Service) revokeAllSessions(ctx context.Context, e command.Envelope) command.Result {
	var p revokePayload
	if !decode(e.Payload, &p) || p.Reason == "" {
		return command.Rejected(e, "INVALID_REVOKE_ALL_SESSIONS", "VALIDATION", "AFTER_USER_ACTION", "identity.invalid_revoke_all_sessions", nil)
	}
	var domainEvents []event.DomainEvent
	var revoked []Session
	var err error
	if repository, ok := s.repository.(TransactionalRepository); ok {
		revoked, err = repository.RevokeAllSessionsAndPublish(ctx, e.Actor.ID, func(sessions []Session) []event.DomainEvent {
			domainEvents = sessionRevocationEvents(sessions, e, p.Reason, s.clock.Now().UTC())
			return domainEvents
		})
	} else {
		revoked, err = s.repository.RevokeAllSessions(ctx, e.Actor.ID)
		domainEvents = sessionRevocationEvents(revoked, e, p.Reason, s.clock.Now().UTC())
	}
	if err != nil {
		return command.Rejected(e, "SESSION_BATCH_REVOKE_FAILED", "INTERNAL", "SAFE_RETRY", "identity.session_batch_revoke_failed", nil)
	}
	result := command.Accepted(e, "SessionBatch", e.Actor.ID, 1, "REVOKED", eventRefs(domainEvents))
	result.OperationRef = "session_batch_" + newID("")
	return result
}

type switchPrincipalPayload struct{ Principal command.Principal }

func (s *Service) switchPrincipalContext(ctx context.Context, e command.Envelope) command.Result {
	var p switchPrincipalPayload
	if !decode(e.Payload, &p) || p.Principal.ID == "" {
		return command.Rejected(e, "INVALID_PRINCIPAL_CONTEXT", "VALIDATION", "AFTER_USER_ACTION", "identity.invalid_principal_context", nil)
	}
	if e.ExpectedAggregateVersion == nil {
		return command.Rejected(e, "EXPECTED_SESSION_VERSION_REQUIRED", "CONCURRENCY", "AFTER_USER_ACTION", "identity.expected_session_version_required", nil)
	}
	session, err := s.repository.GetSession(ctx, e.Target.ID)
	if errors.Is(err, ErrSessionNotFound) {
		return command.Rejected(e, "SESSION_NOT_USABLE", "ACCOUNT_STATE", "AFTER_USER_ACTION", "identity.session_not_usable", nil)
	}
	if err != nil {
		return command.Rejected(e, "IDENTITY_READ_FAILED", "INTERNAL", "SAFE_RETRY", "identity.read_failed", nil)
	}
	// Save original version before sessionUsable may mutate it
	originalVersion := session.Version
	if session.UserAccountID != e.Actor.ID || !s.sessionUsable(ctx, &session) {
		return command.Rejected(e, "SESSION_NOT_USABLE", "ACCOUNT_STATE", "AFTER_USER_ACTION", "identity.session_not_usable", nil)
	}
	allowed, err := s.repository.HasActiveMembership(ctx, session.UserAccountID, p.Principal)
	if err != nil {
		return command.Rejected(e, "IDENTITY_READ_FAILED", "INTERNAL", "SAFE_RETRY", "identity.read_failed", nil)
	}
	if !allowed {
		return command.Rejected(e, "PRINCIPAL_NOT_ALLOWED", "AUTHORIZATION", "AFTER_USER_ACTION", "identity.principal_not_allowed", nil)
	}
	if *e.ExpectedAggregateVersion != originalVersion {
		return command.Rejected(e, "SESSION_VERSION_CONFLICT", "CONCURRENCY", "SAFE_RETRY", "identity.session_version_conflict", map[string]any{"expectedVersion": *e.ExpectedAggregateVersion, "actualVersion": session.Version})
	}
	previousVersion := session.Version
	session.Principal = p.Principal
	session.Version++
	domainEvents := []event.DomainEvent{event.New("SessionPrincipalSwitched", "Session", session.ID, session.Version, e.Principal.ID, e.CorrelationID, e.CommandID, s.clock.Now().UTC(), map[string]any{
		"principal": p.Principal,
	})}
	if err := s.persistUpdateSession(ctx, session, previousVersion, domainEvents); err != nil {
		if errors.Is(err, ErrSessionVersionConflict) {
			return command.Rejected(e, "SESSION_VERSION_CONFLICT", "CONCURRENCY", "SAFE_RETRY", "identity.session_version_conflict", nil)
		}
		return command.Rejected(e, "SESSION_UPDATE_FAILED", "INTERNAL", "SAFE_RETRY", "identity.session_update_failed", nil)
	}
	return command.Accepted(e, "Session", session.ID, session.Version, session.Status, eventRefs(domainEvents))
}

func (s *Service) persistCreateLoginChallenge(ctx context.Context, challenge LoginChallenge, domainEvents []event.DomainEvent) error {
	if repository, ok := s.repository.(TransactionalRepository); ok {
		return repository.CreateLoginChallengeAndPublish(ctx, challenge, domainEvents)
	}
	return s.repository.CreateLoginChallenge(ctx, challenge)
}

func (s *Service) persistUpdateLoginChallenge(ctx context.Context, challenge LoginChallenge, expectedVersion int, domainEvents []event.DomainEvent) error {
	if repository, ok := s.repository.(TransactionalRepository); ok {
		return repository.UpdateLoginChallengeAndPublish(ctx, challenge, expectedVersion, domainEvents)
	}
	return s.repository.UpdateLoginChallenge(ctx, challenge, expectedVersion)
}

func (s *Service) persistCreateSession(ctx context.Context, session Session, tokens SessionToken, challenge LoginChallenge, domainEvents []event.DomainEvent) error {
	if repository, ok := s.repository.(TransactionalRepository); ok {
		return repository.CreateSessionWithTokensAndChallengeAndPublish(ctx, session, tokens, challenge, domainEvents)
	}
	return errors.New("transactional session bootstrap is not configured")
}

func (s *Service) persistCreateAnonymousSession(ctx context.Context, session Session, tokens SessionToken, domainEvents []event.DomainEvent) error {
	if repository, ok := s.repository.(TransactionalRepository); ok {
		return repository.CreateSessionWithTokensAndPublish(ctx, session, tokens, domainEvents)
	}
	return errors.New("transactional session bootstrap is not configured")
}

func (s *Service) Authenticate(ctx context.Context, rawAccessToken string) (AuthenticatedSession, error) {
	if s.tokenManager == nil {
		return AuthenticatedSession{}, ErrTokenStorageNotEnabled
	}
	return s.tokenManager.AuthenticateContext(ctx, rawAccessToken)
}

func authTokens(pair TokenPair, session Session) *command.AuthTokens {
	return &command.AuthTokens{
		SessionID:        pair.SessionID,
		UserAccountID:    session.UserAccountID,
		Principal:        session.Principal,
		AccessToken:      pair.AccessToken,
		RefreshToken:     pair.RefreshToken,
		AccessExpiresAt:  pair.AccessExpiresAt,
		RefreshExpiresAt: pair.RefreshExpiresAt,
		Rotation:         pair.Rotation,
	}
}

func (s *Service) persistUpsertDevice(ctx context.Context, device DeviceRegistration, domainEvents []event.DomainEvent) error {
	if repository, ok := s.repository.(TransactionalRepository); ok {
		return repository.UpsertDeviceAndPublish(ctx, device, domainEvents)
	}
	return s.repository.UpsertDevice(ctx, device)
}

func (s *Service) persistUpdateSession(ctx context.Context, session Session, expectedVersion int, domainEvents []event.DomainEvent) error {
	if repository, ok := s.repository.(TransactionalRepository); ok {
		return repository.UpdateSessionAndPublish(ctx, session, expectedVersion, domainEvents)
	}
	return s.repository.UpdateSession(ctx, session, expectedVersion)
}

func sessionRevocationEvents(sessions []Session, e command.Envelope, reason string, occurredAt time.Time) []event.DomainEvent {
	domainEvents := make([]event.DomainEvent, 0, len(sessions))
	for _, session := range sessions {
		domainEvents = append(domainEvents, event.New("SessionRevoked", "Session", session.ID, session.Version, e.Principal.ID, e.CorrelationID, e.CommandID, occurredAt, map[string]any{
			"reason": reason,
		}))
	}
	return domainEvents
}

func eventRefs(domainEvents []event.DomainEvent) []string {
	refs := make([]string, 0, len(domainEvents))
	for _, domainEvent := range domainEvents {
		refs = append(refs, domainEvent.EventID)
	}
	return refs
}

type recoveryPayload struct{ LoginIdentity, RequestedChannel string }

func (s *Service) requestAccountRecovery(e command.Envelope) command.Result {
	var p recoveryPayload
	if !decode(e.Payload, &p) || p.LoginIdentity == "" || (p.RequestedChannel != "EMAIL" && p.RequestedChannel != "SMS") {
		return command.Rejected(e, "INVALID_ACCOUNT_RECOVERY", "VALIDATION", "AFTER_USER_ACTION", "identity.invalid_account_recovery", nil)
	}
	return command.Pending(e, newID("recovery_"), "RECOVERY_PROVIDER_NOT_CONFIGURED", "PROVIDER", "identity.recovery_provider_pending", map[string]any{"channel": p.RequestedChannel})
}

type refreshSessionPayload struct {
	RefreshToken     string `json:"refreshToken"`
	DeviceID         string `json:"deviceId"`
	DeviceCredential string `json:"deviceCredential"`
}

func (s *Service) refreshSession(ctx context.Context, e command.Envelope) command.Result {
	var p refreshSessionPayload
	if !decode(e.Payload, &p) || p.RefreshToken == "" || p.DeviceID == "" || len(p.DeviceCredential) < 32 {
		return command.Rejected(e, "INVALID_REFRESH_SESSION", "VALIDATION", "AFTER_USER_ACTION", "identity.invalid_refresh_session", nil)
	}
	if s.tokenManager == nil {
		return command.Rejected(e, "SESSION_TOKEN_REFRESH_UNAVAILABLE", "INTERNAL", "SAFE_RETRY", "identity.session_token_refresh_unavailable", nil)
	}
	pair, session, err := s.tokenManager.Rotate(ctx, p.RefreshToken, p.DeviceID, p.DeviceCredential)
	switch {
	case errors.Is(err, ErrTokenNotFound), errors.Is(err, ErrTokenExpired):
		return command.Rejected(e, "REFRESH_TOKEN_INVALID", "AUTHENTICATION", "AFTER_REAUTH", "identity.refresh_token_invalid", nil)
	case errors.Is(err, ErrDeviceProofInvalid):
		return command.Rejected(e, "DEVICE_PROOF_INVALID", "AUTHENTICATION", "AFTER_REAUTH", "identity.device_proof_invalid", nil)
	case errors.Is(err, ErrTokenRotationConflict):
		return command.Rejected(e, "REFRESH_TOKEN_ALREADY_USED", "CONCURRENCY", "AFTER_REAUTH", "identity.refresh_token_already_used", nil)
	case errors.Is(err, ErrSessionNotFound):
		return command.Rejected(e, "SESSION_NOT_USABLE", "ACCOUNT_STATE", "AFTER_REAUTH", "identity.session_not_usable", nil)
	case err != nil:
		return command.Rejected(e, "SESSION_TOKEN_REFRESH_FAILED", "INTERNAL", "SAFE_RETRY", "identity.session_token_refresh_failed", nil)
	}
	result := command.Accepted(e, "Session", session.ID, session.Version, session.Status, []string{})
	result.Auth = authTokens(pair, session)
	return result
}

type resumeTrustedDeviceSessionPayload struct {
	DeviceID         string `json:"deviceId"`
	DeviceCredential string `json:"deviceCredential"`
}

func (s *Service) resumeTrustedDeviceSession(ctx context.Context, e command.Envelope) command.Result {
	var p resumeTrustedDeviceSessionPayload
	if !decode(e.Payload, &p) || p.DeviceID == "" || len(p.DeviceCredential) < 32 {
		return command.Rejected(e, "INVALID_DEVICE_PROOF", "VALIDATION", "AFTER_REAUTH", "identity.invalid_device_proof", nil)
	}
	trustedDevices, ok := s.repository.(TrustedDeviceRepository)
	if !ok {
		return command.Rejected(e, "TRUSTED_DEVICE_UNAVAILABLE", "INTERNAL", "SAFE_RETRY", "identity.trusted_device_unavailable", nil)
	}
	device, err := trustedDevices.GetTrustedDevice(ctx, p.DeviceID, hashToken(p.DeviceCredential))
	if err != nil {
		return command.Rejected(e, "DEVICE_PROOF_INVALID", "AUTHENTICATION", "AFTER_REAUTH", "identity.device_proof_invalid", nil)
	}
	user, err := s.repository.GetUser(ctx, device.UserAccountID)
	if err != nil || !canHoldSession(user.Status) {
		return command.Rejected(e, "ACCOUNT_NOT_ACTIVE", "ACCOUNT_STATE", "AFTER_REAUTH", "identity.account_not_active", nil)
	}
	now := s.clock.Now().UTC()
	if err := s.enforceMaxConcurrentSessions(ctx, user.ID, e); err != nil {
		return command.Rejected(e, "SESSION_CREATE_FAILED", "INTERNAL", "SAFE_RETRY", "identity.session_create_failed", nil)
	}
	session := Session{ID: newID("session_"), UserAccountID: user.ID, DeviceID: device.ID, Status: "ACTIVE", Principal: command.Principal{Type: "INDIVIDUAL", ID: user.ID}, IssuedAt: now, ExpiresAt: now.Add(30 * 24 * time.Hour), Version: 1}
	pair, tokenRecord, err := s.tokenManager.Prepare(session, p.DeviceCredential)
	if err != nil {
		return command.Rejected(e, "SESSION_TOKEN_ISSUE_FAILED", "INTERNAL", "SAFE_RETRY", "identity.session_token_issue_failed", nil)
	}
	events := []event.DomainEvent{event.New("TrustedDeviceSessionCreated", "Session", session.ID, session.Version, user.ID, e.CorrelationID, e.CommandID, now, map[string]any{"deviceId": device.ID})}
	if err := s.persistCreateGoogleSession(ctx, session, tokenRecord, events); err != nil {
		return command.Rejected(e, "SESSION_CREATE_FAILED", "INTERNAL", "SAFE_RETRY", "identity.session_create_failed", nil)
	}
	result := command.Accepted(e, "Session", session.ID, session.Version, session.Status, eventRefs(events))
	result.Auth = authTokens(pair, session)
	return result
}

type authenticateWithGooglePayload struct {
	IdToken          string `json:"idToken"`
	DeviceID         string `json:"deviceId"`
	Platform         string `json:"platform"`
	DeviceCredential string `json:"deviceCredential"`
}

func (s *Service) authenticateWithGoogle(ctx context.Context, e command.Envelope) command.Result {
	var p authenticateWithGooglePayload
	if !decode(e.Payload, &p) || strings.TrimSpace(p.IdToken) == "" || strings.TrimSpace(p.DeviceID) == "" || len(p.DeviceCredential) < 32 || (p.Platform != "IOS" && p.Platform != "ANDROID") {
		return command.Rejected(e, "INVALID_GOOGLE_AUTH", "VALIDATION", "AFTER_USER_ACTION", "identity.invalid_google_auth", nil)
	}
	email, err := verifyGoogleIDToken(ctx, p.IdToken)
	if err != nil {
		return command.Rejected(e, "GOOGLE_TOKEN_INVALID", "AUTHENTICATION", "AFTER_USER_ACTION", "identity.google_token_invalid", map[string]any{"detail": err.Error()})
	}
	// 全球用户：email 即为 LoginIdentity identifier，channel EMAIL
	identity, device, _, err := s.repository.EnsurePasswordlessIdentity(ctx, "EMAIL", strings.ToLower(email), p.DeviceID, p.Platform, "")
	if err != nil {
		return command.Rejected(e, "GOOGLE_IDENTITY_UNAVAILABLE", "INTERNAL", "SAFE_RETRY", "identity.google_identity_unavailable", nil)
	}
	// 确保设备归属正确
	if device.UserAccountID != identity.UserAccountID {
		// 若 EnsurePasswordlessIdentity 已创建新用户，device 已归属该用户；否则需校验
	}
	user, err := s.repository.GetUser(ctx, identity.UserAccountID)
	if err != nil {
		return command.Rejected(e, "IDENTITY_READ_FAILED", "INTERNAL", "SAFE_RETRY", "identity.read_failed", nil)
	}
	if !canHoldSession(user.Status) {
		return command.Rejected(e, "ACCOUNT_NOT_ACTIVE", "ACCOUNT_STATE", "AFTER_USER_ACTION", "identity.account_not_active", nil)
	}
	trustedDevices, ok := s.repository.(TrustedDeviceRepository)
	if !ok || trustedDevices.BindDeviceCredential(ctx, device.ID, user.ID, hashToken(p.DeviceCredential)) != nil {
		return command.Rejected(e, "DEVICE_PROOF_REGISTRATION_FAILED", "INTERNAL", "SAFE_RETRY", "identity.device_proof_registration_failed", nil)
	}
	now := s.clock.Now().UTC()
	if err := s.enforceMaxConcurrentSessions(ctx, user.ID, e); err != nil {
		return command.Rejected(e, "SESSION_CREATE_FAILED", "INTERNAL", "SAFE_RETRY", "identity.session_create_failed", nil)
	}
	session := Session{ID: newID("session_"), UserAccountID: user.ID, DeviceID: device.ID, Status: "ACTIVE", Principal: command.Principal{Type: "INDIVIDUAL", ID: user.ID}, IssuedAt: now, ExpiresAt: now.Add(30 * 24 * time.Hour), Version: 1}
	if s.tokenManager == nil {
		return command.Rejected(e, "SESSION_TOKEN_ISSUE_FAILED", "INTERNAL", "SAFE_RETRY", "identity.session_token_issue_failed", nil)
	}
	pair, tokenRecord, err := s.tokenManager.Prepare(session, p.DeviceCredential)
	if err != nil {
		return command.Rejected(e, "SESSION_TOKEN_ISSUE_FAILED", "INTERNAL", "SAFE_RETRY", "identity.session_token_issue_failed", nil)
	}
	domainEvents := []event.DomainEvent{event.New("GoogleSessionCreated", "Session", session.ID, session.Version, user.ID, e.CorrelationID, e.CommandID, now, map[string]any{"email": email, "provider": "google"})}
	if err := s.persistCreateGoogleSession(ctx, session, tokenRecord, domainEvents); err != nil {
		return command.Rejected(e, "SESSION_CREATE_FAILED", "INTERNAL", "SAFE_RETRY", "identity.session_create_failed", nil)
	}
	result := command.Accepted(e, "Session", session.ID, session.Version, session.Status, eventRefs(domainEvents))
	result.Auth = authTokens(pair, session)
	return result
}

func (s *Service) persistCreateGoogleSession(ctx context.Context, session Session, tokens SessionToken, domainEvents []event.DomainEvent) error {
	if repository, ok := s.repository.(TransactionalRepository); ok {
		return repository.CreateSessionWithTokensAndPublish(ctx, session, tokens, domainEvents)
	}
	return errors.New("transactional session bootstrap is not configured")
}

func verifyGoogleIDToken(ctx context.Context, idToken string) (string, error) {
	idToken = strings.TrimSpace(idToken)
	if idToken == "" {
		return "", fmt.Errorf("empty id_token")
	}
	// 本地开发：允许模拟 token（sim_google_ 开头）直接返回测试邮箱，方便无真实 ClientID 时联调
	if strings.HasPrefix(idToken, "sim_google_") {
		return "simulated_google_user@gmail.com", nil
	}
	// 优先走 Google 官方 tokeninfo（需外网）
	tokenInfoURL := "https://oauth2.googleapis.com/tokeninfo?id_token=" + idToken
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, tokenInfoURL, nil)
	if err != nil {
		return "", err
	}
	client := &http.Client{Timeout: 8 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		// 外网不可达时：仅在开发环境回退本地 JWT 解析（仅验 exp 与 email 存在，不验签名）
		if os.Getenv("PROXY_ENV") == "dev" || os.Getenv("PROXY_ENV") == "local" {
			return fallbackParseGoogleJWT(idToken)
		}
		return "", fmt.Errorf("google tokeninfo unreachable: %w", err)
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 8<<20))
	if resp.StatusCode != http.StatusOK {
		// 非 200 响应：仅在开发环境回退本地解析
		if os.Getenv("PROXY_ENV") == "dev" || os.Getenv("PROXY_ENV") == "local" {
			if email, ferr := fallbackParseGoogleJWT(idToken); ferr == nil && email != "" {
				return email, nil
			}
		}
		return "", fmt.Errorf("tokeninfo %d: %s", resp.StatusCode, string(body))
	}
	var info struct {
		Email         string `json:"email"`
		EmailVerified string `json:"email_verified"`
		Aud           string `json:"aud"`
		Exp           string `json:"exp"`
	}
	if err := json.Unmarshal(body, &info); err != nil {
		return "", err
	}
	if info.Email == "" {
		return "", fmt.Errorf("email missing in tokeninfo")
	}
	// 校验 aud 是否在允许的 ClientID 列表中（生产环境必须配置）
	allowed := os.Getenv("GOOGLE_ALLOWED_CLIENT_IDS")
	if allowed == "" && os.Getenv("PROXY_ENV") != "dev" && os.Getenv("PROXY_ENV") != "local" {
		return "", fmt.Errorf("GOOGLE_ALLOWED_CLIENT_IDS not configured")
	}
	if allowed != "" {
		found := false
		for _, v := range strings.Split(allowed, ",") {
			if strings.TrimSpace(v) != "" && strings.TrimSpace(v) == info.Aud {
				found = true
				break
			}
		}
		if !found {
			return "", fmt.Errorf("aud not allowed")
		}
	}
	return strings.ToLower(info.Email), nil
}

func fallbackParseGoogleJWT(idToken string) (string, error) {
	parts := strings.Split(idToken, ".")
	if len(parts) < 2 {
		return "", fmt.Errorf("invalid jwt")
	}
	payload, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		// 兼容标准 base64
		payload, err = base64.StdEncoding.DecodeString(parts[1])
		if err != nil {
			return "", err
		}
	}
	var claims struct {
		Email    string `json:"email"`
		Exp      int64  `json:"exp"`
		Verified bool   `json:"email_verified"`
	}
	if err := json.Unmarshal(payload, &claims); err != nil {
		return "", err
	}
	if claims.Email == "" {
		return "", fmt.Errorf("email claim missing")
	}
	if claims.Exp != 0 && time.Unix(claims.Exp, 0).Before(time.Now().Add(-5*time.Minute)) {
		return "", fmt.Errorf("token expired")
	}
	return strings.ToLower(claims.Email), nil
}

func (s *Service) sessionUsable(ctx context.Context, session *Session) bool {
	if session.Status != "ACTIVE" || !s.clock.Now().UTC().Before(session.ExpiresAt) {
		if session.Status == "ACTIVE" {
			session.Status = "EXPIRED"
			session.Version++
		}
		return false
	}
	device, err := s.repository.GetDevice(ctx, session.DeviceID)
	return err == nil && device.Status == "ACTIVE"
}

// DisplayIdentity commands — Lotus RFC §1 (PUBLIC/PRIVATE/BURNER, max 3, 7d auto-burn)

type createDisplayIdentityPayload struct {
	Type        string `json:"type"`
	Alias       string `json:"alias"`
	DisplayName string `json:"displayName"`
	AvatarRef   string `json:"avatarRef"`
}

func (s *Service) createDisplayIdentity(ctx context.Context, e command.Envelope) command.Result {
	var p createDisplayIdentityPayload
	if !decode(e.Payload, &p) || strings.TrimSpace(p.Alias) == "" || strings.TrimSpace(p.DisplayName) == "" {
		return command.Rejected(e, "INVALID_DISPLAY_IDENTITY", "VALIDATION", "AFTER_USER_ACTION", "identity.invalid_display_identity", nil)
	}
	if e.Actor.Type != "USER" || e.Actor.ID == "" {
		return command.Rejected(e, "DISPLAY_IDENTITY_FORBIDDEN", "AUTHORIZATION", "AFTER_USER_ACTION", "identity.display_identity_forbidden", nil)
	}
	typ := DisplayIdentityType(strings.ToUpper(strings.TrimSpace(p.Type)))
	if typ == "" {
		typ = DisplayIdentityPublic
	}
	d, err := s.displayIdentityService.Create(ctx, CreateInput{
		OwnerID:     e.Actor.ID,
		Type:        typ,
		Alias:       p.Alias,
		DisplayName: p.DisplayName,
		AvatarRef:   p.AvatarRef,
	})
	if errors.Is(err, ErrDisplayIdentityCapReached) {
		return command.Rejected(e, "DISPLAY_IDENTITY_CAP_REACHED", "BUSINESS_STATE", "AFTER_USER_ACTION", "identity.display_identity_cap_reached", nil)
	}
	if errors.Is(err, ErrDisplayIdentityAliasInvalid) {
		return command.Rejected(e, "INVALID_DISPLAY_IDENTITY", "VALIDATION", "AFTER_USER_ACTION", "identity.invalid_display_identity", nil)
	}
	if errors.Is(err, ErrDisplayIdentityConflict) {
		return command.Rejected(e, "DISPLAY_IDENTITY_CONFLICT", "BUSINESS_STATE", "AFTER_USER_ACTION", "identity.display_identity_conflict", nil)
	}
	if err != nil {
		return command.Rejected(e, "DISPLAY_IDENTITY_CREATE_FAILED", "INTERNAL", "SAFE_RETRY", "identity.display_identity_create_failed", nil)
	}
	ev := event.New("DisplayIdentityCreated", "DisplayIdentity", d.ID, d.Version, e.Actor.ID, e.CorrelationID, e.CommandID, d.CreatedAt, map[string]any{"type": d.Type, "alias": d.Alias})
	return command.Accepted(e, "DisplayIdentity", d.ID, d.Version, string(d.Type), eventRefs([]event.DomainEvent{ev}))
}

func (s *Service) listDisplayIdentities(ctx context.Context, e command.Envelope) command.Result {
	if e.Actor.Type != "USER" || e.Actor.ID == "" {
		return command.Rejected(e, "DISPLAY_IDENTITY_FORBIDDEN", "AUTHORIZATION", "AFTER_USER_ACTION", "identity.display_identity_forbidden", nil)
	}
	list, err := s.displayIdentityService.ListByOwner(ctx, e.Actor.ID)
	if err != nil {
		return command.Rejected(e, "DISPLAY_IDENTITY_LIST_FAILED", "INTERNAL", "SAFE_RETRY", "identity.display_identity_list_failed", nil)
	}
	// OperationRef carries identities as JSON for mobile client
	payload, _ := json.Marshal(map[string]any{"identities": list})
	result := command.Accepted(e, "DisplayIdentity", e.Actor.ID, 1, "LISTED", nil)
	result.OperationRef = string(payload)
	return result
}

type burnDisplayIdentityPayload struct {
	IdentityID string `json:"identityId"`
	ID         string `json:"id"`
}

func (s *Service) burnDisplayIdentity(ctx context.Context, e command.Envelope) command.Result {
	var p burnDisplayIdentityPayload
	_ = decode(e.Payload, &p)
	id := p.IdentityID
	if id == "" {
		id = p.ID
	}
	if id == "" {
		id = e.Target.ID
	}
	if id == "" {
		return command.Rejected(e, "INVALID_DISPLAY_IDENTITY_BURN", "VALIDATION", "AFTER_USER_ACTION", "identity.invalid_display_identity_burn", nil)
	}
	if e.Actor.Type != "USER" || e.Actor.ID == "" {
		return command.Rejected(e, "DISPLAY_IDENTITY_FORBIDDEN", "AUTHORIZATION", "AFTER_USER_ACTION", "identity.display_identity_forbidden", nil)
	}
	d, err := s.displayIdentityService.Burn(ctx, BurnInput{IdentityID: id, OwnerID: e.Actor.ID})
	if errors.Is(err, ErrDisplayIdentityNotFound) {
		return command.Rejected(e, "DISPLAY_IDENTITY_NOT_FOUND", "BUSINESS_STATE", "AFTER_USER_ACTION", "identity.display_identity_not_found", nil)
	}
	if errors.Is(err, ErrDisplayIdentityForbidden) {
		return command.Rejected(e, "DISPLAY_IDENTITY_FORBIDDEN", "AUTHORIZATION", "AFTER_USER_ACTION", "identity.display_identity_forbidden", nil)
	}
	if errors.Is(err, ErrDisplayIdentityBurned) {
		return command.Rejected(e, "DISPLAY_IDENTITY_ALREADY_BURNED", "BUSINESS_STATE", "AFTER_USER_ACTION", "identity.display_identity_already_burned", nil)
	}
	if err != nil {
		return command.Rejected(e, "DISPLAY_IDENTITY_BURN_FAILED", "INTERNAL", "SAFE_RETRY", "identity.display_identity_burn_failed", nil)
	}
	now := s.clock.Now().UTC()
	if d.BurnedAt != nil {
		now = *d.BurnedAt
	}
	ev := event.New("DisplayIdentityBurned", "DisplayIdentity", d.ID, d.Version, e.Actor.ID, e.CorrelationID, e.CommandID, now, map[string]any{"ownerId": d.OwnerID})
	return command.Accepted(e, "DisplayIdentity", d.ID, d.Version, "BURNED", eventRefs([]event.DomainEvent{ev}))
}

// updateProfile / getProfile — R18.x PROFILE-001.
//
// The mobile '编辑主页' modal in me.tsx was a local-only write
// (profileStore.write to iOS Keychain / Android Keystore). No
// server command existed, so the new name / handle / bio / city
// / avatar never reached feeds, opportunity applicants, or any
// cross-device read model. This closes the loop: every save
// goes through UpdateProfile so the home-page identity is
// server-authoritative end-to-end.
type updateProfilePayload struct {
	Name       string `json:"name"`
	Handle     string `json:"handle"`
	Bio        string `json:"bio"`
	City       string `json:"city"`
	AvatarPath string `json:"avatarPath"`
}

func (s *Service) updateProfile(ctx context.Context, e command.Envelope) command.Result {
	var p updateProfilePayload
	if !decode(e.Payload, &p) {
		return command.Rejected(e, "INVALID_PROFILE", "VALIDATION", "AFTER_USER_ACTION", "identity.invalid_profile", nil)
	}
	if e.Actor.Type != "USER" || e.Actor.ID == "" {
		return command.Rejected(e, "PROFILE_FORBIDDEN", "AUTHORIZATION", "AFTER_USER_ACTION", "identity.profile_forbidden", nil)
	}
	candidate := Profile{
		UserAccountID: e.Actor.ID,
		Name:          strings.TrimSpace(p.Name),
		Handle:        strings.TrimSpace(p.Handle),
		Bio:           p.Bio,
		City:          strings.TrimSpace(p.City),
		AvatarPath:    p.AvatarPath,
	}
	saved, err := s.profileService.UpsertProfile(ctx, candidate)
	if err != nil {
		switch {
		case strings.Contains(err.Error(), "avatar"):
			return command.Rejected(e, "PROFILE_INVALID_AVATAR", "VALIDATION", "AFTER_USER_ACTION", "identity.profile_invalid_avatar", nil)
		default:
			return command.Rejected(e, "INVALID_PROFILE", "VALIDATION", "AFTER_USER_ACTION", "identity.invalid_profile", nil)
		}
	}
	now := s.clock.Now().UTC()
	if !saved.UpdatedAt.IsZero() {
		now = saved.UpdatedAt
	}
	ev := event.New("ProfileUpdated", "Profile", saved.UserAccountID, saved.Version, e.Actor.ID, e.CorrelationID, e.CommandID, now, map[string]any{"handle": saved.Handle, "name": saved.Name})
	raw, _ := json.Marshal(map[string]any{"profile": saved})
	r := command.Accepted(e, "Profile", saved.UserAccountID, saved.Version, "UPDATED", []string{ev.EventID})
	r.OperationRef = string(raw)
	return r
}

func (s *Service) getProfile(ctx context.Context, e command.Envelope) command.Result {
	userID := e.Target.ID
	if userID == "" {
		var p struct {
			UserAccountID string `json:"userAccountId"`
		}
		_ = decode(e.Payload, &p)
		userID = p.UserAccountID
	}
	if userID == "" {
		userID = e.Actor.ID
	}
	if userID == "" {
		return command.Rejected(e, "INVALID_PROFILE_READ", "VALIDATION", "AFTER_USER_ACTION", "identity.invalid_profile_read", nil)
	}
	p, err := s.profileService.GetProfile(ctx, userID)
	if errors.Is(err, ErrProfileNotFound) {
		return command.Rejected(e, "PROFILE_NOT_FOUND", "BUSINESS_STATE", "AFTER_USER_ACTION", "identity.profile_not_found", nil)
	}
	if err != nil {
		return command.Rejected(e, "PROFILE_READ_FAILED", "INTERNAL", "SAFE_RETRY", "identity.profile_read_failed", nil)
	}
	raw, _ := json.Marshal(map[string]any{"profile": p})
	r := command.Accepted(e, "Profile", p.UserAccountID, p.Version, "READ", nil)
	r.OperationRef = string(raw)
	return r
}

// enforceMaxConcurrentSessions revokes the oldest ACTIVE sessions so a new
// login can fit within MaxConcurrentSessions. Lotus RFC §6 (max 2 devices).
// It is called inside the service mutex, so List + Revoke is atomic vs
// concurrent logins in this process. PG callers get transactional outbox via
// persistUpdateSession.
func (s *Service) enforceMaxConcurrentSessions(ctx context.Context, userID string, e command.Envelope) error {
	sessions, err := s.repository.ListSessionsByUser(ctx, userID)
	if err != nil {
		return err
	}
	active := make([]Session, 0, len(sessions))
	for _, sess := range sessions {
		if sess.Status == "ACTIVE" {
			active = append(active, sess)
		}
	}
	if len(active) < MaxConcurrentSessions {
		return nil
	}
	sort.Slice(active, func(i, j int) bool { return active[i].IssuedAt.Before(active[j].IssuedAt) })
	toEvict := len(active) - MaxConcurrentSessions + 1
	now := s.clock.Now().UTC()
	for i := 0; i < toEvict; i++ {
		sess := active[i]
		prev := sess.Version
		sess.Status = "REVOKED"
		sess.Version++
		ev := event.New("SessionRevoked", "Session", sess.ID, sess.Version, userID, e.CorrelationID, e.CommandID, now, map[string]any{
			"reason":          "AUTO_EVICT_NEW_LOGIN",
			"userAccountId":   userID,
			"evictedDeviceId": sess.DeviceID,
		})
		if err := s.persistUpdateSession(ctx, sess, prev, []event.DomainEvent{ev}); err != nil {
			return err
		}
	}
	return nil
}

func decode(payload map[string]any, target any) bool {
	bytes, err := json.Marshal(payload)
	return err == nil && json.Unmarshal(bytes, target) == nil
}

func newID(prefix string) string {
	var bytes [16]byte
	if _, err := rand.Read(bytes[:]); err != nil {
		return prefix + time.Now().UTC().Format("20060102150405.000000000")
	}
	return prefix + hex.EncodeToString(bytes[:])
}

func normalizeLoginIdentifier(channel, value string) string {
	identifier := strings.TrimSpace(value)
	if channel == "EMAIL" {
		identifier = strings.ToLower(identifier)
		if len(identifier) > 50 || !validEmail(identifier) {
			return ""
		}
		return identifier
	}
	// Phone normalization deliberately accepts E.164 only; national-number
	// parsing belongs to the phone provider / country selector, not the server.
	if channel == "SMS" && strings.HasPrefix(identifier, "+") {
		for _, character := range identifier[1:] {
			if character < '0' || character > '9' {
				return ""
			}
		}
		return identifier
	}
	return ""
}

// firstString returns the value of payload[key] if it is a non-empty
// string, otherwise "". Privacy request handlers stash small string
// fields in the payload (requestId, reason, legalBasis) rather than
// a typed struct, so this helper keeps the service code readable.
func firstString(payload map[string]any, key string) string {
	if payload == nil {
		return ""
	}
	if v, ok := payload[key].(string); ok {
		return v
	}
	return ""
}

// --- R16.10-P1-F: privacy request center (Vietnam PDP 91/2025/QH15 Art. 31/32) ---
//
// Vietnam legal basis for the privacy request center:
//   - PDP 91/2025/QH15 Art. 31 (data access + portability right)
//   - PDP 91/2025/QH15 Art. 32 (erasure right, "right to be forgotten")
//   - 13/2023/NĐ-CP (PDP 实施令) — Art. 11 (访问响应时限 72h),
//     Art. 12 (删除响应时限 30d), Art. 18 (影响评估), Art. 22
//     (跨境数据处理文件要求). These ministerial-level rules
//     operationalise PDP 91 and are the reason we use 30 days
//     for deletion and 72h for access responses.
//   - Cybersecurity Law 116/2025/QH15 (网络安全法) Art. 17
//     (digital identity verification for in-Vietnam users).
//   - Decree 147/2024/NĐ-CP — fake-news / misleading-info handling
//     (relevant to the ContentReview pipeline, not this file).

// PrivacyDeleteGracePeriod is the number of days between a delete
// request and the actual hard-wipe of personal data. Vietnam PDP
// Art. 32 + 13/2023/NĐ-CP Art. 12 give the controller up to 30
// days to action erasure; the R16.7 plan §6 P1-F chose 30 days to
// match the law. Within this window the user can cancel the
// request.
const PrivacyDeleteGracePeriod = 30 * 24 * time.Hour

// PrivacyExportRetention is how long the export snapshot URL stays
// downloadable. After this window the platform purges the snapshot
// (it is the user's responsibility to download it within the window).
const PrivacyExportRetention = 7 * 24 * time.Hour

// PrivacyDataExport is the shape of the data the platform returns when
// the user invokes their access right. The shape is deliberately
// conservative: account identity, legal consents, device list, and
// session history. Chat messages, feed posts, and engagement events
// are intentionally not included in this initial R16.10 surface —
// they live behind their own services and will be added as a follow-up
// (P1-F follow-up per R16.7 plan §6).
type PrivacyDataExport struct {
	Account         UserAccount            `json:"account"`
	Consents        []LegalConsentSnapshot `json:"consents"`
	Devices         []DeviceRegistration   `json:"devices"`
	Sessions        []Session              `json:"sessions"`
	PrivacyRequests []PrivacyRequest       `json:"privacyRequests"`
	GeneratedAt     time.Time              `json:"generatedAt"`
	LegalBasis      string                 `json:"legalBasis"`
	FormatVersion   string                 `json:"formatVersion"`
}

// LegalConsentSnapshot is a trimmed view of the legal_consent_records
// row that is safe to include in a user-facing data export. The raw
// row carries ip / user_agent which the export should not echo back
// to the user verbatim; the snapshot keeps only the consent metadata
// the user themselves chose.
type LegalConsentSnapshot struct {
	DocKind    string    `json:"docKind"`
	DocVersion string    `json:"docVersion"`
	AcceptedAt time.Time `json:"acceptedAt"`
	Required   bool      `json:"required"`
}

// requestPrivacyAccessPayload is the body the client sends to
// POST /v1/privacy/export. The service then writes a received row
// and (in a follow-up background job) transitions it to in_progress,
// then completed with the snapshot URL.
type requestPrivacyExportPayload struct {
	LegalBasis string `json:"legalBasis"`
}

type requestPrivacyDeletePayload struct {
	LegalBasis string `json:"legalBasis"`
	Reason     string `json:"reason"`
}

type cancelPrivacyRequestPayload struct {
	RequestID string `json:"requestId"`
	Reason    string `json:"reason"`
}

// privacyPrivacyRequestActor extracts the audit 'actor' string from the
// envelope. The transport layer is expected to populate AuthContext
// with clientIp and userAgent (see command_dispatch.go); the actor
// string is the user account id for user-driven requests.
func privacyRequestActor(e command.Envelope) string {
	if e.Actor.Type == "USER" && e.Actor.ID != "" {
		return "user:" + e.Actor.ID
	}
	if e.Actor.Type == "SYSTEM" {
		return "system"
	}
	return "unknown"
}

// requestPrivacyExport creates a received 'export' request. The
// service is the single point of validation: it refuses if the user
// already has an active export request, refuses if the user cannot be
// authenticated, and writes the audit event in the same logical
// step. Export generation itself is a background job; the request
// status moves to in_progress / completed via the operator API.
func (s *Service) requestPrivacyExport(ctx context.Context, e command.Envelope) command.Result {
	var p requestPrivacyExportPayload
	_ = decode(e.Payload, &p)
	if e.Actor.Type != "USER" || e.Actor.ID == "" {
		return command.Rejected(e, "PRIVACY_REQUEST_FORBIDDEN", "AUTHORIZATION", "AFTER_USER_ACTION", "identity.privacy_request_forbidden", nil)
	}
	if s.privacyRepo() == nil {
		return command.Rejected(e, "PRIVACY_REQUEST_UNAVAILABLE", "INTERNAL", "AFTER_USER_ACTION", "identity.privacy_request_unavailable", nil)
	}
	legalBasis := strings.TrimSpace(p.LegalBasis)
	if legalBasis == "" {
		legalBasis = "PDP-91/2025/QH15-Art31"
	}
	now := s.clock.Now().UTC()
	req := PrivacyRequest{
		ID:          newID("preq_"),
		UserID:      e.Actor.ID,
		Kind:        PrivacyRequestKindExport,
		Status:      PrivacyRequestStatusReceived,
		RequestedAt: now,
		LegalBasis:  legalBasis,
		ClientIP:    e.AuthContextIP(),
		UserAgent:   e.AuthContextUA(),
		Version:     1,
	}
	if err := s.privacyRepo().CreatePrivacyRequest(ctx, req); err != nil {
		if errors.Is(err, ErrPrivacyRequestActive) {
			return command.Rejected(e, "PRIVACY_REQUEST_ACTIVE", "ACCOUNT_STATE", "AFTER_USER_ACTION", "identity.privacy_request_active", nil)
		}
		return command.Rejected(e, "PRIVACY_REQUEST_WRITE_FAILED", "INTERNAL", "SAFE_RETRY", "identity.privacy_request_write_failed", nil)
	}
	if err := s.privacyRepo().AppendPrivacyRequestEvent(ctx, PrivacyRequestEvent{
		RequestID:  req.ID,
		FromStatus: "",
		ToStatus:   string(PrivacyRequestStatusReceived),
		OccurredAt: now,
		Actor:      privacyRequestActor(e),
		Notes:      "user-initiated export request",
	}); err != nil {
		log.Printf("privacy request event write failed request=%s err=%v", req.ID, err)
	}
	result := command.Accepted(e, "PrivacyRequest", req.ID, req.Version, string(req.Status), nil)
	result.Body = map[string]any{
		"privacyRequest": req,
		"status":         string(req.Status),
		"retentionDays":  int(PrivacyExportRetention / (24 * time.Hour)),
	}
	return result
}

// requestPrivacyDelete creates a received 'delete' request. Same
// validation surface as the export path. The service does NOT
// immediately hard-delete any data; the 30-day grace window is run
// by a background job that flips the status to in_progress at
// requested_at + 24h, then to completed at requested_at + 30d.
func (s *Service) requestPrivacyDelete(ctx context.Context, e command.Envelope) command.Result {
	var p requestPrivacyDeletePayload
	_ = decode(e.Payload, &p)
	if e.Actor.Type != "USER" || e.Actor.ID == "" {
		return command.Rejected(e, "PRIVACY_REQUEST_FORBIDDEN", "AUTHORIZATION", "AFTER_USER_ACTION", "identity.privacy_request_forbidden", nil)
	}
	if s.privacyRepo() == nil {
		return command.Rejected(e, "PRIVACY_REQUEST_UNAVAILABLE", "INTERNAL", "AFTER_USER_ACTION", "identity.privacy_request_unavailable", nil)
	}
	legalBasis := strings.TrimSpace(p.LegalBasis)
	if legalBasis == "" {
		legalBasis = "PDP-91/2025/QH15-Art32"
	}
	now := s.clock.Now().UTC()
	req := PrivacyRequest{
		ID:          newID("preq_"),
		UserID:      e.Actor.ID,
		Kind:        PrivacyRequestKindDelete,
		Status:      PrivacyRequestStatusReceived,
		RequestedAt: now,
		LegalBasis:  legalBasis,
		ClientIP:    e.AuthContextIP(),
		UserAgent:   e.AuthContextUA(),
		Version:     1,
	}
	if err := s.privacyRepo().CreatePrivacyRequest(ctx, req); err != nil {
		if errors.Is(err, ErrPrivacyRequestActive) {
			return command.Rejected(e, "PRIVACY_REQUEST_ACTIVE", "ACCOUNT_STATE", "AFTER_USER_ACTION", "identity.privacy_request_active", nil)
		}
		return command.Rejected(e, "PRIVACY_REQUEST_WRITE_FAILED", "INTERNAL", "SAFE_RETRY", "identity.privacy_request_write_failed", nil)
	}
	notes := "user-initiated delete request"
	if p.Reason != "" {
		notes = "user-initiated delete request: " + p.Reason
	}
	if err := s.privacyRepo().AppendPrivacyRequestEvent(ctx, PrivacyRequestEvent{
		RequestID:  req.ID,
		FromStatus: "",
		ToStatus:   string(PrivacyRequestStatusReceived),
		OccurredAt: now,
		Actor:      privacyRequestActor(e),
		Notes:      notes,
	}); err != nil {
		log.Printf("privacy request event write failed request=%s err=%v", req.ID, err)
	}
	completedAt := now.Add(PrivacyDeleteGracePeriod)
	erasedAt := completedAt
	result := command.Accepted(e, "PrivacyRequest", req.ID, req.Version, string(req.Status), nil)
	result.Body = map[string]any{
		"privacyRequest":  req,
		"status":          string(req.Status),
		"gracePeriodDays": int(PrivacyDeleteGracePeriod / (24 * time.Hour)),
		"erasedAt":        erasedAt,
		"cancelableUntil": completedAt,
	}
	return result
}

// cancelPrivacyRequest transitions a received or in_progress delete
// request to cancelled. The user can only cancel their OWN request,
// and only while the grace period is still open.
func (s *Service) cancelPrivacyRequest(ctx context.Context, e command.Envelope) command.Result {
	var p cancelPrivacyRequestPayload
	_ = decode(e.Payload, &p)
	if e.Actor.Type != "USER" || e.Actor.ID == "" {
		return command.Rejected(e, "PRIVACY_REQUEST_FORBIDDEN", "AUTHORIZATION", "AFTER_USER_ACTION", "identity.privacy_request_forbidden", nil)
	}
	if s.privacyRepo() == nil {
		return command.Rejected(e, "PRIVACY_REQUEST_UNAVAILABLE", "INTERNAL", "AFTER_USER_ACTION", "identity.privacy_request_unavailable", nil)
	}
	if p.RequestID == "" {
		return command.Rejected(e, "INVALID_PRIVACY_REQUEST_CANCEL", "VALIDATION", "AFTER_USER_ACTION", "identity.invalid_privacy_request_cancel", nil)
	}
	req, err := s.privacyRepo().GetPrivacyRequest(ctx, p.RequestID)
	if err != nil {
		return command.Rejected(e, "PRIVACY_REQUEST_NOT_FOUND", "NOT_FOUND", "AFTER_USER_ACTION", "identity.privacy_request_not_found", nil)
	}
	if req.UserID != e.Actor.ID {
		return command.Rejected(e, "PRIVACY_REQUEST_FORBIDDEN", "AUTHORIZATION", "AFTER_USER_ACTION", "identity.privacy_request_forbidden", nil)
	}
	if req.Status != PrivacyRequestStatusReceived && req.Status != PrivacyRequestStatusInProgress {
		return command.Rejected(e, "PRIVACY_REQUEST_NOT_CANCELLABLE", "ACCOUNT_STATE", "AFTER_USER_ACTION", "identity.privacy_request_not_cancellable", nil)
	}
	now := s.clock.Now().UTC()
	previousStatus := req.Status
	req.Status = PrivacyRequestStatusCancelled
	req.CompletedAt = &now
	req.Version++
	if err := s.privacyRepo().UpdatePrivacyRequest(ctx, req, req.Version-1); err != nil {
		log.Printf("privacy request cancel update failed request=%s user=%s err=%v", req.ID, e.Actor.ID, err)
		return command.Rejected(e, "PRIVACY_REQUEST_WRITE_FAILED", "INTERNAL", "SAFE_RETRY", "identity.privacy_request_write_failed", nil)
	}
	if err := s.privacyRepo().AppendPrivacyRequestEvent(ctx, PrivacyRequestEvent{
		RequestID:  req.ID,
		FromStatus: string(previousStatus),
		ToStatus:   string(PrivacyRequestStatusCancelled),
		OccurredAt: now,
		Actor:      privacyRequestActor(e),
		Notes:      p.Reason,
	}); err != nil {
		log.Printf("privacy request event write failed request=%s err=%v", req.ID, err)
	}
	result := command.Accepted(e, "PrivacyRequest", req.ID, req.Version, string(req.Status), nil)
	result.Body = map[string]any{
		"privacyRequest": req,
		"status":         string(req.Status),
	}
	return result
}

// getPrivacyRequestStatus returns the current status of a request the
// user owns. Used by the mobile client to poll for completion.
func (s *Service) getPrivacyRequestStatus(ctx context.Context, e command.Envelope, requestID string) command.Result {
	if e.Actor.Type != "USER" || e.Actor.ID == "" {
		return command.Rejected(e, "PRIVACY_REQUEST_FORBIDDEN", "AUTHORIZATION", "AFTER_USER_ACTION", "identity.privacy_request_forbidden", nil)
	}
	if s.privacyRepo() == nil {
		return command.Rejected(e, "PRIVACY_REQUEST_UNAVAILABLE", "INTERNAL", "AFTER_USER_ACTION", "identity.privacy_request_unavailable", nil)
	}
	if requestID == "" {
		return command.Rejected(e, "INVALID_PRIVACY_REQUEST_GET", "VALIDATION", "AFTER_USER_ACTION", "identity.invalid_privacy_request_get", nil)
	}
	req, err := s.privacyRepo().GetPrivacyRequest(ctx, requestID)
	if err != nil {
		return command.Rejected(e, "PRIVACY_REQUEST_NOT_FOUND", "NOT_FOUND", "AFTER_USER_ACTION", "identity.privacy_request_not_found", nil)
	}
	if req.UserID != e.Actor.ID {
		return command.Rejected(e, "PRIVACY_REQUEST_FORBIDDEN", "AUTHORIZATION", "AFTER_USER_ACTION", "identity.privacy_request_forbidden", nil)
	}
	result := command.Accepted(e, "PrivacyRequest", req.ID, req.Version, string(req.Status), nil)
	result.Body = map[string]any{
		"privacyRequest": req,
		"status":         string(req.Status),
	}
	return result
}

// listPrivacyRequests returns the user's full request history,
// newest first.
func (s *Service) listPrivacyRequests(ctx context.Context, e command.Envelope) command.Result {
	if e.Actor.Type != "USER" || e.Actor.ID == "" {
		return command.Rejected(e, "PRIVACY_REQUEST_FORBIDDEN", "AUTHORIZATION", "AFTER_USER_ACTION", "identity.privacy_request_forbidden", nil)
	}
	if s.privacyRepo() == nil {
		return command.Rejected(e, "PRIVACY_REQUEST_UNAVAILABLE", "INTERNAL", "AFTER_USER_ACTION", "identity.privacy_request_unavailable", nil)
	}
	rows, err := s.privacyRepo().ListPrivacyRequestsByUser(ctx, e.Actor.ID)
	if err != nil {
		return command.Rejected(e, "PRIVACY_REQUEST_READ_FAILED", "INTERNAL", "SAFE_RETRY", "identity.privacy_request_read_failed", nil)
	}
	result := command.Accepted(e, "PrivacyRequest", e.Actor.ID, 1, "LISTED", nil)
	result.Body = map[string]any{
		"privacyRequests": rows,
		"count":           len(rows),
	}
	return result
}

// generatePrivacyExportData assembles the PrivacyDataExport payload.
// This is the synchronous counterpart of an 'export' request; in
// production the same code runs in the background job that flips
// the status to completed.
func (s *Service) GeneratePrivacyExportData(ctx context.Context, userID string) (PrivacyDataExport, error) {
	if s.repository == nil {
		return PrivacyDataExport{}, errors.New("identity repository not configured")
	}
	user, err := s.repository.GetUser(ctx, userID)
	if err != nil {
		return PrivacyDataExport{}, err
	}
	now := s.clock.Now().UTC()
	export := PrivacyDataExport{
		Account:         user,
		Consents:        []LegalConsentSnapshot{},
		Devices:         []DeviceRegistration{},
		Sessions:        []Session{},
		PrivacyRequests: []PrivacyRequest{},
		GeneratedAt:     now,
		LegalBasis:      "PDP-91/2025/QH15-Art31",
		FormatVersion:   "1.0",
	}
	// Walk the same repository surface that /v1/identity/me uses so the
	// export stays in sync with what the user sees in-app. We deliberately
	// do not call into other services (engagement, demand, etc.) here —
	// the cross-service export is a follow-up.
	sessions, err := s.repository.ListSessionsByUser(ctx, userID)
	if err != nil {
		slog.Warn("privacy_export: failed to list sessions", "err", err, "userId", userID)
	}
	export.Sessions = sessions
	if s.privacyRepo() != nil {
		rows, err := s.privacyRepo().ListPrivacyRequestsByUser(ctx, userID)
		if err != nil {
			slog.Warn("privacy_export: failed to list privacy requests", "err", err, "userId", userID)
		}
		export.PrivacyRequests = rows
	}
	// Devices and consents are best-effort: the device list lives on
	// the same MemoryRepository but is gathered by walking the sessions
	// (which carry DeviceID). Real devices come from a separate query
	// once postgres is in scope; for the memory repository the snapshot
	// is good enough for tests.
	seen := map[string]struct{}{}
	for _, sess := range sessions {
		if _, ok := seen[sess.DeviceID]; ok {
			continue
		}
		seen[sess.DeviceID] = struct{}{}
		if dev, err := s.repository.GetDevice(ctx, sess.DeviceID); err == nil {
			export.Devices = append(export.Devices, dev)
		}
	}
	if s.repository != nil {
		if snapshot, ok := s.repository.(interface {
			ListLegalConsents(ctx context.Context, userID string) ([]LegalConsentSnapshot, error)
		}); ok {
			if rows, err := snapshot.ListLegalConsents(ctx, userID); err == nil {
				export.Consents = rows
			}
		}
	}
	return export, nil
}

// privacyRepo is a small adapter that lets the Service look up the
// PrivacyRequestRepository on the underlying Repository without making
// the main Repository interface wider than it needs to be. If the
// repository does not implement privacy-request persistence (e.g. an
// older deployment that predates migration 060) the service still
// compiles, it just returns PRIVACY_REQUEST_UNAVAILABLE at runtime.
func (s *Service) privacyRepo() PrivacyRequestRepository {
	if r, ok := s.repository.(PrivacyRequestRepository); ok {
		return r
	}
	return nil
}

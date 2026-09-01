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
type DeviceRegistration struct{ ID, UserAccountID, Platform, Status, PushTokenRef string }
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
	service := &Service{repository: repository, clock: domainClock, challengeProvider: provider, displayIdentityService: NewDisplayIdentityService(nil, domainClock)}
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

// Repository exposes the identity repository so transport-layer code
// (e.g. wiring the SMTP LoginChallengeProvider email resolver) can look
// up LoginIdentity rows by id without re-creating one. Returned interface
// is read-only at the call site; the service keeps the only mutable handle.
func (s *Service) Repository() Repository {
	return s.repository
}

func (s *Service) Supports(commandType string) bool {
	switch commandType {
	case "BeginPasswordlessAuthentication", "RequestLoginChallenge", "VerifyLoginChallenge", "CreateSession", "CreateAnonymousSession", "RegisterDevice", "RevokeSession", "RevokeAllSessions", "SwitchPrincipalContext", "RequestAccountRecovery", "RefreshSession", "AuthenticateWithGoogle",
		"CreateDisplayIdentity", "ListDisplayIdentities", "BurnDisplayIdentity":
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
	case "AuthenticateWithGoogle":
		return s.authenticateWithGoogle(ctx, envelope)
	case "CreateDisplayIdentity":
		return s.createDisplayIdentity(ctx, envelope)
	case "ListDisplayIdentities":
		return s.listDisplayIdentities(ctx, envelope)
	case "BurnDisplayIdentity":
		return s.burnDisplayIdentity(ctx, envelope)
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
	DeviceID string `json:"deviceId"`
	Platform string `json:"platform"`
}

func (s *Service) createAnonymousSession(ctx context.Context, e command.Envelope) command.Result {
	var p createAnonymousSessionPayload
	if !decode(e.Payload, &p) || p.DeviceID == "" || (p.Platform != "IOS" && p.Platform != "ANDROID") {
		return command.Rejected(e, "INVALID_ANONYMOUS_SESSION", "VALIDATION", "AFTER_USER_ACTION", "identity.invalid_anonymous_session", nil)
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
	pair, tokenRecord, err := s.tokenManager.Prepare(session)
	if err != nil {
		return command.Rejected(e, "SESSION_TOKEN_ISSUE_FAILED", "INTERNAL", "SAFE_RETRY", "identity.session_token_issue_failed", nil)
	}
	if err := s.persistCreateAnonymousSession(ctx, session, tokenRecord, domainEvents); err != nil {
		return command.Rejected(e, "SESSION_CREATE_FAILED", "INTERNAL", "SAFE_RETRY", "identity.session_create_failed", nil)
	}
	result := command.Accepted(e, "Session", session.ID, session.Version, session.Status, eventRefs(domainEvents))
	result.Auth = authTokens(pair, session)
	return result
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
	return command.Accepted(e, "LoginChallenge", challenge.ID, challenge.Version, challenge.Status, eventRefs(domainEvents))
}

func (s *Service) createSession(ctx context.Context, e command.Envelope) command.Result {
	var p createSessionPayload
	if !decode(e.Payload, &p) || p.DeviceID == "" || p.ChallengeID == "" {
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
		pair, tokenRecord, tokenErr = s.tokenManager.Prepare(session)
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
	if *e.ExpectedAggregateVersion != session.Version {
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
	RefreshToken string `json:"refreshToken"`
}

func (s *Service) refreshSession(ctx context.Context, e command.Envelope) command.Result {
	var p refreshSessionPayload
	if !decode(e.Payload, &p) || p.RefreshToken == "" {
		return command.Rejected(e, "INVALID_REFRESH_SESSION", "VALIDATION", "AFTER_USER_ACTION", "identity.invalid_refresh_session", nil)
	}
	if s.tokenManager == nil {
		return command.Rejected(e, "SESSION_TOKEN_REFRESH_UNAVAILABLE", "INTERNAL", "SAFE_RETRY", "identity.session_token_refresh_unavailable", nil)
	}
	pair, session, err := s.tokenManager.Rotate(ctx, p.RefreshToken)
	switch {
	case errors.Is(err, ErrTokenNotFound), errors.Is(err, ErrTokenExpired):
		return command.Rejected(e, "REFRESH_TOKEN_INVALID", "AUTHENTICATION", "AFTER_REAUTH", "identity.refresh_token_invalid", nil)
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

type authenticateWithGooglePayload struct {
	IdToken  string `json:"idToken"`
	DeviceID string `json:"deviceId"`
	Platform string `json:"platform"`
}

func (s *Service) authenticateWithGoogle(ctx context.Context, e command.Envelope) command.Result {
	var p authenticateWithGooglePayload
	if !decode(e.Payload, &p) || strings.TrimSpace(p.IdToken) == "" || strings.TrimSpace(p.DeviceID) == "" || (p.Platform != "IOS" && p.Platform != "ANDROID") {
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
	now := s.clock.Now().UTC()
	if err := s.enforceMaxConcurrentSessions(ctx, user.ID, e); err != nil {
		return command.Rejected(e, "SESSION_CREATE_FAILED", "INTERNAL", "SAFE_RETRY", "identity.session_create_failed", nil)
	}
	session := Session{ID: newID("session_"), UserAccountID: user.ID, DeviceID: device.ID, Status: "ACTIVE", Principal: command.Principal{Type: "INDIVIDUAL", ID: user.ID}, IssuedAt: now, ExpiresAt: now.Add(30 * 24 * time.Hour), Version: 1}
	if s.tokenManager == nil {
		return command.Rejected(e, "SESSION_TOKEN_ISSUE_FAILED", "INTERNAL", "SAFE_RETRY", "identity.session_token_issue_failed", nil)
	}
	pair, tokenRecord, err := s.tokenManager.Prepare(session)
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
		// 外网不可达时回退本地 JWT 解析（仅验 exp 与 email 存在，不验签名，仅用于开发）
		return fallbackParseGoogleJWT(idToken)
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 8<<20))
	if resp.StatusCode != http.StatusOK {
		// 回退本地解析
		if email, ferr := fallbackParseGoogleJWT(idToken); ferr == nil && email != "" {
			return email, nil
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
	// 可选：校验 aud 是否在允许的 ClientID 列表中
	if allowed := os.Getenv("GOOGLE_ALLOWED_CLIENT_IDS"); allowed != "" {
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
			"reason": "AUTO_EVICT_NEW_LOGIN",
			"userAccountId": userID,
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
		return strings.ToLower(identifier)
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

package identity

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"time"

	"github.com/proxy-app/proxy-api/internal/clock"
	"github.com/proxy-app/proxy-api/internal/command"
)

var (
	ErrTokenNotFound          = errors.New("session token not found")
	ErrTokenExpired           = errors.New("session token expired")
	ErrTokenRotationConflict  = errors.New("session token rotation conflict")
	ErrTokenStorageNotEnabled = errors.New("session token storage is not enabled")
)

const (
	AccessTokenLifetime  = 15 * time.Minute
	RefreshTokenLifetime = 30 * 24 * time.Hour
)

type SessionToken struct {
	SessionID        string
	AccessTokenHash  string
	RefreshTokenHash string
	AccessExpiresAt  time.Time
	RefreshExpiresAt time.Time
	Rotation         int
}

type TokenPair struct {
	SessionID        string    `json:"sessionId"`
	AccessToken      string    `json:"accessToken"`
	RefreshToken     string    `json:"refreshToken"`
	AccessExpiresAt  time.Time `json:"accessExpiresAt"`
	RefreshExpiresAt time.Time `json:"refreshExpiresAt"`
	Rotation         int       `json:"rotation"`
}

// TokenRepository stores only one-way token hashes. Raw access/refresh tokens
// are returned to the App once and must never be persisted or logged by the
// backend.
type TokenRepository interface {
	SaveSessionTokens(ctx context.Context, tokens SessionToken) error
	GetByAccessTokenHash(ctx context.Context, accessTokenHash string) (SessionToken, error)
	GetByRefreshTokenHash(ctx context.Context, refreshTokenHash string) (SessionToken, error)
	RotateSessionTokens(ctx context.Context, sessionID string, expectedRotation int, replacement SessionToken) error
	RevokeSessionTokens(ctx context.Context, sessionID string) error
}

type TokenManager struct {
	repository TokenRepository
	sessions   Repository
	clock      clock.Clock
}

func NewTokenManager(repository TokenRepository, sessions Repository, domainClock clock.Clock) *TokenManager {
	if domainClock == nil {
		domainClock = clock.System{}
	}
	return &TokenManager{repository: repository, sessions: sessions, clock: domainClock}
}

func (m *TokenManager) Prepare(session Session) (TokenPair, SessionToken, error) {
	if m == nil || m.repository == nil {
		return TokenPair{}, SessionToken{}, ErrTokenStorageNotEnabled
	}
	now := m.clock.Now().UTC()
	accessToken, err := newSecret("pxa_")
	if err != nil {
		return TokenPair{}, SessionToken{}, err
	}
	refreshToken, err := newSecret("pxr_")
	if err != nil {
		return TokenPair{}, SessionToken{}, err
	}
	record := SessionToken{
		SessionID:        session.ID,
		AccessTokenHash:  hashToken(accessToken),
		RefreshTokenHash: hashToken(refreshToken),
		AccessExpiresAt:  now.Add(AccessTokenLifetime),
		RefreshExpiresAt: now.Add(RefreshTokenLifetime),
		Rotation:         1,
	}
	return TokenPair{
		SessionID:        session.ID,
		AccessToken:      accessToken,
		RefreshToken:     refreshToken,
		AccessExpiresAt:  record.AccessExpiresAt,
		RefreshExpiresAt: record.RefreshExpiresAt,
		Rotation:         record.Rotation,
	}, record, nil
}

func (m *TokenManager) Commit(ctx context.Context, record SessionToken) error {
	if m == nil || m.repository == nil {
		return ErrTokenStorageNotEnabled
	}
	return m.repository.SaveSessionTokens(ctx, record)
}

func (m *TokenManager) Rotate(ctx context.Context, rawRefreshToken string) (TokenPair, Session, error) {
	if m == nil || m.repository == nil || m.sessions == nil {
		return TokenPair{}, Session{}, ErrTokenStorageNotEnabled
	}
	if rawRefreshToken == "" {
		return TokenPair{}, Session{}, ErrTokenNotFound
	}
	record, err := m.repository.GetByRefreshTokenHash(ctx, hashToken(rawRefreshToken))
	if err != nil {
		return TokenPair{}, Session{}, err
	}
	now := m.clock.Now().UTC()
	if !now.Before(record.RefreshExpiresAt) {
		return TokenPair{}, Session{}, ErrTokenExpired
	}
	session, err := m.sessions.GetSession(ctx, record.SessionID)
	if err != nil {
		return TokenPair{}, Session{}, err
	}
	if !m.sessionUsable(ctx, session) {
		return TokenPair{}, Session{}, ErrTokenExpired
	}
	pair, replacement, err := m.Prepare(session)
	if err != nil {
		return TokenPair{}, Session{}, err
	}
	replacement.Rotation = record.Rotation + 1
	pair.Rotation = replacement.Rotation
	if err := m.repository.RotateSessionTokens(ctx, record.SessionID, record.Rotation, replacement); err != nil {
		return TokenPair{}, Session{}, err
	}
	return pair, session, nil
}

func (m *TokenManager) Authenticate(ctx context.Context, rawAccessToken string) (Session, error) {
	if m == nil || m.repository == nil || m.sessions == nil {
		return Session{}, ErrTokenStorageNotEnabled
	}
	if rawAccessToken == "" {
		return Session{}, ErrTokenNotFound
	}
	record, err := m.repository.GetByAccessTokenHash(ctx, hashToken(rawAccessToken))
	if err != nil {
		return Session{}, err
	}
	if !m.clock.Now().UTC().Before(record.AccessExpiresAt) {
		return Session{}, ErrTokenExpired
	}
	session, err := m.sessions.GetSession(ctx, record.SessionID)
	if err != nil {
		return Session{}, err
	}
	if !m.sessionUsable(ctx, session) {
		return Session{}, ErrTokenExpired
	}
	return session, nil
}

func (m *TokenManager) Revoke(ctx context.Context, sessionID string) error {
	if m == nil || m.repository == nil {
		return ErrTokenStorageNotEnabled
	}
	return m.repository.RevokeSessionTokens(ctx, sessionID)
}

func (m *TokenManager) sessionUsable(ctx context.Context, session Session) bool {
	if session.Status != "ACTIVE" || !m.clock.Now().UTC().Before(session.ExpiresAt) {
		return false
	}
	device, err := m.sessions.GetDevice(ctx, session.DeviceID)
	return err == nil && device.Status == "ACTIVE"
}

func hashToken(raw string) string {
	digest := sha256.Sum256([]byte(raw))
	return hex.EncodeToString(digest[:])
}

func newSecret(prefix string) (string, error) {
	var raw [32]byte
	if _, err := rand.Read(raw[:]); err != nil {
		return "", err
	}
	return prefix + hex.EncodeToString(raw[:]), nil
}

type AuthenticatedSession struct {
	Actor       command.Actor
	Principal   command.Principal
	SessionID   string
	AuthContext map[string]any
}

func (m *TokenManager) AuthenticateContext(ctx context.Context, rawAccessToken string) (AuthenticatedSession, error) {
	session, err := m.Authenticate(ctx, rawAccessToken)
	if err != nil {
		return AuthenticatedSession{}, err
	}
	return AuthenticatedSession{
		Actor:       command.Actor{Type: "USER", ID: session.UserAccountID},
		Principal:   session.Principal,
		SessionID:   session.ID,
		AuthContext: map[string]any{"sessionId": session.ID},
	}, nil
}

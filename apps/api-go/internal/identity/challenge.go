package identity

import (
	"context"
	"errors"
	"time"
)

var (
	ErrLoginChallengeNotFound         = errors.New("login challenge not found")
	ErrLoginChallengeNotUsable        = errors.New("login challenge is not usable")
	ErrLoginChallengeVersionConflict  = errors.New("login challenge version conflict")
	ErrLoginChallengeProviderNotReady = errors.New("login challenge provider is not configured")
	ErrLoginChallengeProviderRejected = errors.New("login challenge provider rejected verification")
)

type LoginChallenge struct {
	ID              string    `json:"id"`
	UserAccountID   string    `json:"userAccountId"`
	LoginIdentityID string    `json:"loginIdentityId"`
	DeviceID        string    `json:"deviceId"`
	Channel         string    `json:"channel"`
	ProviderRef     string    `json:"providerRef"`
	Status          string    `json:"status"`
	Attempts        int       `json:"attempts"`
	MaxAttempts     int       `json:"maxAttempts"`
	Version         int       `json:"version"`
	RequestedAt     time.Time `json:"requestedAt"`
	ExpiresAt       time.Time `json:"expiresAt"`
	VerifiedAt      time.Time `json:"verifiedAt,omitempty"`
	ConsumedAt      time.Time `json:"consumedAt,omitempty"`
}

type LoginChallengeRequest struct {
	LoginIdentityID string
	DeviceID        string
	Channel         string
	Purpose         string
	CorrelationID   string
	// Identifier is the verified address (EMAIL) or E.164 number (SMS)
	// resolved by the service layer from the LoginIdentity row. The
	// providers use it as the delivery recipient; the legacy global
	// lookup hooks are kept only as a fallback for direct provider tests.
	Identifier string
}

type ProviderChallenge struct {
	ProviderRef string
	ExpiresAt   time.Time
}

type LoginChallengeVerification struct {
	ProviderRef string
	Code        string
}

type ProviderVerification struct {
	Verified bool
}

// LoginChallengeProvider owns OTP/passwordless delivery and verification.
// The API never persists or returns the raw code.
type LoginChallengeProvider interface {
	Request(ctx context.Context, request LoginChallengeRequest) (ProviderChallenge, error)
	Verify(ctx context.Context, verification LoginChallengeVerification) (ProviderVerification, error)
}

type UnconfiguredLoginChallengeProvider struct{}

func (UnconfiguredLoginChallengeProvider) Request(context.Context, LoginChallengeRequest) (ProviderChallenge, error) {
	return ProviderChallenge{}, ErrLoginChallengeProviderNotReady
}

func (UnconfiguredLoginChallengeProvider) Verify(context.Context, LoginChallengeVerification) (ProviderVerification, error) {
	return ProviderVerification{}, ErrLoginChallengeProviderNotReady
}

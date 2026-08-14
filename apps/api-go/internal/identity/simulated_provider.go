package identity

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"strings"
	"sync"
	"time"
)

type simulatedChallenge struct {
	codeHash  [32]byte
	expiresAt time.Time
}

// SimulatedLoginChallengeProvider is a local-development-only OTP provider.
// It never sends a message and never returns the raw code through the domain
// or HTTP result. Production must use a real provider or remain fail-closed.
type SimulatedLoginChallengeProvider struct {
	mu         sync.Mutex
	codeHash   [32]byte
	configured bool
	challenges map[string]simulatedChallenge
	now        func() time.Time
	sequence   uint64
}

func NewSimulatedLoginChallengeProvider(code string) *SimulatedLoginChallengeProvider {
	return NewSimulatedLoginChallengeProviderWithClock(code, time.Now)
}

func NewSimulatedLoginChallengeProviderWithClock(code string, now func() time.Time) *SimulatedLoginChallengeProvider {
	if now == nil {
		now = time.Now
	}
	code = strings.TrimSpace(code)
	if code == "" {
		code = "123456"
	}
	return &SimulatedLoginChallengeProvider{
		codeHash:   sha256.Sum256([]byte(code)),
		configured: len(code) > 0,
		challenges: make(map[string]simulatedChallenge),
		now:        now,
	}
}

func (p *SimulatedLoginChallengeProvider) Request(_ context.Context, _ LoginChallengeRequest) (ProviderChallenge, error) {
	if p == nil || !p.configured {
		return ProviderChallenge{}, ErrLoginChallengeProviderNotReady
	}
	now := p.now().UTC()
	p.mu.Lock()
	defer p.mu.Unlock()
	p.sequence++
	var entropy [12]byte
	if _, err := rand.Read(entropy[:]); err != nil {
		return ProviderChallenge{}, err
	}
	providerRef := "sim_" + hex.EncodeToString(entropy[:]) + "_" + hex.EncodeToString([]byte{byte(p.sequence)})
	expiresAt := now.Add(5 * time.Minute)
	p.challenges[providerRef] = simulatedChallenge{codeHash: p.codeHash, expiresAt: expiresAt}
	return ProviderChallenge{ProviderRef: providerRef, ExpiresAt: expiresAt}, nil
}

func (p *SimulatedLoginChallengeProvider) Verify(_ context.Context, verification LoginChallengeVerification) (ProviderVerification, error) {
	if p == nil || !p.configured {
		return ProviderVerification{}, ErrLoginChallengeProviderNotReady
	}
	now := p.now().UTC()
	p.mu.Lock()
	challenge, exists := p.challenges[verification.ProviderRef]
	if !exists {
		p.mu.Unlock()
		return ProviderVerification{Verified: false}, nil
	}
	if !now.Before(challenge.expiresAt) {
		delete(p.challenges, verification.ProviderRef)
		p.mu.Unlock()
		return ProviderVerification{Verified: false}, nil
	}
	providedHash := sha256.Sum256([]byte(strings.TrimSpace(verification.Code)))
	verified := subtle.ConstantTimeCompare(providedHash[:], challenge.codeHash[:]) == 1
	if verified {
		delete(p.challenges, verification.ProviderRef)
	}
	p.mu.Unlock()
	return ProviderVerification{Verified: verified}, nil
}

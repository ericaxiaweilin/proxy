package main

import (
	"context"
	"time"

	"github.com/proxy-app/proxy-api/internal/identity"
	"github.com/proxy-app/proxy-api/internal/providerapp"
)

// providerPhoneChallengeSender adapts identity.LoginChallengeProvider (the
// same configured SMS vendor used for login OTP — Twilio / eSMS / SpeedSMS,
// see wire_providers.go) to providerapp.PhoneChallengeSender, KYC-PHONE-ONLY-001's
// minimal, import-free dependency shape. providerapp never imports identity
// directly (same discipline as the rest of its Deps); this adapter is the one
// place that knows both packages.
type providerPhoneChallengeSender struct {
	provider identity.LoginChallengeProvider
}

var _ providerapp.PhoneChallengeSender = providerPhoneChallengeSender{}

func (a providerPhoneChallengeSender) RequestOTP(ctx context.Context, phoneE164, purpose string) (string, time.Time, error) {
	challenge, err := a.provider.Request(ctx, identity.LoginChallengeRequest{
		Channel:    "SMS",
		Purpose:    purpose,
		Identifier: phoneE164,
	})
	if err != nil {
		return "", time.Time{}, err
	}
	return challenge.ProviderRef, challenge.ExpiresAt, nil
}

func (a providerPhoneChallengeSender) VerifyOTP(ctx context.Context, providerRef, code string) (bool, error) {
	verification, err := a.provider.Verify(ctx, identity.LoginChallengeVerification{ProviderRef: providerRef, Code: code})
	if err != nil {
		return false, err
	}
	return verification.Verified, nil
}

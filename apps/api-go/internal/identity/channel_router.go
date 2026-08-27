package identity

// ChannelRouterLoginChallengeProvider is a single LoginChallengeProvider
// that dispatches by Channel to either an EMAIL or SMS concrete provider.
// It is the production entry point wired up by cmd/api/main.go.
//
// Construction requires both providers to be ready; if either is missing
// the router stays fail-closed and returns ErrLoginChallengeProviderNotReady,
// which the API maps to LOGIN_CHALLENGE_PROVIDER_PENDING.

import (
	"context"
	"fmt"
)

// ChannelRouter is a LoginChallengeProvider that selects the right concrete
// provider by channel. It is the only provider the Service should depend
// on in production.
type ChannelRouter struct {
	email LoginChallengeProvider
	sms   LoginChallengeProvider
}

func NewChannelRouter(email, sms LoginChallengeProvider) *ChannelRouter {
	return &ChannelRouter{email: email, sms: sms}
}

func (r *ChannelRouter) Request(ctx context.Context, req LoginChallengeRequest) (ProviderChallenge, error) {
	switch req.Channel {
	case "EMAIL":
		if r.email == nil {
			return ProviderChallenge{}, ErrLoginChallengeProviderNotReady
		}
		return r.email.Request(ctx, req)
	case "SMS":
		if r.sms == nil {
			return ProviderChallenge{}, ErrLoginChallengeProviderNotReady
		}
		return r.sms.Request(ctx, req)
	default:
		return ProviderChallenge{}, fmt.Errorf("channel router: unsupported channel %q", req.Channel)
	}
}

func (r *ChannelRouter) Verify(ctx context.Context, v LoginChallengeVerification) (ProviderVerification, error) {
	// We don't have a channel on Verify; the ProviderRef embeds the
	// provider kind ("smtp_..." or "sms_..."), so route by prefix. This
	// avoids a separate side-channel on the challenge row.
	if r.email != nil && len(v.ProviderRef) >= 4 && v.ProviderRef[:4] == "smtp" {
		return r.email.Verify(ctx, v)
	}
	if r.sms != nil && len(v.ProviderRef) >= 3 && v.ProviderRef[:3] == "sms" {
		return r.sms.Verify(ctx, v)
	}
	// Unknown prefix: try both. The first that recognizes the ref will
	// accept; the other will return Verified:false.
	if r.email != nil {
		if v, err := r.email.Verify(ctx, v); err == nil && v.Verified {
			return v, nil
		}
	}
	if r.sms != nil {
		return r.sms.Verify(ctx, v)
	}
	return ProviderVerification{}, ErrLoginChallengeProviderNotReady
}

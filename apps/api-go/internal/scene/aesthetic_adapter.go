package scene

import (
	"context"

	"github.com/proxy-app/proxy-api/internal/localnet"
)

// SceneAestheticAdapter exposes the scene.Service.GetAestheticBackdrop
// method through the localnet.SceneAestheticProvider interface, so
// the feed hydrator in localnet can stay free of a direct scene
// import. cmd/api/main.go wires the adapter at boot time.
//
// The adapter is a thin pass-through; it returns whatever the
// service returns (including zero values when no signal exists).
// The feed hydrator treats SampleCount < 2 as "fall back to the
// hard-coded frame background" so the adapter does not need a
// confidence threshold of its own.
type SceneAestheticAdapter struct {
	Service *Service
}

// NewSceneAestheticAdapter wraps a *Service into the
// localnet.SceneAestheticProvider interface.
func NewSceneAestheticAdapter(svc *Service) *SceneAestheticAdapter {
	return &SceneAestheticAdapter{Service: svc}
}

// GetAestheticBackdrop satisfies localnet.SceneAestheticProvider.
func (a *SceneAestheticAdapter) GetAestheticBackdrop(ctx context.Context, cityScope, sceneType string) (localnet.SceneAestheticBackdrop, error) {
	if a == nil || a.Service == nil {
		return localnet.SceneAestheticBackdrop{}, nil
	}
	bd, err := a.Service.GetAestheticBackdrop(ctx, cityScope, sceneType)
	if err != nil {
		return localnet.SceneAestheticBackdrop{}, err
	}
	return localnet.SceneAestheticBackdrop{
		Hex:         bd.Hex,
		SampleCount: bd.SampleCount,
		Confidence:  bd.Confidence,
	}, nil
}

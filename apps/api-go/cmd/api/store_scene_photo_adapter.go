package main

import (
	"context"

	"github.com/proxy-app/proxy-api/internal/business"
	"github.com/proxy-app/proxy-api/internal/realityscene"
)

// storeScenePhotoAdapter adapts business.Service (ListStorePhotosByRealitySceneID)
// to realityscene's merchantPhotoLister, STORE-SCENE-LINK-001's minimal,
// import-free dependency shape. realityscene never imports business
// directly; this adapter is the one place that knows both packages.
type storeScenePhotoAdapter struct {
	business *business.Service
}

func (a storeScenePhotoAdapter) ListStorePhotosByRealitySceneID(ctx context.Context, sceneID string) ([]realityscene.MerchantPhotoRef, error) {
	photos, err := a.business.ListStorePhotosByRealitySceneID(ctx, sceneID)
	if err != nil {
		return nil, err
	}
	out := make([]realityscene.MerchantPhotoRef, 0, len(photos))
	for _, p := range photos {
		if p.MediaAssetID == "" {
			continue
		}
		out = append(out, realityscene.MerchantPhotoRef{MediaAssetID: p.MediaAssetID, Caption: p.Caption})
	}
	return out, nil
}

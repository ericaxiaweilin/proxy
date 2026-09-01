package media

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// ResolveLocalStoreDir returns the single durable local object-store root used
// by the API, worker and model adapters. Keeping this policy in one place avoids
// uploads and derivatives silently landing in different working directories.
//
// PROXY_MEDIA_STORE_DIR remains the deployment override. The default is outside
// Desktop/Documents so iCloud cannot evict active media objects.
func ResolveLocalStoreDir(configured string) (string, error) {
	dir := strings.TrimSpace(configured)
	if dir == "" {
		home, err := os.UserHomeDir()
		if err != nil || home == "" {
			return "", errors.New("resolve media store: home directory unavailable; set PROXY_MEDIA_STORE_DIR")
		}
		dir = filepath.Join(home, "Developer", "kake-data", "media_store")
	}
	abs, err := filepath.Abs(dir)
	if err != nil {
		return "", fmt.Errorf("resolve media store path: %w", err)
	}
	if err := os.MkdirAll(abs, 0o750); err != nil {
		return "", fmt.Errorf("create media store %s: %w", abs, err)
	}
	probe, err := os.CreateTemp(abs, ".proxy-storage-probe-*")
	if err != nil {
		return "", fmt.Errorf("media store is not writable %s: %w", abs, err)
	}
	probePath := probe.Name()
	if _, err = probe.Write([]byte("proxy-media-store-v1")); err == nil {
		err = probe.Sync()
	}
	closeErr := probe.Close()
	removeErr := os.Remove(probePath)
	if err != nil {
		return "", fmt.Errorf("media store durability probe failed %s: %w", abs, err)
	}
	if closeErr != nil {
		return "", fmt.Errorf("media store close probe failed %s: %w", abs, closeErr)
	}
	if removeErr != nil {
		return "", fmt.Errorf("media store cleanup probe failed %s: %w", abs, removeErr)
	}
	return abs, nil
}

// CheckStorage is intentionally cheap enough for /health/ready. The destructive
// write/fsync probe runs once at startup in ResolveLocalStoreDir.
func (s *Service) CheckStorage(_ context.Context) error {
	if s == nil || strings.TrimSpace(s.storeDir) == "" {
		return errors.New("media store is not configured")
	}
	info, err := os.Stat(s.storeDir)
	if err != nil {
		return fmt.Errorf("media store unavailable: %w", err)
	}
	if !info.IsDir() {
		return errors.New("media store path is not a directory")
	}
	return nil
}

// StoreDir is exposed for adapters that need to read an already-authorized
// local derivative (for example vision input). It must never be used to build
// public URLs; clients only receive stable /v1/media/... identifiers.
func (s *Service) StoreDir() string {
	if s == nil {
		return ""
	}
	return s.storeDir
}

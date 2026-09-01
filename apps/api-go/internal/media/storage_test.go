package media

import (
	"context"
	"path/filepath"
	"testing"
)

func TestResolveLocalStoreDirReturnsWritableAbsoluteDirectory(t *testing.T) {
	dir, err := ResolveLocalStoreDir(filepath.Join(t.TempDir(), "objects"))
	if err != nil {
		t.Fatal(err)
	}
	if !filepath.IsAbs(dir) {
		t.Fatalf("store dir must be absolute: %s", dir)
	}
	service := New()
	service.SetStoreDir(dir)
	if err := service.CheckStorage(context.Background()); err != nil {
		t.Fatal(err)
	}
}

func TestCheckStorageRejectsMissingRoot(t *testing.T) {
	service := New()
	service.SetStoreDir(filepath.Join(t.TempDir(), "missing"))
	if err := service.CheckStorage(context.Background()); err == nil {
		t.Fatal("expected missing media store to fail readiness")
	}
}

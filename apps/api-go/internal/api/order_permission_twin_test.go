package api

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/proxy-app/proxy-api/internal/aipersona"
	"github.com/proxy-app/proxy-api/internal/media"
)

// ORDER-PERMISSION-TWIN-001：没有接单权限，建不了本人 AI 分身，模型也读不到本人照片。
func TestAITwinRequiresOrderPermission(t *testing.T) {
	personaSvc := aipersona.NewService(aipersona.NewMemoryRepository(), "terms-1.1")
	personaSvc.SetAgeLookup(twinCenterAdultLookup{})
	granted := map[string]bool{"user_ok": true}
	server := &Server{
		AIPersona:       personaSvc,
		Media:           media.NewWithDependencies(media.NewMemoryRepository(), nil),
		OrderPermission: func(_ context.Context, id string) (bool, error) { return granted[id], nil },
	}
	create := func(owner, personaType string) int {
		rec := httptest.NewRecorder()
		body := `{"ownerId":"` + owner + `","displayName":"我的AI分身","personaType":"` + personaType + `"}`
		server.createPersona(rec, httptest.NewRequest(http.MethodPost, "/v1/ai/personas", strings.NewReader(body)))
		return rec.Code
	}
	if code := create("user_no", "USER_TWIN"); code != http.StatusForbidden {
		t.Fatalf("twin without order permission: %d, want 403", code)
	}
	if code := create("user_ok", "USER_TWIN"); code != http.StatusCreated {
		t.Fatalf("twin with order permission: %d, want 201", code)
	}
	if _, err := server.likenessReferencePhotos(context.Background(), "user_no"); !errors.Is(err, ErrOrderPermissionRequired) {
		t.Fatalf("photos without order permission: %v", err)
	}
}

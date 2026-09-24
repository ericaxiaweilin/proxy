package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestAICatalogEndpointServesTheConfigFile(t *testing.T) {
	s := &Server{}
	rec := httptest.NewRecorder()
	s.getAICatalog(rec, httptest.NewRequest(http.MethodGet, "/v1/ai/catalog", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d: %s", rec.Code, rec.Body.String())
	}
	var body struct {
		Version      string `json:"version"`
		ImageBilling struct {
			FreeImagesPerMonth int `json:"freeImagesPerMonth"`
		} `json:"imageBilling"`
		Vendors []struct {
			ID      string `json:"id"`
			Logo    string `json:"logo"`
			LogoSVG string `json:"logoSvg"`
		} `json:"vendors"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body.Version == "" || len(body.Vendors) == 0 || body.Vendors[0].LogoSVG == "" {
		t.Fatalf("catalog must come from config/ai-catalog with inlined logos: %+v", body)
	}
	if body.Vendors[0].Logo != "" {
		t.Fatal("server file paths must not be exposed")
	}
}

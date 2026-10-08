package tagging

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/proxy-app/proxy-api/internal/command"
	"github.com/proxy-app/proxy-api/internal/consent"
)

type fakeSink struct {
	purposes map[string]bool
	location bool
	failRead bool
	cells    []string
}

func (f *fakeSink) RecordCoarseCell(_ context.Context, _ string, cell string, _ time.Time) error {
	f.cells = append(f.cells, cell)
	return nil
}
func (f *fakeSink) HasConsent(_ context.Context, _ string, purpose string) (bool, error) {
	if f.failRead {
		return false, errors.New("db down")
	}
	return f.purposes[purpose], nil
}
func (f *fakeSink) HasLocationConsent(context.Context, string) (bool, error) {
	if f.failRead {
		return false, errors.New("db down")
	}
	return f.location, nil
}

func locate(sink CoarseSink, actor string, payload map[string]any) command.Result {
	c := &Commands{Sink: sink, Now: func() time.Time { return now }}
	return c.HandleContext(context.Background(), command.Envelope{CommandType: "RecordCoarseLocation", Actor: command.Actor{ID: actor}, Payload: payload})
}

func TestCoarseLocationNeedsBothConsentsAndStoresOnlyTheCell(t *testing.T) {
	good := map[string]any{"lat": 21.0287913, "lng": 105.8523441}

	if res := locate(&fakeSink{purposes: map[string]bool{consent.Recommendation: true}}, "", good); res.Error == nil || res.Error.ErrorCode != "COARSE_LOCATION_REQUIRES_ACTOR" {
		t.Fatalf("anonymous: %+v", res.Error)
	}
	noPurpose := &fakeSink{location: true}
	if res := locate(noPurpose, "u", good); res.Error == nil || res.Error.ErrorCode != "CONSENT_REQUIRED" || len(noPurpose.cells) != 0 {
		t.Fatalf("no capture consent must refuse and store nothing: %+v %v", res.Error, noPurpose.cells)
	}
	noLocation := &fakeSink{purposes: map[string]bool{consent.TwinInsight: true}}
	if res := locate(noLocation, "u", good); res.Error == nil || res.Error.ErrorCode != "LOCATION_CONSENT_REQUIRED" || len(noLocation.cells) != 0 {
		t.Fatalf("no location consent must refuse: %+v", res.Error)
	}
	broken := &fakeSink{failRead: true}
	if res := locate(broken, "u", good); res.Error == nil || res.Error.ErrorCode != "CONSENT_STATE_UNAVAILABLE" || len(broken.cells) != 0 {
		t.Fatalf("unreadable consent state is fail-closed: %+v", res.Error)
	}

	ok := &fakeSink{purposes: map[string]bool{consent.OperatorAudienceDetail: true}, location: true}
	res := locate(ok, "u", good)
	if res.Error != nil || len(ok.cells) != 1 || ok.cells[0] != "21.02,105.85" {
		t.Fatalf("with both consents the 0.01 cell is stored: %+v %v", res.Error, ok.cells)
	}
	// 原始坐标不能出现在结果里（回执、聚合 id、任何字符串字段）。
	blob := res.OperationRef + res.CommandID
	if res.Aggregate != nil {
		blob += res.Aggregate.ID + res.Aggregate.State
	}
	if strings.Contains(blob, "0287913") || strings.Contains(blob, "8523441") {
		t.Fatalf("the raw fix leaked into the result: %s", blob)
	}
	if res := locate(ok, "u", map[string]any{"lat": 200.0, "lng": 0.0}); res.Error == nil || res.Error.ErrorCode != "INVALID_COARSE_LOCATION" {
		t.Fatalf("out-of-range coordinates: %+v", res.Error)
	}
}

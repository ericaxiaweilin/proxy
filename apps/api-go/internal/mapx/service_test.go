package mapx

import (
	"net/url"
	"testing"
)

func TestParseBBox(t *testing.T) {
	t.Run("valid", func(t *testing.T) {
		q := url.Values{}
		q.Set("sw_lat", "10.0")
		q.Set("sw_lng", "106.0")
		q.Set("ne_lat", "11.0")
		q.Set("ne_lng", "107.0")
		b, err := ParseBBox(q)
		if err != nil {
			t.Fatalf("err: %v", err)
		}
		if b.SWLat != 10.0 || b.NELat != 11.0 || b.SWLng != 106.0 || b.NELng != 107.0 {
			t.Fatalf("bbox: %+v", b)
		}
	})
	t.Run("missing", func(t *testing.T) {
		q := url.Values{}
		_, err := ParseBBox(q)
		if err == nil {
			t.Fatal("expected error")
		}
	})
	t.Run("sw_lat > ne_lat", func(t *testing.T) {
		q := url.Values{}
		q.Set("sw_lat", "11.0")
		q.Set("sw_lng", "106.0")
		q.Set("ne_lat", "10.0")
		q.Set("ne_lng", "107.0")
		_, err := ParseBBox(q)
		if err == nil {
			t.Fatal("expected error")
		}
	})
	t.Run("lng out of range", func(t *testing.T) {
		q := url.Values{}
		q.Set("sw_lat", "10.0")
		q.Set("sw_lng", "200.0")
		q.Set("ne_lat", "11.0")
		q.Set("ne_lng", "107.0")
		_, err := ParseBBox(q)
		if err == nil {
			t.Fatal("expected error")
		}
	})
}

func TestParseKinds(t *testing.T) {
	t.Run("default all", func(t *testing.T) {
		got, err := ParseKinds(url.Values{})
		if err != nil {
			t.Fatalf("err: %v", err)
		}
		if !got[KindPost] || !got[KindAgent] || !got[KindOrder] {
			t.Fatalf("expected all kinds, got %v", got)
		}
	})
	t.Run("filter", func(t *testing.T) {
		q := url.Values{}
		q.Set("types", "post,agent")
		got, err := ParseKinds(q)
		if err != nil {
			t.Fatalf("err: %v", err)
		}
		if !got[KindPost] || !got[KindAgent] || got[KindOrder] {
			t.Fatalf("unexpected: %v", got)
		}
	})
	t.Run("unknown", func(t *testing.T) {
		q := url.Values{}
		q.Set("types", "post,snakes")
		_, err := ParseKinds(q)
		if err == nil {
			t.Fatal("expected error")
		}
	})
}

func TestParseLimit(t *testing.T) {
	cases := map[string]int{
		"":      200,
		"0":     200,
		"-1":    200,
		"100":   100,
		"1000":  500,
		"abc":   200,
	}
	for in, want := range cases {
		t.Run(in, func(t *testing.T) {
			q := url.Values{}
			if in != "" {
				q.Set("limit", in)
			}
			if got := ParseLimit(q); got != want {
				t.Errorf("got %d want %d", got, want)
			}
		})
	}
}

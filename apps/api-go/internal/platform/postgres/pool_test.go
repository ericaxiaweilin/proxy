package postgres

import (
	"testing"
	"time"
)

func TestPoolConfigHasBoundedProductionDefaults(t *testing.T) {
	t.Setenv("PROXY_DB_MAX_CONNS", "")
	t.Setenv("PROXY_DB_MIN_CONNS", "")
	config, err := poolConfig("postgres://proxy:proxy@localhost:5432/proxy")
	if err != nil {
		t.Fatal(err)
	}
	if config.MaxConns != 20 || config.MinConns != 2 {
		t.Fatalf("pool bounds max=%d min=%d", config.MaxConns, config.MinConns)
	}
	if config.MaxConnLifetimeJitter != 5*time.Minute || config.HealthCheckPeriod != 30*time.Second || config.ConnConfig.ConnectTimeout != 5*time.Second {
		t.Fatalf("unexpected resilience config: %+v", config)
	}
}

func TestPoolConfigAcceptsBoundedOverridesAndRejectsUnsafeValues(t *testing.T) {
	t.Setenv("PROXY_DB_MAX_CONNS", "8")
	t.Setenv("PROXY_DB_MIN_CONNS", "3")
	config, err := poolConfig("postgres://proxy:proxy@localhost:5432/proxy?connect_timeout=9")
	if err != nil {
		t.Fatal(err)
	}
	if config.MaxConns != 8 || config.MinConns != 3 || config.ConnConfig.ConnectTimeout != 9*time.Second {
		t.Fatalf("overrides not preserved max=%d min=%d timeout=%s", config.MaxConns, config.MinConns, config.ConnConfig.ConnectTimeout)
	}

	t.Setenv("PROXY_DB_MAX_CONNS", "1000")
	t.Setenv("PROXY_DB_MIN_CONNS", "99")
	config, err = poolConfig("postgres://proxy:proxy@localhost:5432/proxy")
	if err != nil {
		t.Fatal(err)
	}
	if config.MaxConns != 20 || config.MinConns != 2 {
		t.Fatalf("unsafe values accepted max=%d min=%d", config.MaxConns, config.MinConns)
	}
}

// Command data-audit performs read-only structural checks against DATABASE_URL.
// It prints counts and booleans only; identifiers, tokens and user data are
// never emitted. A non-zero exit means the database is unsafe to promote.
package main

import (
	"context"
	"fmt"
	"log"
	"os"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

func main() {
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		log.Fatal("DATABASE_URL is required")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		log.Fatalf("connect: %v", err)
	}
	defer pool.Close()

	checks := []struct {
		name  string
		query string
	}{
		{"duplicate_active_login_identifiers", `SELECT count(*) FROM (SELECT channel, lower(identifier) FROM identity.login_identities WHERE status='ACTIVE' AND channel IS NOT NULL AND identifier IS NOT NULL GROUP BY 1,2 HAVING count(*) > 1) q`},
		{"duplicate_access_token_hashes", `SELECT count(*) FROM (SELECT access_token_hash FROM identity.session_tokens GROUP BY 1 HAVING count(*) > 1) q`},
		{"duplicate_refresh_token_hashes", `SELECT count(*) FROM (SELECT refresh_token_hash FROM identity.session_tokens GROUP BY 1 HAVING count(*) > 1) q`},
		{"orphan_session_users", `SELECT count(*) FROM identity.sessions s LEFT JOIN identity.user_accounts u ON u.id=s.user_account_id WHERE u.id IS NULL`},
		{"orphan_session_devices", `SELECT count(*) FROM identity.sessions s LEFT JOIN identity.device_registrations d ON d.id=s.device_id WHERE d.id IS NULL`},
		{"invalid_media_state_rows", `SELECT count(*) FROM media.media_assets WHERE owner_principal_type NOT IN ('INDIVIDUAL','BUSINESS') OR media_type NOT IN ('IMAGE','VIDEO','AUDIO') OR processing_status NOT IN ('UPLOADING','PROCESSING','READY','FAILED')`},
	}
	unsafe := false
	for _, check := range checks {
		var count int64
		if err := pool.QueryRow(ctx, check.query).Scan(&count); err != nil {
			log.Fatalf("%s: %v", check.name, err)
		}
		fmt.Printf("%s=%d\n", check.name, count)
		unsafe = unsafe || count != 0
	}
	if unsafe {
		os.Exit(2)
	}
}

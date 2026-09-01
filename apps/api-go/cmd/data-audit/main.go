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
	var currentRole, reviewTableOwner string
	var canAssumeOperator bool
	if err := pool.QueryRow(ctx, `
		SELECT current_user, pg_get_userbyid(c.relowner),
		       pg_has_role(current_user, 'proxy_api_operator', 'MEMBER')
		FROM pg_class c WHERE c.oid='media.media_review_decisions'::regclass`).Scan(&currentRole, &reviewTableOwner, &canAssumeOperator); err != nil {
		log.Fatalf("database role boundary: %v", err)
	}
	fmt.Printf("database_role=%q review_table_owner=%q can_assume_operator=%t\n", currentRole, reviewTableOwner, canAssumeOperator)

	checks := []struct {
		name  string
		query string
	}{
		{"duplicate_active_login_identifiers", `SELECT count(*) FROM (SELECT channel, lower(identifier) FROM identity.login_identities WHERE status='ACTIVE' AND channel IS NOT NULL AND identifier IS NOT NULL GROUP BY 1,2 HAVING count(*) > 1) q`},
		{"duplicate_access_token_hashes", `SELECT count(*) FROM (SELECT access_token_hash FROM identity.session_tokens GROUP BY 1 HAVING count(*) > 1) q`},
		{"duplicate_refresh_token_hashes", `SELECT count(*) FROM (SELECT refresh_token_hash FROM identity.session_tokens GROUP BY 1 HAVING count(*) > 1) q`},
		{"orphan_session_users", `SELECT count(*) FROM identity.sessions s LEFT JOIN identity.user_accounts u ON u.id=s.user_account_id WHERE u.id IS NULL`},
		{"orphan_session_devices", `SELECT count(*) FROM identity.sessions s LEFT JOIN identity.device_registrations d ON d.id=s.device_id WHERE d.id IS NULL`},
		{"invalid_media_owner_rows", `SELECT count(*) FROM media.media_assets WHERE owner_principal_type NOT IN ('INDIVIDUAL','BUSINESS','PLATFORM')`},
		{"invalid_media_type_rows", `SELECT count(*) FROM media.media_assets WHERE media_type NOT IN ('IMAGE','VIDEO','AUDIO')`},
		{"invalid_media_processing_rows", `SELECT count(*) FROM media.media_assets WHERE processing_status NOT IN ('UPLOADING','PROCESSING','READY','FAILED')`},
		{"observer_raw_table_privileges", `SELECT count(*) FROM (VALUES
			('scene.scenes'), ('scene.invitations'), ('contribution.contributions'),
			('supply.agent_profiles'), ('supply.availability_windows'),
			('media.media_assets'), ('media.media_review_decisions'), ('localnet.posts')) AS raw(table_name)
			WHERE EXISTS (SELECT 1 FROM pg_roles WHERE rolname='proxy_api_observer')
			  AND has_table_privilege('proxy_api_observer', raw.table_name, 'SELECT')`},
		{"orphan_post_media_assets", `SELECT count(*) FROM localnet.post_media pm LEFT JOIN media.media_assets m ON m.media_asset_id=pm.media_asset_id WHERE m.media_asset_id IS NULL`},
		{"missing_post_media_json_assets", `SELECT count(*) FROM localnet.posts p CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(p.media_refs)='array' THEN p.media_refs ELSE '[]'::jsonb END) ref LEFT JOIN media.media_assets m ON m.media_asset_id=ref->>'mediaAssetId' WHERE COALESCE(ref->>'mediaAssetId','')<>'' AND m.media_asset_id IS NULL`},
		{"missing_post_media_projection_rows", `SELECT count(*) FROM localnet.posts p CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(p.media_refs)='array' THEN p.media_refs ELSE '[]'::jsonb END) ref JOIN media.media_assets m ON m.media_asset_id=ref->>'mediaAssetId' LEFT JOIN localnet.post_media pm ON pm.post_id=p.id AND pm.media_asset_id=m.media_asset_id WHERE pm.post_id IS NULL`},
		{"orphan_post_reactions", `SELECT count(*) FROM engagement.reactions e LEFT JOIN localnet.posts p ON p.id=e.post_id WHERE p.id IS NULL`},
		{"orphan_post_replies", `SELECT count(*) FROM engagement.replies e LEFT JOIN localnet.posts p ON p.id=e.post_id WHERE p.id IS NULL`},
		{"orphan_post_reposts", `SELECT count(*) FROM engagement.reposts e LEFT JOIN localnet.posts p ON p.id=e.post_id WHERE p.id IS NULL`},
		{"orphan_post_bookmarks", `SELECT count(*) FROM engagement.bookmarks e LEFT JOIN localnet.posts p ON p.id=e.post_id WHERE p.id IS NULL`},
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
	var hardeningObjects int
	if err := pool.QueryRow(ctx, `
		SELECT
		  (SELECT count(*) FROM pg_indexes WHERE schemaname='identity' AND indexname IN ('uq_login_identity_active_identifier','uq_session_tokens_access_hash','uq_session_tokens_refresh_hash'))
		+ (SELECT count(*) FROM pg_constraint WHERE conname IN (
		  'identity_user_status_check','identity_login_channel_check','identity_login_status_check',
		  'identity_device_platform_check','identity_device_status_check','identity_session_status_check',
		  'identity_session_principal_type_check','identity_session_lifetime_check','identity_token_lifetime_check',
		  'identity_sessions_user_fk','identity_sessions_device_fk','media_asset_owner_type_check',
		  'media_asset_type_check','media_asset_processing_status_check','media_asset_moderation_status_check',
		  'media_asset_visibility_check','media_asset_dimensions_check','media_asset_checksum_check',
		  'business_owner_user_fk','business_membership_user_fk','payment_intent_currency_check',
		  'ledger_currency_check','payout_currency_check'))`).Scan(&hardeningObjects); err != nil {
		log.Fatalf("hardening objects: %v", err)
	}
	fmt.Printf("hardening_objects=%d/26\n", hardeningObjects)
	unsafe = unsafe || hardeningObjects != 26
	printGroups(ctx, pool, "legacy_media_owner", `
		SELECT owner_principal_type, count(*)
		FROM media.media_assets
		WHERE owner_principal_type NOT IN ('INDIVIDUAL','BUSINESS','PLATFORM')
		GROUP BY owner_principal_type ORDER BY owner_principal_type`)
	printGroups(ctx, pool, "legacy_media_processing", `
		SELECT processing_status, count(*)
		FROM media.media_assets
		WHERE processing_status NOT IN ('UPLOADING','PROCESSING','READY','FAILED')
		GROUP BY processing_status ORDER BY processing_status`)
	printGroups(ctx, pool, "legacy_media_processing_detail", `
		SELECT processing_status || '|moderation=' || moderation_status ||
		       '|playback=' || CASE WHEN COALESCE(playback_url, '') <> '' THEN 'yes' ELSE 'no' END,
		       count(*)
		FROM media.media_assets
		WHERE processing_status NOT IN ('UPLOADING','PROCESSING','READY','FAILED')
		GROUP BY 1 ORDER BY 1`)
	if unsafe {
		os.Exit(2)
	}
}

func printGroups(ctx context.Context, pool *pgxpool.Pool, name, query string) {
	rows, err := pool.Query(ctx, query)
	if err != nil {
		log.Fatalf("%s: %v", name, err)
	}
	defer rows.Close()
	for rows.Next() {
		var value string
		var count int64
		if err := rows.Scan(&value, &count); err != nil {
			log.Fatalf("%s scan: %v", name, err)
		}
		fmt.Printf("%s[%q]=%d\n", name, value, count)
	}
	if err := rows.Err(); err != nil {
		log.Fatalf("%s rows: %v", name, err)
	}
}

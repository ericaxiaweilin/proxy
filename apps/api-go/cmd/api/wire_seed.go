package main

// 身份/创作者种子数据（种子只插缺失行，不覆盖）。

import (
	"context"
	"fmt"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/proxy-app/proxy-api/internal/media"
	"github.com/proxy-app/proxy-api/internal/mockidentity"
	"log"
	"os"
	"path/filepath"
	"strings"
	"time"
)

func seedPostgresMedia(pool *pgxpool.Pool) error {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	now := time.Now().UTC()
	assets := []struct {
		id, mediaType, originalKey, playbackKey, thumbKey, mime, codec string
		width, height                                                  int
		durationMs                                                     int64
	}{
		{"seed_media_hoankiem", "IMAGE", "dkq8mi3yf254_thumb.jpg", "dkq8mi3yf254_thumb.jpg", "dkq8mi3yf254_thumb.jpg", "image/jpeg", "", 480, 360, 0},
		{"seed_media_coffee", "IMAGE", "dkq8n8mjr34w_thumb.jpg", "dkq8n8mjr34w_thumb.jpg", "dkq8n8mjr34w_thumb.jpg", "image/jpeg", "", 480, 360, 0},
		{"seed_media_westlake", "IMAGE", "dkq8noieylig_thumb.jpg", "dkq8noieylig_thumb.jpg", "dkq8noieylig_thumb.jpg", "image/jpeg", "", 480, 360, 0},
		{"seed_media_route_video", "VIDEO", "dkq8qwqitirc_playback.mp4", "dkq8qwqitirc_playback.mp4", "dkq8qwqitirc_thumb.jpg", "video/mp4", "h264", 1080, 1920, 9833},
		{"seed_media_opening_video", "VIDEO", "dkq8mi3yf254_playback.mp4", "dkq8mi3yf254_playback.mp4", "dkq8mi3yf254_thumb.jpg", "video/mp4", "h264", 320, 240, 2020},
	}
	appendImage := func(id, key string, width, height int) {
		assets = append(assets, struct {
			id, mediaType, originalKey, playbackKey, thumbKey, mime, codec string
			width, height                                                  int
			durationMs                                                     int64
		}{id, "IMAGE", key, key, key, "image/jpeg", "", width, height, 0})
	}
	for _, group := range []struct {
		kind, prefix string
		height       int
		names        []string
	}{
		{"action", "scene_r42_action", 267, []string{"cycling", "shopping", "movie", "music", "food-hunting", "travel", "sport"}},
		{"scene", "scene_r42_scene", 250, []string{"old-town", "beach", "park", "mall", "restaurant", "cafe", "night-market", "event"}},
		{"theme", "scene_r42_theme", 247, []string{"night", "retro", "vietnam", "nature", "art", "daily", "festival", "local"}},
		{"moment", "scene_r42_moment", 260, []string{"morning", "daytime", "sunset", "night", "friends", "solo", "couple", "family"}},
	} {
		for _, name := range group.names {
			appendImage("seed_r42_v2_"+group.kind+"_"+name, group.prefix+"_"+name+"_v2.jpg", 168, group.height)
		}
	}
	for _, service := range []struct {
		name   string
		height int
	}{
		{"business-companion", 225}, {"administrative-companion", 225},
		{"housing-viewing", 227}, {"sim-setup", 227}, {"study-exchange", 227},
		{"content-creation", 227}, {"local-guide", 227},
	} {
		appendImage("seed_scene_service_"+service.name+"_v1", "scene_service_"+service.name+"_v1.jpg", 248, service.height)
	}
	// R42 scene/action editorial samples live in the server media store, never
	// in the mobile bundle. Stable IDs let the catalog change independently of
	// an App Store build while the files can later move to object storage/CDN.
	for row := 0; row < 3; row++ {
		for col := 0; col < 6; col++ {
			id := fmt.Sprintf("seed_scene_action_primary_%d_%d", row, col)
			key := fmt.Sprintf("scene_action_primary_%d_%d.jpg", row, col)
			assets = append(assets, struct {
				id, mediaType, originalKey, playbackKey, thumbKey, mime, codec string
				width, height                                                  int
				durationMs                                                     int64
			}{id, "IMAGE", key, key, key, "image/jpeg", "", 250, 288, 0})
		}
	}
	extendedHeights := []int{242, 232, 226, 235}
	for row, height := range extendedHeights {
		for col := 0; col < 6; col++ {
			id := fmt.Sprintf("seed_scene_action_extended_%d_%d", row, col)
			key := fmt.Sprintf("scene_action_extended_%d_%d.jpg", row, col)
			assets = append(assets, struct {
				id, mediaType, originalKey, playbackKey, thumbKey, mime, codec string
				width, height                                                  int
				durationMs                                                     int64
			}{id, "IMAGE", key, key, key, "image/jpeg", "", 250, height, 0})
		}
	}
	for row := 0; row < 3; row++ {
		for col := 0; col < 5; col++ {
			id := fmt.Sprintf("seed_scene_theme_%d_%d", row, col)
			key := fmt.Sprintf("scene_theme_%d_%d.jpg", row, col)
			assets = append(assets, struct {
				id, mediaType, originalKey, playbackKey, thumbKey, mime, codec string
				width, height                                                  int
				durationMs                                                     int64
			}{id, "IMAGE", key, key, key, "image/jpeg", "", 303, 336, 0})
		}
	}
	for _, portrait := range []struct{ id, key string }{
		{"seed_scene_aodai_rooftop", "scene_aodai_rooftop.jpg"},
		{"seed_scene_aodai_oldtown", "scene_aodai_oldtown.jpg"},
	} {
		assets = append(assets, struct {
			id, mediaType, originalKey, playbackKey, thumbKey, mime, codec string
			width, height                                                  int
			durationMs                                                     int64
		}{portrait.id, "IMAGE", portrait.key, portrait.key, portrait.key, "image/jpeg", "", 1122, 1402, 0})
	}
	// R135 hospital language/companion samples are deliberately separate
	// network assets. The emergency reference crop is retained in storage for
	// editorial use, but is not exposed by the matchmaking catalog.
	for _, medical := range []struct {
		id, key       string
		width, height int
	}{
		{"seed_scene_medical_hero_v1", "scene_medical_hero_v1.jpg", 688, 422},
		{"seed_scene_medical_registration_v1", "scene_medical_registration_v1.jpg", 224, 211},
		{"seed_scene_medical_doctor_translation_v1", "scene_medical_doctor_translation_v1.jpg", 224, 211},
		{"seed_scene_medical_examination_v1", "scene_medical_examination_v1.jpg", 202, 211},
		{"seed_scene_medical_pharmacy_v1", "scene_medical_pharmacy_v1.jpg", 198, 211},
		{"seed_scene_medical_communication_v1", "scene_medical_communication_v1.jpg", 224, 211},
		{"seed_scene_medical_stay_v1", "scene_medical_stay_v1.jpg", 224, 211},
		{"seed_scene_medical_checkup_v1", "scene_medical_checkup_v1.jpg", 202, 211},
		{"seed_scene_medical_hospital_v1", "scene_medical_hospital_v1.jpg", 205, 235},
		{"seed_scene_medical_information_v1", "scene_medical_information_v1.jpg", 205, 235},
		{"seed_scene_medical_waiting_v1", "scene_medical_waiting_v1.jpg", 230, 235},
		{"seed_scene_medical_companion_v1", "scene_medical_companion_v1.jpg", 222, 235},
	} {
		assets = append(assets, struct {
			id, mediaType, originalKey, playbackKey, thumbKey, mime, codec string
			width, height                                                  int
			durationMs                                                     int64
		}{medical.id, "IMAGE", medical.key, medical.key, medical.key, "image/jpeg", "", medical.width, medical.height, 0})
	}
	// MEDIA-FILE-001: a seed row claiming READY for bytes that are not on disk
	// is the same lie the read model used to tell — a URL that 404s, which the
	// client renders as a black frame. It also re-asserts itself on every boot,
	// so quarantining the row by hand never sticks. Derive the status from the
	// filesystem instead.
	storeDir, err := media.ResolveLocalStoreDir(os.Getenv("PROXY_MEDIA_STORE_DIR"))
	if err != nil {
		return err
	}
	for _, a := range assets {
		status := "READY"
		if _, statErr := os.Stat(filepath.Join(storeDir, a.playbackKey)); statErr != nil {
			status = "FAILED"
			log.Printf("seed media %s has no bytes at %s; marking FAILED instead of READY", a.id, a.playbackKey)
		}
		// First-party editorial assets are owned by the PLATFORM principal.
		// Never attribute system content to a synthetic individual account.
		if _, err := pool.Exec(ctx, `
			INSERT INTO media.media_assets (
				media_asset_id, owner_principal_type, owner_principal_id, media_type,
				original_storage_key, playback_storage_key, thumbnail_storage_key,
				mime_type, width, height, duration_ms, codec,
				processing_status, playback_url, thumbnail_url, moderation_status, visibility_class, created_at, updated_at
			) VALUES ($1,'PLATFORM','seed',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'APPROVED','PUBLIC',$14,$14)
			ON CONFLICT (media_asset_id) DO UPDATE SET
				owner_principal_type=EXCLUDED.owner_principal_type,
				owner_principal_id=EXCLUDED.owner_principal_id,
				playback_storage_key=EXCLUDED.playback_storage_key,
				thumbnail_storage_key=EXCLUDED.thumbnail_storage_key,
				processing_status=EXCLUDED.processing_status, moderation_status='APPROVED', visibility_class='PUBLIC', updated_at=EXCLUDED.updated_at`,
			a.id, a.mediaType, a.originalKey, a.playbackKey, a.thumbKey, a.mime,
			a.width, a.height, a.durationMs, a.codec, status,
			"/v1/media/play/"+a.id, "/v1/media/thumb/"+a.id, now); err != nil {
			return err
		}
	}
	return nil
}

// seedPostgresIdentity 在 simulated 模式把开发用户幂等写入 Postgres
// （与 localIdentityService 的 memory seed 对齐，保证模拟登录在 DB 模式可用）。
func seedPostgresIdentity(pool *pgxpool.Pool) error {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	// user_accounts
	if _, err := pool.Exec(ctx, `
		INSERT INTO identity.user_accounts (id, status) VALUES ($1, $2)
		ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status`,
		"user_001", "ACTIVE"); err != nil {
		return err
	}
	// login_identities
	if _, err := pool.Exec(ctx, `
		INSERT INTO identity.login_identities (id, user_account_id, verified, status, channel, identifier)
		VALUES ($1, $2, TRUE, 'ACTIVE', 'PHONE', 'jvn')
		ON CONFLICT (id) DO UPDATE SET verified = TRUE, status = 'ACTIVE'`,
		"login_001", "user_001"); err != nil {
		return err
	}
	// memberships
	if _, err := pool.Exec(ctx, `
		INSERT INTO identity.memberships (principal_type, principal_id, user_account_id, status)
		VALUES ('INDIVIDUAL', 'user_001', 'user_001', 'ACTIVE')
		ON CONFLICT (principal_type, principal_id) DO UPDATE SET status = 'ACTIVE'`); err != nil {
		return err
	}
	if _, err := pool.Exec(ctx, `
		INSERT INTO identity.memberships (principal_type, principal_id, user_account_id, status)
		VALUES ('BUSINESS', 'business_001', 'user_001', 'ACTIVE')
		ON CONFLICT (principal_type, principal_id) DO UPDATE SET status = 'ACTIVE'`); err != nil {
		return err
	}
	// devices
	if _, err := pool.Exec(ctx, `
		INSERT INTO identity.device_registrations (id, user_account_id, platform, status)
		VALUES ('device_001', 'user_001', 'IOS', 'ACTIVE')
		ON CONFLICT (id) DO UPDATE SET status = 'ACTIVE'`); err != nil {
		return err
	}
	return nil
}

type creatorSeedProfile struct {
	agentID, name, bio string
	languages, areas   []string
}

func merchantCreatorSeedProfiles() []creatorSeedProfile {
	// IDENTITY-ID-001: 头像不再写死外链。候选头像由账号 id 派生（见
	// creatorAvatarPath），与 identity.profiles.avatar_path 指向同一媒体资产——
	// 同一个人的头像只有一处事实源，谁也不会「首页一个新、发布订单一个旧」。
	return []creatorSeedProfile{
		{"agent_linh", "Linh", "河内本地向导，中文流利，擅长摄影", []string{"ZH", "VI"}, []string{"hn"}},
		{"agent_mai", "Mai", "河内本地人，越南语向导", []string{"VI"}, []string{"hn"}},
		{"agent_an", "An", "河内活动接待，熟悉咖啡与餐厅场景", []string{"VI", "ZH"}, []string{"hn"}},
		{"agent_thao", "Thao", "河内中越口译与活动协作 Creator", []string{"VI", "ZH"}, []string{"hn"}},
		{"agent_yen", "Yen", "河内生活方式 Creator，擅长到店内容", []string{"VI", "ZH"}, []string{"hn"}},
		{"agent_minh", "Minh", "胡志明市中文向导", []string{"ZH"}, []string{"hcm"}},
	}
}

// creatorAccountID / creatorAvatarPath 委托给 mockidentity（唯一事实源）：
// 身份映射只允许有一处实现，避免各 surface 再各自硬编码姓名/头像。
func creatorAccountID(agentID string) string {
	return mockidentity.AccountIDForFacetKey(strings.TrimPrefix(agentID, "agent_"))
}

func creatorAvatarPath(agentID string) string {
	return mockidentity.AvatarPathForFacetKey(strings.TrimPrefix(agentID, "agent_"))
}

func merchantCreatorAvailability(now time.Time) (time.Time, time.Time) {
	return now.Add(time.Hour), now.Add(72 * time.Hour)
}

// creatorAccountID 由固定 facet 键（agent_id）确定性派生出系统账号 id。
// 与可编辑的显示名解耦：改名字不动 id，同名不同人也能区分。

// creatorCity 把服务区映射为账号 profile 的城市（profile 要求 1..60 字符）。
func creatorCity(areas []string) string {
	if len(areas) > 0 && areas[0] == "hcm" {
		return "Ho Chi Minh City"
	}
	return "Hanoi"
}

// seedPostgresSupply 写入可用于商家 Creator 推荐的真实测试 Agent。
// Linh：河内，中文+越南语 VERIFIED+摄影，120 万
// Mai：河内，仅越南语 VERIFIED，100 万（中文查询应被过滤）
// Minh：胡志明市，中文 VERIFIED，110 万（河内查询应被过滤）

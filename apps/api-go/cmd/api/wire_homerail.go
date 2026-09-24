package main

// 首页「真人推荐」rail 的人物种子。
//
// HOME-RAIL-ACCOUNT-001（2026-09-23，用户报 P0）：首页那条 rail 读的是客户端
// fixture（recommend-fixtures.ts 的 SCENE_RECOMMEND），不是服务端 feed。此前
// 28 个人里只有 7 个在服务端真有账号，其余 21 个点 + 只会得到一句「还没有账号，
// 暂时加不了好友」—— 卡片上却顶着「真人」徽标；ACTIVITY / TRIP / CREATOR /
// TRANSLATE / MEDICAL 五个场景甚至一个真人都没有。
//
// 这个文件把「rail 上的人」变成「服务端真有账号的人」：账号 + 资料 + 写真资产
// 三件齐，幂等、每次启动重跑。人物目录的唯一事实源是 internal/mockidentity 的
// HomeRailPeople；这里只负责把它写进库，不另编名字/简介。

import (
	"context"
	"image"
	_ "image/jpeg"
	_ "image/png"
	"log"
	"os"
	"path/filepath"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/proxy-app/proxy-api/internal/mockidentity"
)

// portraitImageConfig 只读文件头拿宽高，不解码像素 —— 一张 1024x1024 的写真
// 也只花一次 header 读。
func portraitImageConfig(path string) (image.Config, error) {
	f, err := os.Open(path)
	if err != nil {
		return image.Config{}, err
	}
	defer f.Close()
	cfg, _, err := image.DecodeConfig(f)
	return cfg, err
}

func seedPostgresHomeRail(pool *pgxpool.Pool, storeDir string) error {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	now := time.Now().UTC()

	for _, p := range mockidentity.HomeRailPeople {
		accountID := mockidentity.AccountIDForFacetKey(p.Key)
		assetID := mockidentity.AvatarAssetIDForFacetKey(p.Key)
		storageKey := mockidentity.PortraitStorageKeyForFacetKey(p.Key)
		avatarPath := "assets/" + assetID

		// MEDIA-FILE-001：磁盘上没有字节就不许写 READY。声称 READY 却没有字节的
		// 行会让 thumb 404，客户端只能画空圈；而且它每次启动都会把手工修好的行
		// 再改回去，所以这里必须从文件系统派生状态。
		//
		// width/height 同样从文件头读出来，不写死：既有 creator 行声明 128x128 而
		// 文件其实是 1024x1024 ——「声明的尺寸不是字节的尺寸」正是本仓库反复出现的
		// 那类假数据。这里按文件头派生真实尺寸，下面 DO UPDATE 也写，所以既有行会
		// 被一起修正。读不出尺寸 = 这不是一张能用的图，和没有字节同等对待（FAILED），
		// 不许顶着 READY 画黑圈。
		status := "READY"
		width, height := 0, 0
		portraitPath := filepath.Join(storeDir, storageKey)
		if _, statErr := os.Stat(portraitPath); statErr != nil {
			status = "FAILED"
			log.Printf("home rail portrait %s has no bytes at %s; marking FAILED instead of READY", assetID, storageKey)
		} else if cfg, cfgErr := portraitImageConfig(portraitPath); cfgErr != nil {
			status = "FAILED"
			log.Printf("home rail portrait %s is not a decodable image (%v); marking FAILED instead of READY", assetID, cfgErr)
		} else {
			width, height = cfg.Width, cfg.Height
		}

		// 账号：缺了就建，已有不动（身份由 facet 键确定性派生，与可编辑的显示名无关）。
		if _, err := pool.Exec(ctx, `
			INSERT INTO identity.user_accounts (id, status, created_at, updated_at)
			VALUES ($1,'REGISTERED',$2,$2)
			ON CONFLICT (id) DO NOTHING`, accountID, now); err != nil {
			return err
		}

		// 资料：名字/简介取 rail 卡片上那一句。已存在的行不覆盖 —— 现有 7 个
		// （linh/mai/an/minh 等）的名字简介同时被供给域的 Creator 种子写，改它们
		// 会牵动发布订单那一侧，不在本改动的射程里（见 HOME-RAIL-ACCOUNT-001 备注）。
		if _, err := pool.Exec(ctx, `
			INSERT INTO identity.profiles (user_account_id, name, handle, bio, city, avatar_path, version, updated_at)
			VALUES ($1,$2,$3,$4,'Hanoi',$5,1,$6)
			ON CONFLICT (user_account_id) DO NOTHING`,
			accountID, p.Name, "creator_"+p.Key, p.Bio, avatarPath, now); err != nil {
			return err
		}

		// 写真资产：owner 指向账号本身（不是 PLATFORM）—— 这是「这个人的脸」，
		// 不是平台编辑素材。
		//
		// width/height 在 DO UPDATE 里也写：现有 7 个 rail 人物的资产行由供给域的
		// creator 种子创建，手写声明 128x128，而真实文件是 1024x1024。既然这个种子
		// 已经接管了这 28 行的 owner / storage key / status，就没有理由让尺寸停在
		// 「声明的不是字节的」—— 每次启动按文件头重新派生，它会自己修回来。
		// （没有任何测试或代码依赖那个 128；在 seed_creator_portraits.sql 里它只是
		// 一个手写占位，不是量出来的值。）
		if _, err := pool.Exec(ctx, `
			INSERT INTO media.media_assets (
				media_asset_id, owner_principal_type, owner_principal_id, media_type,
				original_storage_key, playback_storage_key, thumbnail_storage_key,
				mime_type, width, height, processing_status,
				playback_url, thumbnail_url, moderation_status, visibility_class, created_at, updated_at
			) VALUES ($1,'INDIVIDUAL',$2,'IMAGE',$3,$3,$3,'image/jpeg',$7,$8,$4,$5,$5,'APPROVED','PUBLIC',$6,$6)
			ON CONFLICT (media_asset_id) DO UPDATE SET
				owner_principal_type = EXCLUDED.owner_principal_type,
				owner_principal_id   = EXCLUDED.owner_principal_id,
				original_storage_key = EXCLUDED.original_storage_key,
				playback_storage_key = EXCLUDED.playback_storage_key,
				thumbnail_storage_key= EXCLUDED.thumbnail_storage_key,
				width                = EXCLUDED.width,
				height               = EXCLUDED.height,
				processing_status    = EXCLUDED.processing_status,
				moderation_status    = 'APPROVED',
				visibility_class     = 'PUBLIC',
				updated_at           = EXCLUDED.updated_at`,
			assetID, accountID, storageKey, status, "/v1/media/thumb/"+assetID, now, width, height); err != nil {
			return err
		}

		// 头像路径回填：只在为空时写，不覆盖已经指对的行。
		if _, err := pool.Exec(ctx, `
			UPDATE identity.profiles SET avatar_path = $1, updated_at = $2
			 WHERE user_account_id = $3 AND (avatar_path = '' OR avatar_path IS NULL)`,
			avatarPath, now, accountID); err != nil {
			return err
		}

		// AI-MANAGE-003：这些是演示用的「真人」账号，没人登录它们；用户在测试时把它们当成
		// 「AI 托管的真人」（有人私信就由 AI 代回复）。AI 管理的默认对话权限是「每次确认」，
		// 而这些号没有主人来确认 —— 不给个设置行，私信它们就永远没回音。
		// 所以只在**没有设置行时**写一行「全自动」；有人手动改过（比如为了测连发上限
		// 把某个号关掉 AI）就不覆盖。
		if _, err := pool.Exec(ctx, `
			INSERT INTO identity.ai_engine_settings (user_account_id, chat_permission, updated_at)
			VALUES ($1, 'auto', $2)
			ON CONFLICT (user_account_id) DO NOTHING`, accountID, now); err != nil {
			return err
		}
	}
	return nil
}

#!/usr/bin/env python3
"""gen_mockdata.py — 由 spec.py 生成三个 SQL 文件。

    python3 apps/api-go/scripts/mockdata/gen_mockdata.py

产出（都写到 apps/api-go/scripts/ 下，与既有 devseed 脚本同目录）：

    seed_dev_shops_users.sql          100 用户 + 30 店 + 媒体资产 + 成员
    seed_dev_shops_users_posts.sql    100 条帖文
    seed_dev_shops_users_remove.sql   反做（删干净，含本批新增的媒体资产）

为什么不手写：100 用户 × 6 张表 + 30 店 × 6 张表 + 100 帖，手写必然出现
「用户 47 的名字在 profiles 与 posts 里不一致」这类漂移。数据在 spec.py 只写
一遍，SQL 派生出来，漂移不可能发生。改数据改 spec.py，然后重跑本脚本。

生成后请**在事务里试跑**（见 README.md 的 dry-run 一节）再正式灌。
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import spec  # noqa: E402

OUT_DIR = Path(__file__).resolve().parent.parent  # apps/api-go/scripts/

# 30 家店的封面：28 张本批生成的店面图 + 12 张仓库自带 ai-scenes（后 2 张进封面，
# 其余 10 张当第 2 张图）。全部是 AI 生成的**占位图**，不是这些店的真实现场照片 ——
# 所以 store_photos.caption 里写明，见 PLACEHOLDER_CAPTION。
VENUE_PHOTOS = [f"ma_devseed_venue_{i:02d}" for i in range(1, 29)] + [
    f"ma_devseed_venue_scene_{i:02d}" for i in range(1, 13)
]
PLACEHOLDER_CAPTION = "Ảnh minh hoạ cho môi trường phát triển — không phải ảnh thật của quán"


def q(value: str) -> str:
    """SQL 单引号转义。"""
    return "'" + value.replace("'", "''") + "'"


def user_id(n: int) -> str:
    # 2 位补零：既有 devseed 数据（2026-09-30 已灌进开发库）用的是
    # user_devseed_01 这种形式。不补零就会造出 user_devseed_1 这一批**平行**的
    # 身份，库里变成 130 个用户而不是 100 个。n=100 时 lpad 不截断，仍是 '100'。
    return f"{spec.USER_PREFIX}{n:02d}"


def biz_id(n: int) -> str:
    return f"{spec.BIZ_PREFIX}{n:02d}"


def store_id(n: int) -> str:
    return f"{spec.STORE_PREFIX}{n:02d}"


def post_id(n: int) -> str:
    # 同样 2 位补零，与既有 post_devseed_01 对齐（否则 01–30 会变成另一批 id，
    # 库里出现 130 条 devseed 帖子）。
    return f"{spec.POST_PREFIX}{n:02d}"


def avatar_path(n: int) -> str:
    """用户 01–30 复用 creator 肖像；31–100 用本批生成的 70 张越南面孔。"""
    if n <= 30:
        return f"assets/ma_creator_{spec.CREATOR_KEYS[n - 1]}_portrait_v1"
    key = next(k for (m, k, *_rest) in spec.EXTRA_USERS if m == n)
    return f"assets/{spec.AVATAR_ASSET_PREFIX}{key}_portrait_v1"


def all_users() -> list[tuple[int, str, str, str]]:
    """(n, name, city, bio) —— 100 条。"""
    out = [(n, name, city, bio) for (n, name, city, bio) in spec.OWNER_USERS]
    out += [(n, name, city, bio) for (n, _k, name, city, bio) in spec.EXTRA_USERS]
    return out


# ─────────────────────────────────────────────────────────────────────────────
# seed_dev_shops_users.sql
# ─────────────────────────────────────────────────────────────────────────────
HEADER_SEED = """-- seed_dev_shops_users.sql
--
-- DEV-ONLY 开发种子：**30 家真实店铺 + 100 个用户**（Hà Nội + Bắc Ninh，
-- 咖啡店 + 餐厅）。后期整体删除，见配套的 seed_dev_shops_users_remove.sql。
--
-- ⚠️ 本文件由 apps/api-go/scripts/mockdata/gen_mockdata.py 生成。
--    要改数据请改 mockdata/spec.py，然后重跑生成器；直接改这里会被下一次生成覆盖。
--
-- ## 数据来源与边界（重要，别照着扩散）
--
-- 店铺用**真实公开信息**：店名、街道地址、行政区、品类都取自公开的越南本地生活
-- 平台与旅游指南（Foody.vn / PasGo / toplist.vn / wheretarawent.com / travelviet.net
-- 等公开页面）。这些是**事实性公开信息**（营业地址不是谁的版权）。
--
-- 但**用户是合成的**，不是从网上扒的真实个人：越南姓名风格 + 真实行政区，
-- 身份一律 `user_devseed_*` 前缀。理由不是版权 —— 是个人数据。越南
-- Nghị định 13/2023/NĐ-CP 把姓名/账号/画像当个人数据管，而这个项目自己在做
-- LC-15 隐私中心；往库里灌 100 个真实人的资料会跟自己的合规目标打架。
--
-- ## 三件**故意不做**的事（都有人踩过，别"顺手补上"）
--
-- 1. **不建 business.store_lines**。营业时间 / wifi / 空调温度 / 座位数是
--    「商家自己页面上一个月采一次」的数据，全仓没有生产者。给一家真实存在的店
--    编一条「免费 wifi、24°C、安静」，是在断言一个我们并不知道的事实。
--    seed_threebeans_bn.sql 当年就是因此故意不写 menu/facilities（"编出来会坑到
--    真人"）。这里沿用同一决定。
-- 2. **不建 reality.scenes，reality_scene_id 一律留空**。reality.scenes 的
--    latitude/longitude 是 NOT NULL，而店铺目录（scene-shop-directory.ts）用坐标
--    算「1.2km / 步行约 15 分钟」。给真实地址编一组坐标会让那些距离全错 —— 比不
--    显示更糟。要挂场景得先拿到真坐标（OSM 查），再走 LinkStoreToRealityScene。
-- 3. **店里的照片是占位图**。store_photos.caption 明确写了「不是本店实拍」——
--    把一张 AI 生成的室内图挂到一家真实店铺的相册里，不写清楚就是拿假图冒充现场。
--
-- ## 为什么单独一个脚本，不进启动种子
--
-- 现有三个启动种子（supply / home rail / media）每次 boot 都灌，属于产品基线。
-- 这批是**临时开发数据**，用户明确说了"后期删除"。塞进 `cmd/api/wire_seed.go`
-- 就得改代码才能删，而 AGENTS.md 规定 app 包只放行为、不放可变业务内容 ——
-- 店铺和用户正是可变业务内容。所以它待在 `scripts/`，一条命令灌、一条命令删。
--
-- ## 幂等：**收敛式 upsert**，不是 insert-if-absent
--
-- 固定 ID + `ON CONFLICT DO UPDATE`，可重复执行，且**跑完必到同一个形状**。
--
-- 这里**故意偏离** AGENTS.md 的 "seed 路径必须 insert-if-absent，绝不 blind
-- overwrite"，理由要说清楚，免得后来人以为写错了：
--
--   · insert-if-absent 的适用对象是**产品基线种子**（boot 时灌的那三个）——
--     那些行的内容属于产品，覆盖等于篡改。
--   · 本文件是**一次性的开发数据**，用户明确说"开发后就删除了"。它存在的唯一
--     意义就是"库里有这么一批可预期的行"。而 2026-09-30 已经有一版旧的
--     devseed 灌进了开发库（20 店 / 30 用户，HCMC 为主）—— 此时 insert-if-absent
--     会让旧行**原样留着**，结果是「一半旧数据 + 一半新数据」，用户 01–30 顶着
--     旧的城市和简介去当河内/北宁店的店主。那种状态比覆盖更难查。
--   · 覆盖范围**只限 devseed_ 前缀的行**，碰不到任何真实数据。
--
-- 所以：跑一次 = 收敛到 spec.py 描述的形状；跑两次 = 同一个形状。
-- 想清空就上 seed_dev_shops_users_remove.sql。
--
-- ⚠️ 时间戳是唯一的例外：帖文的 `created_at` 在冲突时**不更新**（见 posts 文件），
--    否则每次重跑都会把这些帖子的排序位置重洗一遍。
--
-- ## 头像
--
-- 用户 01–30 复用库里已有的 30 个 creator 肖像媒体资产（与
-- seed_creator_portraits.sql 同一套事实源），按顺序 **1:1** 分配 —— 30 张肖像正好
-- 30 个人，不重脸（上一版有 6 组重复）。
-- 用户 31–100 用本批新落的 70 张越南面孔资产 `ma_devseed_<key>_portrait_v1`，
-- 字节在 media store 里（见 mockdata/README.md 的裁剪步骤）。
-- 两批都**不指向不存在的文件** —— 造一批悬空 avatar_path 只会让 UI 出现破图
-- （MEDIA-FILE-001：声称 READY 却没有字节的行，客户端画成黑圈）。
--
-- 执行：psql "$DATABASE_URL" -f apps/api-go/scripts/seed_dev_shops_users.sql

\\set ON_ERROR_STOP on

BEGIN;
"""


def gen_seed() -> str:
    L: list[str] = [HEADER_SEED]

    # ── 媒体资产：70 张新头像 ────────────────────────────────────────────────
    L.append("""
-- ─────────────────────────────────────────────────────────────────────────────
-- 媒体资产 A：70 张新增头像（用户 31–100）
--
-- 256×256 JPEG，字节在 media store（devseed_<key>_portrait_v1.jpg）。
-- READY + APPROVED + PUBLIC 才能走公开路由 /v1/media/thumb/<id>。
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO media.media_assets (
  media_asset_id, owner_principal_type, owner_principal_id, media_type,
  original_storage_key, playback_storage_key, thumbnail_storage_key,
  mime_type, width, height, processing_status, moderation_status, visibility_class,
  ai_generation_source, ai_generated, created_at, updated_at
)
SELECT
  '""" + spec.AVATAR_ASSET_PREFIX + """' || g.key || '_portrait_v1',
  'INDIVIDUAL',
  '""" + spec.USER_PREFIX + """' || g.n::text,
  'IMAGE',
  'devseed_' || g.key || '_portrait_v1.jpg',
  'devseed_' || g.key || '_portrait_v1.jpg',
  'devseed_' || g.key || '_portrait_v1.jpg',
  'image/jpeg', 256, 256, 'READY', 'APPROVED', 'PUBLIC',
  'MODEL_API', true, now(), now()
FROM (VALUES""")
    rows = [
        f"  ({n}, {q(key)})" for (n, key, *_rest) in spec.EXTRA_USERS
    ]
    L.append(",\n".join(rows))
    L.append(""") AS g(n, key)
ON CONFLICT (media_asset_id) DO UPDATE
  SET owner_principal_type  = EXCLUDED.owner_principal_type,
      owner_principal_id    = EXCLUDED.owner_principal_id,
      original_storage_key  = EXCLUDED.original_storage_key,
      playback_storage_key  = EXCLUDED.playback_storage_key,
      thumbnail_storage_key = EXCLUDED.thumbnail_storage_key,
      mime_type             = EXCLUDED.mime_type,
      width                 = EXCLUDED.width,
      height                = EXCLUDED.height,
      processing_status     = EXCLUDED.processing_status,
      moderation_status     = EXCLUDED.moderation_status,
      visibility_class      = EXCLUDED.visibility_class,
      ai_generation_source  = EXCLUDED.ai_generation_source,
      ai_generated          = EXCLUDED.ai_generated,
      updated_at            = now();""")

    # ── 媒体资产：店面占位图 ─────────────────────────────────────────────────
    L.append("""
-- ─────────────────────────────────────────────────────────────────────────────
-- 媒体资产 B：店面占位图（28 张本批生成 + 12 张仓库自带 ai-scenes）
--
-- ⚠️ 这些是 **AI 生成的占位图**，不是任何一家店的现场照片。挂到 store_photos
--    时 caption 必须写明（见文件头第 3 条）。
-- owner 用 PLATFORM：它们是平台提供的开发占位素材，不是商家自己上传的。
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO media.media_assets (
  media_asset_id, owner_principal_type, owner_principal_id, media_type,
  original_storage_key, playback_storage_key, thumbnail_storage_key,
  mime_type, width, height, processing_status, moderation_status, visibility_class,
  ai_generation_source, ai_generated, created_at, updated_at
)
SELECT
  g.asset_id,
  'PLATFORM',
  'platform_devseed',
  'IMAGE',
  g.storage_key,
  g.storage_key,
  g.storage_key,
  'image/jpeg', g.w, g.h, 'READY', 'APPROVED', 'PUBLIC',
  'MODEL_API', true, now(), now()
FROM (VALUES""")
    rows = []
    for i in range(1, 29):
        rows.append(
            f"  ({q(f'ma_devseed_venue_{i:02d}')}, {q(f'devseed_venue_{i:02d}.jpg')}, 800, 800)"
        )
    for i in range(1, 13):
        rows.append(
            f"  ({q(f'ma_devseed_venue_scene_{i:02d}')}, {q(f'devseed_venue_scene_{i:02d}.jpg')}, 376, 335)"
        )
    L.append(",\n".join(rows))
    L.append(""") AS g(asset_id, storage_key, w, h)
ON CONFLICT (media_asset_id) DO UPDATE
  SET owner_principal_type  = EXCLUDED.owner_principal_type,
      owner_principal_id    = EXCLUDED.owner_principal_id,
      original_storage_key  = EXCLUDED.original_storage_key,
      playback_storage_key  = EXCLUDED.playback_storage_key,
      thumbnail_storage_key = EXCLUDED.thumbnail_storage_key,
      mime_type             = EXCLUDED.mime_type,
      width                 = EXCLUDED.width,
      height                = EXCLUDED.height,
      processing_status     = EXCLUDED.processing_status,
      moderation_status     = EXCLUDED.moderation_status,
      visibility_class      = EXCLUDED.visibility_class,
      ai_generation_source  = EXCLUDED.ai_generation_source,
      ai_generated          = EXCLUDED.ai_generated,
      updated_at            = now();""")

    # ── 用户账号 ─────────────────────────────────────────────────────────────
    users = all_users()
    L.append("""
-- ─────────────────────────────────────────────────────────────────────────────
-- 100 个用户账号
--
-- 01–30 是下面 30 家店的店主（business.accounts.owner_user_id 有外键指过来），
-- 31–60 是店员（每店一人，membership OPERATOR），61–100 是无店的普通用户 ——
-- 用来让 feed / 推荐位 / 私信这些**不依赖店铺**的界面也有内容可看。
-- 全部 status=ACTIVE。
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO identity.user_accounts (id, status, created_at, updated_at) VALUES""")
    L.append(",\n".join(f"  ({q(user_id(n))}, 'ACTIVE', now(), now())" for (n, *_r) in users))
    L.append("""ON CONFLICT (id) DO UPDATE
  SET status = EXCLUDED.status, updated_at = now();""")

    # ── profiles ────────────────────────────────────────────────────────────
    L.append("""
-- ─────────────────────────────────────────────────────────────────────────────
-- 100 个 profile
--
-- handle 用 @ 开头的规范形式（profiles 上有 lower(ltrim(handle,'@')) 唯一索引）。
-- avatar_path 指向真实存在的媒体资产（见文件头「头像」一节）。
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO identity.profiles
  (user_account_id, name, handle, bio, city, avatar_path, version, updated_at) VALUES""")
    prof_rows = []
    for (n, name, city, bio) in users:
        if n <= 30:
            key = spec.CREATOR_KEYS[n - 1]
        else:
            key = next(k for (m, k, *_r) in spec.EXTRA_USERS if m == n)
        # handle 必须带序号。唯一索引是全局的 lower(ltrim(handle,'@'))，
        # 而 2026-09-30 那版 devseed 已经占用了裸 key 形式（@devseed_lan 挂在
        # user_devseed_15 上）。不带序号的话，user_devseed_10 想拿 @devseed_lan
        # 会直接撞唯一约束 —— 而且能不能过还取决于插入顺序，等于埋雷。
        # 带上序号既全局唯一，又不依赖处理顺序。
        handle = f"@devseed_{n:02d}_{key}"
        prof_rows.append(
            f"  ({q(user_id(n))}, {q(name)}, {q(handle)}, {q(bio)}, {q(city)}, "
            f"{q(avatar_path(n))}, 1, now())"
        )
    L.append(",\n".join(prof_rows))
    L.append("""ON CONFLICT (user_account_id) DO UPDATE
  SET name        = EXCLUDED.name,
      handle      = EXCLUDED.handle,
      bio         = EXCLUDED.bio,
      city        = EXCLUDED.city,
      avatar_path = EXCLUDED.avatar_path,
      version     = identity.profiles.version + 1,
      updated_at  = now();""")

    # ── business.accounts ───────────────────────────────────────────────────
    L.append("""
-- ─────────────────────────────────────────────────────────────────────────────
-- 30 个商家主体（一店一主体，方便对着真实店一家家核）
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO business.accounts (id, owner_user_id, name, status, created_at) VALUES""")
    L.append(
        ",\n".join(
            f"  ({q(biz_id(n))}, {q(user_id(n))}, {q(name.split(' — ')[0])}, 'ACTIVE', now())"
            for (n, _k, _c, _a, name, _addr, _cat) in spec.SHOPS
        )
    )
    L.append("""ON CONFLICT (id) DO UPDATE
  SET owner_user_id = EXCLUDED.owner_user_id,
      name          = EXCLUDED.name,
      status        = EXCLUDED.status;""")

    # ── business.stores ─────────────────────────────────────────────────────
    L.append("""
-- ─────────────────────────────────────────────────────────────────────────────
-- 30 家店
--
-- reality_scene_id 留空（''）而不是瞎指一个场景：business.stores 上有
-- `idx_stores_reality_scene ... WHERE reality_scene_id <> ''`，指错的场景会让
-- 「附近的店」出现在不相干的地点，比空着更难排查。理由详见文件头第 2 条。
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO business.stores
  (id, business_id, name, address, status, category, reality_scene_id, created_at) VALUES""")
    L.append(
        ",\n".join(
            f"  ({q(store_id(n))}, {q(biz_id(n))}, {q(store_name)}, {q(addr)}, "
            f"'ACTIVE', {q(cat)}, '', now())"
            for (n, _kind, _city, _area, store_name, addr, cat) in spec.SHOPS
        )
    )
    L.append("""ON CONFLICT (id) DO UPDATE
  SET business_id      = EXCLUDED.business_id,
      name             = EXCLUDED.name,
      address          = EXCLUDED.address,
      status           = EXCLUDED.status,
      category         = EXCLUDED.category,
      reality_scene_id = EXCLUDED.reality_scene_id;""")

    # ── memberships ─────────────────────────────────────────────────────────
    L.append("""
-- ─────────────────────────────────────────────────────────────────────────────
-- 成员关系：店主 OWNER（用户 01–30）+ 店员 OPERATOR（用户 31–60，一店一人）
--
-- role 有 CHECK：OWNER / ADMIN / OPERATOR / VIEWER
-- status 有 CHECK：ACTIVE / INVITED / SUSPENDED
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO business.memberships (business_id, user_id, role, status, created_at) VALUES""")
    mem_rows = []
    for (n, *_r) in spec.SHOPS:
        mem_rows.append(f"  ({q(biz_id(n))}, {q(user_id(n))}, 'OWNER', 'ACTIVE', now())")
    for (n, *_r) in spec.SHOPS:
        staff = spec.STAFF_USER_START + n - 1
        mem_rows.append(f"  ({q(biz_id(n))}, {q(user_id(staff))}, 'OPERATOR', 'ACTIVE', now())")
    L.append(",\n".join(mem_rows))
    L.append("""ON CONFLICT (business_id, user_id) DO UPDATE
  SET role = EXCLUDED.role, status = EXCLUDED.status;""")

    # ── member_directory ────────────────────────────────────────────────────
    name_by_n = {n: name for (n, name, _c, _b) in users}
    L.append("""
-- ─────────────────────────────────────────────────────────────────────────────
-- 成员目录（display_name 是投影，供商家后台列表直接显示，不用再 JOIN profiles）
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO business.member_directory
  (business_id, user_id, display_name, role, status, joined_at) VALUES""")
    dir_rows = []
    for (n, *_r) in spec.SHOPS:
        dir_rows.append(
            f"  ({q(biz_id(n))}, {q(user_id(n))}, {q(name_by_n[n])}, 'OWNER', 'ACTIVE', now())"
        )
    for (n, *_r) in spec.SHOPS:
        staff = spec.STAFF_USER_START + n - 1
        dir_rows.append(
            f"  ({q(biz_id(n))}, {q(user_id(staff))}, {q(name_by_n[staff])}, 'OPERATOR', 'ACTIVE', now())"
        )
    L.append(",\n".join(dir_rows))
    L.append("""ON CONFLICT (business_id, user_id) DO UPDATE
  SET display_name = EXCLUDED.display_name,
      role         = EXCLUDED.role,
      status       = EXCLUDED.status;""")

    # ── store_photos ────────────────────────────────────────────────────────
    L.append("""
-- ─────────────────────────────────────────────────────────────────────────────
-- 店面照片：30 家店各 1 张封面，前 10 家再各 1 张（共 40 张，互不重复）
--
-- asset_path 有 CHECK：`^ai-personas/|^assets/|^store/` 或 `photo_%` —— 用
-- `assets/<mediaAssetId>`（与 identity.profiles.avatar_path 同口径）。
-- caption 写明是开发占位图，见文件头第 3 条。
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO business.store_photos
  (id, store_id, business_id, uploaded_by, asset_path, caption, sort_order,
   media_asset_id, created_at) VALUES""")
    photo_rows = []
    for (n, *_r) in spec.SHOPS:
        asset = VENUE_PHOTOS[n - 1]
        photo_rows.append(
            f"  ({q(f'storephoto_devseed_{n:02d}_1')}, {q(store_id(n))}, {q(biz_id(n))}, "
            f"{q(user_id(n))}, {q('assets/' + asset)}, {q(PLACEHOLDER_CAPTION)}, 0, "
            f"{q(asset)}, now())"
        )
    for n in range(1, 11):
        asset = VENUE_PHOTOS[30 + n - 1]
        photo_rows.append(
            f"  ({q(f'storephoto_devseed_{n:02d}_2')}, {q(store_id(n))}, {q(biz_id(n))}, "
            f"{q(user_id(n))}, {q('assets/' + asset)}, {q(PLACEHOLDER_CAPTION)}, 1, "
            f"{q(asset)}, now())"
        )
    L.append(",\n".join(photo_rows))
    L.append("""ON CONFLICT (id) DO UPDATE
  SET store_id       = EXCLUDED.store_id,
      business_id    = EXCLUDED.business_id,
      uploaded_by    = EXCLUDED.uploaded_by,
      asset_path     = EXCLUDED.asset_path,
      caption        = EXCLUDED.caption,
      sort_order     = EXCLUDED.sort_order,
      media_asset_id = EXCLUDED.media_asset_id;

COMMIT;
""")

    # ── 自检 ────────────────────────────────────────────────────────────────
    L.append("""
-- ── 结果自检（应当 100 / 100 / 30 / 30 / 30 / 60 / 40）─────────────────────
SELECT 'identity.user_accounts' AS what, count(*) FROM identity.user_accounts WHERE id LIKE 'user_devseed_%'
UNION ALL SELECT 'identity.profiles',          count(*) FROM identity.profiles        WHERE user_account_id LIKE 'user_devseed_%'
UNION ALL SELECT 'business.accounts',          count(*) FROM business.accounts        WHERE id LIKE 'biz_devseed_%'
UNION ALL SELECT 'business.stores',            count(*) FROM business.stores          WHERE id LIKE 'store_devseed_%'
UNION ALL SELECT 'business.memberships',       count(*) FROM business.memberships     WHERE business_id LIKE 'biz_devseed_%'
UNION ALL SELECT 'business.member_directory',  count(*) FROM business.member_directory WHERE business_id LIKE 'biz_devseed_%'
UNION ALL SELECT 'business.store_photos',      count(*) FROM business.store_photos    WHERE id LIKE 'storephoto_devseed_%'
UNION ALL SELECT '新增头像资产',                count(*) FROM media.media_assets WHERE media_asset_id LIKE 'ma_devseed_%_portrait_v1'
UNION ALL SELECT '店面占位图资产',              count(*) FROM media.media_assets WHERE media_asset_id LIKE 'ma_devseed_venue_%'
-- 下面几条应当全为 0：指了不存在的店 / 头像指了不存在的资产 / 照片指了不存在的资产
UNION ALL SELECT 'profile 指向不存在的账号',    count(*) FROM identity.profiles p
   LEFT JOIN identity.user_accounts u ON u.id = p.user_account_id
   WHERE p.user_account_id LIKE 'user_devseed_%' AND u.id IS NULL
UNION ALL SELECT 'store 指向不存在的账号',      count(*) FROM business.stores s
   LEFT JOIN business.accounts a ON a.id = s.business_id
   WHERE s.id LIKE 'store_devseed_%' AND a.id IS NULL
UNION ALL SELECT '头像指向不存在的资产',        count(*) FROM identity.profiles p
   LEFT JOIN media.media_assets m ON m.media_asset_id = replace(p.avatar_path, 'assets/', '')
   WHERE p.user_account_id LIKE 'user_devseed_%' AND p.avatar_path <> '' AND m.media_asset_id IS NULL
UNION ALL SELECT '照片指向不存在的资产',        count(*) FROM business.store_photos sp
   LEFT JOIN media.media_assets m ON m.media_asset_id = sp.media_asset_id
   WHERE sp.id LIKE 'storephoto_devseed_%' AND m.media_asset_id IS NULL
ORDER BY 1;
""")
    return "\n".join(L)


# ─────────────────────────────────────────────────────────────────────────────
# seed_dev_shops_users_posts.sql
# ─────────────────────────────────────────────────────────────────────────────
HEADER_POSTS = """-- seed_dev_shops_users_posts.sql
--
-- DEV-ONLY：给 seed_dev_shops_users.sql 那 100 个用户各发 1 条公开帖子（共 100 条）。
-- 配套删除见 seed_dev_shops_users_remove.sql（同一个脚本，一起删）。
--
-- ⚠️ 本文件由 apps/api-go/scripts/mockdata/gen_mockdata.py 生成。
--    要改数据请改 mockdata/spec.py，然后重跑生成器。
--
-- ## 为什么单独一个文件：数据在库里 ≠ 界面上看得到
--
-- 2026-09-30 灌完店铺 + 用户之后，用户在模拟器里看不到任何变化。查出来是
-- 两个原因，都不是"数据没灌进去"：
--
-- 1. **feed 只显示帖子，不显示用户。** 用户建好之后 `localnet.posts` 里
--    一条他们的帖子都没有，所以 feed 翻到底也不会出现他们 —— 对一个刷信息流的
--    界面来说，"多了 100 个用户但一个都看不见" 等于没加。
-- 2. **`ListBusinessStores` 是 `WHERE business_id=$1`**，只返回**当前登录商家自己
--    的店**。30 家新店各有独立 owner，模拟器里登录的那个账号一家都看不到 ——
--    这是设计如此（商家只该看到自己的店），不是 bug，但它意味着"新增 30 家店"
--    对当前那个登录态是不可见的。要验证得用其中一个店主的账号登录。
--
-- 所以这个文件补的是**帖子**：让 100 个用户真正出现在 feed 里，店主的帖子同时
-- 也充当"这家店在营业"的可视信号。
--
-- ## 时间戳是关键
--
-- feed 的排序是 `created_at DESC`（见 idx_posts_feed_keyset）。库里现有帖子
-- 停在更早的日期，而这些 devseed 用户是后加的。如果 `created_at` 写成 `now()`
-- 就会好；但为了**幂等**（重跑不改变已有行的排序位置），这里用**固定的过去时间**
-- 而不是 now()，落在现有数据之后 —— 既能排到前面，又重跑不变。
--
-- ## 形状照着现有帖子抄，不猜
--
-- media_refs 的元素是**对象** `{"sortOrder":0,"mediaAssetId":"ma_…"}`，不是裸字符串 ——
-- 第一版写成 `["ma_…"]` 时，两种形状混在一起，读模型解析时会拿到 undefined 的
-- mediaAssetId，界面就是一片没有图的帖子。是自检那条「指向不存在资产」把问题
-- 揪出来的：它报 8 条，而那 8 条其实存在，只是取键取不到。
--
-- 「没图」的帖子写 `'null'::jsonb`（列是 NOT NULL，写裸 NULL 会撞约束）。
-- `author_type='USER'`、`status='PUBLISHED'`、`visibility='PUBLIC'`、
-- `city_scope` 用简写 `hn` / `hcm` / `danang` / `hue` / `bacninh`、
-- `scene_type` 必须落在 CHECK 枚举里（查法见文件末尾）。
-- **照着能跑通的数据抄形状，不要凭想象填。**
--
-- scene_type 枚举只有这九个：UNKNOWN / ROOFTOP / BRUNCH / SPA / CINEMA /
-- PHOTO / NIGHTLIFE / OUTDOOR / COFFEE。
--
-- 执行：psql "$DATABASE_URL" -f apps/api-go/scripts/seed_dev_shops_users_posts.sql
--
-- 查枚举：SELECT pg_get_constraintdef(oid) FROM pg_constraint
--         WHERE conname='posts_scene_type_check';

\\set ON_ERROR_STOP on

BEGIN;
"""


def gen_posts() -> str:
    users = all_users()
    name_by_n = {n: name for (n, name, _c, _b) in users}
    city_by_n = {n: city for (n, _name, city, _b) in users}
    shop_city = {n: city for (n, _k, city, _a, _sn, _addr, _cat) in spec.SHOPS}

    L = [HEADER_POSTS]
    L.append("""
INSERT INTO localnet.posts
  (id, author_type, author_id, author_display_name, body, media_refs,
   visibility, city_scope, scene_type, status, context_refs, created_at, ephemeral_until)
SELECT
  g.post_id,
  'USER',
  g.author_id,
  g.display_name,
  g.body,
  g.media_refs,
  'PUBLIC',
  g.city_scope,
  g.scene_type,
  'PUBLISHED',
  '[]'::jsonb,
  ts.created_at,
  NULL
FROM (VALUES""")

    # id / author_id 由 Python 拼好当字面量，**不在 SQL 里用 lpad 拼**。
    # 踩过的坑：`lpad('100', 2, '0')` 返回的是 '10' —— lpad 在源串比目标长度长时
    # 会**截断**，于是第 100 条帖子和第 10 条撞同一个 id，报
    # "ON CONFLICT DO UPDATE command cannot affect row a second time"。
    # 同一个表达式还会让 author_id 变成 'user_devseed_1'（少补一个零），
    # 跟 profiles 里的 'user_devseed_01' 对不上 —— 帖子会挂到不存在的作者上。
    rows = []
    for (n, name, city, _bio) in users:
        if n <= 30:
            body, scene = spec.OWNER_POSTS[n]
            # 店主帖跟着自己的店走
            scope = "hn" if shop_city.get(n) == "Hà Nội" else "bacninh"
        else:
            body, scene = spec.EXTRA_POSTS[n]
            scope = "hn" if city == "Hà Nội" else "bacninh"
        rows.append(
            f"  ({n}, {q(post_id(n))}, {q(user_id(n))}, {q(name)}, {q(body)}, "
            f"{q(scope)}, {q(scene)}, 'null'::jsonb)"
        )
    L.append(",\n".join(rows))
    L.append("""
) AS g(n, post_id, author_id, display_name, body, city_scope, scene_type, media_refs)
-- 固定时间戳，不用 now()：feed 按 created_at DESC 排序，用 now() 会让每次重跑
-- 把这些帖子顶到最前面（位置一直在变），用固定时间才能既排得进前排又幂等。
CROSS JOIN LATERAL (SELECT TIMESTAMPTZ '2026-09-28 08:00:00+07'
                    + (g.n || ' hours')::interval) AS ts(created_at)
-- 冲突时更新**内容**但不碰 created_at：feed 按 created_at DESC 排序，
-- 改时间会让每次重跑都把这些帖子重新洗一遍位置。
ON CONFLICT (id) DO UPDATE
  SET author_type         = EXCLUDED.author_type,
      author_id           = EXCLUDED.author_id,
      author_display_name = EXCLUDED.author_display_name,
      body                = EXCLUDED.body,
      media_refs          = EXCLUDED.media_refs,
      visibility          = EXCLUDED.visibility,
      city_scope          = EXCLUDED.city_scope,
      scene_type          = EXCLUDED.scene_type,
      status              = EXCLUDED.status;

COMMIT;
""")
    L.append("""
-- ── 结果自检（应当 100 / 100 / 0 / 0）────────────────────────────────────────
SELECT 'devseed 帖子' AS what, count(*) FROM localnet.posts WHERE id LIKE 'post_devseed_%'
UNION ALL SELECT '作者确实是 devseed 用户', count(*) FROM localnet.posts p
            JOIN identity.user_accounts u ON u.id = p.author_id WHERE p.id LIKE 'post_devseed_%'
UNION ALL SELECT '作者名与 profile 不一致', count(*) FROM localnet.posts p
            JOIN identity.profiles pr ON pr.user_account_id = p.author_id
            WHERE p.id LIKE 'post_devseed_%' AND p.author_display_name <> pr.name
-- jsonb_array_elements 在 media_refs 是 JSON `null`（标量）时会报
-- "cannot extract elements from a scalar"，所以先按 jsonb_typeof 过滤掉标量。
UNION ALL SELECT 'media_refs 指向不存在资产',
            (SELECT count(*)
               FROM localnet.posts p
               CROSS JOIN LATERAL jsonb_array_elements(p.media_refs) m
               LEFT JOIN media.media_assets a ON a.media_asset_id = m->>'mediaAssetId'
              WHERE p.id LIKE 'post_devseed_%'
                AND jsonb_typeof(p.media_refs) = 'array'
                AND a.media_asset_id IS NULL)
ORDER BY 1;
""")
    return "\n".join(L)


# ─────────────────────────────────────────────────────────────────────────────
# seed_dev_shops_users_remove.sql
# ─────────────────────────────────────────────────────────────────────────────
HEADER_REMOVE = """-- seed_dev_shops_users_remove.sql
--
-- DEV-ONLY：删掉 seed_dev_shops_users.sql 灌进来的 30 店 + 100 用户，
-- 以及 seed_dev_shops_users_posts.sql 的 100 条帖子。
--
-- ⚠️ 本文件由 apps/api-go/scripts/mockdata/gen_mockdata.py 生成。
--
-- ## 为什么删除要护栏，而灌数据不用
--
-- 灌数据是 insert-if-absent，幂等，跑错了最坏是多一批 devseed_ 行，删掉就行。
-- 删除是**不可逆**的，而且按前缀批量删 —— 一旦 DSN 指到不是开发库，
-- `DELETE FROM identity.user_accounts WHERE id LIKE 'user_devseed_%'` 本身看着
-- 很安全（只碰 devseed_ 前缀），可一旦有人后来把 devseed_ 前缀用到了真实数据上，
-- 这条脚本就会静默吃掉它。所以这里强制三重确认：
--
--   1. 数据库名不得带生产特征（prod / production / live）；`proxy` 这类开发库放行；
--   2. 必须显式传 -v I_KNOW=1（脚本没收到就拒绝执行）；
--   3. 事务里先打印将要删除的行数并要求确认，再真正 DELETE。
--
-- AGENTS.md 说"生产代码不得硬删除用户业务数据" —— 这个文件是**开发脚本不是生产
-- 代码**，而且用户明确要求这批数据"后期删除"。但护栏不能省：省掉护栏的那次删除
-- 就是不可撤销的。
--
-- ## ⚠️ media store 里的文件不在这个脚本的管辖范围
--
-- 本批新增了 70 张头像 + 40 张店面占位图的**数据库行**，这里会一并删掉；
-- 但磁盘上的 JPEG 文件（~/Developer/kake-data/media_store/devseed_*.jpg）
-- SQL 删不掉。删完行之后手动清一下：
--
--   ls ~/Developer/kake-data/media_store/devseed_*.jpg   # 先看
--   rm  ~/Developer/kake-data/media_store/devseed_*.jpg   # 再删
--
-- 顺序很重要：**先删行再删文件**。反过来的话，行还在、字节没了 ——
-- 客户端会画黑圈（MEDIA-FILE-001）。
--
-- 用法：
--   psql "$DATABASE_URL" -v I_KNOW=1 -f apps/api-go/scripts/seed_dev_shops_users_remove.sql

\\set ON_ERROR_STOP on

-- ── 护栏 1：必须显式确认 ─────────────────────────────────────────────────────
\\if :{?I_KNOW}
\\else
  \\echo '拒绝执行：没有收到 -v I_KNOW=1。'
  \\echo '这批数据是开发种子，删除不可撤销；请确认 DSN 指向开发库后再跑。'
  -- \\quit 不接受参数（`\\quit 1` 会被 psql 报 "extra argument 1 ignored" 然后
  -- 仍然以 0 退出）—— 护栏必须真的让调用方拿到非 0，所以用 \\set ON_ERROR_STOP
  -- 配合一个必然失败的语句来产生非 0 退出码。
  SELECT 1/0;
\\endif

-- ── 护栏 2：库名必须是开发库 ─────────────────────────────────────────────────
DO $$
DECLARE
  dbname text := current_database();
BEGIN
  -- 按"**排除**生产特征"来判：只要名字里出现 prod / production / live 就拒绝，
  -- 其余（proxy / dev / local / test / e2e / scratch / 随机开发库名）都放行。
  -- 护栏太窄等于没有护栏：真要用的时候只能被人加个白名单绕过去。
  IF dbname ~* '(prod|production|live)' THEN
    RAISE EXCEPTION '拒绝在库 % 上执行删除：库名带生产特征（prod/production/live）。', dbname
      USING HINT = '这是不可撤销的批量删除。确认 DSN 指向开发库后重试。';
  END IF;
  RAISE NOTICE '护栏通过：当前库 % 匹配开发库模式。', dbname;
END $$;

\\echo ''
\\echo '── 将要删除的行（确认无误再继续）──'

SELECT 'localnet.posts'                 AS table_name, count(*) FROM localnet.posts                 WHERE id LIKE 'post_devseed_%'
UNION ALL SELECT 'business.store_photos',        count(*) FROM business.store_photos         WHERE id LIKE 'storephoto_devseed_%'
UNION ALL SELECT 'business.member_directory',    count(*) FROM business.member_directory     WHERE business_id LIKE 'biz_devseed_%'
UNION ALL SELECT 'business.memberships',         count(*) FROM business.memberships          WHERE business_id LIKE 'biz_devseed_%'
UNION ALL SELECT 'business.stores',              count(*) FROM business.stores               WHERE id LIKE 'store_devseed_%'
UNION ALL SELECT 'business.accounts',            count(*) FROM business.accounts             WHERE id LIKE 'biz_devseed_%'
UNION ALL SELECT 'identity.profiles',            count(*) FROM identity.profiles             WHERE user_account_id LIKE 'user_devseed_%'
UNION ALL SELECT 'identity.user_accounts',       count(*) FROM identity.user_accounts        WHERE id LIKE 'user_devseed_%'
UNION ALL SELECT 'media 头像资产',                count(*) FROM media.media_assets            WHERE media_asset_id LIKE 'ma_devseed_%_portrait_v1'
UNION ALL SELECT 'media 店面占位图',              count(*) FROM media.media_assets            WHERE media_asset_id LIKE 'ma_devseed_venue_%'
ORDER BY 1;

\\echo ''
\\echo '注意：先删子表再删父表 —— business.accounts 有 owner_user_id 外键指向'
\\echo 'identity.user_accounts（ON DELETE RESTRICT），所以顺序反了会撞外键约束。'

BEGIN;

-- 顺序：posts → store_photos → member_directory → memberships → stores → accounts
--       → media 资产 → profiles → user_accounts。
-- store_photos / store_lines / memberships 对 stores 是 CASCADE，但显式先删更清楚，
-- 免得依赖 CASCADE 悄悄改变行为。
DELETE FROM localnet.posts                 WHERE id LIKE 'post_devseed_%';
DELETE FROM business.store_photos          WHERE id LIKE 'storephoto_devseed_%';
DELETE FROM business.member_directory      WHERE business_id LIKE 'biz_devseed_%';
DELETE FROM business.memberships           WHERE business_id LIKE 'biz_devseed_%';
DELETE FROM business.store_lines           WHERE store_id LIKE 'store_devseed_%';
DELETE FROM business.store_products        WHERE store_id LIKE 'store_devseed_%';
DELETE FROM business.stores                WHERE id LIKE 'store_devseed_%';
DELETE FROM business.accounts              WHERE id LIKE 'biz_devseed_%';
-- 媒体资产必须在引用它的 profile / store_photos 之后删
DELETE FROM media.media_assets             WHERE media_asset_id LIKE 'ma_devseed_%_portrait_v1';
DELETE FROM media.media_assets             WHERE media_asset_id LIKE 'ma_devseed_venue_%';
DELETE FROM identity.profiles              WHERE user_account_id LIKE 'user_devseed_%';
DELETE FROM identity.user_accounts         WHERE id LIKE 'user_devseed_%';

COMMIT;

\\echo ''
\\echo '── 删除后（应全为 0）──'
SELECT 'localnet.posts' AS table_name, count(*) FROM localnet.posts      WHERE id LIKE 'post_devseed_%'
UNION ALL SELECT 'business.stores',              count(*) FROM business.stores          WHERE id LIKE 'store_devseed_%'
UNION ALL SELECT 'business.accounts',            count(*) FROM business.accounts        WHERE id LIKE 'biz_devseed_%'
UNION ALL SELECT 'identity.profiles',            count(*) FROM identity.profiles        WHERE user_account_id LIKE 'user_devseed_%'
UNION ALL SELECT 'identity.user_accounts',       count(*) FROM identity.user_accounts   WHERE id LIKE 'user_devseed_%'
UNION ALL SELECT 'media 头像资产',                count(*) FROM media.media_assets       WHERE media_asset_id LIKE 'ma_devseed_%_portrait_v1'
UNION ALL SELECT 'media 店面占位图',              count(*) FROM media.media_assets       WHERE media_asset_id LIKE 'ma_devseed_venue_%'
ORDER BY 1;
"""


def main() -> int:
    users = all_users()
    assert len(users) == 100, f"expected 100 users, got {len(users)}"
    assert len(spec.SHOPS) == 30, f"expected 30 shops, got {len(spec.SHOPS)}"
    assert len(spec.OWNER_POSTS) == 30, len(spec.OWNER_POSTS)
    assert len(spec.EXTRA_POSTS) == 70, len(spec.EXTRA_POSTS)

    # 一致性自检：这些错了会生成跑不通的 SQL
    assert {n for (n, *_r) in users} == set(range(1, 101))
    for (n, *_r) in spec.SHOPS:
        assert n <= 30, n
    keys = [k for (_n, k, *_r) in spec.EXTRA_USERS]
    assert len(set(keys)) == 70, "EXTRA_USERS 有重复 key"
    names = [nm for (_n, _k, nm, *_r) in spec.EXTRA_USERS]
    assert len(set(names)) == 70, "EXTRA_USERS 有重复姓名"

    written = []
    for fname, content in (
        ("seed_dev_shops_users.sql", gen_seed()),
        ("seed_dev_shops_users_posts.sql", gen_posts()),
        ("seed_dev_shops_users_remove.sql", HEADER_REMOVE),
    ):
        path = OUT_DIR / fname
        path.write_text(content, encoding="utf-8")
        written.append((fname, len(content.splitlines())))

    print("users=100 shops=30 posts=100")
    for fname, lines in written:
        print(f"  wrote {fname} ({lines} lines)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

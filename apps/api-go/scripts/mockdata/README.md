# mockdata — 开发数据生成管线

DEV-ONLY。产出 **100 个用户 + 30 家店 + 100 条帖文**，覆盖 Hà Nội 与 Bắc Ninh，
咖啡店 + 餐厅。用户明确说了「开发后就删除了」，配套删除脚本见下。

## 一条命令跑完

```bash
cd <repo root>

# 1) 由 spec.py 生成三个 SQL（幂等，随时重跑）
python3 apps/api-go/scripts/mockdata/gen_mockdata.py

# 2) 把 contact sheet 裁成媒体资产文件，落进 media store
#    ⚠️ 需要 Pillow，用带 PIL 的解释器
python apps/api-go/scripts/mockdata/crop_assets.py

# 3) 灌（先用户/店，再帖子）
psql "$DATABASE_URL" -f apps/api-go/scripts/seed_dev_shops_users.sql
psql "$DATABASE_URL" -f apps/api-go/scripts/seed_dev_shops_users_posts.sql

# 4) 读回验证
bash apps/api-go/scripts/mockdata/verify_mockdata.sh
```

## 删掉

```bash
psql "$DATABASE_URL" -v I_KNOW=1 -f apps/api-go/scripts/seed_dev_shops_users_remove.sql
# 再清磁盘上的字节（顺序不能反，理由见 remove 脚本头部）
rm ~/Developer/kake-data/media_store/devseed_*.jpg
```

## 文件

| 文件 | 作用 |
|---|---|
| `spec.py` | **唯一事实源**：用户 / 店铺 / 帖文的数据都在这里 |
| `gen_mockdata.py` | 由 spec.py 生成下面三个 .sql |
| `crop_assets.py` | contact sheet → 媒体资产文件（70 头像 + 28 店面 + 12 ai-scenes） |
| `verify_mockdata.sh` | 读回验证（计数 / 引用完整性 / 字节 / HTTP 路由） |
| `../seed_dev_shops_users.sql` | 生成物：100 用户 + 30 店 + 媒体资产 + 成员 |
| `../seed_dev_shops_users_posts.sql` | 生成物：100 条帖文 |
| `../seed_dev_shops_users_remove.sql` | 生成物：反做 |

**要改数据就改 `spec.py`，别直接改那三个 .sql** —— 下次生成会覆盖。

## 三个「故意不做」，别顺手补上

1. **不建 `business.store_lines`。** 营业时间 / wifi / 空调温度 / 座位数是「商家
   自己页面上一个月采一次」的数据，全仓没有生产者。给一家真实存在的店编一条
   「免费 wifi、24°C、安静」，是在断言一个我们并不知道的事实。
   `seed_threebeans_bn.sql` 当年就是因此故意不写 menu/facilities（"编出来会坑到
   真人"），这里沿用同一决定。
2. **不建 `reality.scenes`，`reality_scene_id` 留空。** `reality.scenes` 的
   latitude/longitude 是 NOT NULL，而店铺目录（`scene-shop-directory.ts`）用坐标
   算「1.2km / 步行约 15 分钟」。给真实地址编一组坐标会让那些距离全错 —— 比不显示
   更糟。要挂场景得先拿真坐标（OSM 查），再走 `LinkStoreToRealityScene`。
   **代价要说清楚：这批店目前不会出现在店铺目录里**，只能以店主账号登录后在
   「我的店」看到（`ListBusinessStores` 是 `WHERE business_id=$1`，设计如此）。
   帖文会出现在 feed 里 —— 那是用户能被看见的路径。
3. **店里照片是占位图，caption 里写明了。** 把一张 AI 生成的室内图挂到一家真实
   店铺的相册里、不写清楚，就是拿假图冒充现场。`store_photos.caption` 统一是
   「Ảnh minh hoạ cho môi trường phát triển — không phải ảnh thật của quán」。

## 幂等口径：**收敛式 upsert**，不是 insert-if-absent

固定 ID + `ON CONFLICT DO UPDATE`，跑完必到 `spec.py` 描述的形状。

这里**故意偏离** AGENTS.md 的「seed 路径必须 insert-if-absent，绝不 blind
overwrite」：那条规则的适用对象是**产品基线种子**（boot 时灌的那三个），覆盖等于
篡改产品。本文件是**一次性开发数据**，而且 2026-09-30 已经有一版旧的 devseed 灌进
了开发库（20 店 / 30 用户，HCMC 为主）—— 此时 insert-if-absent 会让旧行原样留着，
结果是「一半旧数据 + 一半新数据」：用户 01–30 顶着旧的城市和简介去当河内/北宁店的
店主。那种状态比覆盖更难查。覆盖范围**只限 `devseed_` 前缀**，碰不到真实数据。

唯一的例外是帖文的 `created_at`：冲突时**不更新**，否则每次重跑都会把这些帖子的
排序位置重洗一遍。

## 踩过的坑（改之前先读，省一轮）

- **`lpad('100', 2, '0')` 返回 `'10'`** —— lpad 在源串比目标长度长时会**截断**。
  用它拼 id 会让第 100 条和第 10 条撞同一个主键，报
  `ON CONFLICT DO UPDATE command cannot affect row a second time`。
  同一个表达式还让 `author_id` 变成 `user_devseed_1`（少补一个零），跟 profiles 里的
  `user_devseed_01` 对不上，帖子会挂到不存在的作者上。
  ⇒ **id 一律在 Python 侧拼好当字面量，不在 SQL 里用 lpad 拼。**
- **`identity.profiles.handle` 的唯一索引是全局的**（`lower(ltrim(handle,'@'))`）。
  2026-09-30 那版已经占用了裸 key 形式（`@devseed_lan` 挂在 `user_devseed_15` 上），
  所以 handle 必须**带序号**（`@devseed_10_lan`）；只带 key 的话能不能过还取决于
  插入顺序，等于埋雷。
- **contact sheet 的两个测试图文件名前缀撞了**（都叫 `A_contact_sheet__one_single_sq_*`），
  靠时间戳区分：`11-31-48` 是人脸（3×3），`11-31-53` 是店面（2×2）。
  已人工看过确认，`crop_assets.py` 里写死了这两条路径。
- **裁格子要内缩**（`INSET = 0.045`），否则格子之间那条白缝会留在头像边缘。
- **媒体文件必须先落盘再灌 SQL。** MEDIA-FILE-001：一行声称 READY 却没有字节的
  媒体资产，客户端画成黑圈。SQL 里写 READY 只是声明。

## 与另一个写者共存

2026-10-01 实测：这个开发库上**有别的进程在同时写**（`identity.user_accounts`
两小时内 +519）。本管线是幂等收敛的，重跑安全；但如果看到计数和 `spec.py` 对不上，
先查是不是别人又在灌 —— `verify_mockdata.sh` 的计数段就是干这个的。

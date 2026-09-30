#!/usr/bin/env node
// dev-feed-pipeline.mjs — 开发用 feed 管线：每 5 分钟发一条文本帖文，
// 顺带滚动补充新用户，让 For You 一直有新内容。
//
// ## 为什么是"文本帖文"而不是图文
//
// 走真实 API 发帖要过一串资产属主约束：UpdateProfile 的头像必须
// **属主匹配 + moderation APPROVED + visibility PUBLIC**
// （media/service.go:890 `asset.OwnerPrincipalID != ownerPrincipalID` → ErrMediaNotOwner）。
// 试过复用库里那 30 个 creator 肖像，被 PROFILE_AVATAR_NOT_DELIVERABLE 挡下 ——
// 属主是别人，怎么提权都没用。所以管线**只发纯文本帖**，不挂媒体：
// 那样就完全绕开了属主约束，产出又和真实帖子同构。
//
// ## 为什么直接写库而不是走 CreatePost API
//
// 走 API 每次都要先 CreateAnonymousSession + UpdateProfile（要 token、要头像），
// 而且 **idempotencyKey 一去不回**：每 5 分钟一个新 key 会不断堆 session 行
// （实测今天一天就堆了 474 个 session、6974 条 idempotency）。管线的目的是产出
// feed 内容，不该顺带污染身份表。所以走 SQL，形状照着库里能跑通的数据抄。
//
// 形状不是猜的，全部实测过（错一次撞一次约束）：
//   · `media_refs`      —— NOT NULL；"无图"是 JSON `'null'::jsonb`（现有 47 条）
//   · `scene_type`      —— CHECK 枚举 9 个：UNKNOWN/ROOFTOP/BRUNCH/SPA/CINEMA/
//                         PHOTO/NIGHTLIFE/OUTDOOR/COFFEE
//   · `city_scope`      —— 简写 `hcm`/`hn`/`danang`（不是完整城市名）
//   · `visibility`      —— PUBLIC；`status` —— PUBLISHED
//   · `author_type`     —— USER
//
// ## 用户名唯一
//
// `identity.profiles` 上有 `UNIQUE (lower(ltrim(handle,'@')))`。所以用户句柄
// 带一个单调递增的序号后缀 —— 用户名不重复，但**头像可以复用**（按序号取模
// 轮转那 30 个 creator 肖像，库里真实存在且 READY）。
//
// ## 单调递增的 created_at 是关键
//
// feed 排序是 `created_at DESC`（idx_posts_feed_keyset）。每 5 分钟一条，
// 所以每次 tick 都用 `now() - 少量偏移` 保证排在最前面。
//
// ## 幂等
//
// 每次 tick 生成一个确定性后缀并先查重：同样的输入跑两次不会产生两条。
//
// 用法：
//   node scripts/dev-feed-pipeline.mjs              # 跑一次 tick
//   node scripts/dev-feed-pipeline.mjs --dry-run    # 只打印会做什么
//   node scripts/dev-feed-pipeline.mjs --backfill 6 # 一次补 6 条（建库时用）
import { spawnSync } from "node:child_process";

const REPO = process.env.PROXY_ROOT || "/Users/thanhhuyennguyen/proxy";
const DRY = process.argv.includes("--dry-run");
const backfillArg = process.argv.indexOf("--backfill");
const BACKFILL = backfillArg >= 0 ? Number(process.argv[backfillArg + 1] || 0) : 0;
const TICKS = BACKFILL > 0 ? BACKFILL : 1;

// ── 连接 ────────────────────────────────────────────────────────────────────
function dsn() {
  const r = spawnSync("grep", ["-o", "^DATABASE_URL=.*", `${REPO}/.env`], { encoding: "utf8" });
  const m = /^DATABASE_URL=(.*)$/m.exec(r.stdout || "");
  if (!m) throw new Error("读不到 .env 里的 DATABASE_URL");
  return m[1].trim();
}
const DSN = dsn();
const PSQL = "/opt/homebrew/opt/postgresql@15/bin/psql";

function sql(text) {
  const r = spawnSync(PSQL, [DSN, "-tAF", "|", "-c", text], { encoding: "utf8", maxBuffer: 8 << 20 });
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error(`psql 退出 ${r.status}: ${(r.stderr || "").slice(0, 300)}`);
  return (r.stdout || "").trim();
}
const q = (s) => `'${String(s).replace(/'/g, "''")}'`;

// ── 内容素材（越南语短帖，贴近真实 feed 的长度与语气）────────────────────────
const BODIES = [
  ["Sáng nay quán vắng, ngồi được hai tiếng không ai hỏi gì. Tối nay chắc lại đông.", "hn", "COFFEE"],
  ["Hết mùa mưa rồi. Đường ngoài phố cổ khô trơn, đi bộ dễ thấy.", "hn", "OUTDOOR"],
  ["Quán mới thử, cà phê hơi nhạt. Giá thì vừa, view thì quá trời đẹp.", "hcm", "COFFEE"],
  ["Bánh mì ốp lò bán tới 9h, hết là hết. Hôm nay tôi đến trễ mất bốn cái.", "hcm", "BRUNCH"],
  ["Nhạc cũ nghe đỡ mệt hơn nhạc mới. Quán nào cũng vậy.", "hcm", "NIGHTLIFE"],
  ["Cà phê sữa đá, nhiều đá. Nhức răng nhưng không bỏ được.", "danang", "COFFEE"],
  ["Trưa nay nắng gắt, ngồi trong nhà mà vẫn nóng. Ăn bún chả rồi về.", "hue", "BRUNCH"],
  ["Có quán nào ở đây cho tôi chỗ có ổ cắm không. Đã ngồi hai tiếng mới hết pin.", "hn", "COFFEE"],
  ["Đi bộ từ 5h sáng, chợ chưa đông. Gặp sương mù dày hơn hôm qua.", "hue", "OUTDOOR"],
  ["Quán này nhạc acoustic, nên nói chuyện nghe rõ. Ít ai thích, tôi thích.", "hcm", "NIGHTLIFE"],
  ["Bánh cuốn cuộn lại ăn không được, ngon thì có. Tự quấn thì xịn hơn.", "hn", "BRUNCH"],
  ["Trà đá mát lạnh mùa này. Uống một ly là thấy cả ngày bớt nóng.", "hcm", "COFFEE"],
  ["Khuya nay vắng, chỉ có mình với con chó của quán.", "danang", "OUTDOOR"],
  ["Giao diện app mới nhìn sáng hơn hẳn. Đọc dễ hơn hẳn.", "hcm", "COFFEE"],
];

// 句柄前缀 + 城市（用户表要求 city 非空且 ≤60 字符）
const HANDLE_PREFIX = "devpipe";
const CITIES = ["Hà Nội", "TP. Hồ Chí Minh", "Đà Nẵng", "Huế"];

function tickStamp(i) {
  // 单调：第 i 条比第 i-1 条新，保证排到 feed 最前
  return `2026-09-30T00:00:00+07`;
}

function nextSeq() {
  // 序号取库里已有的最大后缀 +1，保证句柄唯一
  // user_account_id 在 identity.profiles 上（identity.user_accounts 只有 id/status/时间），
  // 第一版查错了表，报 column "user_account_id" does not exist。
  const cur = sql(
    `SELECT COALESCE(MAX(substring(user_account_id from '[0-9]+$')::int), 0)
     FROM identity.profiles WHERE user_account_id LIKE '${HANDLE_PREFIX}_%'`);
  return Number(cur) + 1;
}

function avatarFor(seq) {
  // 按序号取模轮转那 30 个 creator 肖像（真实存在且 READY）
  const ids = sql(
    `SELECT media_asset_id FROM media.media_assets
      WHERE original_storage_key LIKE '%creator%portrait%' AND processing_status='READY'
      ORDER BY media_asset_id`).split("\n").map((s) => s.trim()).filter(Boolean);
  if (!ids.length) throw new Error("库里没有 READY 的 creator 肖像，头像无从轮转");
  return `assets/${ids[seq % ids.length]}`;
}

function seedUser(seq) {
  const uid = `${HANDLE_PREFIX}_${seq}`;
  const handle = `@${HANDLE_PREFIX}_${seq}`;   // 唯一：带序号后缀
  const name = `Dev ${seq}`;
  const city = CITIES[seq % CITIES.length];
  const avatar = avatarFor(seq);
  if (sql(`SELECT count(*) FROM identity.user_accounts WHERE id=${q(uid)}`) !== "0") return { uid, reused: true };
  if (DRY) return { uid, dry: true, avatar, handle };
  sql(`
    INSERT INTO identity.user_accounts (id, status, created_at, updated_at)
    VALUES (${q(uid)}, 'ACTIVE', now(), now());
    INSERT INTO identity.profiles
      (user_account_id, name, handle, bio, city, avatar_path, version, updated_at)
    VALUES (${q(uid)}, ${q(name)}, ${q(handle)}, ${q("Tài khoản phát triển")}, ${q(city)},
            ${q(avatar)}, 1, now());`);
  return { uid, avatar, handle };
}

function seedPost(seq, userUid) {
  const pid = `post_${HANDLE_PREFIX}_${seq}`;
  if (sql(`SELECT count(*) FROM localnet.posts WHERE id=${q(pid)}`) !== "0") return { pid, reused: true };
  const [body, cityScope, sceneType] = BODIES[seq % BODIES.length];
  const name = sql(`SELECT name FROM identity.profiles WHERE user_account_id=${q(userUid)}`);
  if (DRY) return { pid, dry: true, body, sceneType, cityScope };
  // created_at 用 now()，每 5 分钟一条自然排在最前；media_refs 走 JSON 'null'
  // （不是 SQL NULL —— 列是 NOT NULL，这是实测撞出来的）
  sql(`
    INSERT INTO localnet.posts
      (id, author_type, author_id, author_display_name, body, media_refs,
       visibility, city_scope, scene_type, status, context_refs, created_at, ephemeral_until)
    VALUES (${q(pid)}, 'USER', ${q(userUid)}, ${q(name || " " + seq)},
            ${q(body)}, 'null'::jsonb,
            'PUBLIC', ${q(cityScope)}, ${q(sceneType)}, 'PUBLISHED', '[]'::jsonb,
            now(), NULL);`);
  return { pid, body };
}

// ── 主流程 ──────────────────────────────────────────────────────────────────
console.log(`=== dev feed pipeline · ${TICKS} tick${DRY ? "（dry-run）" : ""} ===`);

const seqStart = nextSeq();
let created = 0;
for (let i = 0; i < TICKS; i++) {
  const seq = seqStart + i;
  const u = seedUser(seq);
  const p = seedPost(seq, u.uid);
  const tag = u.reused ? "复用已有用户" : u.dry ? "将建用户" : "已建用户";
  if (!u.reused) created++;
  console.log(`  [${seq}] ${tag} ${u.uid}（${u.avatar || "—"}） · 帖 ${p.pid}${p.dry ? " · " + p.body : ""}`);
}
// 没有新增就说清楚"没有新增"，别让"跑过了"看起来像"又发了几条"
if (!DRY && created === 0) console.log("  （本轮没有新增 —— 序号已存在，按幂等跳过）");

if (DRY) {
  console.log("\n（dry-run，未写库）");
} else {
  const n = sql(`SELECT count(*) FROM localnet.posts WHERE id LIKE 'post_${HANDLE_PREFIX}_%'`);
  const u = sql(`SELECT count(*) FROM identity.user_accounts WHERE id LIKE '${HANDLE_PREFIX}_%'`);
  console.log(`\n  管线累计：${u} 用户 / ${n} 帖`);
  // 句柄唯一性自查（列上有 UNIQUE 索引，撞了插入就会报错，但先自查更清楚）
  const dup = sql(
    `SELECT count(*) FROM (
       SELECT lower(ltrim(handle,'@')) h FROM identity.profiles
        WHERE user_account_id LIKE '${HANDLE_PREFIX}_%'
        GROUP BY 1 HAVING count(*) > 1) x`);
  if (Number(dup) > 0) {
    console.error(`  FAIL: 有 ${dup} 组重复句柄 —— 用户名必须唯一`);
    process.exitCode = 1;
  } else {
    console.log("  句柄唯一：通过");
  }
}

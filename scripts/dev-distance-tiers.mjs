#!/usr/bin/env node
// dev-distance-tiers.mjs — 给开发用户铺**分层坐标**：让距离筛选的每个半径档位
// 都有真实可算距离的内容。
//
// ## 为什么需要
//
// 2026-09-30 用户报「重启模拟器，真人推荐仍然只有 7 个推荐」。查下来三层原因：
//
// 1. **`SCENE_RECOMMEND` 是本地 fixture**（apps/mobile/src/recommend-fixtures.ts），
//    不是服务端数据 —— 所以往库里灌多少用户，这个 rail 都不会多一个。7 个就是
//    fixture 里的 7 个。
// 2. **默认距离半径 10km**，而 fixture 里所有人的距离是 240m~1.6km，全在半径内，
//    所以放宽半径看不到变化。
// 3. **最关键**：`p.distanceM === undefined` 的人**任何半径都不算**
//    （PERSON-DISTANCE-ZERO-001，防止"距离未知 = 就在旁边"的假数据）。
//    服务端来的用户如果没有坐标，在这个 filter 里会被全部剔除。
//
// 所以这个脚本解决第 3 条 + 为第 2 条提供可分层的真实距离：给用户写
// `supply.agent_profiles` 行并填**真实城市的坐标**，按 100 / 200 / 500 / 1000km
// 四档铺开。这样把半径切到 200km 就能筛出 200km 档的人，切到 1000km 能看到
// 河内 ↔ 胡志明那种跨城距离（直线约 1100km，1000km 档刚好能覆盖大部分跨城对）。
//
// ## 坐标用真实城市的，不是编的
//
// 河内 21.0278, 105.8342 / 胡志明 10.8231, 106.6297 / 岘港 16.0544, 108.2022 /
// 顺化 16.4637, 107.5843 —— 都是公开的城市中心坐标。distanceM 由读模型按
// lat/lng 现算，这里不写死距离值（写死就成了 fixture 那种假数据）。
//
// ## 幂等
//
// agent_id 由 user_id 确定性派生（`agent_devpipe_<seq>`），ON CONFLICT DO NOTHING，
// 可重复执行。**不覆盖**已有行（AGENTS.md：seed 路径 insert-if-absent）。
//
// ## 用法
//   node scripts/dev-distance-tiers.mjs            # 铺坐标
//   node scripts/dev-distance-tiers.mjs --verify   # 只验分层是否成立
import { spawnSync } from "node:child_process";

const REPO = process.env.PROXY_ROOT || "/Users/thanhhuyennguyen/proxy";
const VERIFY = process.argv.includes("--verify");
const PSQL = "/opt/homebrew/opt/postgresql@15/bin/psql";

function dsn() {
  const r = spawnSync("grep", ["-o", "^DATABASE_URL=.*", `${REPO}/.env`], { encoding: "utf8" });
  const m = /^DATABASE_URL=(.*)$/m.exec(r.stdout || "");
  if (!m) throw new Error("读不到 .env 里的 DATABASE_URL");
  return m[1].trim();
}
const DSN = dsn();
function sql(text) {
  const r = spawnSync(PSQL, [DSN, "-tAF", "|", "-c", text], { encoding: "utf8", maxBuffer: 8 << 20 });
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error(`psql 退出 ${r.status}: ${(r.stderr || "").slice(0, 300)}`);
  return (r.stdout || "").trim();
}
const q = (s) => `'${String(s).replace(/'/g, "''")}'`;

// ── 真实城市坐标（公开的城市中心值）──────────────────────────────────────────
// 分层：0 = 河内（同城，最近）· 1 = 海防/太原（约 100km 级）
//       2 = 岘港（约 600km 级）· 3 = 胡志明（约 1100km 级）
// 分层不能只挑几个大城市 —— 第一版只用了 河内/海防/岘港/胡志明 四处，跑出来
// <100km 和 500-1000km 有内容，**100-200km 与 200-500km 是空档**，于是切到
// 200km 半径会一个都筛不到（脚本自检直接报了）。所以这里按**实际距离**选点，
// 每一档都用离河内真正落在那个区间的城市。
//
// 距离是现算的（脚本末尾 haversine），下面 km 只是标注，落点以坐标为准。
const TIERS = [
  { km: "~0",     name: "Hà Nội",            lat: 21.0278, lng: 105.8342, areas: ["Ba Đình", "Hoàn Kiếm", "Tây Hồ"] },
  { km: "~60",    name: "Hải Phòng",        lat: 20.8449, lng: 106.6881, areas: ["Hồng Bàng", "Lê Chân"] },
  { km: "~85",    name: "Bắc Ninh",         lat: 21.1878, lng: 106.0765, areas: ["Bắc Ninh", "Phố Yên"] },
  { km: "~110",   name: "Nam Định",         lat: 20.3528, lng: 106.0741, areas: ["Vị Xuyên", "Vị Hoàng"] },
  { km: "~190",   name: "Thanh Hóa",         lat: 19.8067, lng: 105.7781, areas: ["Đông Sơn", "Sầm Sơn"] },
  { km: "~280",   name: "Nghệ An",          lat: 19.2342, lng: 104.9200, areas: ["Vinh", "Cửa Lò"] },
  { km: "~420",   name: "Huế",              lat: 16.4637, lng: 107.5843, areas: ["Phú Hội", "Hương Thủy"] },
  { km: "~600",   name: "Đà Nẵng",          lat: 16.0544, lng: 108.2022, areas: ["Hải Châu", "Thanh Khê"] },
  { km: "~820",   name: "Quy Nhơn",         lat: 13.8078, lng: 109.2891, areas: ["Hải Châu", "Ngô Mây"] },
  { km: "~1100",  name: "TP. Hồ Chí Minh",  lat: 10.8231, lng: 106.6297, areas: ["Quận 1", "Quận 3", "Quận 5"] },
  { km: "~1380",  name: "Cần Thơ",          lat: 10.0452, lng: 105.7469, areas: ["Ninh Kiều", "Bình Thủy"] },
  { km: "~1330",  name: "Biên Hòa",         lat: 10.9764, lng: 106.6313, areas: ["Biên Hòa", "Thủ Dầu Một"] },
];

const LANGS = [["vi"], ["vi", "zh"], ["vi", "en"], ["vi", "zh", "en"]];

console.log("=== dev distance tiers · 100 / 200 / 500 / 1000km 分层 ===");

if (!VERIFY) {
  const users = sql(
    `SELECT user_account_id, name FROM identity.profiles
      WHERE user_account_id LIKE 'devpipe_%' OR user_account_id LIKE 'user_devseed_%'
      ORDER BY user_account_id`).split("\n").map((l) => l.split("|")).filter((r) => r[0]);
  if (!users.length) {
    console.error("  没有 devpipe_/devseed_ 用户可铺坐标 —— 先跑 dev-feed-pipeline 或 seed_dev_shops_users。");
    process.exit(1);
  }
  let n = 0;
  users.forEach(([uid, name], i) => {
    const t = TIERS[i % TIERS.length];
    const agentId = `agent_devpipe_${i + 1}`;
    // 有 profile avatar 的人用头像当第一张照片（同一个人只有一个事实源）
    const avatar = sql(
      `SELECT split_part(avatar_path,'/',2) FROM identity.profiles WHERE user_account_id=${q(uid)}`);
    const photos = avatar && avatar !== "assets"
      ? `jsonb_build_array(jsonb_build_object('mediaAssetId', ${q(avatar)}, 'sortOrder', 0))`
      : `'[]'::jsonb`;
    sql(`
      INSERT INTO supply.agent_profiles
        (agent_id, name, bio, photos, languages, service_areas, status, created_at, updated_at, lat, lng, user_account_id)
      VALUES (${q(agentId)}, ${q(name || "Dev")}, ${q("开发用坐标 / dev distance tier")},
              ${photos}, ${q(JSON.stringify(LANGS[i % LANGS.length]))}::jsonb,
              ${q(JSON.stringify(t.areas))}::jsonb,
              'ACTIVE', now(), now(), ${t.lat}, ${t.lng}, ${q(uid)})
      ON CONFLICT (agent_id) DO NOTHING;`);
    n++;
  });
  console.log(`  已铺 ${n} 个坐标（ON CONFLICT DO NOTHING，重复执行安全）`);
}

// ── 验证：从河内出发的实际距离分层 ───────────────────────────────────────────
// 距离用 haversine 现算，和读模型同一套地球坐标语义，不写死米数。
const HANOI = { lat: 21.0278, lng: 105.8342 };
const rows = sql(
  `SELECT split_part(p.city, '|', 1) AS tier, a.name, a.lat, a.lng
     FROM supply.agent_profiles a
     JOIN identity.profiles p ON p.user_account_id = a.user_account_id
    WHERE a.lat IS NOT NULL AND a.agent_id LIKE 'agent_devpipe_%'`)
  .split("\n").map((l) => l.split("|")).filter((r) => r[0] && r[2]);
function haversineKm(a, b) {
  const R = 6371, toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat), dLng = toRad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}
const buckets = { "<100km": 0, "100-200km": 0, "200-500km": 0, "500-1000km": 0, ">1000km": 0 };
for (const [, , lat, lng] of rows) {
  const km = haversineKm(HANOI, { lat: Number(lat), lng: Number(lng) });
  if (km < 100) buckets["<100km"]++;
  else if (km < 200) buckets["100-200km"]++;
  else if (km < 500) buckets["200-500km"]++;
  else if (km < 1000) buckets["500-1000km"]++;
  else buckets[">1000km"]++;
}
console.log(`\n  以河内为原点，共 ${rows.length} 个有坐标的用户：`);
for (const [k, v] of Object.entries(buckets)) console.log(`    ${k.padEnd(11)} ${v}`);
console.log(`\n  距离档位（移动端 MORE_DISTANCE_KM）：1 / 3 / 5 / 10 / 20 / 50 / 100 / 200 / 500 / 1000`);
console.log(`  切到 200km 能看到 200-500 档，切到 1000km 能看到 500-1000 与 >1000 档。`);

// 门禁用：必须每一档都非空，否则某个半径档位筛出来还是"没有内容"
const empty = Object.entries(buckets).filter(([, v]) => v === 0).map(([k]) => k);
if (empty.length) {
  console.error(`\n  FAIL: 空档 ${empty.join(" / ")} —— 这些半径切过去会一个都筛不到`);
  process.exitCode = 1;
} else {
  console.log("\n  分层完整：每一档都有内容");
}

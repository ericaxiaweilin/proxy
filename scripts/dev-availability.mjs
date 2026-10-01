#!/usr/bin/env node
// dev-availability.mjs — 给开发用户铺「有没有空」的排期，并让那 6 条 fixture 一直不过期。
//
// HOME-FORYOU-FREE-001：推荐位上的「这个人当前有没有空」必须有依据。
//
// 之前的问题（用户 2026-10-01 提出）：
//   · rail 上那个「在线点」是 `online: false` 写死的假值；
//   · 点圆圈刷新走的是 `Math.random()`，与「有没有空」毫无关系；
//   · 于是「换个人」看起来像在挑有空的人，其实完全没有依据 —— 和
//     PERSON-DISTANCE-ZERO-001 造出的 0m 是同一类错误：拿一个和现实无关的量当承诺。
//
// 事实源：复用 `supply.availability_windows`（没有另立表）——「一个人什么时候有空」
// 只能有一个事实源。free_at 由 Postgres 侧的服务端读计算，客户端不猜。
//
// ## 为什么脚本要滚动窗口
//
// 既有 6 条 fixture（agent_linh/mai/an/thao/minh/yen）的 `end_at` 是
// **2026-10-04 08:29** —— 今天是 10-01，也就是三天后它们全部过期。推荐位今天
// 还不看这张表，所以毫无察觉；一旦接上就会表现为「点圆圈刷不出人」，
// 而且没有报错 —— 只是忽然没人了。
//
// 所以这里每次执行都把窗口**往前滚**：now() → now()+14 天。
// 幂等（按 agent_id 唯一覆盖），可重复执行。
//
// ## 三态，不是两态
//
//   没有任何排期        → FreeAt = nil  = **未知**（不是"有空"）
//   有排期且盖住了时段   → FreeAt = true
//   有排期但盖不住       → FreeAt = false
//
// 「未知 ≠ 有空」是 PERSON-DISTANCE-ZERO-001 的同一条规矩：不知道就不能当成满足
// 条件。所以这个脚本给每个开发用户都排了至少一段，**不是全部排满** —— 留一部分
// 故意没有排期，才能验到"未知不会被当成有空"。
//
// 用法：node scripts/dev-availability.mjs [--verify]
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

const DAYS = 14;

// 每种排期形态。**故意留一部分人没有排期**（ratio 0.35 的那档），
// 用来验证「未知不会被当成有空」—— 全都排满的话这条规则就没法验。
const PROFILES = [
  { suffix: "_am", startHour: 9,  endHour: 21, ratio: 1.0 },  // 全天空档
  { suffix: "_pm", startHour: 14, endHour: 22, ratio: 0.9 },  // 下午/晚上
  { suffix: "_noon", startHour: 11, endHour: 15, ratio: 0.5 }, // 午间
  { suffix: "_none", startHour: 0, endHour: 0, ratio: 0.35 }, // 故意没排期
];

console.log("=== dev availability · 滚动 14 天排期（HOME-FORYOU-FREE-001）===");

if (!VERIFY) {
  const agents = sql(
    `SELECT agent_id FROM supply.agent_profiles
      WHERE lat IS NOT NULL AND (agent_id LIKE 'agent_devpipe_%' OR agent_id LIKE 'agent_user_devseed_%')
      ORDER BY agent_id`).split("\n").map((s) => s.trim()).filter(Boolean);
  if (!agents.length) {
    console.error("  没有带坐标的开发用户 —— 先跑 dev-distance-tiers.mjs。");
    process.exit(1);
  }
  let n = 0;
  agents.forEach((agentId, i) => {
    const p = PROFILES[i % PROFILES.length];
    // ratio: 按 agent 序号决定这一档里有多少人真的排期（其余保持"无排期"）
    if (((i * 7919) % 100) / 100 >= p.ratio) return;
    if (p.endHour <= p.startHour) return; // _none 档：不写任何窗口
    const id = `aw_dev_${agentId}_${p.suffix}`;
    sql(`
      INSERT INTO supply.availability_windows
        (id, agent_id, start_at, end_at, market_id, status, created_at, updated_at)
      VALUES (${q(id)}, ${q(agentId)},
              date_trunc('day', now()) + interval '${p.startHour} hours',
              date_trunc('day', now()) + interval '${p.endHour} hours',
              'dev', 'AVAILABLE', now(), now())
      ON CONFLICT (id) DO UPDATE
        SET start_at = EXCLUDED.start_at, end_at = EXCLUDED.end_at,
            status = 'AVAILABLE', updated_at = now();`);
    n++;
  });
  // 既有 6 条 fixture 往前滚 —— 它们 10-04 就过期了。
  sql(`
    UPDATE supply.availability_windows
       SET start_at = date_trunc('day', now()),
           end_at   = date_trunc('day', now()) + interval '${DAYS} days',
           updated_at = now()
     WHERE id IN ('aw_agent_linh','aw_agent_mai','aw_agent_an','aw_agent_thao','aw_agent_minh','aw_agent_yen');`);
  console.log(`  已写 ${n} 段排期（滚动 ${DAYS} 天）· 6 条 fixture 已往前滚`);
}

// ── 验证 ────────────────────────────────────────────────────────────────────
const total = sql(`SELECT count(*) FROM supply.availability_windows WHERE status='AVAILABLE'`);
const expired = sql(`SELECT count(*) FROM supply.availability_windows WHERE status='AVAILABLE' AND end_at <= now()`);
const noWindow = sql(
  `SELECT count(*) FROM supply.agent_profiles a
    WHERE a.lat IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM supply.availability_windows w
                       WHERE w.agent_id = a.agent_id AND w.status='AVAILABLE' AND w.end_at > now())`);
console.log(`\n  AVAILABLE 窗口：${total} 段`);
console.log(`  已过期（必须为 0）：${expired}`);
console.log(`  带坐标但**没有排期**的用户：${noWindow}（这些人的 FreeAt 是 nil=未知，不是"有空"）`);
console.log(`\n  事实源：supply.availability_windows（free_at 由 Postgres 侧服务端读计算）`);
console.log(`  滚动窗口：${DAYS} 天 —— 重新执行本脚本即可往前滚，不必手工改日期。`);

if (Number(expired) !== 0) {
  console.error(`\n  FAIL: 有 ${expired} 段已过期 —— 推荐位会表现为「刷不出人」且不报错。跑一次本脚本即可。`);
  process.exitCode = 1;
} else {
  console.log("\n  排期健康：没有已过期的窗口");
}
if (Number(noWindow) === 0) {
  console.error("\n  WARN: 所有用户都排满了期 —— 「未知 ≠ 有空」这条规则就没法验了。");
  console.error("        _none 档故意不给一部分人排期，就是为了留出「未知」这一态。");
  process.exitCode = 1;
}
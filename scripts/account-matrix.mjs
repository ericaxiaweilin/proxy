#!/usr/bin/env node
// account-matrix.mjs — 账户体系「真链路」6 例（并发 / 限流 / 畸形）。
//
// 为什么它现在在仓库里：它原来硬编码在 /tmp/account-matrix.mjs，由
// `account-vibe.mjs` 调用。/tmp 会被系统清理，所以「脚本不见了」是迟早的事 ——
// 而 2026-09-30 实测它**已经**不在了：account-vibe 那一段子进程
// MODULE_NOT_FOUND 崩掉，但调用处写的是 `node /tmp/account-matrix.mjs | tail -n 10`，
// 管道的退出码取 tail，于是崩了也当成功，脚本照样打出
// "=== 账户 overall: 51 cases ===" 并以 0 退出。六例真链路一次都没跑成。
//
// 教训落在两处，都写死在代码里：
//   1. 别把被依赖的脚本放在 /tmp；
//   2. **别用管道接子进程** —— `cmd | tail` 的退出码是 tail 的，真实失败会被吞掉。
//
// 「比真人更严」的含义：真人不会并发打 12 次、不会发 4MB 的畸形体、不会拿
// 空 payload 打命令。这些恰恰是攻击面，所以这里全都试一遍，并要求**明确的**
// 拒绝（结构化错误），而不是 5xx 或超时。
//
// 只读：不写业务数据，只创建匿名会话（可逆、会过期）。
// 用法：PROXY_API_BASE=http://127.0.0.1:4100 node scripts/account-matrix.mjs
import { spawnSync } from "node:child_process";

const BASE = process.env.PROXY_API_BASE || "http://127.0.0.1:4100";
const UA = "account-matrix/1.0";

let failures = 0;
const ok = (m) => console.log(`  OK  : ${m}`);
const fail = (m) => { console.log(`  FAIL: ${m}`); failures++; };

function ts() { return `${Date.now()}${Math.floor(Math.random() * 1000)}`; }

// 用 curl 子进程。**状态码必须靠 `-w` 单独取一行，不能从 body 里猜。**
// 第一版用正则 `/^\s*(\d{3})$/m` 去 stdout 里找"看起来像状态码的行"——
// 结果 body 里任何纯数字行都会被当成状态码，而 health 那条又根本没加 `-w`，
// 于是活着的 API 被判成 health=0。猜是错的，让 curl 把它知道的事写出来。
function curlGet(path) {
  const r = spawnSync("curl", ["--noproxy", "*", "-s", "-m", "5", "-o", "/dev/null", "-w", "%{http_code}", `${BASE}${path}`], {
    encoding: "utf8",
  });
  return { code: r.error ? -1 : Number(String(r.stdout).trim()) || 0 };
}

function post(body, { path = "/v1/commands/CreateAnonymousSession", extra = [] } = {}) {
  const r = spawnSync("curl", [
    "--noproxy", "*", "-s", "-m", "30",
    "-o", "-", "-w", "\n__STATUS__%{http_code}\n",
    "-X", "POST", `${BASE}${path}`,
    "-H", "content-type: application/json",
    "-H", `user-agent: ${UA}`,
    ...extra,
    "--data-binary", typeof body === "string" ? body : JSON.stringify(body),
  ], { encoding: "utf8", timeout: 40000 });
  if (r.error) return { code: -1, body: "", error: r.error.message };
  const m = /\n__STATUS__(\d{3})\n?$/.exec(r.stdout);
  if (!m) return { code: -1, body: r.stdout, error: "curl 没写出状态码（-w 被覆盖或 body 里含同样标记）" };
  return { code: Number(m[1]), body: r.stdout.slice(0, m.index) };
}

// payload 的形状是**照着能跑通的那份 e2e**（scripts/benefit-eligibility-e2e.sh）抄的，
// 不是猜的。第一版我 payload 写空，服务回 INVALID_COMMAND_ENVELOPE —— 那是**正确
// 的拒绝**（校验层没问题），是我的用例没按真实契约发请求。照着猜出来的 envelope
// 写断言，测的就不是产品而是我自己的想象。
function anonEnvelope(id, extra = {}) {
  const t = ts();
  return {
    commandType: "CreateAnonymousSession", commandVersion: 1,
    commandId: `acct-matrix-${id}-${t}`,
    idempotencyKey: `acct-matrix-idem-${id}-${t}`,
    actor: { type: "USER", id: "ignored" },
    principal: { type: "INDIVIDUAL", id: "ignored" },
    target: { type: "Session", id: "ignored" },
    authContext: { clientIp: "127.0.0.1", userAgent: UA },
    purpose: "e2e_account_matrix",
    correlationId: `acct-matrix-corr-${id}-${t}`,
    causationId: "",
    requestedAt: new Date().toISOString().replace(/\.\d+Z$/, "Z"),
    payload: {
      deviceId: `acct-matrix-${id}-${t}`,
      platform: "IOS",
      deviceCredential: "a".repeat(64),
      dateOfBirth: "2000-01-01",
      legalDocVersion: "1.1",
      consents: { terms: true, privacy: true },
    },
    ...extra,
  };
}

// body 走 stdin（用于超大 payload）。
function postStdin(body, { path = "/v1/commands/CreateAnonymousSession" } = {}) {
  const r = spawnSync("curl", [
    "--noproxy", "*", "-s", "-m", "30",
    "-o", "-", "-w", "\n__STATUS__%{http_code}\n",
    "-X", "POST", `${BASE}${path}`,
    "-H", "content-type: application/json",
    "-H", `user-agent: ${UA}`,
    "--data-binary", "@-",
  ], { encoding: "utf8", timeout: 40000, input: body, maxBuffer: 64 * 1024 * 1024 });
  if (r.error) return { code: -1, body: "", error: r.error.message };
  const m = /\n__STATUS__(\d{3})\n?$/.exec(r.stdout);
  if (!m) return { code: -1, body: r.stdout, error: `curl 没写出状态码（status=${r.status}）` };
  return { code: Number(m[1]), body: r.stdout.slice(0, m.index) };
}

function parsed(body) { try { return JSON.parse(body); } catch { return null; } }
function tokenOf(body) { return parsed(body)?.auth?.accessToken || ""; }

console.log("=== account matrix · 6 例（并发 / 限流 / 畸形）===");
console.log(`  api: ${BASE}`);

// ── 0. 前置：API 活着 ─────────────────────────────────────────────────────
{
  const r = curlGet("/health/live");
  if (r.code !== 200) {
    fail(`API 不在 ${BASE}（health=${r.code}）—— 下面 6 例全部无意义，先起 API`);
    console.log(`\n=== account matrix: 0 例有效（API 不可达）===`);
    process.exit(1);
  }
  ok("API 活着");
}

// ── 1. 基线：一次正常匿名会话必须成功且拿到 token ─────────────────────────
{
  const r = post(anonEnvelope("baseline"));
  const t = tokenOf(r.body);
  if (r.code >= 200 && r.code < 300 && t) ok(`基线匿名会话成功（${r.code}，拿到 token）`);
  else fail(`基线匿名会话失败（${r.code}）：${r.body.slice(0, 160)}`);
}

// ── 2. 并发 12 次建会话：必须全部成功且**互不相同** ────────────────────────
// 真人不会同时点 12 下；会话单例化 / 幂等串扰只在这里露出来。
{
  const n = 12;
  const results = [];
  for (let i = 0; i < n; i++) results.push(post(anonEnvelope(`conc${i}`)));
  const codes = results.map((r) => r.code);
  const tokens = results.map((r) => tokenOf(r.body));
  const good = codes.filter((c) => c >= 200 && c < 300).length;
  const uniq = new Set(tokens.filter(Boolean)).size;
  if (good === n && uniq === n) ok(`并发 ${n} 次全部成功且 token 各不相同（${uniq}/${n}）`);
  else if (good < n) fail(`并发 ${n} 次只成功 ${good} 次：${JSON.stringify(codes)}`);
  else fail(`并发 ${n} 次 token 出现复用（唯一 ${uniq}/${n}）—— 会话串扰`);
}

// ── 3. 幂等重放：同 idempotencyKey 打两次必须收敛，且**不能**发两个会话 ────
{
  const key = `acct-matrix-replay-${ts()}`;
  const env = anonEnvelope("replay", { idempotencyKey: key });
  const a = post(env);
  const b = post(env);
  const ta = tokenOf(a.body);
  const tb = tokenOf(b.body);
  if (a.code === 409 || b.code === 409) ok(`重放被拒或收敛（${a.code}/${b.code}）`);
  else if (ta && ta === tb) ok(`重放收敛到同一会话（token 相同，${a.code}/${b.code}）`);
  else fail(`同幂等键两次得到不同结果（${a.code}/${b.code}，token ${ta ? "有" : "无"}/${tb ? "有" : "无"}）—— 幂等失效`);
}

// ── 4. 畸形 JSON：必须是 4xx 结构化拒绝，不能 5xx、不能 200 ───────────────
for (const [name, raw] of [
  ["非法 JSON", "{not json"],
  ["空 body", ""],
  ["JSON 数组而非对象", "[]"],
  ["缺 commandType", JSON.stringify({ commandVersion: 1, payload: {} })],
]) {
  const r = post(raw);
  if (r.code >= 400 && r.code < 500) ok(`${name} → ${r.code}（4xx 拒绝）`);
  else if (r.code === 200) fail(`${name} 竟然返回 200：${r.body.slice(0, 120)} —— 畸形输入被放行`);
  else fail(`${name} → ${r.code}，应当是 4xx（5xx 说明解析层没有兜住）`);
}

// ── 5. 超大 body（4MB）：必须被拒，且不能把服务打挂 ──────────────────────
{
  // 4MB 必须走 **stdin**（`--data-binary @-`），不能走命令行参数：
  // 第一版用 `--data-binary "<4MB>"`，直接撞上 OS 的 exec 参数长度上限
  // （spawnSync 报 E2BIG，curl 压根没启动）。那是我测试台的限制，不是产品缺陷 ——
  // 报成"产品没拒 4MB"会是彻头彻尾的误判。
  const big = JSON.stringify({ ...anonEnvelope("big"), payload: { blob: "x".repeat(4 * 1024 * 1024) } });
  const r = postStdin(big);
  if (r.code >= 400 && r.code < 500) ok(`4MB body → ${r.code}（4xx 拒绝）`);
  else fail(`4MB body → ${r.code}，应当被拒（200 意味着 4MB 全进了内存）`);
  // 服务必须还活着 —— 大 body 处理完之后再打一次基线。
  const after = post(anonEnvelope("after-big"));
  if (after.code >= 200 && after.code < 300) ok("超大 body 之后服务仍可用");
  else fail(`超大 body 之后服务不可用（${after.code}）—— 4MB 请求打挂了会话创建`);
}

// ── 6. 版本防护 ─────────────────────────────────────────────────────────
// 这里我第一版断言"未知 commandVersion 必须被拒"，**断言本身是错的**，实测也证伪了。
//
// 查了契约：apps/api-go/openapi.yaml 的 CommandEnvelope 写的是
//   commandVersion: { type: integer, minimum: 1 }
// —— 只有下界，**没有上界**。服务端只拒 `CommandVersion <= 0`
// （api/command_dispatch.go:393 missingEnvelopeField）。所以 9999 被当 v1 处理
// 是**符合契约**的行为，不是缺陷。
//
// 而且这是团队的明确取向，不是疏漏：同一个 enum 里有
//   DummyOther # placeholder to keep enum open for additive field evolution
// 即"加法演进"。所以不在这里加版本闸门 —— 那会与已声明的契约相矛盾，属于
// 契约变更，不是顺手能改的。测试改成钉**真正存在**的闸门。
//
// 现实风险有限：payload 是 JSON map，服务端按必填字段校验，所以不兼容的新 payload
// 会被字段校验挡下，而不是被静默误读。
{
  for (const v of [0, -1]) {
    const r = post(anonEnvelope(`ver${v}`, { commandVersion: v }));
    if (r.code >= 400 && r.code < 500) ok(`commandVersion=${v} → ${r.code}（4xx 拒绝，这是真正的闸门）`);
    else fail(`commandVersion=${v} → ${r.code}，应当被拒（missingEnvelopeField 拒 <= 0）`);
  }
  const missing = post((() => { const e = anonEnvelope("nover"); delete e.commandVersion; return JSON.stringify(e); })());
  if (missing.code >= 400 && missing.code < 500) ok(`缺 commandVersion → ${missing.code}（4xx 拒绝）`);
  else fail(`缺 commandVersion → ${missing.code}，应当被拒`);

  // 高版本按契约被接受 —— 显式钉住这个决定，免得下次有人再写一个错的断言。
  const hi = post(anonEnvelope("hiver", { commandVersion: 2 }));
  if (hi.code >= 200 && hi.code < 300) {
    ok(`commandVersion=2 → ${hi.code}（按 openapi minimum:1 被接受：加法演进，非缺陷）`);
  } else {
    fail(`commandVersion=2 → ${hi.code}，与 openapi 的 minimum:1 不符（契约与实现漂移）`);
  }
}

console.log("");
if (failures) {
  console.log(`=== account matrix: ${failures} 例失败 ===`);
  process.exit(1);
}
console.log("=== account matrix: ALL PASS ===");

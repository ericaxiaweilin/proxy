// Isolated console API client — talks only to Go BFF, never to mobile store
const BASE = "";

export type ExperienceMetrics = {
  compile_count: number;
  compile_latency_p50_ms: number;
  compile_latency_p95_ms: number;
  validation_fail: number;
  capability_fallback: number;
  delta_apply_success: number;
  delta_reject: number;
  snapshot_recovery: number;
  no_ui_change: number;
};

export async function fetchExperienceMetrics(): Promise<ExperienceMetrics> {
  const r = await fetch(`${BASE}/v1/experience/metrics`);
  if (!r.ok) throw new Error(`metrics ${r.status}`);
  return r.json() as Promise<ExperienceMetrics>;
}

export async function fetchDecisionTrace(decisionId: string): Promise<unknown> {
  // placeholder — wired to future POST /v1/decisions/evaluate trace
  const r = await fetch(`${BASE}/v1/experience/surface?surface_id=home`);
  if (!r.ok) throw new Error(`surface ${r.status}`);
  return r.json();
}

// ---------------------------------------------------------------------------
// OPS-REAL-001：运营控制台的登录与取数。
//
// /v1/operator/* 现在只给运营（会话 + PROXY_OPERATOR_PRINCIPALS 白名单 + ANALYTICS scope）。
// 登录走 App 同一条邮箱验证码流程（BeginPasswordlessAuthentication → VerifyLoginChallenge → CreateSession），
// 平台报 WEB。会话只放 sessionStorage（关掉标签页就退出），不进 localStorage。
//
// opFetch 统一处理三种非正常态，页面不用各写一遍：
//   - 没登录 / 会话过期（401）→ 广播 auth，App 显示登录框；
//   - 登录了但不是运营（403）→ 广播 forbidden；
//   - 服务端说 NOT_CONNECTED（规格里有、后端还没做）→ 广播 notConnected，App 显示「未接入：缺 X 模块」，页面不渲染任何数字。
export type OpStatus =
  | { kind: "auth" }
  | { kind: "forbidden" }
  | { kind: "notConnected"; missing: string; spec: string };

const SESSION_KEY = "proxy.ops.session";
const listeners = new Set<(status: OpStatus) => void>();

export function onOpStatus(listener: (status: OpStatus) => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

function emit(status: OpStatus): void {
  for (const listener of listeners) listener(status);
}

type OpsSession = { accessToken: string; userAccountId: string };

export function readOpsSession(): OpsSession | undefined {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as OpsSession) : undefined;
  } catch {
    return undefined;
  }
}

export function clearOpsSession(): void {
  try { sessionStorage.removeItem(SESSION_KEY); } catch { /* ignore */ }
}

export class OpStatusError extends Error {
  constructor(public readonly status: OpStatus) {
    super(status.kind);
  }
}

// 默认 any：老页面直接 .then(setState) 推断各自的 Payload；新页面显式传类型。
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function opFetch<T = any>(path: string): Promise<T> {
  const session = readOpsSession();
  const r = await fetch(`${BASE}${path}`, { headers: session ? { Authorization: `Bearer ${session.accessToken}` } : {} });
  if (r.status === 401) { clearOpsSession(); emit({ kind: "auth" }); throw new OpStatusError({ kind: "auth" }); }
  if (r.status === 403) { emit({ kind: "forbidden" }); throw new OpStatusError({ kind: "forbidden" }); }
  if (!r.ok) throw new Error(`${path} ${r.status}`);
  const body = (await r.json()) as { dataSource?: string; missing?: string; spec?: string };
  if (body.dataSource === "NOT_CONNECTED") {
    const status: OpStatus = { kind: "notConnected", missing: body.missing ?? "", spec: body.spec ?? "" };
    emit(status);
    throw new OpStatusError(status);
  }
  return body as T;
}

// 一个控制台标签页 = 一台 WEB 设备；deviceCredential 只在本标签页里。
function deviceIdentity(): { deviceId: string; deviceCredential: string } {
  const key = "proxy.ops.device";
  try {
    const saved = sessionStorage.getItem(key);
    if (saved) return JSON.parse(saved) as { deviceId: string; deviceCredential: string };
  } catch { /* ignore */ }
  const random = (n: number) => Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) => b.toString(16).padStart(2, "0")).join("");
  const identity = { deviceId: `ops_web_${random(8)}`, deviceCredential: random(24) };
  try { sessionStorage.setItem(key, JSON.stringify(identity)); } catch { /* ignore */ }
  return identity;
}

async function loginCommand(commandType: string, target: { type: string; id: string }, payload: Record<string, unknown>): Promise<Record<string, unknown>> {
  const { deviceId } = deviceIdentity();
  const id = `ops_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  const r = await fetch(`${BASE}/v1/commands/${commandType}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      commandId: id, commandType, commandVersion: 1,
      actor: { type: "USER", id: deviceId }, principal: { type: "INDIVIDUAL", id: deviceId },
      target, idempotencyKey: `${id}_key`, authContext: {}, purpose: "operator_console_login",
      correlationId: id, causationId: "", requestedAt: new Date().toISOString(), payload,
    }),
  });
  return (await r.json()) as Record<string, unknown>;
}

export async function beginEmailLogin(email: string): Promise<string> {
  const { deviceId } = deviceIdentity();
  const result = await loginCommand("BeginPasswordlessAuthentication", { type: "LoginChallenge", id: "new" }, { channel: "EMAIL", identifier: email.trim(), deviceId, platform: "WEB" });
  if (result.outcome !== "PENDING" || typeof result.operationRef !== "string") throw new Error("验证码没发出去");
  return result.operationRef;
}

export async function completeEmailLogin(challengeId: string, code: string): Promise<void> {
  const verified = await loginCommand("VerifyLoginChallenge", { type: "LoginChallenge", id: challengeId }, { challengeId, code: code.trim() });
  if (verified.outcome !== "ACCEPTED") throw new Error("验证码不对或已过期");
  const { deviceId, deviceCredential } = deviceIdentity();
  const session = await loginCommand("CreateSession", { type: "Session", id: "new" }, { deviceId, challengeId, deviceCredential });
  const auth = session.auth as { accessToken?: string; userAccountId?: string } | undefined;
  if (session.outcome !== "ACCEPTED" || !auth?.accessToken || !auth.userAccountId) throw new Error("登录没有成功");
  sessionStorage.setItem(SESSION_KEY, JSON.stringify({ accessToken: auth.accessToken, userAccountId: auth.userAccountId }));
}

// 运营写操作（如「立即重算引力」）：同一套会话与 401 / 403 处理。
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function opPost<T = any>(path: string, body?: unknown): Promise<T> {
  const session = readOpsSession();
  const headers: Record<string, string> = session ? { Authorization: `Bearer ${session.accessToken}` } : {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const r = await fetch(`${BASE}${path}`, { method: "POST", headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  if (r.status === 401) { clearOpsSession(); emit({ kind: "auth" }); throw new OpStatusError({ kind: "auth" }); }
  if (r.status === 403) { emit({ kind: "forbidden" }); throw new OpStatusError({ kind: "forbidden" }); }
  if (!r.ok) throw new Error(`${path} ${r.status}`);
  return (await r.json()) as T;
}

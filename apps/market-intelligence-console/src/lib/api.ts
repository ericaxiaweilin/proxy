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

type OpsSession = { accessToken: string; userAccountId: string; sessionId?: string };

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

// OPS-SESSION-SLOT-RELEASE-001（2026-10-06）：「关掉标签页就退出」以前只做到了
// **客户端忘掉 token** —— 服务端那条会话还是 ACTIVE，30 天不释放。
//
// 为什么这会伤人：账号同时只有 2 个设备位（identity/service.go
// enforceMaxConcurrentSessions，MaxConcurrentSessions = 2，Lotus RFC §6），
// 新登录按 issued_at FIFO 驱逐**最老**的那条。运营控制台和开发者手机用的是
// **同一个账号**（PROXY_OPERATOR_PRINCIPALS 那个），所以每开一次控制台标签页就
// 多压一个槽位、把最老的挤出去 —— 而最老的通常就是手机上那条，于是开发者
// 莫名其妙被登出（2026-10-06 实测：手机会话 REVOKED 与 ops_web 新会话 issued
// 相差 5–6 毫秒，两次）。
//
// 第一版修法是在 pagehide 时发 RevokeSession。但 pagehide 分不清「关标签页」和
// 「刷新」—— 运营按一下 F5 就被注销，得重新收验证码（2026-10-11 实测）。
//
// SESSION-SAME-DEVICE-001（2026-10-11）把槽位问题挪到服务端解决：同一台设备再登录
// 时先替换这台设备自己的旧会话，不再挤掉别的设备。配合下面 deviceIdentity 改存
// localStorage（同一浏览器 = 同一台设备），控制台无论开关多少次标签页都只占一个
// 槽位，所以不再需要在 pagehide 注销：刷新保持登录，关标签页仍然忘掉 token
// （会话只在 sessionStorage），留在服务端的那条会在下次登录时被替换。
// 只有点「退出」才主动注销。
export function releaseOpsSession(): void {
  const session = readOpsSession();
  clearOpsSession();
  if (!session?.sessionId || !session.accessToken) return;
  const id = `ops_release_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  try {
    void fetch(`${BASE}/v1/commands/RevokeSession`, {
      method: "POST",
      keepalive: true,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.accessToken}` },
      body: JSON.stringify({
        commandId: id,
        commandType: "RevokeSession",
        commandVersion: 1,
        actor: { type: "USER", id: session.userAccountId },
        principal: { type: "INDIVIDUAL", id: session.userAccountId },
        target: { type: "Session", id: session.sessionId },
        idempotencyKey: `${id}_key`,
        authContext: { sessionId: session.sessionId },
        purpose: "operator_console_tab_close",
        correlationId: id,
        causationId: "",
        requestedAt: new Date().toISOString(),
        payload: { reason: "USER_LOGOUT" }
      })
    }).catch(() => undefined);
  } catch { /* 尽力而为：失败时服务端那条会在这台设备下次登录时被替换 */ }
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

// 一个浏览器 = 一台 WEB 设备（SESSION-SAME-DEVICE-001）。以前是一个标签页一台设备，
// 每开一次标签页就多一台设备、多占一个会话槽位。存 localStorage 让同一浏览器每次
// 登录都是同一个 deviceId，服务端据此替换这台设备的旧会话。只存设备身份，
// 访问令牌仍然只在 sessionStorage。旧的 sessionStorage 记录迁移过来一次。
function deviceIdentity(): { deviceId: string; deviceCredential: string } {
  const key = "proxy.ops.device";
  try {
    const saved = localStorage.getItem(key) ?? sessionStorage.getItem(key);
    if (saved) {
      try { localStorage.setItem(key, saved); } catch { /* ignore */ }
      return JSON.parse(saved) as { deviceId: string; deviceCredential: string };
    }
  } catch { /* ignore */ }
  const random = (n: number) => Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) => b.toString(16).padStart(2, "0")).join("");
  const identity = { deviceId: `ops_web_${random(8)}`, deviceCredential: random(24) };
  try { localStorage.setItem(key, JSON.stringify(identity)); } catch {
    try { sessionStorage.setItem(key, JSON.stringify(identity)); } catch { /* ignore */ }
  }
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
  const auth = session.auth as { accessToken?: string; userAccountId?: string; sessionId?: string } | undefined;
  if (session.outcome !== "ACCEPTED" || !auth?.accessToken || !auth.userAccountId) throw new Error("登录没有成功");
  // sessionId 必须一起存：关标签页时要拿它发 RevokeSession，把这条会话的
  // 设备位真的还回去（OPS-SESSION-SLOT-RELEASE-001）。只存 token 的话
  // 服务端那条 ACTIVE 会一直占着账号 2 个槽位里的一个。
  sessionStorage.setItem(SESSION_KEY, JSON.stringify({
    accessToken: auth.accessToken,
    userAccountId: auth.userAccountId,
    ...(auth.sessionId ? { sessionId: auth.sessionId } : {})
  }));
}

// 运营看私有图（如接单申请的证件 / 自拍）：<img> 带不了 Authorization，所以取成 blob 再给 object URL。
export async function opBlobUrl(path: string): Promise<string> {
  const session = readOpsSession();
  const r = await fetch(`${BASE}${path}`, { headers: session ? { Authorization: `Bearer ${session.accessToken}` } : {} });
  if (r.status === 401) { clearOpsSession(); emit({ kind: "auth" }); throw new OpStatusError({ kind: "auth" }); }
  if (r.status === 403) { emit({ kind: "forbidden" }); throw new OpStatusError({ kind: "forbidden" }); }
  if (!r.ok) throw new Error(`${path} ${r.status}`);
  return URL.createObjectURL(await r.blob());
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

// PUBLIC-NO-LOOKUP-001：运营写 / 查命令走 /v1/commands/<Type>（命令信封）。服务端用会话覆盖
// 信封里的 actor / principal，所以这里的身份只是占位。会话过期（401）/ 不是运营或缺 scope
// （403）与 opFetch 一样广播给 App，页面不用各写一遍。
export type OpCommandResult = {
  outcome: string;
  operationRef?: string;
  error?: { errorCode: string; safeDetails?: Record<string, unknown> };
};

export async function opCommand(commandType: string, target: { type: string; id: string }, payload: Record<string, unknown>): Promise<OpCommandResult> {
  const session = readOpsSession();
  const id = `ops_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  const who = session?.userAccountId ?? "unknown";
  const r = await fetch(`${BASE}/v1/commands/${commandType}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(session ? { Authorization: `Bearer ${session.accessToken}` } : {}) },
    body: JSON.stringify({
      commandId: id, commandType, commandVersion: 1,
      actor: { type: "USER", id: who }, principal: { type: "INDIVIDUAL", id: who },
      target, idempotencyKey: `${id}_key`, authContext: {}, purpose: "operator_console",
      correlationId: id, causationId: "", requestedAt: new Date().toISOString(), payload,
    }),
  });
  if (r.status === 401) { clearOpsSession(); emit({ kind: "auth" }); throw new OpStatusError({ kind: "auth" }); }
  if (r.status === 403) { emit({ kind: "forbidden" }); throw new OpStatusError({ kind: "forbidden" }); }
  if (r.status >= 500 && r.status !== 503) throw new Error(`${commandType} ${r.status}`);
  return (await r.json()) as OpCommandResult;
}

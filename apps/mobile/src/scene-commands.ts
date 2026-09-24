// 场景域的命令出口（原来私有在 surfaces/reality-scene-map.tsx 里）。
//
// 为什么抽出来：场景详情有两处入口 —— 地图模块那一屏（reality-scene-map）
// 和「Scene · 精修版」原型第 2/3 屏带出来的分类列表/单店详情。两处都要发
// 同一种命令（打卡 / 收藏 / 去过 / 徽章）。把 20 行命令封包抄第二份，就等于
// 把 commandId / idempotencyKey / purpose / 错误分流各留两套 —— 改一处漏
// 一处，最后是两个入口对同一个后端说不同的话。
//
// ⚠️ 这个文件是**唯一**发场景命令的地方。command-error-message.test.ts 钉的
// 「所有命令出口都要走 commandErrorMessage」现在盯的是这里（原来盯
// reality-scene-map.tsx —— 那个文件已经不发命令了，还盯着它就是假守卫）。

import { commandErrorMessage } from "./command-error-message";
import { parseCommandResult } from "./login-client";
import type { SessionAuthClient } from "./auth-client";
import type { StoredSession } from "./secure-session";

/** 带 principal 的会话 —— 发命令必须的形态（没有 principal 说明只是匿名读）。 */
export type AuthenticatedStoredSession = StoredSession & { principal: NonNullable<StoredSession["principal"]> };

export async function sendSceneCommand(
  authClient: SessionAuthClient,
  session: AuthenticatedStoredSession,
  commandType: string,
  targetId: string,
  payload: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const nonce = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const response = await authClient.request(`/v1/commands/${commandType}`, { method: "POST", body: {
    commandId: `scene_${nonce}`, commandType, commandVersion: 1,
    actor: { type: "USER", id: session.userAccountId }, principal: session.principal,
    target: { type: "RealityScene", id: targetId }, idempotencyKey: `scene_idem_${nonce}`,
    authContext: { sessionId: session.auth.sessionId }, purpose: "reality_scene_user_state",
    correlationId: `scene_corr_${nonce}`, requestedAt: new Date().toISOString(), payload
  }});
  const result = parseCommandResult(await response.json());
  if (!result || response.status < 200 || response.status >= 300 || result.outcome === "REJECTED") throw new Error(commandErrorMessage(result?.error, "reality scene command failed"));
  let decoded: Record<string, unknown> = {};
  if (result.operationRef) {
    const value = JSON.parse(result.operationRef) as unknown;
    if (!value || typeof value !== "object") throw new Error("reality scene response malformed");
    decoded = value as Record<string, unknown>;
  }
  return { ...decoded, aggregateId: result.aggregate?.id, aggregateState: result.aggregate?.state };
}

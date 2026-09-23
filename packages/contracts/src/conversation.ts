/**
 * COMP-AI-MINOR-001（聊天侧）— 会话命令的 AI 状态 wire 契约。
 *
 * 服务端 conversation 域在 StartConversation / SendMessage 的 payload 里回一个
 * assistantStatus，说明「AI 那半到底有没有动」。五个值必须分开，因为它们对应
 * 五种不同的真相 —— 折叠任意两个都会让用户看到错误的因果：
 *
 *   RESPONDED      AI 真的回了（payload 里同时有 aiMessage）
 *   NOT_REQUESTED  这次消息本来就不该有 AI 回复（普通用户之间聊天）
 *   UNAVAILABLE    模型服务没配置 —— 环境问题，重试没用，要人去配
 *   FAILED         模型调用失败 —— 故障，可以重试
 *   GATED          按规则不向这个账号提供 —— 不是故障，重试永远没用
 *
 * 客户端原来只认 FAILED / UNAVAILABLE 两个值，GATED 落到 else 分支什么都不说，
 * 于是「依法不提供」渲染成沉默 —— 用户分不清「被拒了」和「发出去没人理」。
 * 把 GATED 折叠进 FAILED / UNAVAILABLE 同样是错的：那是把「不提供」说成
 * 「服务坏了」，用户会一直重试一个永远不会成功的东西。
 */
import { z } from "zod";

export const AssistantStatusSchema = z.enum([
  "RESPONDED",
  "NOT_REQUESTED",
  "UNAVAILABLE",
  "FAILED",
  "GATED"
]);
export type AssistantStatus = z.infer<typeof AssistantStatusSchema>;

/**
 * 把 payload 里那个 unknown 字段收窄成联合类型。
 *
 * 未知值返回 undefined 而不是兜一个默认值：服务端将来加第六个状态时，
 * 老客户端应该「什么都不说」（保持现状），而不是猜成 FAILED 然后提示
 * 「服务不可用」—— 那又是一次把两种真相说成一种。
 */
export function parseAssistantStatus(raw: unknown): AssistantStatus | undefined {
  const parsed = AssistantStatusSchema.safeParse(raw);
  return parsed.success ? parsed.data : undefined;
}

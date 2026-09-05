/**
 * AI-ASSIST-001 — 平台 AI 助手公开目录（首页 5 小美推荐）。
 *
 * 后端 `GET /v1/ai/assistants` 返回平台自有展示数据（id/name/role/
 * color/photo/avatar/tagline/aiBadge），匿名可读。无凭证、无私人数据。
 * 接单/报名/收付款不在此面，仍由服务端门禁禁止。
 */
import { z } from "zod";

export const AIAssistantSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  role: z.string().min(1),
  color: z.string().min(1),
  photo: z.string().min(1),
  avatar: z.string().min(1),
  tagline: z.string().min(1),
  aiBadge: z.string().min(1)
});
export type AIAssistant = z.infer<typeof AIAssistantSchema>;

export const ListAIAssistantsPayloadSchema = z.object({
  assistants: z.array(AIAssistantSchema).min(1)
});
export type ListAIAssistantsPayload = z.infer<typeof ListAIAssistantsPayloadSchema>;

export function parseListAIAssistantsPayload(raw: unknown): ListAIAssistantsPayload {
  return ListAIAssistantsPayloadSchema.parse(raw);
}

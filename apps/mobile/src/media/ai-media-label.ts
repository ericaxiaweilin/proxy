import type { FeedMediaItem } from "@proxy/contracts";

/**
 * LC-06 显示侧：一张媒体该不该打「AI 生成」标注，以及打什么字。
 *
 * 产品决定（2026-09-21，用户原话「ai做的 就标注 法规要求要满足」）：
 *   AI_PERSONA / MODEL_API → 标「AI 生成」
 *   USER_UPLOADED          → 不标（手机直传，没有 AI 参与，标了是假话）
 *   缺省（字段没下发）      → 不标（老服务端 / 非 feed 来源）
 *
 * UNKNOWN 也不标，但它到不了这里：MarkMediaReady 对 UNKNOWN fail-closed
 * （internal/media/service.go 的 AI_LABEL_MISSING），READY 资产不可能是 UNKNOWN。
 * 也就是说这个分支是**不可达**的兜底 —— 如果哪天那道服务端闸门被放宽，
 * 这个函数必须重新审视，因为那时「不知道谁生成的图」会静默地不带标注上线。
 *
 * 之所以做成纯函数而不是散在 JSX 里：判定口径只能有一处。渲染点有好几个
 * （feed / 个人页 / 其它主页），每处各写一遍 if 迟早会分叉。
 */
export function aiMediaLabel(source: FeedMediaItem["aiGenerationSource"]): string | undefined {
  if (source === "AI_PERSONA" || source === "MODEL_API") return "AI 生成";
  return undefined;
}

// command-error-message.ts — 命令被服务端拒绝时，说给用户听的那句话。
//
// 为什么有这个文件（2026-09-22 修的形状）：
//
// 运营拨下 kill switch 后，服务端拒绝命令时给的是
//   code       = "SERVICE_DISABLED"
//   messageKey = "compliance.service_disabled"      ← 机器串，不是句子
// （apps/api-go/internal/api/command_dispatch.go:171，
//   签名见 apps/api-go/internal/command/model.go:102）
//
// 而各 *-client.ts 被拒时一律
//   throw new Error(result.error?.messageKey ?? result.error?.errorCode ?? fallback)
// 于是 messageKey 那个**英文机器串直接进了 Error.message** —— 也就是直接给用户看了。
// 全仓原本没有任何 messageKey → 人话的翻译表。
//
// 这不是"文案取舍"，是漏翻译。仓库里已经修过同一类：native-app.tsx 的
// loginChallengeErrorMessage()（注释「裸 messageKey 换成与主路径同一套映射文案」）。
// 这里照同一形状做，包括**把原始错误码留在括号里**便于排查 —— 那是先例里
// 刻意保留的（"（错误码：LOGIN_PROVIDER_NOT_CONFIGURED）"）。
//
// 只映射已知的、用户真会撞上的码；其余原样退回 client 自己的 fallback，
// 不扩大行为改动面。

export type CommandErrorLike =
  | {
      messageKey?: string | null;
      errorCode?: string | null;
    }
  | null
  | undefined;

// kill switch 拒绝时的 messageKey。服务端今天只在这一个地方产生它。
const SERVICE_DISABLED_MESSAGE_KEYS: ReadonlySet<string> = new Set([
  "compliance.service_disabled"
]);

export function commandErrorMessage(error: CommandErrorLike, fallback: string): string {
  const code = error?.errorCode ?? undefined;
  const key = error?.messageKey ?? undefined;
  if (code === "SERVICE_DISABLED" || (key !== undefined && SERVICE_DISABLED_MESSAGE_KEYS.has(key))) {
    // 措辞跟 LegalStatusBanner 已有的「服务暂停 · 交易」保持一致，不另发明一套。
    return "服务已暂停，暂时无法完成此操作（错误码：SERVICE_DISABLED）。";
  }
  // 未映射的码保持 client 原有行为：messageKey ?? errorCode ?? fallback。
  return key ?? code ?? fallback;
}

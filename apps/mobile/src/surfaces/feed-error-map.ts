// R15.38: 互动 (LIKE / REPLY / BOOKMARK / 偏好 / 举报) 报错文案护甲。
//   之前 catch 全用同一句 "请检查连接后重试", 遮掩了
//   "未登录" 这种情况 — 访客点赞也会看到这句话。
//   这里区分:
//   - OfflineFallbackSessionError / "require a real sign-in" / "principal required"
//     → 改口为 "请登录后重试"
//   - SessionExpiredError (server 实际 拒了, keychain 清掉, 仍需重登)
//     → "会话过期，请重新登录后重试"
//   - 其他 (真网络) → 保持原 fallback
//
// 独立成 module 以便 unit test (feed.tsx 拖 React Native, 加载慢)。

import { OfflineFallbackSessionError, SignedOutSessionError } from "../secure-session";
import { SessionExpiredError } from "../auth-client";

export function mapEngagementError(error: unknown, fallback: string): string {
  if (error instanceof OfflineFallbackSessionError || error instanceof SignedOutSessionError) {
    return "访客不能点赞 / 回复 / 举报，请登录后重试。";
  }
  if (error instanceof SessionExpiredError) {
    // auth-client 在 server 拒接 (401) 且 refresh 失败后 扊掉 keychain,
    //   扊不掉走 authClient.request() 调 engagement 的时候。
    return "会话已过期，请重新登录后重试。";
  }
  if (error instanceof Error) {
    const msg = error.message;
    // engagement-client requireSession 在离线 fallback 走的是
    // "engagement actions require a real sign-in (offline session cannot react)"
    if (msg.includes("require a real sign-in") || msg.includes("offline session cannot")) {
      return "访客不能点赞 / 回复 / 举报，请登录后重试。";
    }
    // localnet-client createPost 走的是 "publishing requires a real sign-in (offline session cannot post)"
    if (msg.includes("publishing requires a real sign-in")) {
      return "访客不能发评论 / 帖文，请登录后重试。";
    }
    // R15.39: signedOut session
    if (msg.includes("signed out") || msg.includes("re-authenticate")) {
      return "会话已登出，请登录后重试。";
    }
    // R15.38.1: engagement-client requireSession 在 fresh guest (keychain
    //   完全空) 走的是 "an authenticated principal is required"。这是
    //   "未登录" 的另一种表达 — 不能被 fallback 当成 "网络问题"。
    if (
      msg.includes("principal required") ||
      msg.includes("an authenticated principal") ||
      msg.includes("authenticated principal")
    ) {
      return "访客不能点赞 / 回复 / 举报，请登录后重试。";
    }
    // R15.38.4: server 返回 500 (e.g. command_transaction_failed) 时
    //   engagement-client 抛 EngagementProtocolError 包了 status+body。
    //   这不是 "网络问题" — 是 server 内部事务挂了。告诉用户明确, 别
    //   再说 "检查连接" (误导)。
    if (msg.includes("command_transaction_failed") || msg.includes("(status=5")) {
      return "服务器处理出错，请稍后重试或反馈给我们。";
    }
    // R15.38.4: 其他解析失败 (e.g. body 不是 commandResult 格式) 也
    //   几乎都是 server 端 bug, 不是说用户网不行。
    if (msg.includes("malformed")) {
      return "服务器响应异常，请稍后重试。";
    }
  }
  return fallback;
}

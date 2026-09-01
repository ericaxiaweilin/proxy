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
  }
  return fallback;
}

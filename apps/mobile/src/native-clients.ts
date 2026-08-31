// 共享给 ProxyApp + 子 surface 的底层 client 实例（auth + base URL）。
//
// 这个模块独立于 native-app.tsx / app-shell.tsx，是为了避开 require cycle：
//   index.ts → native-app.tsx → app-shell.tsx → surfaces/me.tsx → native-app.tsx
// 如果 me.tsx 直接 import native-app.tsx, 而 native-app.tsx 又 import 了
// restoreAppShell (从 app-shell.tsx), 就是圈。FACET Phase 1 (me.tsx
// inline 拉 /v1/facet/objects) 需要 sessionAuthClient + baseUrl, 所以把
// 这两个 module-level const 拆出来 — 它们只依赖 SecureSessionStore +
// Transport type + nativeSecureStorageDriver, 不依赖 app-shell。
//
// 任何 surface (me, home-assistant, market, ...) 都可以直接 import 这两个常量
// 来构造自己的匿名/认证 client。重复的 fetch transport 之前只在 native-app.tsx
// 里定义, 这里复制一份是 local 副作用 — 不会落到 server。

import { Platform } from "react-native";
import { SessionAuthClient, type Transport } from "./auth-client";
import { SecureSessionStore } from "./secure-session";
import { nativeSecureStorageDriver } from "./native-secure-storage";

export const localApiBaseUrl =
  process.env.EXPO_PUBLIC_API_BASE_URL ??
  (Platform.OS === "android" ? "http://10.0.2.2:4100" : "http://127.0.0.1:4100");

// 跟 native-app.tsx 里的 nativeTransport 等价的 fetch 实现。两者独立 —
// 只用作 PublicRequester 跟 SessionAuthClient 内部访问网络, 跟 command
// envelope 不冲突 (get-only)。任何 surface 用这个 transport 就保证跟
// 其它 client 一致走 fetch, 没 side effect。
const nativeTransport: Transport = async (request) => {
  const response = await fetch(request.url, {
    method: request.method,
    headers: request.headers,
    ...(request.body !== undefined ? { body: request.body } : {})
  });
  return { status: response.status, json: () => response.json() };
};

// 跟 native-app.tsx 里的 secureSessionStore 等价的 Keychain-backed store。
// 各 surface 拿到同一个 principalId / sessionId, 不需要 singleton。
const secureSessionStore = new SecureSessionStore(nativeSecureStorageDriver);

// 服务端驱动 Surface 的认证客户端：读模型/命令全部走 /v1/commands/ envelope。
// 也兼任匿名 GET transport (response.json()), 跟 transport.ts 共享底层 fetch。
export const sessionAuthClient = new SessionAuthClient({
  baseUrl: localApiBaseUrl,
  secureSessionStore,
  transport: nativeTransport
});
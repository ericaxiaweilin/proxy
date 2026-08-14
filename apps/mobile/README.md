# Proxy Mobile Foundation

这是 iOS / Android App 的 Shell 状态契约，不是 Web 页面。

当前 Mobile runtime 已使用 Expo SDK 57 + React Native 0.86，并生成 development-build 原生工程。入口是 `src/index.ts`，原生配置在 `app.json`；`ios/` 和 `android/` 由 Expo prebuild 生成，不把 HTML 原型当作 App runtime。

运行方式：

- `pnpm --filter @proxy/mobile start` 启动 Metro
- `pnpm --filter @proxy/mobile native:prebuild` 重新生成原生工程
- `pnpm --filter @proxy/mobile ios` / `android` 构建 development build

下一步在已生成的 React Native + TypeScript + Expo development build 上继续接入：

- Secure session restore through an injected Keychain / Keystore driver
- Access-token expiry handling, one-flight refresh rotation, and 401 retry
- Principal context switch
- Deep link guard
- Offline / pending / restricted banner
- Demand Draft local save/restore with server-ACK publish guard
- TanStack Query server state

当前 `app-shell.ts` 只负责可测试的启动状态决策；不能把它当作 Domain Truth。
当前 `demand-draft-store.ts` 是移动端持久化与同步状态契约，`InMemoryDemandDraftStore` 只用于测试；原生构建时替换为 SQLite，不允许离线或未 ACK Draft 显示为已发布。
`secure-session.ts` 只接受宿主注入的安全存储 driver；`InMemorySecureStorageDriver` 仅用于测试，生产 App 必须接 iOS Keychain / Android Keystore，禁止使用 AsyncStorage、普通 SQLite 或 analytics 保存 token。`expo-secure-storage.ts` 提供不依赖 UI 的 Expo SecureStore adapter，`native-secure-storage.ts` 才注入真实 `expo-secure-store` 模块，并强制使用 `AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY`；domain/session 层不直接依赖原生模块。

`login-client.ts` 提供 App 端无 Bearer 的 passwordless 登录边界：RequestLoginChallenge → VerifyLoginChallenge → CreateSession。OTP 发送与验证仍由 Go 后端的 provider port 负责；App 不生成、保存或记录 OTP，也不会接受缺失或格式不合法的 auth token。

本地模拟器登录：先启动 API，再启动 Mobile dev build。iOS Simulator 使用宿主机地址，Android Emulator 使用 `10.0.2.2`：

```bash
# terminal 1 — Go API
PROXY_LOGIN_PROVIDER=simulated PROXY_SIMULATED_OTP_CODE=123456 pnpm dev:api

# terminal 2 — iOS Simulator
EXPO_PUBLIC_LOGIN_MODE=simulated EXPO_PUBLIC_API_BASE_URL=http://127.0.0.1:4100 pnpm --filter @proxy/mobile start

# Android Emulator 时改为：
EXPO_PUBLIC_LOGIN_MODE=simulated EXPO_PUBLIC_API_BASE_URL=http://10.0.2.2:4100 pnpm --filter @proxy/mobile start
```

开发登录页使用本地 fixture `user_001 / login_001 / device_001`，验证码为配置的模拟码。该页面不会进入 production build。
`auth-client.ts` 负责 access token 注入、401 单次重试和 refresh 并发合并；refresh 失败会清除安全 Session，不能把失效 token 留在 App 内。

`native-app.tsx` 是当前最小 App Shell：启动时从 Keychain / Keystore 恢复 session，原生存储读取异常时 fail closed 并回到 auth 路由。

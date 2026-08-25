# 动态 IP 下真机 + 模拟器更新指南（外出场景）

> 适用：外出时 IP 频繁变化，真机 `weilin` (iPhone 15) 通过 USB/热点连接 Mac，模拟器 `Pixel_8` / `Proxy iPhone 15 QA` 在本机。

## 1. 结论先行

- **不需要在 `apps/mobile/.env` 里写死 `192.168.1.49:4100`**。脚本会自动处理动态 IP：
  - **iOS 真机/模拟器**：`scripts/dev-ios.sh` 用 Bonjour `Thanhs-MacBook-Air.local:4100`（`scutil --get LocalHostName`），热点/Wi-Fi 切换不失效。已验证 `Thanhs-MacBook-Air.local` 解析到 `127.0.0.1` + `192.168.1.49` + `169.254.202.249`。
  - **Android 模拟器**：`scripts/dev-android.sh` 用 `adb reverse tcp:4100 tcp:4100` + `tcp:8081`，模拟器内走 `127.0.0.1` 回环，不依赖局域网 IP。
- **外出时的唯一前提**：真机与 Mac 能互访（USB + `coredevice.local` 已满足），API 监听 `4100`，Metro 监听 `8081`。

## 2. 远端推送说明

当前仓库 **无 `git remote`**（`git remote -v` 为空，`.git/config` 无 origin），无法 `git push`。这是预期状态 —— 本地开发仓库，未绑定 GitHub。

外出前如需推送，先绑定远端：

```bash
# 在 GitHub 新建空仓库后
git remote add origin https://github.com/<你的组织>/kake.git
git push -u origin main
# 或已有仓库
git remote add origin <url>
git branch -M main
git push -u origin main
```

> 无 remote 时，`推送` 等于本地提交：`git add -A && git commit -m "..."` 即可保留外出前的快照。

## 3. 日常更新（Server UI / JS Renderer）—— 不重编译

> 三层分离见 `apps/mobile/DELIVERY_ARCHITECTURE.md`：Server UI 自动 15s 轮询 revision，JS 由 Metro 热更新，Native Shell 才需重编译。

```bash
# 终端 1 — Go API（含本地模型底座网关）
pnpm dev:api
# 等价于：API_HOST=127.0.0.1:4100 + MODELSTACK 环节，业务代码仍只发 taskId

# 终端 2 — Android 模拟器（已安装 development shell 时）
pnpm --filter @proxy/mobile android:dev
# 内部：adb reverse tcp:8081 tcp:8081 && adb reverse tcp:4100 tcp:4100 && expo start --dev-client --android

# 终端 2 — iOS 真机 weilin（或模拟器）
pnpm --filter @proxy/mobile ios:dev
# 内部：scutil --get LocalHostName → Thanhs-MacBook-Air.local:4100，expo start --host lan
# 特殊网络可覆盖：PROXY_IOS_API_BASE_URL=http://<你的IP>:4100 pnpm --filter @proxy/mobile ios:dev

# 终端 2 — iOS 模拟器单独（Proxy iPhone 15 QA 已 Booted）
# ios:dev 同样适用；或临时：
EXPO_PUBLIC_API_BASE_URL=http://127.0.0.1:4100 pnpm --filter @proxy/mobile start
```

真机已登录时，前台恢复会自动拉最新 Server UI revision，无需重装。

## 4. 首次 / Native Shell 变更后 — 需重编译

仅当改了 `app.json` 权限/BundleId、Expo 原生依赖、`ios/Podfile`、`android/gradle` 时才执行：

```bash
# Android 单实例锁 + 限定 2 worker，禁止并行第二条 Gradle
pnpm --filter @proxy/mobile android:bootstrap

# iOS 真机 weilin（单实例锁 + DerivedData 外置到 ~/Library/Developer/... 避免签名污染）
PROXY_IOS_DEVICE=weilin pnpm --filter @proxy/mobile ios:bootstrap
# 首次安装后：iPhone → 设置 → 通用 → VPN与设备管理 → 信任开发者证书
# 平台缺失时自动：xcodebuild -downloadPlatform iOS（可设 PROXY_IOS_PLATFORM_AUTO_INSTALL=0 关闭）
```

> `android:bootstrap` / `ios:bootstrap` 会校验 `scripts/doctor-delivery.sh` 的所有交付门禁（Gradle daemon/parallel、scheme proxy://、Metro 端口转发等）。

## 5. 模拟器启停

```bash
# Android 模拟器 Pixel_8（-screen touch 避免幽灵多点手势）
pnpm --filter @proxy/mobile android:emulator
# 或等价：$ANDROID_HOME/emulator/emulator -avd Pixel_8 -gpu host -screen touch -no-mouse-reposition
# 已有设备连接时脚本直接退出：An Android device is already connected

# iOS 模拟器列表
xcrun simctl list devices | grep -E "Proxy|iPhone"
# 当前本机：Proxy iPhone 15 QA (22280AEA-3B36-4499-81EC-A1D77C712BA9) (Booted)
xcrun simctl boot "Proxy iPhone 15 QA"   # 如为 Shutdown
open -a Simulator
```

## 6. 外出前自检清单

```bash
# 1) 诊断交付架构
pnpm --filter @proxy/mobile doctor:delivery
# 预期：Delivery architecture OK

# 2) 基线校验
pnpm check:design

# 3) 设备连通
xcrun devicectl list devices | grep weilin    # 应为 connected
adb devices                                   # 模拟器/真机应为 device

# 4) Bonjour 解析
scutil --get LocalHostName                    # Thanhs-MacBook-Air
dscacheutil -q host -a name Thanhs-MacBook-Air.local

# 5) 端口占用
lsof -i :4100 -i :8081
```

## 7. 常见外出问题

| 现象 | 原因 | 解法 |
|------|------|------|
| iOS 真机白屏/连不上 API | `apps/mobile/.env` 写死旧 IP | 改用 `ios:dev`（Bonjour），或设置 `PROXY_IOS_API_BASE_URL=http://Thanhs-MacBook-Air.local:4100` 覆盖 |
| Android 模拟器 blank Activity | 先开了 App 后开 Metro | `adb shell am force-stop com.proxy.app` 后重跑 `android:dev`（脚本已内置） |
| `Another Proxy ... build is already running` | 单实例 lock | 等待上一构建完成，勿并行启动第二条 Gradle/Xcode |
| `weilin is not paired` | iPhone 未解锁/未信任 | 解锁、热点允许、开发者模式开启，重连 USB |
| `Please download and install the platform` | Xcode iOS Platform 缺失 | 脚本自动 `xcodebuild -downloadPlatform iOS`，或手动 Xcode → Settings → Components |

## 8. 当前本机快照（2026-08-25）

- Mac: `Thanhs-MacBook-Air.local` / `Thanh’s MacBook Air` / `192.168.1.49`
- iOS: `weilin` (iPhone15,4, 23G71) connected via `weilin.coredevice.local`
- iOS Simulator: `Proxy iPhone 15 QA` Booted
- Android: `Pixel_8` 未运行，adb 空闲
- Git: `main` @ `d8a4a6c M8 Safety`，16 modified + 7 untracked（含 `023_business_workspace.sql`），无 remote
- `Node 24.3.0` / `pnpm 11.19.0` / `Go 1.26.6` / `Expo 57.0.12` / `RN 0.86.2`

## 9. 一键外出更新命令（复制即用）

```bash
# 0) 在 kake 根目录
cd /Users/thanhhuyennguyen/Desktop/kake

# 1) 启动模拟器（如未运行）
pnpm --filter @proxy/mobile android:emulator &

# 2) 启动 API
pnpm dev:api &

# 3) 更新 Android 模拟器（热更新）
pnpm --filter @proxy/mobile android:dev

# 4) 更新 iOS 真机 weilin（热更新，Bonjour 自动 IP）
pnpm --filter @proxy/mobile ios:dev

# 5) 验证
pnpm --filter @proxy/mobile doctor:delivery && node ./scripts/check-design-baseline.mjs
```

> 推送前：`git add -A && git commit -m "chore: ..."`，有 remote 后 `git push`。

---
*文档生成：2026-08-25，外出动态 IP 场景专用。*

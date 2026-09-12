# 动态 IP 下真机 + 模拟器更新指南（外出场景）

> 适用：外出时 IP 频繁变化，真机 `weilin` (iPhone 15) 通过 USB/热点连接 Mac，模拟器 `Pixel_8` / `Proxy iPhone 15 QA` 在本机。

## 1. 结论先行

- **不需要在 `apps/mobile/.env` 里写死 `192.168.1.49:4100`**。脚本会自动处理动态 IP：
  - **iOS 真机/模拟器**：`scripts/dev-ios.sh` 用 Bonjour `Thanhs-MacBook-Air.local:4100`（`scutil --get LocalHostName`），热点/Wi-Fi 切换不失效。
    - ⚠️ 这**只在 `ios/Proxy/Info.plist` 没有 `MetroHost` 时**才成立。该 key 存在时 Bonjour 兜底会被完全绕过 —— 见 §7.1（2026-09-12 真实事故）。
    - 2026-09-12 实测解析到 `127.0.0.1` + `192.168.112.30` + `169.254.214.60`。**IP 会变，任何地方都别写死。**
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

### 3.1 常驻开发服务（2026-09-12 起，免手工起服务）

为避免「忘了起 API → 真机全报 `Could not connect to the server`」，API 与 Metro 已改为常驻：

| 组件 | 文件 | 说明 |
|------|------|------|
| LaunchAgent（API） | `~/Library/LaunchAgents/com.user.kake-dev-api.plist` | `RunAtLoad` + `KeepAlive`，登录自启、崩溃自愈 |
| LaunchAgent（Metro） | `~/Library/LaunchAgents/com.user.kake-dev-metro.plist` | 同上，跑 `apps/mobile/scripts/dev-ios.sh` |
| 包装脚本 | `~/bin/kake-dev-api.sh`、`~/bin/kake-dev-metro.sh` | 启动前先回收端口上的残留监听，保证重启不会 `address already in use` |
| 自愈循环 | `~/bin/kake-dev-supervise.sh` | 进程退出后 5s 重启；供 launchctl 不可用时使用 |
| 分离器 | `~/bin/kake-dev-detach.sh` | macOS 无 `setsid`，用 double-fork + `setsid` 让服务脱离调用它的 shell（`nohup … & disown` **不够**，会被连坐杀掉） |

日志：`~/Library/Logs/kake/dev-api.log`、`dev-metro.log`
（**真机 JS 的 `console.log/error` 也会转发到 dev-metro.log**，是排查真机问题的第一现场）。

```bash
launchctl list | grep kake                                    # 是否被 launchd 托管
launchctl kickstart -k gui/$(id -u)/com.user.kake-dev-api     # 重启 API
tail -f ~/Library/Logs/kake/dev-metro.log                     # Metro + 真机日志
```

> `launchctl` 在部分受限 shell 里**完全不可用**：`launchctl list` 返回空、
> `bootstrap` 报 `Bootstrap failed: 5: Input/output error`。此时改用
> `~/bin/kake-dev-detach.sh ~/bin/kake-dev-supervise.sh api`（metro 同理）。
> 两条路径可共存 —— 包装脚本的端口回收保证了干净的交接。

> ⚠️ **跑门禁/提交前注意**：受限 shell 的 `PATH` 里 `grep` 会被替换成不支持
> `\|`、`\b` 的替身，`python3` 也缺少 `yaml`。会让 `scripts/gate.sh` 的 g4
> **假失败**（报「activity.go 没过滤 origin='TEST'」等，但源码其实是好的）。
> 干净环境跑法：
> ```bash
> env -u BASH_ENV PATH="/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin" git commit ...
> ```

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
| **iOS 真机白屏/打不开（首选排查项）** | `ios/Proxy/Info.plist` 里有写死的 `MetroHost` | 删掉该 key，见 **§7.1**。优先级高于 Bonjour，存在即让兜底失效 |
| iOS 真机连的是很久以前的地址 | dev client 记住了历史 dev-server URL | 见 **§7.2** |
| iOS 真机白屏/连不上 API | `apps/mobile/.env` 写死旧 IP | 改用 `ios:dev`（Bonjour），或设置 `PROXY_IOS_API_BASE_URL=http://Thanhs-MacBook-Air.local:4100` 覆盖。**注意：先排除 §7.1** |
| 真机 App 里所有请求都 `Could not connect to the server` | API 进程没在跑（不是网络问题） | 见 **§3.1**（常驻服务）；`curl --noproxy '*' -s -o /dev/null -w '%{http_code}' http://127.0.0.1:4100/health/live` 应为 200 |
| Android 模拟器 blank Activity | 先开了 App 后开 Metro | `adb shell am force-stop com.proxy.app` 后重跑 `android:dev`（脚本已内置） |
| `Another Proxy ... build is already running` | 单实例 lock | 等待上一构建完成，勿并行启动第二条 Gradle/Xcode |
| `weilin is not paired` | iPhone 未解锁/未信任 | 解锁、热点允许、开发者模式开启，重连 USB |
| `Please download and install the platform` | Xcode iOS Platform 缺失 | 脚本自动 `xcodebuild -downloadPlatform iOS`，或手动 Xcode → Settings → Components |
| 改完代码但真机没变 | 改了 Native Shell 层 | 三层交付模型：Server UI 15s 轮询、JS 走 Metro 热更、**Native Shell 必须重编译**（见 §4） |

### 7.1 `Info.plist` 写死的 `MetroHost`（2026-09-12 实际踩坑）

`apps/mobile/ios/Proxy/AppDelegate.swift` 的取值逻辑是：

```swift
let metroHost = (Bundle.main.object(forInfoDictionaryKey: "MetroHost") as? String)
  ?? "Thanhs-MacBook-Air.local"
```

即 **`Info.plist` 一旦有 `MetroHost`，Bonjour 兜底永远不生效**。

真实事故：commit `d4dadba` 往 `Info.plist` 写入了当时的 Mac IP `192.168.115.138`。
之后 Mac 换到 `192.168.112.30`，真机就恒去连那个死地址 —— 表现是「打不开」，
且 Metro 日志里 `Thanhs-MacBook-Air.local` **一次都不会被尝试**，极具误导性
（会让人以为是设备网络或防火墙问题，其实设备侧完全正常）。

**排查**：

```bash
plutil -extract MetroHost raw apps/mobile/ios/Proxy/Info.plist
# 报 "No value at that key path" 才是对的；能打印出 IP 就是中招了
```

**修复**：直接删掉 `MetroHost` / 它的 `<string>` 两行，然后重编译（`ios:bootstrap`），
让 App 回落到 Bonjour。**不要**改成新 IP —— 下次 IP 一变又会复发。

### 7.2 设备端 dev client 记着历史 URL

iOS dev client 会保存历次连接过的 dev-server 地址。Mac 换 IP 后，App 可能仍在
轮询一个早已失效的旧地址（实测见过 `10.20.30.223:8081`、`localhost:8082`），
而当前正确地址一次都不试。

**排查**：读 Metro 日志里的 `Packager status check` 报错，它会直接暴露设备在找哪个地址。

**修复**：真机上摇一摇 → Dev Menu → 重新输入 `http://Thanhs-MacBook-Air.local:8081`；
或直接重装 App。

## 8. 当前本机快照（2026-09-12）

- 仓库路径：`/Users/thanhhuyennguyen/work/kake` —— **已不在 `~/Desktop/kake`**。
  搬家后旧绝对路径会残留在 `ios/Pods` 的 `React-VFS.yaml` 引用里，导致
  `xcodebuild` 直接失败（`virtual filesystem overlay file ... not found`）。
  修法：`LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8 pod install`。
- Mac: `Thanhs-MacBook-Air.local` / `Thanh’s MacBook Air` / `192.168.112.30`
- iOS 真机: `weilin` (iPhone15,4) available (paired)，bundle id `com.proxy.creator.dev.c4673fy8u7`
- iOS Simulator: `Proxy iPhone 15 QA`
- Git: 分支 `fix/home-chooser-root-swipe` @ `bdf23f5`，无 remote
- 工具链: `Node 24.3.0`（`/opt/homebrew/bin/node`）/ `pnpm 11.19.0` / `Go 1.26.6` / `Expo 57.0.12` / `RN 0.86.2`
- 常驻服务: `com.user.kake-dev-api` + `com.user.kake-dev-metro`（见 §3.1）
- 基础设施: postgres `5432`、mailpit `8025` 常驻；**Redis `6379` / MinIO `9000` 通常不跑，且属可选依赖**
  —— API 的 `/health/ready` 会自报 `"redis":"not_configured_optional"`，不必为此去装。

## 9. 一键外出更新命令（复制即用）

```bash
# 0) 在 kake 根目录（注意：不是 ~/Desktop/kake）
cd /Users/thanhhuyennguyen/work/kake

# 1) 启动模拟器（如未运行）
pnpm --filter @proxy/mobile android:emulator &

# 2) API 与 Metro 已常驻（见 §3.1），无需手工启动。先确认：
curl --noproxy '*' -s -o /dev/null -w 'API   %{http_code}\n' http://127.0.0.1:4100/health/live  # 期望 200
curl --noproxy '*' -s -o /dev/null -w 'Metro %{http_code}\n' http://127.0.0.1:8081/status     # 期望 200
# 万一没起来，手工拉起：
#   ~/bin/kake-dev-detach.sh ~/bin/kake-dev-supervise.sh api
#   ~/bin/kake-dev-detach.sh ~/bin/kake-dev-supervise.sh metro

# 3) 更新 Android 模拟器（热更新）
pnpm --filter @proxy/mobile android:dev

# 4) 更新 iOS 真机 weilin（热更新，Bonjour 自动 IP）
pnpm --filter @proxy/mobile ios:dev

# 5) 验证
pnpm --filter @proxy/mobile doctor:delivery && node ./scripts/check-design-baseline.mjs
```

> 推送前：`git add -A && git commit -m "chore: ..."`，有 remote 后 `git push`。

---
*文档生成：2026-08-25，外出动态 IP 场景专用。
最近更新：2026-09-12 —— 新增 §3.1 常驻开发服务、§7.1 `Info.plist MetroHost` 陷阱、
§7.2 设备端历史 URL；修正 §1 过期 IP、§8 快照、§9 过期路径。*

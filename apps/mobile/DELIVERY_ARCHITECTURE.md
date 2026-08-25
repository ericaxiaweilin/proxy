# Proxy Mobile 交付架构

Proxy 的 UI 交付分为三层。三层不能再共用“每次 assembleRelease”这一条命令。

| 变更 | 示例 | Android / iOS 动作 |
|---|---|---|
| Server UI | ExperienceManifest、UIPlan、文案、顺序、显隐、数据 | 不构建 App；已登录 App 前台恢复时刷新，并每 15 秒读取已验证 revision |
| JS Renderer | React Native 组件、交互、稳定 Surface | 开发期由 Metro 热更新；生产期走 OTA，runtimeVersion 不变时发布 |
| Native Shell | Expo/原生依赖、权限、启动图、App Icon、Bundle ID | 每个平台仅在此类变更时重新编译、签名和安装 |

## 日常命令

Android 首次或 Native Shell 改变后：

```bash
pnpm --filter @proxy/mobile android:bootstrap
```

随后所有 Server UI / JS Renderer 开发：

```bash
pnpm dev:api
pnpm --filter @proxy/mobile android:dev
```

iPhone 首次或 Native Shell 改变后：

```bash
PROXY_IOS_DEVICE=weilin pnpm --filter @proxy/mobile ios:bootstrap
```

`ios:bootstrap` 在编译前检查 Xcode 首次启动状态、真机配对状态和 Scheme destinations。若 Xcode 缺少与当前工具链匹配的 iOS Platform Support，脚本会在单实例 native-build lock 内通过官方 `xcodebuild -downloadPlatform iOS` 自动补齐，再开始 Xcode 编译。设置 `PROXY_IOS_PLATFORM_AUTO_INSTALL=0` 可改为只报错、不自动下载。

真机开发构建使用 `com.proxy.creator.dev.<team>` 本地 Bundle ID，避免个人开发团队占用或覆盖生产 `com.proxy.app`。可通过 `PROXY_IOS_DEV_BUNDLE_ID` 显式覆盖；仓库里的生产 Bundle ID 不会被脚本改写。首次安装后，iPhone 需要在“设置 → 通用 → VPN 与设备管理”信任开发者证书。

本仓库位于 macOS Desktop/File Provider 管理目录。为避免 FinderInfo/FileProvider 扩展属性污染 `.app` 并导致签名失败，iOS DerivedData 固定写到 `~/Library/Developer/Xcode/DerivedData/Proxy-Local`，ExpoModulesJSI 的内部 SwiftPM/DerivedData 固定写到 `~/Library/Developer/Xcode/DerivedData/Proxy-ExpoModulesJSI`，同时启用 `COPYFILE_DISABLE=1`。依赖补丁 `patches/expo-modules-jsi@57.0.4.patch` 保证重新安装依赖后仍支持该外置目录；禁止把这些构建目录改回项目目录。

Bootstrap 禁用 Xcode 自动 Package Resolution，只使用 `pod install` 已锁定的依赖图，避免真机构建在输出依赖图之前无期限等待。只有 Pod/原生依赖变化时才需要重新执行 `pod install`，普通 Server UI / JS Renderer 更新不重新编译。

随后运行：

```bash
pnpm dev:api
pnpm --filter @proxy/mobile ios:dev
```

`ios:dev` 自动把 `EXPO_PUBLIC_API_BASE_URL` 指向 Mac 当前局域网地址；它不会沿用 Android 模拟器专用的 `10.0.2.2`。网络环境特殊时可设置 `PROXY_IOS_API_BASE_URL`。真机与 Mac 必须能互访，API 监听 4100，Metro 监听 8081。

`pnpm dev:api` 会先恢复并检查本地模型底座通道，再启动 Go API。该开发辅助只维护 `.env` 指定的 loopback gateway；业务代码仍只提交 task ID，模型、Provider 与故障切换继续由模型底座负责。

自包含 Android 验收包是低频命令：

```bash
pnpm --filter @proxy/mobile android:release-test
```

该命令有系统级单实例锁、关闭 Gradle composite parallel、限制两个 worker，并只清理已确认的 AAPT2 重复生成物目录。禁止同时启动第二条 Gradle/CMake 构建。

## 安全边界

服务器只能发送共享契约允许的组件、图标 token、props 和已注册 route。App 使用 Zod 验证整个 manifest/UIPlan；任意 JavaScript、任意原生能力和未注册 route 都 fail closed。服务端不可绕过 App Store 权限、支付、身份或隐私边界。

模块图标规范入口是仓库的 `docs/design/README.md`，生产唯一注册表是 `src/components/proxy-icon.tsx`。服务端下发稳定 icon token；Android/iOS 通过同一份 SVG path、viewBox、stroke 和 fill 规则渲染。禁止引用不存在的本地母版、使用 Unicode 回退字体、替换图形或按页面重新绘制模块图标。

生产 OTA 需要一次性配置更新服务与签名凭据。该步骤只用于 JS Renderer；Server UI revision 不依赖 OTA。未配置生产 OTA 前，不允许把 release APK 编译当作日常 UI 同步机制。

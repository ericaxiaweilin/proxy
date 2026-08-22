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

`ios:bootstrap` 在编译前检查 Xcode 首次启动状态、真机配对状态和 Scheme destinations。若 Xcode 缺少与当前工具链匹配的 iOS Platform Support，脚本会在单实例 native-build lock 内通过官方 `xcodebuild -downloadPlatform iOS` 自动补齐，再开始 Expo/Xcode 编译。设置 `PROXY_IOS_PLATFORM_AUTO_INSTALL=0` 可改为只报错、不自动下载。

随后运行：

```bash
pnpm dev:api
pnpm --filter @proxy/mobile ios:dev
```

自包含 Android 验收包是低频命令：

```bash
pnpm --filter @proxy/mobile android:release-test
```

该命令有系统级单实例锁、关闭 Gradle composite parallel、限制两个 worker，并只清理已确认的 AAPT2 重复生成物目录。禁止同时启动第二条 Gradle/CMake 构建。

## 安全边界

服务器只能发送共享契约允许的组件、图标 token、props 和已注册 route。App 使用 Zod 验证整个 manifest/UIPlan；任意 JavaScript、任意原生能力和未注册 route 都 fail closed。服务端不可绕过 App Store 权限、支付、身份或隐私边界。

模块图标唯一母版是仓库根目录的 `Proxy_Module_Logo_Master_R1.html`。服务端下发 `profile-ring`、`target`、`route`、`coin`、`gear` 等稳定 token；Android/iOS 通过同一份 24×24 SVG path、2.2px round stroke 渲染。禁止使用 Unicode 回退字体或按页面重新绘制模块图标。

生产 OTA 需要一次性配置更新服务与签名凭据。该步骤只用于 JS Renderer；Server UI revision 不依赖 OTA。未配置生产 OTA 前，不允许把 release APK 编译当作日常 UI 同步机制。

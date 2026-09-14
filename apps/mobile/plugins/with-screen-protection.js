// with-screen-protection — 手工原生定制的 prebuild-safe 保险栓。
//
// 背景：expo prebuild 会清空并再生 ios/ 与 android/，此前手放在原生工程里的
// 定制在 prebuild 后丢失。本 plugin 把它们收编，每次 prebuild 自动重放：
//   - ScreenProtection 原生模块（Lotus RFC §4）：iOS 挂本地 pod，Android 拷源码
//     并注册 ScreenProtectionPackage（源码在 modules/proxy-screen-protection/）。
//   - NSMicrophoneUsageDescription：见下 withMicrophoneUsage 注释（走 app.json）。
//   - AppDelegate METRO_HOST 三级回退（DEVICE-METROHOST-001，门禁 grep 钉死）。
//   - gradle.properties 确定性构建（并行关/daemon 关/arm64）。
//   - entitlements 的 keychain-access-groups 走 app.json ios.entitlements（见 app.json）。
// 幂等：重复跑 prebuild 不会叠加；锚点丢失时 loud fail，不静默跳过。
const fs = require("fs");
const path = require("path");
const {
  withPodfile,
  withMainApplication,
  withDangerousMod,
  withAppDelegate,
  withGradleProperties,
} = require("@expo/config-plugins");

const MODULE_DIR = path.join(__dirname, "..", "modules", "proxy-screen-protection");
const POD_NAME = "ProxyScreenProtection";
const ANDROID_PKG = "com.proxy.screenprotection";
const ANDROID_FILES = ["ScreenProtectionModule.kt", "ScreenProtectionPackage.kt"];

function withScreenProtectionPod(config) {
  return withPodfile(config, (config) => {
    if (!config.modResults.contents.includes(POD_NAME)) {
      const podLine = `  pod '${POD_NAME}', :path => File.join(__dir__, '..', 'modules', 'proxy-screen-protection', 'ios')`;
      config.modResults.contents = config.modResults.contents.replace(
        "target 'Proxy' do",
        `target 'Proxy' do\n${podLine}`
      );
    }
    return config;
  });
}

function withScreenProtectionAndroidSources(config) {
  return withDangerousMod(config, [
    "android",
    async (config) => {
      const destDir = path.join(
        config.modRequest.platformProjectRoot,
        "app",
        "src",
        "main",
        "java",
        ...ANDROID_PKG.split(".")
      );
      fs.mkdirSync(destDir, { recursive: true });
      for (const file of ANDROID_FILES) {
        const src = path.join(MODULE_DIR, "android", file);
        if (!fs.existsSync(src)) {
          throw new Error(`[with-screen-protection] missing vendored source: ${src}`);
        }
        fs.copyFileSync(src, path.join(destDir, file));
      }
      return config;
    },
  ]);
}

function withScreenProtectionRegistration(config) {
  return withMainApplication(config, (config) => {
    let src = config.modResults.contents;
    const importLine = `import ${ANDROID_PKG}.ScreenProtectionPackage`;
    if (!src.includes(importLine)) {
      if (!src.includes("import com.facebook.react.ReactPackage")) {
        throw new Error("[with-screen-protection] MainApplication hook anchor missing (ReactPackage import)");
      }
      src = src.replace(
        "import com.facebook.react.ReactPackage",
        `import com.facebook.react.ReactPackage\n\n${importLine}`
      );
    }
    if (!src.includes("ScreenProtectionPackage()")) {
      if (!src.includes("// add(MyReactNativePackage())")) {
        throw new Error("[with-screen-protection] MainApplication hook anchor missing (packages.apply block)");
      }
      src = src.replace(
        "// add(MyReactNativePackage())",
        `// add(MyReactNativePackage())\n          add(ScreenProtectionPackage())`
      );
    }
    config.modResults.contents = src;
    return config;
  });
}

module.exports = function withScreenProtection(config) {
  config = withScreenProtectionPod(config);
  config = withScreenProtectionAndroidSources(config);
  config = withScreenProtectionRegistration(config);
  config = withMetroHostDelegate(config);
  config = withDeterministicGradle(config);
  return config;
};

// NSMicrophoneUsageDescription 走 app.json 里 expo-image-picker 的
// microphonePermission 字符串（禁止设 false：语音输入双端真在用；Android 侧
// 旧 manifest 的 RECORD_AUDIO=remove 是 1d2629f 时代的批量接线残留，早于语音
// 功能，留着它 Android 录音必崩）。iOS 侧 image-picker 插件负责写键，
// Android 侧顺带拿到 RECORD_AUDIO —— 两边都是修，不是回归。

// DEVICE-METROHOST-001：AppDelegate 的 METRO_HOST env → Info.plist → Bonjour
// 三级回退是真机救命链（门禁在 check-regression-contracts.sh 里 grep 钉死），
// prebuild 再生会把它打回 stock，必须在这里补回来（含 import Foundation）。
function withMetroHostDelegate(config) {
  return withAppDelegate(config, (config) => {
    let src = config.modResults.contents;
    if (!src.includes("METRO_HOST")) {
      const anchor =
        '    return RCTBundleURLProvider.sharedSettings().jsBundleURL(forBundleRoot: ".expo/.virtual-metro-entry")';
      if (!src.includes(anchor)) {
        throw new Error("[with-screen-protection] AppDelegate hook anchor missing (bundleURL stock line)");
      }
      src = src.replace(anchor, METRO_HOST_BLOCK);
    }
    if (!src.includes("import Foundation")) {
      src = `import Foundation\n${src}`;
    }
    config.modResults.contents = src;
    return config;
  });
}

// Android 确定性构建（注释见原 gradle.properties）：禁用并行/daemon、
// worker 上限、只编 arm64。prebuild 再生会打回并行+全 ABI，必须钉回来。
function withDeterministicGradle(config) {
  return withGradleProperties(config, (config) => {
    const setProp = (key, value) => {
      config.modResults = config.modResults.filter(
        (p) => !(p.type === "property" && p.key === key)
      );
      config.modResults.push({ type: "property", key, value });
    };
    setProp("org.gradle.parallel", "false");
    setProp("org.gradle.caching", "true");
    setProp("org.gradle.daemon", "false");
    setProp("org.gradle.workers.max", "2");
    setProp("org.gradle.vfs.watch", "false");
    setProp("reactNativeArchitectures", "arm64-v8a");
    return config;
  });
}

// 逐字取自 prebuild 前的 AppDelegate.swift（DEVICE-METROHOST-001），
// 只保留 bundleURL() 内的 DEBUG 分支替换体。
const METRO_HOST_BLOCK = `    // A physical iPhone cannot use Metro's localhost default.
    // Priority: launch environment \`METRO_HOST\` → Info.plist \`MetroHost\`
    // (per-build override) → Bonjour hostname.
    let envHost: String? = {
      let raw = ProcessInfo.processInfo.environment["METRO_HOST"] ?? ""
      return raw.isEmpty ? nil : raw
    }()
    let metroHost = envHost
      ?? (Bundle.main.object(forInfoDictionaryKey: "MetroHost") as? String)
      ?? "Thanhs-MacBook-Air.local"
    var components = URLComponents()
    components.scheme = "http"
    components.host = metroHost
    components.port = 8081
    components.path = "/.expo/.virtual-metro-entry.bundle"
    components.queryItems = [
      URLQueryItem(name: "platform", value: "ios"),
      URLQueryItem(name: "dev", value: "true"),
      URLQueryItem(name: "minify", value: "false"),
      URLQueryItem(name: "modulesOnly", value: "false"),
      URLQueryItem(name: "runModule", value: "true"),
    ]
    return components.url`;

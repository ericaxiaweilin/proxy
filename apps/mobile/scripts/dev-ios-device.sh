#!/usr/bin/env bash
# 真机（physical iPhone/iPad）Debug 构建 + 安装 + 启动。
#
# 为什么不用裸 xcodebuild：project.pbxproj 里没有 DEVELOPMENT_TEAM，
# 裸跑必报 'Signing for "Proxy" requires a development team'。
# Team C4673FY8U7 来自钥匙串证书 Apple Development (nguyenthanhhuyen0304@gmail.com)，
# 与 ~/Library/MobileDevice/Provisioning Profiles 里
# "iOS Team Provisioning Profile: com.proxy.creator.dev.c4673fy8u7" 匹配。
#
# 用法:
#   ./scripts/dev-ios-device.sh build            # 只构建
#   ./scripts/dev-ios-device.sh install [设备名]  # 构建+安装+启动（默认设备 weilin）
#
# 救急（mDNS 解析到失效地址、真机连不上 Metro）—— 不改文件、不重编译:
#   METRO_HOST=192.168.1.23 ./scripts/dev-ios-device.sh install
# 见 docs/development/SOP_DYNAMIC_IP_DEVICES.md §7.1。

set -euo pipefail

TEAM_ID="C4673FY8U7"
DEVICE_NAME="${2:-weilin}"
BUNDLE_ID="com.proxy.creator.dev.c4673fy8u7"
DD="$HOME/Library/Developer/Xcode/DerivedData/Proxy-Local"
MOBILE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

cmd="${1:-install}"

xcodebuild -workspace "$MOBILE_DIR/ios/Proxy.xcworkspace" -scheme Proxy \
  -configuration Debug \
  -destination "platform=iOS,name=${DEVICE_NAME}" \
  -derivedDataPath "$DD" \
  -disableAutomaticPackageResolution -skipPackagePluginValidation -skipMacroValidation \
  -allowProvisioningUpdates \
  DEVELOPMENT_TEAM="$TEAM_ID" CODE_SIGN_STYLE=Automatic \
  COCOAPODS_PARALLEL_CODE_SIGN=YES COMPILER_INDEX_STORE_ENABLE=NO build

APP="$DD/Build/Products/Debug-iphoneos/Proxy.app"
if [[ "$cmd" == "build" ]]; then
  echo "BUILD OK: $APP"
  exit 0
fi

# UUID 是 36 字符 (8-4-4-4-12 hex) 形式，Name 词数不固定，用 regex 最稳
DEV_UUID=$(xcrun devicectl list devices 2>/dev/null | awk -v n="$DEVICE_NAME" '$1 == n {if (match($0, /[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}/)) print substr($0, RSTART, RLENGTH); exit}')
if [[ -z "$DEV_UUID" ]]; then
  echo "Device '${DEVICE_NAME}' not found. Run: xcrun devicectl list devices" >&2
  exit 69
fi

xcrun devicectl device install app --device "$DEV_UUID" "$APP"

# 注意：不要用 --console 挂日志启动 —— devicectl 的隧道断连会把被调试进程一起带走，
# 表现为 App 几十秒后消失。要看日志用 Console.app 或 idevicesyslog。
#
# --- Metro 主机解析（两处共用，避免出现「原生按 A、dev client 按 B」）--------
# 优先级：METRO_HOST（显式覆盖）→ Bonjour LocalHostName → AppDelegate 内置兜底。
metro_host="${METRO_HOST:-}"
if [[ -z "$metro_host" ]]; then
  proxy_local_host="$(scutil --get LocalHostName 2>/dev/null || true)"
  [[ -n "$proxy_local_host" ]] && metro_host="${proxy_local_host}.local"
fi
if [[ -n "$metro_host" && ( "$metro_host" == *'"'* || "$metro_host" == *'\'* ) ]]; then
  echo "METRO_HOST must not contain quotes or backslashes: ${metro_host}" >&2
  exit 64
fi

launch_args=()
if [[ -n "$metro_host" ]]; then
  # DEVICE-METROHOST-001: 救急/常规的 Metro 主机覆盖。**只走启动环境变量**，
  # 绝不写进受版本控制的 Info.plist —— 一旦提交，AppDelegate 的 Bonjour 兜底
  # 对所有人永久失效，之后 IP 一变真机就再也打不开（2026-09-12 实际事故）。
  #   METRO_HOST=192.168.1.23 ./scripts/dev-ios-device.sh install
  launch_args=(-e "{\"METRO_HOST\":\"${metro_host}\"}")

  # DEVICE-DEVURL-001: 同时用 deep link 明确指定 dev-server。
  # 为什么必须：dev client 若**没有**已保存的 dev-server（全新安装、清过历史，
  # 或存的是旧 IP），它会停在 launcher 界面等用户点选，既不拉 bundle 也不报错 ——
  # 表现和「App 打不开」一模一样（2026-09-12 实测：卸载重装后普通启动 96s 无反应，
  # 带上这个 deep link 后 24s 正常加载）。把 URL 显式传给启动命令，启动就变成确定的。
  metro_url="http://$(printf '%s' "$metro_host" | tr '[:upper:]' '[:lower:]'):8081"
  encoded_url="${metro_url//:/%3A}"
  encoded_url="${encoded_url//\//%2F}"
  launch_args+=(--payload-url "proxy://expo-development-client/?url=${encoded_url}")

  echo "Metro host : ${metro_host}"
  echo "Dev server : ${metro_url}"
else
  echo "warn: 无法解析 Metro 主机（无 METRO_HOST、无 Bonjour LocalHostName）；" >&2
  echo "      交给 AppDelegate 的内置兜底，若真机连不上请显式设置 METRO_HOST。" >&2
fi

# --terminate-existing：安装完新构建后必须替换掉正在跑的旧实例，否则重跑本脚本
# 只会把旧 App 拉到前台，你看到的是**上一次**的 bundle（极易误判成「改了没生效」）。
xcrun devicectl device process launch --device "$DEV_UUID" --terminate-existing ${launch_args[@]+"${launch_args[@]}"} "$BUNDLE_ID"

echo
echo "INSTALLED & LAUNCHED on ${DEVICE_NAME} (${DEV_UUID})"
echo "JS bundle 来自 Metro（./scripts/dev-ios.sh，端口 8081），确保它先跑起来。"
echo "若真机停在 dev client launcher：用上面打印的 Dev server 地址手工连接，或重跑本脚本。"

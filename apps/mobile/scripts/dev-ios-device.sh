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

DEV_UUID=$(xcrun devicectl list devices 2>/dev/null | awk -v n="$DEVICE_NAME" '$0 ~ n {print $4; exit}')
if [[ -z "$DEV_UUID" ]]; then
  echo "Device '${DEVICE_NAME}' not found. Run: xcrun devicectl list devices" >&2
  exit 69
fi

xcrun devicectl device install app --device "$DEV_UUID" "$APP"

# 注意：不要用 --console 挂日志启动 —— devicectl 的隧道断连会把被调试进程一起带走，
# 表现为 App 几十秒后消失。要看日志用 Console.app 或 idevicesyslog。
xcrun devicectl device process launch --device "$DEV_UUID" "$BUNDLE_ID"

echo
echo "INSTALLED & LAUNCHED on ${DEVICE_NAME} (${DEV_UUID})"
echo "JS bundle 来自 Metro（./scripts/dev-ios.sh，端口 8081），确保它先跑起来。"

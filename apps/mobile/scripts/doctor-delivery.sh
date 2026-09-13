#!/usr/bin/env bash

set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
mobile_dir="$(cd "${script_dir}/.." && pwd)"
failures=0

require_text() {
  local proxy_file="$1"
  local proxy_pattern="$2"
  local proxy_label="$3"
  if ! rg -q --fixed-strings -- "${proxy_pattern}" "${proxy_file}"; then
    echo "FAIL: ${proxy_label}" >&2
    failures=$((failures + 1))
  fi
}

# DEVICE-METROHOST-001: the mirror image of require_text — some things must stay
# absent. A committed `MetroHost` pins every device to one LAN IP and silently
# disables the Bonjour fallback in AppDelegate.bundleURL(), so the next IP change
# bricks the device until someone recompiles. Caught here (at native-build time,
# before a 10-minute build) as well as in the pre-commit contract gate.
require_absent() {
  local proxy_file="$1"
  local proxy_pattern="$2"
  local proxy_label="$3"
  if rg -q --fixed-strings -- "${proxy_pattern}" "${proxy_file}"; then
    echo "FAIL: ${proxy_label}" >&2
    failures=$((failures + 1))
  fi
}

require_text "${mobile_dir}/android/gradle.properties" "org.gradle.parallel=false" "Gradle parallel composite execution must stay disabled."
require_text "${mobile_dir}/android/gradle.properties" "org.gradle.daemon=false" "Native builds must not leave a resident Gradle daemon."
require_text "${mobile_dir}/android/gradle.properties" "org.gradle.workers.max=2" "Native build worker count must stay bounded."
require_text "${mobile_dir}/android/app/src/main/AndroidManifest.xml" 'android:scheme="proxy"' "Android proxy:// URL scheme is missing."
require_text "${mobile_dir}/ios/Proxy/Info.plist" "<string>proxy</string>" "iOS proxy:// URL scheme is missing."
require_absent "${mobile_dir}/ios/Proxy/Info.plist" "<key>MetroHost</key>" \
  "ios/Proxy/Info.plist must not hardcode MetroHost — it disables the Bonjour fallback for every device. Use: METRO_HOST=<ip> ./scripts/dev-ios-device.sh install"
require_text "${mobile_dir}/scripts/dev-android.sh" "adb reverse tcp:8081 tcp:8081" "Android Metro port forwarding is missing."
require_text "${mobile_dir}/scripts/dev-android.sh" "adb reverse tcp:4100 tcp:4100" "Android API port forwarding is missing."
require_text "${mobile_dir}/scripts/start-android-emulator.sh" "-screen touch" "Android acceptance emulator must disable the stuck multi-touch gesture mode."
require_text "${mobile_dir}/scripts/bootstrap-android-dev.sh" "proxy-android-native-build.lock" "Android native-build lock is missing."
require_text "${mobile_dir}/scripts/bootstrap-ios-dev.sh" "proxy-ios-native-build.lock" "iOS native-build lock is missing."
require_text "${mobile_dir}/scripts/bootstrap-ios-dev.sh" "xcodebuild -checkFirstLaunchStatus" "iOS Xcode first-launch preflight is missing."
require_text "${mobile_dir}/scripts/bootstrap-ios-dev.sh" "xcodebuild -downloadPlatform iOS" "iOS platform self-heal is missing."
require_text "${mobile_dir}/package.json" '"react-native-svg"' "Shared SVG module-logo renderer is missing."

if [[ -d "${mobile_dir}/android/app/build" ]]; then
  duplicate_flat_count="$(find "${mobile_dir}/android/app/build" -type f -name '* [0-9]*.flat' | wc -l | tr -d ' ')"
else
  duplicate_flat_count="0"
fi
if [[ "${duplicate_flat_count}" != "0" ]]; then
  echo "FAIL: ${duplicate_flat_count} duplicated AAPT2 .flat artifacts found." >&2
  failures=$((failures + 1))
fi

if (( failures > 0 )); then
  exit 1
fi

echo "Delivery architecture OK: server UI, Metro JS, and native builds are separated."

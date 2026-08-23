#!/usr/bin/env bash

set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
mobile_dir="$(cd "${script_dir}/.." && pwd)"
proxy_build_lock="${TMPDIR:-/tmp}/proxy-android-native-build.lock"

command -v adb >/dev/null || { echo "adb is required." >&2; exit 1; }
adb get-state >/dev/null 2>&1 || { echo "Start or connect one Android device first." >&2; exit 1; }

if ! /usr/bin/shlock -f "${proxy_build_lock}" -p $$; then
  echo "Another Proxy Android native build is already running." >&2
  exit 2
fi
trap 'unlink "${proxy_build_lock}" 2>/dev/null || true' EXIT INT TERM

proxy_java_home="${PROXY_ANDROID_JAVA_HOME:-${JAVA_HOME:-}}"
if [[ ! -x "${proxy_java_home}/bin/java" ]] && [[ -x "/Applications/Android Studio.app/Contents/jbr/Contents/Home/bin/java" ]]; then
  proxy_java_home="/Applications/Android Studio.app/Contents/jbr/Contents/Home"
fi
if [[ ! -x "${proxy_java_home}/bin/java" ]]; then
  echo "Android Studio's bundled JDK was not found." >&2
  exit 1
fi

cd "${mobile_dir}"
proxy_device_arch="$(adb shell getprop ro.product.cpu.abi | tr -d '\r\n')"
case "${proxy_device_arch}" in
  arm64-v8a|x86_64|armeabi-v7a|x86) ;;
  *) echo "Unsupported Android device ABI: ${proxy_device_arch}" >&2; exit 1 ;;
esac

echo "Installing one development shell for ${proxy_device_arch}."
JAVA_HOME="${proxy_java_home}" \
  PATH="${proxy_java_home}/bin:${PATH}" \
  NODE_ENV=development \
  ORG_GRADLE_PROJECT_reactNativeArchitectures="${proxy_device_arch}" \
  npx expo run:android --no-bundler

echo "Android development shell installed. Future UI work uses: pnpm android:dev"

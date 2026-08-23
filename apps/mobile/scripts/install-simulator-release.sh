#!/usr/bin/env bash

set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
mobile_dir="$(cd "${script_dir}/.." && pwd)"
android_dir="${mobile_dir}/android"
apk_path="${android_dir}/app/build/outputs/apk/release/app-release.apk"
proxy_build_lock="${TMPDIR:-/tmp}/proxy-android-native-build.lock"

if ! /usr/bin/shlock -f "${proxy_build_lock}" -p $$; then
  echo "Another Proxy Android native build is already running. Wait for it instead of starting a second Gradle/CMake graph." >&2
  exit 2
fi
trap 'unlink "${proxy_build_lock}" 2>/dev/null || true' EXIT INT TERM

# Android uses Gradle during packaging even though Proxy itself is TypeScript/React Native.
# Prefer an explicitly supplied JDK, then Android Studio's bundled JDK on macOS.
proxy_java_home="${PROXY_ANDROID_JAVA_HOME:-${JAVA_HOME:-}}"
if [[ ! -x "${proxy_java_home}/bin/java" ]] && [[ -x "/Applications/Android Studio.app/Contents/jbr/Contents/Home/bin/java" ]]; then
  proxy_java_home="/Applications/Android Studio.app/Contents/jbr/Contents/Home"
fi

if [[ ! -x "${proxy_java_home}/bin/java" ]]; then
  echo "Android JDK not found. Set PROXY_ANDROID_JAVA_HOME to Android Studio's bundled JDK." >&2
  exit 1
fi

command -v adb >/dev/null || { echo "adb is required to install the simulator build." >&2; exit 1; }

# This command exists for a self-contained acceptance package, not daily UI work.
# Daily JS/UI work uses Metro and server manifests; distribution packaging keeps
# the complete architecture and lint gates.
proxy_simulator_arch="${PROXY_ANDROID_SIMULATOR_ARCH:-}"
if [[ -z "${proxy_simulator_arch}" ]]; then
  proxy_simulator_arch="$(adb shell getprop ro.product.cpu.abi 2>/dev/null | tr -d '\r\n')"
fi
proxy_simulator_arch="${proxy_simulator_arch:-x86_64}"

# Interrupted Gradle/AAPT2 runs can leave names such as `values-pt 2.json`,
# `gradleResValues 2.xml`, or `values-xx 2.flat`. They exist only in these
# three small generated-resource folders. Do not scan all intermediates: CMake
# outputs are large and unrelated to this failure.
for proxy_generated_root in \
  "${android_dir}/app/build/generated/res/resValues/release" \
  "${android_dir}/app/build/intermediates/merged_res/release/mergeReleaseResources" \
  "${android_dir}/app/build/intermediates/merged_res_blame_folder/release"; do
  if [[ -d "${proxy_generated_root}" ]]; then
    find "${proxy_generated_root}" -type f -name '* [0-9]*.*' -delete
  fi
done

echo "Building simulator-only release for ${proxy_simulator_arch} (full lint is reserved for distribution builds)."

(
  cd "${android_dir}"
  JAVA_HOME="${proxy_java_home}" PATH="${proxy_java_home}/bin:${PATH}" ./gradlew :app:assembleRelease \
    "-PreactNativeArchitectures=${proxy_simulator_arch}" \
    --no-daemon \
    --no-parallel \
    --max-workers=2 \
    -Dorg.gradle.vfs.watch=false \
    -x lintVitalRelease
)

adb install -r "${apk_path}"
adb shell am force-stop com.proxy.app
adb shell monkey -p com.proxy.app 1 >/dev/null

echo "Proxy simulator build installed: bundled JS, no Expo/Metro service required."

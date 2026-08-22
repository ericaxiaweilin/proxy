#!/usr/bin/env bash

set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
mobile_dir="$(cd "${script_dir}/.." && pwd)"
proxy_build_lock="${TMPDIR:-/tmp}/proxy-ios-native-build.lock"
proxy_ios_device="${PROXY_IOS_DEVICE:-weilin}"
proxy_ios_platform_auto_install="${PROXY_IOS_PLATFORM_AUTO_INSTALL:-1}"
proxy_ios_workspace="${mobile_dir}/ios/Proxy.xcworkspace"
proxy_ios_scheme="Proxy"

if ! /usr/bin/shlock -f "${proxy_build_lock}" -p $$; then
  echo "Another Proxy iOS native build is already running." >&2
  exit 2
fi
trap 'unlink "${proxy_build_lock}" 2>/dev/null || true' EXIT INT TERM

cd "${mobile_dir}"

if ! command -v xcodebuild >/dev/null 2>&1; then
  echo "Xcode command-line tools are unavailable. Install or select Xcode before building Proxy." >&2
  exit 69
fi

if ! xcodebuild -checkFirstLaunchStatus >/dev/null 2>&1; then
  echo "Xcode first-launch setup is incomplete. Open Xcode once and finish the required system components." >&2
  exit 69
fi

if ! xcrun devicectl list devices 2>/dev/null | grep -Fq -- "${proxy_ios_device}"; then
  echo "Proxy iOS device '${proxy_ios_device}' is not paired or available. Unlock and connect the iPhone." >&2
  exit 69
fi

proxy_ios_destinations="$(
  xcodebuild \
    -workspace "${proxy_ios_workspace}" \
    -scheme "${proxy_ios_scheme}" \
    -showdestinations 2>&1 || true
)"

if grep -Fq -- "Please download and install the platform from Xcode > Settings > Components." <<<"${proxy_ios_destinations}"; then
  if [[ "${proxy_ios_platform_auto_install}" != "1" ]]; then
    echo "The required iOS platform is missing. Run 'xcodebuild -downloadPlatform iOS' or set PROXY_IOS_PLATFORM_AUTO_INSTALL=1." >&2
    exit 70
  fi

  echo "Required iOS platform is missing; downloading the official Xcode platform under the native-build lock."
  xcodebuild -downloadPlatform iOS

  proxy_ios_destinations="$(
    xcodebuild \
      -workspace "${proxy_ios_workspace}" \
      -scheme "${proxy_ios_scheme}" \
      -showdestinations 2>&1 || true
  )"
fi

if grep -Fq -- "Please download and install the platform from Xcode > Settings > Components." <<<"${proxy_ios_destinations}"; then
  echo "The iOS platform download completed but Xcode still reports it unavailable." >&2
  exit 70
fi

NODE_ENV=development npx expo run:ios --device "${proxy_ios_device}" --no-bundler

echo "iOS development shell installed. Future UI work uses: pnpm ios:dev"

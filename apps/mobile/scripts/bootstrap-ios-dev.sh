#!/usr/bin/env bash

set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
mobile_dir="$(cd "${script_dir}/.." && pwd)"
proxy_build_lock="${TMPDIR:-/tmp}/proxy-ios-native-build.lock"
proxy_ios_device="${PROXY_IOS_DEVICE:-weilin}"
proxy_ios_platform_auto_install="${PROXY_IOS_PLATFORM_AUTO_INSTALL:-1}"
proxy_ios_workspace="${mobile_dir}/ios/Proxy.xcworkspace"
proxy_ios_scheme="Proxy"
proxy_ios_project="${mobile_dir}/ios/Proxy.xcodeproj/project.pbxproj"
proxy_ios_autolinking="${mobile_dir}/ios/build/generated/autolinking/autolinking.json"
proxy_ios_derived_data="${PROXY_IOS_DERIVED_DATA:-${HOME}/Library/Developer/Xcode/DerivedData/Proxy-Local}"

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

proxy_ios_destination_id=""
while IFS= read -r proxy_ios_destination; do
  if [[ "${proxy_ios_destination}" == *"platform:iOS,"* && "${proxy_ios_destination}" == *"name:${proxy_ios_device} }"* ]]; then
    proxy_ios_destination_id="${proxy_ios_destination#*id:}"
    proxy_ios_destination_id="${proxy_ios_destination_id%%,*}"
    break
  fi
done <<<"${proxy_ios_destinations}"

if [[ -z "${proxy_ios_destination_id}" ]]; then
  echo "Proxy iOS device '${proxy_ios_device}' is paired but is not an eligible Xcode destination. Unlock it and enable Developer Mode." >&2
  exit 69
fi

proxy_ios_team="${PROXY_IOS_DEVELOPMENT_TEAM:-}"
if [[ -z "${proxy_ios_team}" ]]; then
  proxy_ios_team="$(sed -n 's/.*DEVELOPMENT_TEAM = \([^;]*\);/\1/p' "${proxy_ios_project}" | head -n 1)"
fi

if [[ -z "${proxy_ios_team}" ]]; then
  echo "No Apple development team is configured. Set PROXY_IOS_DEVELOPMENT_TEAM before building." >&2
  exit 71
fi

proxy_ios_team_slug="$(printf '%s' "${proxy_ios_team}" | tr '[:upper:]' '[:lower:]')"
proxy_ios_bundle_id="${PROXY_IOS_DEV_BUNDLE_ID:-com.proxy.creator.dev.${proxy_ios_team_slug}}"

if [[ ! -f "${proxy_ios_autolinking}" ]]; then
  echo "Regenerating CocoaPods autolinking metadata."
  (
    cd "${mobile_dir}/ios"
    pod install
  )
fi

mkdir -p "${proxy_ios_derived_data}"

echo "Building Proxy for '${proxy_ios_device}' with local development bundle '${proxy_ios_bundle_id}'."
echo "DerivedData: ${proxy_ios_derived_data}"

COPYFILE_DISABLE=1 xcodebuild \
  -workspace "${proxy_ios_workspace}" \
  -configuration Debug \
  -scheme "${proxy_ios_scheme}" \
  -destination "id=${proxy_ios_destination_id}" \
  -derivedDataPath "${proxy_ios_derived_data}" \
  COCOAPODS_PARALLEL_CODE_SIGN=true \
  COMPILER_INDEX_STORE_ENABLE=NO \
  DEVELOPMENT_TEAM="${proxy_ios_team}" \
  PRODUCT_BUNDLE_IDENTIFIER="${proxy_ios_bundle_id}" \
  -allowProvisioningUpdates \
  -allowProvisioningDeviceRegistration \
  build

proxy_ios_app="${proxy_ios_derived_data}/Build/Products/Debug-iphoneos/Proxy.app"
if [[ ! -d "${proxy_ios_app}" ]]; then
  echo "Xcode reported success but the expected app is missing: ${proxy_ios_app}" >&2
  exit 72
fi

codesign --verify --deep --strict --verbose=2 "${proxy_ios_app}"
xcrun devicectl device install app --device "${proxy_ios_device}" "${proxy_ios_app}"

if ! xcrun devicectl device process launch --device "${proxy_ios_device}" "${proxy_ios_bundle_id}"; then
  echo "Proxy was installed but iOS refused to launch it. On the iPhone, trust the developer under Settings > General > VPN & Device Management, then run this command again." >&2
  exit 73
fi

echo "iOS development shell installed and launched. Future UI work uses: pnpm ios:dev"

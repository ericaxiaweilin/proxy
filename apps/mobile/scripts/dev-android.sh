#!/usr/bin/env bash

set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
mobile_dir="$(cd "${script_dir}/.." && pwd)"

command -v adb >/dev/null || { echo "adb is required." >&2; exit 1; }
adb get-state >/dev/null 2>&1 || { echo "Start the Android emulator first." >&2; exit 1; }

if ! adb shell run-as com.proxy.app pwd >/dev/null 2>&1; then
  echo "Proxy development shell is not installed. Run once: pnpm android:bootstrap" >&2
  exit 2
fi

# The emulator must reach the host Metro port before ReactHost starts. If the
# app was opened before Metro, restart it instead of merely foregrounding the
# faulted blank Activity.
adb reverse tcp:8081 tcp:8081
adb reverse tcp:4100 tcp:4100
adb shell am force-stop com.proxy.app

cd "${mobile_dir}"
NODE_ENV=development exec npx expo start --dev-client --android

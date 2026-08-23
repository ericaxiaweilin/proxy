#!/usr/bin/env bash

set -euo pipefail

proxy_avd_name="${PROXY_ANDROID_AVD:-Pixel_8}"
proxy_emulator="${ANDROID_HOME:-${HOME}/Library/Android/sdk}/emulator/emulator"

if [[ ! -x "${proxy_emulator}" ]]; then
  echo "Android Emulator was not found at ${proxy_emulator}." >&2
  exit 1
fi

if adb devices | awk 'NR > 1 && $2 == "device" { found = 1 } END { exit !found }'; then
  echo "An Android device is already connected."
  exit 0
fi

# Single-touch mode prevents the desktop emulator's Option/Ctrl pinch overlay
# from injecting repeated ghost gestures into normal product acceptance tests.
exec "${proxy_emulator}" \
  -avd "${proxy_avd_name}" \
  -gpu host \
  -screen touch \
  -no-mouse-reposition

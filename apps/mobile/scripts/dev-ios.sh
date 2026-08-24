#!/usr/bin/env bash

set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
mobile_dir="$(cd "${script_dir}/.." && pwd)"
proxy_ios_api_base_url="${PROXY_IOS_API_BASE_URL:-}"

if [[ -z "${proxy_ios_api_base_url}" ]]; then
  # A numeric LAN address becomes stale whenever the Mac moves between Wi-Fi
  # and an iPhone hotspot. Bonjour's LocalHostName is stable for both the iOS
  # simulator and a physical iPhone on the same local network.
  proxy_ios_local_host="$(scutil --get LocalHostName 2>/dev/null || true)"
  if [[ -z "${proxy_ios_local_host}" ]]; then
    echo "Cannot determine the Mac Bonjour hostname. Set PROXY_IOS_API_BASE_URL explicitly." >&2
    exit 69
  fi
  proxy_ios_api_base_url="http://${proxy_ios_local_host}.local:4100"
fi

export EXPO_PUBLIC_API_BASE_URL="${proxy_ios_api_base_url}"
echo "Proxy iOS API: ${EXPO_PUBLIC_API_BASE_URL}"

cd "${mobile_dir}"
NODE_ENV=development exec npx expo start --host lan

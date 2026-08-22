#!/usr/bin/env bash

set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
mobile_dir="$(cd "${script_dir}/.." && pwd)"
proxy_ios_api_base_url="${PROXY_IOS_API_BASE_URL:-}"

if [[ -z "${proxy_ios_api_base_url}" ]]; then
  proxy_ios_host_ip="$(ipconfig getifaddr en0 2>/dev/null || true)"
  if [[ -z "${proxy_ios_host_ip}" ]]; then
    proxy_ios_host_ip="$(ipconfig getifaddr en1 2>/dev/null || true)"
  fi
  if [[ -z "${proxy_ios_host_ip}" ]]; then
    echo "Cannot determine the Mac LAN address. Set PROXY_IOS_API_BASE_URL explicitly." >&2
    exit 69
  fi
  proxy_ios_api_base_url="http://${proxy_ios_host_ip}:4100"
fi

export EXPO_PUBLIC_API_BASE_URL="${proxy_ios_api_base_url}"
echo "Proxy iOS API: ${EXPO_PUBLIC_API_BASE_URL}"

cd "${mobile_dir}"
NODE_ENV=development exec npx expo start --dev-client

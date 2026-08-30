#!/usr/bin/env bash
# 一次性启 iPhone 真机 dev 链 (API + Metro)，完全绕开 Wi-Fi 切 IP / 端口漂移.
#
# 关键设计 (R15.22):
#   - API 固定 listen 0.0.0.0:4100 (Mac) — 改 main.go 用 0.0.0.0 而不是 ":4100" (macOS Go 1.26 IPv6 only 问题)
#   - Metro 8081 (Mac) — iOS dev client 自带 RSD forward, 拉 bundle
#   - iPhone app bundle baseUrl = http://${en0_ipv4}:4100
#     → iPhone 192.168.x.x:4100 → Mac en0 同子网 → API 4100 ✓
#   - Wi-Fi 切换: 重跑这个脚本 (自动重读 en0 IP, 触发 Metro 重新 build bundle)
#   - 端口 4100 / 8081 永远不变 — 任何时候起来都这两个数字
#
# 用法:
#   ./scripts/dev-iphone-usb.sh          # 一次性启好 (默认 up)
#   ./scripts/dev-iphone-usb.sh stop     # 全停
#   ./scripts/dev-iphone-usb.sh status   # 状态
#   ./scripts/dev-iphone-usb.sh relaunch # 重启 iPhone app 拿新 bundle
#
# 先决条件:
#   - iPhone 用 USB 连 Mac (UDID 在 PROXY_IOS_UDID env 或默认 weilin)
#   - 同一 Wi-Fi 接入点 — iPhone Wi-Fi 跟 Mac en0 同子网 (192.168.x.x)
#   - /tmp/api-bin 是最新的 Go API binary (从 apps/api-go build 出来)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
MOBILE_DIR="${ROOT_DIR}/apps/mobile"

UDID="${PROXY_IOS_UDID:-5F487B76-69EA-5311-AE63-3C5F09A61F20}"
BUNDLE_ID="com.proxy.creator.dev.c4673fy8u7"
API_PORT="${API_PORT:-4100}"
METRO_PORT="${METRO_PORT:-8081}"

API_BIN="${API_BIN:-/tmp/api-bin}"
API_LOG="${API_LOG:-/tmp/api-final.log}"
METRO_LOG="${METRO_LOG:-/tmp/metro-ios.log}"

cmd="${1:-up}"

kill_port_listeners() {
  local port="$1"
  local pids
  pids="$(lsof -nP -iTCP:"${port}" -sTCP:LISTEN -t 2>/dev/null || true)"
  if [[ -n "${pids}" ]]; then
    echo "  killing PIDs on :${port} → ${pids}"
    echo "${pids}" | xargs -r kill 2>/dev/null || true
  fi
}

get_en0_lan_ip() {
  ipconfig getifaddr en0 2>/dev/null || true
}

case "${cmd}" in
  up)
    echo "=== Step 1/5: 验证 iPhone USB ==="
    if ! xcrun devicectl list devices 2>/dev/null | awk -v u="${UDID}" '$3 == u {found=1; exit} END {exit !found}'; then
      echo "iPhone UDID=${UDID} 不在 'xcrun devicectl list devices'. 检查 USB." >&2
      exit 69
    fi
    echo "  ✓ iPhone ${UDID} connected"
    echo

    echo "=== Step 2/5: 取 en0 LAN IP ==="
    LAN_IP="$(get_en0_lan_ip)"
    if [[ -z "${LAN_IP}" ]]; then
      echo "  ✗ en0 无 IPv4. 检查 Wi-Fi." >&2
      exit 1
    fi
    echo "  ✓ Mac LAN IP: ${LAN_IP}"
    echo

    echo "=== Step 3/5: 启 API (Mac 0.0.0.0:${API_PORT}) ==="
    kill_port_listeners "${API_PORT}"
    sleep 1
    if [[ ! -x "${API_BIN}" ]]; then
      echo "  building ${API_BIN} from apps/api-go ..."
      (cd "${ROOT_DIR}/apps/api-go" && go build -o "${API_BIN}" ./cmd/api)
    else
      echo "  rebuilding ${API_BIN} (always fresh) ..."
      (cd "${ROOT_DIR}/apps/api-go" && go build -o "${API_BIN}" ./cmd/api)
    fi
    API_PORT="${API_PORT}" nohup "${API_BIN}" > "${API_LOG}" 2>&1 &
    disown
    sleep 3
    if ! lsof -nP -iTCP:"${API_PORT}" -sTCP:LISTEN >/dev/null 2>&1; then
      echo "  ✗ API 没起来. tail ${API_LOG}:" >&2
      tail -10 "${API_LOG}" >&2
      exit 1
    fi
    echo "  ✓ API listening on :${API_PORT} (log: ${API_LOG})"
    echo

    echo "=== Step 4/5: 启 Metro (固定 baseUrl=http://${LAN_IP}:${API_PORT}) ==="
    kill_port_listeners "${METRO_PORT}"
    sleep 1
    PROXY_IOS_API_BASE_URL="http://${LAN_IP}:${API_PORT}" \
      nohup "${MOBILE_DIR}/scripts/dev-ios.sh" > "${METRO_LOG}" 2>&1 &
    disown
    sleep 8
    if ! lsof -nP -iTCP:"${METRO_PORT}" -sTCP:LISTEN >/dev/null 2>&1; then
      echo "  ✗ Metro 没起来. tail ${METRO_LOG}:" >&2
      tail -15 "${METRO_LOG}" >&2
      exit 1
    fi
    echo "  ✓ Metro listening on :${METRO_PORT} (log: ${METRO_LOG})"
    echo

    echo "=== Step 5/5: 重启 iPhone app (拿新 bundle) ==="
    xcrun devicectl device process launch --device "${UDID}" --terminate-existing "${BUNDLE_ID}" 2>&1 | head -3
    echo
    echo "DONE. 一次启好 iPhone 真机 dev 链."
    echo "  API:    ${API_BIN} → 0.0.0.0:${API_PORT}"
    echo "  Metro:  :${METRO_PORT} (Mac) — iPhone dev client RSD forward 内置"
    echo "  baseUrl: http://${LAN_IP}:${API_PORT} (走 Wi-Fi 同子网到 Mac)"
    echo
    echo "  Wi-Fi 切了 / Mac IP 变了 → 重跑: ./scripts/dev-iphone-usb.sh up"
    echo "  端口 4100 / 8081 永远不变."
    ;;

  stop)
    echo "=== Stopping ==="
    kill_port_listeners "${METRO_PORT}"
    kill_port_listeners "${API_PORT}"
    pkill -f "${API_BIN}" 2>/dev/null || true
    pkill -f "expo start" 2>/dev/null || true
    echo "  ✓ all stopped"
    ;;

  status)
    echo "=== Status ==="
    for port in "${API_PORT}" "${METRO_PORT}"; do
      if lsof -nP -iTCP:"${port}" -sTCP:LISTEN >/dev/null 2>&1; then
        echo "  :${port} UP   → $(lsof -nP -iTCP:${port} -sTCP:LISTEN | tail -1 | awk '{print $1}')"
      else
        echo "  :${port} DOWN"
      fi
    done
    echo
    LAN_IP="$(get_en0_lan_ip)"
    echo "  Mac en0 LAN IP: ${LAN_IP:-<none>}"
    if xcrun devicectl list devices 2>/dev/null | awk -v u="${UDID}" '$3 == u {found=1; exit} END {exit !found}'; then
      echo "  iPhone ${UDID} connected"
    else
      echo "  iPhone ${UDID} NOT connected"
    fi
    ;;

  relaunch)
    echo "=== Relaunch iPhone app ==="
    xcrun devicectl device process launch --device "${UDID}" --terminate-existing "${BUNDLE_ID}" 2>&1 | head -3
    ;;

  *)
    echo "usage: $0 {up|stop|status|relaunch}" >&2
    exit 64
    ;;
esac

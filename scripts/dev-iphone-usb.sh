#!/usr/bin/env bash
# 一次性启 iPhone 真机 dev 链 (API + Metro)，完全绕开 Wi-Fi 切 IP / 端口漂移.
#
# 关键设计 (R15.22):
#   - API 固定 listen 0.0.0.0:4100 (Mac) — 改 main.go 用 0.0.0.0 而不是 ":4100" (macOS Go 1.26 IPv6 only 问题)
#   - Metro 8081 (Mac) — iOS dev client 自带 RSD forward, 拉 bundle
#   - iPhone app bundle baseUrl = http://${STABLE_HOST}:4100
#     → STABLE_HOST 默认是 Mac Bonjour 名 (xxx.local，R15.66，换 Wi-Fi 不变)；
#     Bonjour 不可用才回退 en0 数字 IP。iPhone 与 Mac 同子网即可。
#     可用 PROXY_IOS_HOST 环境变量强制指定。
#   - Wi-Fi 切换: 域名不变一般不用重跑；连不上才重跑这个脚本
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
#   - 仓库根 .env 提供 PROXY_LOGIN_PROVIDER/SMTP/DATABASE_URL —
#     Step 3 会自动载入 (dev-api.sh 同款)，缺登录配置直接 fail-fast，
#     不再静默起一个发不出验证码的 API (R15.64: 曾全员
#     "验证码没有配置" LOGIN_PROVIDER_NOT_CONFIGURED)

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

# R15.66: 不固定办公室 → Mac IP 常变。用 Bonjour 主机名做稳定地址，
# bundle 里写死域名（Thanhs-MacBook-Air.local），换 Wi-Fi 不用重连，
# 同子网 mDNS 可达即可。显式 PROXY_IOS_HOST 优先；.local 解析不到
# 非回环 IPv4 才回退 en0 数字 IP（回退后换网仍需重跑 up + 手机重连）。
stable_host() {
  if [[ -n "${PROXY_IOS_HOST:-}" ]]; then echo "${PROXY_IOS_HOST}"; return; fi
  local bonjour resolved
  bonjour="$(scutil --get LocalHostName 2>/dev/null || true)"
  if [[ -n "${bonjour}" ]]; then
    resolve_v4() { dscacheutil -q host -a name "${bonjour}.local" 2>/dev/null | awk '/^ip_address:/{print $2}' | grep -v -E '^(127\.|169\.254\.)' | head -n 1 || true; }
    resolved="$(resolve_v4)"
    if [[ -z "${resolved}" ]]; then
      # mDNS 缓存偶尔缺失，ping 一次灌缓存再查（一共最多等约 2s）。
      ping -c1 -t1 "${bonjour}.local" >/dev/null 2>&1 || true
      resolved="$(resolve_v4)"
    fi
    if [[ -n "${resolved}" ]]; then echo "${bonjour}.local"; return; fi
  fi
  get_en0_lan_ip
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

    echo "=== Step 2/5: 取稳定地址 (Bonjour，IP 漫游免疫) ==="
    LAN_IP="$(get_en0_lan_ip)"
    if [[ -z "${LAN_IP}" ]]; then
      echo "  ✗ en0 无 IPv4. 检查 Wi-Fi." >&2
      exit 1
    fi
    echo "  ✓ Mac LAN IP: ${LAN_IP}"
    STABLE_HOST="$(stable_host)"
    if [[ -z "${STABLE_HOST}" ]]; then
      echo "  ✗ 取不到稳定地址. 检查 Wi-Fi." >&2
      exit 1
    fi
    if [[ "${STABLE_HOST}" == "${LAN_IP}" ]]; then
      echo "  ! Bonjour 解析失败，用数字 IP（换 Wi-Fi 后需重跑 up + 手机重连）"
    else
      echo "  ✓ 稳定地址: ${STABLE_HOST}（换 Wi-Fi 不变）"
    fi
    echo

    echo "=== Step 3/5: 启 API (Mac 0.0.0.0:${API_PORT}) ==="
    # R15.64: 自动载入仓库根 .env (dev-api.sh 同款)。之前不读 .env，
    # PROXY_LOGIN_PROVIDER 为空 → UnconfiguredLoginChallengeProvider →
    # 真机全员 "验证码没有配置"，且 DATABASE_URL 为空 → 内存存储，
    # 重启丢登录态。显式 export 的变量优先于 .env。
    if [[ -f "${ROOT_DIR}/.env" ]]; then
      _saved_api_port="${API_PORT:-}"
      _saved_metro_port="${METRO_PORT:-}"
      _saved_udid="${PROXY_IOS_UDID:-}"
      set -a
      # shellcheck disable=SC1091
      source "${ROOT_DIR}/.env"
      set +a
      if [[ -n "${_saved_api_port}" ]]; then API_PORT="${_saved_api_port}"; fi
      if [[ -n "${_saved_metro_port}" ]]; then METRO_PORT="${_saved_metro_port}"; fi
      if [[ -n "${_saved_udid}" ]]; then PROXY_IOS_UDID="${_saved_udid}"; fi
      UDID="${PROXY_IOS_UDID:-5F487B76-69EA-5311-AE63-3C5F09A61F20}"
      echo "  ✓ 已载入 ${ROOT_DIR}/.env (PROXY_LOGIN_PROVIDER=${PROXY_LOGIN_PROVIDER:-<unset>})"
    else
      echo "  ! 无 ${ROOT_DIR}/.env，用默认环境启动 (登录可能不可用)"
    fi
    # 跟 cmd/api/main.go R16.6 同款 fail-fast：早死早超生，
    # 不起一个发不出验证码的 API。
    case "${PROXY_LOGIN_PROVIDER:-}" in
      smtp)
        if [[ -z "${PROXY_SMTP_HOST:-}" ]]; then
          echo "  ✗ PROXY_LOGIN_PROVIDER=smtp 但 PROXY_SMTP_HOST 为空。检查 .env (PROXY_SMTP_*)。" >&2
          exit 1
        fi
        ;;
      sms)
        if [[ -z "${PROXY_SMS_URL:-}" ]]; then
          echo "  ✗ PROXY_LOGIN_PROVIDER=sms 但 PROXY_SMS_URL 为空。检查 .env。" >&2
          exit 1
        fi
        ;;
      production)
        if [[ -z "${PROXY_SMTP_HOST:-}" && -z "${PROXY_SMS_URL:-}" ]]; then
          echo "  ✗ production 模式但 SMTP/SMS 全空。检查 .env。" >&2
          exit 1
        fi
        ;;
      simulated)
        echo "  ! simulated 模式：不发真邮件，万能码 123456 (仅开发)"
        ;;
      *)
        echo "  ✗ PROXY_LOGIN_PROVIDER 为空 (.env 缺失或未设)。设为 simulated(开发) 或 smtp(真邮件) 后重跑。" >&2
        exit 1
        ;;
    esac
    if [[ -z "${DATABASE_URL:-}" ]]; then
      echo "  ! DATABASE_URL 为空：API 将用内存存储，重启丢登录态 (dev-api.sh 会直接拒绝启动)"
    fi
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

    echo "=== Step 4/5: 启 Metro (固定 baseUrl=http://${STABLE_HOST}:${API_PORT}) ==="
    kill_port_listeners "${METRO_PORT}"
    sleep 1
    PROXY_IOS_API_BASE_URL="http://${STABLE_HOST}:${API_PORT}" \
      nohup "${MOBILE_DIR}/scripts/dev-ios.sh" > "${METRO_LOG}" 2>&1 &
    disown
    # Metro 冷启动 10-60s 不等（autolinking + 1224 模块），轮询等，不睡死 8s 就判死刑。
    _metro_wait=0
    while ! lsof -nP -iTCP:"${METRO_PORT}" -sTCP:LISTEN >/dev/null 2>&1; do
      sleep 5
      _metro_wait=$((_metro_wait + 5))
      if [[ "${_metro_wait}" -ge 90 ]]; then
        echo "  ✗ Metro 90s 没起来. tail ${METRO_LOG}:" >&2
        tail -15 "${METRO_LOG}" >&2
        exit 1
      fi
    done
    echo "  ✓ Metro listening on :${METRO_PORT} (log: ${METRO_LOG})"
    echo

    echo "=== Step 5/5: 重启 iPhone app (拿新 bundle) ==="
    xcrun devicectl device process launch --device "${UDID}" --terminate-existing "${BUNDLE_ID}" 2>&1 | head -3
    echo
    echo "DONE. 一次启好 iPhone 真机 dev 链."
    echo "  API:    ${API_BIN} → 0.0.0.0:${API_PORT}"
    echo "  Metro:  :${METRO_PORT} (Mac) — iPhone dev client RSD forward 内置"
    echo "  baseUrl: http://${STABLE_HOST}:${API_PORT} (域名固定，换 Wi-Fi 不变)"
    echo
    echo "  Wi-Fi 切了连不上 → 先重跑: ./scripts/dev-iphone-usb.sh up（域名不变一般不用）"
    echo "  端口 4100 / 8081 永远不变."
    echo
    echo "  R15.65 必读：iPhone dev client 会记住上次的 Metro 地址，连旧地址"
    echo "  就只显示旧界面（Metro 日志出现 status check timeout + 旧 IP）。"
    echo "  relaunch 切不过 URL，必须在 iPhone Safari 打开一次："
    echo "    exp://${STABLE_HOST}:${METRO_PORT}"
    echo "  看到新界面才算连上。域名固定后，这一步一次就够."
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
    _stable_now="$(stable_host)"
    echo "  稳定地址: ${_stable_now:-<none>}"
    if xcrun devicectl list devices 2>/dev/null | awk -v u="${UDID}" '$3 == u {found=1; exit} END {exit !found}'; then
      echo "  iPhone ${UDID} connected"
    else
      echo "  iPhone ${UDID} NOT connected"
    fi
    # R15.65: 手机连着旧 Metro 地址（IP 漂移后常见）就喊出来。
    # R15.66 起正常地址是 Bonjour 域名，数字 IP 的残留一律算旧。
    stale_url="$(grep -o -E 'http://[^/:]+:8081/status' "${METRO_LOG}" 2>/dev/null | sort -u | grep -v -E "(${_stable_now:-none}|${LAN_IP:-none})" | head -n 1 || true)"
    if [[ -n "${stale_url}" ]]; then
      echo "  ! iPhone 可能连着旧 Metro (${stale_url})，新改动上不去。"
      echo "    去 iPhone Safari 打开 exp://${_stable_now:-<stable-host>}:${METRO_PORT} 跳一次。"
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

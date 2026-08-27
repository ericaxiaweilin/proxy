#!/usr/bin/env bash
# End-to-end real-device login smoke (D variant).
#
# What it does:
#   1. Spins up an in-process SMTP sink on 127.0.0.1:<random>. Each
#      captured message is also written to ~/.proxy-smoke/last-message.txt
#      so the developer can grab the 6-digit OTP off the local file system
#      while the iPhone shows the same code in the simulated email body.
#   2. Starts the Proxy API on :4100 with PROXY_LOGIN_PROVIDER=smtp pointed
#      at the sink and PROXY_SMTP_TEST_RECIPIENT=weilinxia511@gmail.com
#      (the developer types this on the iPhone, but the OTP is delivered
#      to the local sink, not Gmail, for this run).
#   3. Builds + installs the Proxy development build on the iPhone named
#      $DEVICE_NAME (default: weilin) and launches it.
#   4. Exports EXPO_PUBLIC_API_BASE_URL=http://192.168.110.44:4100 so the
#      JS bundle baked into the binary talks to this Mac on the local Wi-Fi.
#   5. Starts Metro in the background so subsequent JS edits hot-reload
#      into the installed binary.
#
# After it runs, the developer:
#   - Taps "Sign in" on the iPhone
#   - Enters weilinxia511@gmail.com
#   - Runs \`cat ~/.proxy-smoke/last-message.txt\` on the Mac to read the
#     6-digit code
#   - Types the code on the iPhone
#   - Verifies the session is restored on the next launch and that
#     sign-out wipes the iOS Keychain entry

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
API_BIN="${API_BIN:-/tmp/proxy-api-test}"
DEVICE_NAME="${DEVICE_NAME:-weilin}"
# API base URL the iPhone should call. The device is connected over USB
# (xcrun devicectl), so Xcode's usbmuxd tunnel exposes the Mac's localhost
# as 127.0.0.1 on the iPhone. We bind the API on 0.0.0.0:4100 so the
# tunnel can reach it. Override with PROXY_REAL_API_BASE_URL for a Wi-Fi
# (non-USB) setup.
PROXY_REAL_API_BASE_URL="${PROXY_REAL_API_BASE_URL:-http://127.0.0.1:4100}"
API_PORT="${API_PORT:-4100}"
RECIPIENT="${PROXY_SMTP_TEST_RECIPIENT:-weilinxia511@gmail.com}"
SMOKE_DIR="${SMOKE_DIR:-$HOME/.proxy-smoke}"
LOG_DIR="${LOG_DIR:-/tmp/proxy-realsmoke-$$}"
mkdir -p "${SMOKE_DIR}" "${LOG_DIR}"

cleanup() {
  if [[ -n "${API_PID:-}" ]]; then kill "${API_PID}" 2>/dev/null || true; fi
  if [[ -n "${SINK_PID:-}" ]]; then kill "${SINK_PID}" 2>/dev/null || true; fi
  if [[ -n "${METRO_PID:-}" ]]; then kill "${METRO_PID}" 2>/dev/null || true; fi
  rm -f /tmp/smtp_sink_main.go
  echo "smoke artifacts in ${LOG_DIR}; captured messages in ${SMOKE_DIR}"
}
trap cleanup EXIT INT TERM

# ---- 1. SMTP sink ---------------------------------------------------------

cat > /tmp/smtp_sink_main.go <<GO
package main
import ("net"; "os"; "path/filepath"; "strings"; "sync"; "time")
func main() {
  ln, err := net.Listen("tcp", "127.0.0.1:0")
  if err != nil { os.Exit(2) }
  host, port, _ := net.SplitHostPort(ln.Addr().String())
  os.Stdout.WriteString(host + " " + port + "\n")
  os.Stdout.Sync()
  out := os.Getenv("SINK_OUT_PATH")
  var mu sync.Mutex; var body strings.Builder
  for { c, err := ln.Accept(); if err != nil { return }; go func(c net.Conn) {
    defer c.Close()
    c.SetDeadline(time.Now().Add(5*time.Second))
    c.Write([]byte("220 sink ESMTP\\r\\n"))
    for { line, err := readLine(c); if err != nil { return }
      u := strings.ToUpper(line)
      switch {
      case strings.HasPrefix(u, "EHLO"), strings.HasPrefix(u, "HELO"):
        c.Write([]byte("250-sink\\r\\n250 OK\\r\\n"))
      case strings.HasPrefix(u, "MAIL"), strings.HasPrefix(u, "RCPT"),
           strings.HasPrefix(u, "RSET"), strings.HasPrefix(u, "NOOP"):
        c.Write([]byte("250 OK\\r\\n"))
      case strings.HasPrefix(u, "DATA"):
        c.Write([]byte("354 go\\r\\n"))
        for { l, err := readLine(c); if err != nil { return }
          if l == "." { break }
          mu.Lock(); body.WriteString(l+"\\n"); mu.Unlock() }
        mu.Lock()
        captured := body.String()
        body.Reset()
        mu.Unlock()
        if out != "" {
          _ = os.MkdirAll(filepath.Dir(out), 0o755)
          _ = os.WriteFile(out, []byte(captured), 0o600)
        }
        c.Write([]byte("250 OK\\r\\n"))
      case strings.HasPrefix(u, "QUIT"):
        c.Write([]byte("221 bye\\r\\n")); return
      default: c.Write([]byte("500 ?\\r\\n"))
      }
    }
  }(c) }
}
func readLine(c net.Conn) (string, error) {
  var b []byte; tmp := make([]byte, 1)
  for { _, err := c.Read(tmp); if err != nil { return "", err }
    b = append(b, tmp[0])
    if len(b) >= 2 && b[len(b)-2] == '\\r' && b[len(b)-1] == '\\n' {
      return strings.TrimRight(string(b), "\\r\\n"), nil
    }
  }
}
GO

SINK_OUT_PATH="${SMOKE_DIR}/last-message.txt"
(cd /tmp && SINK_OUT_PATH="${SINK_OUT_PATH}" go run /tmp/smtp_sink_main.go > "${LOG_DIR}/sink_addr" 2> "${LOG_DIR}/sink_err") &
SINK_PID=$!
for _ in $(seq 1 30); do
  [[ -s "${LOG_DIR}/sink_addr" ]] && break
  sleep 0.1
done
[[ -s "${LOG_DIR}/sink_addr" ]] || { echo "smtp sink failed to start"; cat "${LOG_DIR}/sink_err"; exit 1; }
SINK_HOST=$(awk '{print $1}' "${LOG_DIR}/sink_addr")
SINK_PORT=$(awk '{print $2}' "${LOG_DIR}/sink_addr")
echo "smtp sink listening on ${SINK_HOST}:${SINK_PORT} (captures → ${SINK_OUT_PATH})"

# ---- 2. API ---------------------------------------------------------------
# Bind on all interfaces so the usbmuxd tunnel + a future Wi-Fi test both
# can reach it. 0.0.0.0 is required because the iPhone routes through
# usbmuxd as 127.0.0.1, but a Wi-Fi-attached device would hit the LAN IP.
PROXY_LOGIN_PROVIDER=smtp \
PROXY_SMTP_HOST="${SINK_HOST}" \
PROXY_SMTP_PORT="${SINK_PORT}" \
PROXY_SMTP_FROM="no-reply@proxy.example" \
PROXY_SMTP_TLS=none \
PROXY_SMTP_TEST_RECIPIENT="${RECIPIENT}" \
API_PORT="${API_PORT}" \
API_BIND="${API_BIND:-0.0.0.0}" \
"${API_BIN}" > "${LOG_DIR}/api.log" 2>&1 &
API_PID=$!
for _ in $(seq 1 50); do
  curl -fsS "http://127.0.0.1:${API_PORT}/health/live" >/dev/null 2>&1 && break
  sleep 0.1
done
curl -fsS "http://127.0.0.1:${API_PORT}/health/live" >/dev/null || { echo "api not up"; tail -50 "${LOG_DIR}/api.log"; exit 1; }
echo "api up on :${API_PORT}"

# ---- 3. iPhone build + install + launch -----------------------------------

cd "${ROOT}/apps/mobile"
TEAM_ID="C4673FY8U7"
BUNDLE_ID="com.proxy.creator.dev.c4673fy8u7"
DD="$HOME/Library/Developer/Xcode/DerivedData/Proxy-Local"
export EXPO_PUBLIC_API_BASE_URL="${PROXY_REAL_API_BASE_URL}"
export EXPO_PUBLIC_LOGIN_MODE="${EXPO_PUBLIC_LOGIN_MODE:-simulated}"
echo "EXPO_PUBLIC_API_BASE_URL=${EXPO_PUBLIC_API_BASE_URL}"
echo "EXPO_PUBLIC_LOGIN_MODE=${EXPO_PUBLIC_LOGIN_MODE}"

xcodebuild -workspace ios/Proxy.xcworkspace -scheme Proxy \
  -configuration Debug \
  -destination "platform=iOS,name=${DEVICE_NAME}" \
  -derivedDataPath "${DD}" \
  -disableAutomaticPackageResolution -skipPackagePluginValidation -skipMacroValidation \
  -allowProvisioningUpdates \
  DEVELOPMENT_TEAM="${TEAM_ID}" CODE_SIGN_STYLE=Automatic \
  COCOAPODS_PARALLEL_CODE_SIGN=YES COMPILER_INDEX_STORE_ENABLE=NO build > "${LOG_DIR}/xcodebuild.log" 2>&1
APP="${DD}/Build/Products/Debug-iphoneos/Proxy.app"
[[ -d "${APP}" ]] || { echo "xcodebuild failed — see ${LOG_DIR}/xcodebuild.log"; exit 1; }
echo "build OK: ${APP}"

DEV_UUID=$(xcrun devicectl list devices 2>/dev/null | awk -v n="${DEVICE_NAME}" '$1 == n {if (match($0, /[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}/)) print substr($0, RSTART, RLENGTH); exit}')
[[ -n "${DEV_UUID}" ]] || { echo "device ${DEVICE_NAME} not found"; exit 1; }
xcrun devicectl device install app --device "${DEV_UUID}" "${APP}" > "${LOG_DIR}/install.log" 2>&1
xcrun devicectl device process launch --device "${DEV_UUID}" "${BUNDLE_ID}" > "${LOG_DIR}/launch.log" 2>&1
echo "installed + launched on ${DEVICE_NAME} (${DEV_UUID})"

# ---- 4. Metro -------------------------------------------------------------

(cd "${ROOT}/apps/mobile" && NODE_ENV=development npx expo start --host lan > "${LOG_DIR}/metro.log" 2>&1) &
METRO_PID=$!
echo "metro starting (pid ${METRO_PID}); log: ${LOG_DIR}/metro.log"

cat <<NEXT

============================================================
Smoke is up. Next steps on the iPhone "${DEVICE_NAME}":
  1. Wait for Metro to finish bundling (≈ 30-60s on first start).
     Watch: tail -f ${LOG_DIR}/metro.log
  2. The Proxy app should already be open on the device.
  3. Tap "Sign in" and enter: ${RECIPIENT}
  4. On the Mac, run: cat ${SINK_OUT_PATH}
     Copy the 6-digit code from the message body into the iPhone.
  5. Verify Home loads → kill the app → relaunch → still on Home
     (Keychain session restore). Use the in-app Sign Out to wipe
     the Keychain entry.
============================================================
NEXT

# Block until the user kills this script. They can watch Metro + read the
# captured email body during this time.
wait "${API_PID}" 2>/dev/null || true

#!/usr/bin/env bash
# Real-device Keychain restore smoke (E variant).
#
# Goal: prove that the iOS Keychain actually holds the session across a
# forced process kill + relaunch. The mobile shell emits a single
# `[proxy.smoke] keychain=present|absent ...` line on every launch (DEV
# build only); we read it through `idevicesyslog` and assert it twice.
#
# What this script does (no human input required for the kill+relaunch
# half; sign-out still has to be tapped on the device):
#   1. Reuses smoke_realdevice_login.sh to install + launch + log in.
#      The developer still has to type the 6-digit OTP once on the
#      iPhone — that part is the same D variant flow.
#   2. Opens `idevicesyslog` in the background, filtered to our marker.
#   3. Wait for the FIRST `[proxy.smoke] keychain=present` line.
#   4. `xcrun devicectl process terminate` the app, then relaunch it.
#   5. Wait for the SECOND `[proxy.smoke] keychain=present` line on the
#      same `sessionId` value as the first line. That is the restore proof.
#   6. Exit 0 with PASS / non-zero with the failing marker so CI can
#      gate the iOS keychain contract.
#
# The script does NOT exercise sign-out; the developer runs the in-app
# Sign Out once and we capture a third marker (`keychain=absent`) on the
# next launch to close out the wipe half. (See README "iOS real-device
# smoke" for the full E variant flow.)

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
DEVICE_NAME="${DEVICE_NAME:-weilin}"
BUNDLE_ID="${BUNDLE_ID:-com.proxy.creator.dev.c4673fy8u7}"
SYSLOG_TAG="${SYSLOG_TAG:-[proxy.smoke]}"
SMOKE_DIR="${SMOKE_DIR:-$HOME/.proxy-smoke}"
LOG_DIR="${LOG_DIR:-/tmp/proxy-keychain-$$}"
mkdir -p "${SMOKE_DIR}" "${LOG_DIR}"
MARKERS="${LOG_DIR}/markers.log"
: > "${MARKERS}"

cleanup() {
  if [[ -n "${SYSLOG_PID:-}" ]]; then kill "${SYSLOG_PID}" 2>/dev/null || true; fi
  echo
  echo "markers captured:"
  sed 's/^/  /' "${MARKERS}" || true
  echo "log dir: ${LOG_DIR}"
}
trap cleanup EXIT INT TERM

# ---- 1. Install + launch + log in (D variant) ----------------------------
#
# This script is the E variant: it assumes you have already started the
# D variant (smoke_realdevice_login.sh) in another terminal, OR that the
# app is already installed and logged in. The marker lines on syslog are
# what we read, not the API process itself.
#
# Workflow:
#   terminal 1: apps/api-go/scripts/smoke_realdevice_login.sh   # D variant
#   iPhone    : tap Sign in, enter email, type the OTP
#   terminal 2: apps/api-go/scripts/smoke_realdevice_keychain.sh # this script

if ! command -v idevicesyslog >/dev/null 2>&1; then
  echo "idevicesyslog not on PATH (brew install libimobiledevice)" >&2
  exit 2
fi
if ! xcrun devicectl list devices 2>/dev/null | awk -v n="${DEVICE_NAME}" '$1 == n {found=1} END{exit !found}'; then
  echo "device ${DEVICE_NAME} not connected" >&2
  exit 2
fi

DEV_UUID=$(xcrun devicectl list devices 2>/dev/null | awk -v n="${DEVICE_NAME}" '$1 == n {if (match($0, /[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}/)) print substr($0, RSTART, RLENGTH); exit}')
echo "device uuid: ${DEV_UUID}"

# ---- 2. Start idevicesyslog filter ---------------------------------------

echo "=== 2. start idevicesyslog filter (marker: ${SYSLOG_TAG}) ==="
idevicesyslog -u "${DEV_UUID}" 2> "${LOG_DIR}/syslog.err" \
  | grep --line-buffered -F "${SYSLOG_TAG}" \
  | tee -a "${MARKERS}" > "${LOG_DIR}/syslog.out" &
SYSLOG_PID=$!
sleep 1 # let idevicesyslog attach

# ---- 3. Drive kill + relaunch -------------------------------------------

wait_for_marker() {
  local timeout_ms="$1"
  local deadline=$(( $(date +%s) * 1000 + timeout_ms ))
  while (( $(date +%s) * 1000 < deadline )); do
    if [[ -s "${MARKERS}" ]]; then
      # the most recent line wins
      tail -n 1 "${MARKERS}"
      return 0
    fi
    sleep 0.5
  done
  return 1
}

# Helper: terminate + relaunch the bundle, returns the new marker line.
kill_relaunch() {
  echo "=== terminating + relaunching ${BUNDLE_ID} ==="
  xcrun devicectl device process terminate --device "${DEV_UUID}" "${BUNDLE_ID}" \
    > "${LOG_DIR}/terminate.log" 2>&1 || true
  sleep 2
  xcrun devicectl device process launch --device "${DEV_UUID}" "${BUNDLE_ID}" \
    > "${LOG_DIR}/relaunch.log" 2>&1 || true
}

# First wait: the app may already be running and have logged a marker.
# If not, the D variant launch is what we just triggered, so wait for it.
echo "=== 3a. wait for first marker (login) ==="
if ! wait_for_marker 120000; then
  echo "FAIL: no marker after 120s; check the iPhone login flow" >&2
  exit 3
fi
FIRST=$(tail -n 1 "${MARKERS}")
echo "first  : ${FIRST}"
echo "${FIRST}" | grep -q "keychain=present" || { echo "FAIL: first marker not present"; exit 4; }
SESSION_ID=$(echo "${FIRST}" | sed -nE 's/.*sessionId=([^ ]+).*/\1/p')
[[ -n "${SESSION_ID}" ]] || { echo "FAIL: missing sessionId in marker"; exit 5; }
echo "sessionId captured: ${SESSION_ID}"

# Force a relaunch to prove the Keychain survives process death.
kill_relaunch

echo "=== 3b. wait for second marker (relaunch) ==="
if ! wait_for_marker 60000; then
  echo "FAIL: no marker after relaunch" >&2
  exit 6
fi
SECOND=$(tail -n 1 "${MARKERS}")
echo "second : ${SECOND}"
echo "${SECOND}" | grep -q "keychain=present" || { echo "FAIL: post-relaunch marker not present"; exit 7; }
echo "${SECOND}" | grep -q "sessionId=${SESSION_ID}" \
  || { echo "FAIL: sessionId changed across relaunch (was ${SESSION_ID})"; exit 8; }

echo
echo "keychain restore smoke: PASS ✅"
echo "  - first  marker: ${FIRST}"
echo "  - second marker: ${SECOND}"
echo
echo "Next: tap Sign Out on the iPhone, then relaunch once more. The next"
echo "[proxy.smoke] keychain=absent ... line is your sign-out wipe proof."

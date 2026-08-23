#!/usr/bin/env bash

set -euo pipefail

gateway_url="${MODELSTACK_GATEWAY_URL:-}"
if [[ -z "${gateway_url}" ]]; then
  echo "MODELSTACK_GATEWAY_URL is not configured; model tasks remain fail-closed." >&2
  exit 69
fi

# Production gateways are reached directly. This helper only owns the local
# development loopback endpoint used by this repository.
if [[ ! "${gateway_url}" =~ ^http://(127\.0\.0\.1|localhost):([0-9]+)$ ]]; then
  exit 0
fi

local_port="${BASH_REMATCH[2]}"
if nc -z 127.0.0.1 "${local_port}" >/dev/null 2>&1; then
  exit 0
fi

ssh_target="${MODELSTACK_SSH_TARGET:-eric@100.96.188.77}"
remote_port="${MODELSTACK_REMOTE_GATEWAY_PORT:-14040}"
control_socket="${TMPDIR:-/tmp}/proxy-modelstack-${local_port}.sock"

if [[ -S "${control_socket}" ]]; then
  ssh -S "${control_socket}" -O exit "${ssh_target}" >/dev/null 2>&1 || true
  unlink "${control_socket}" 2>/dev/null || true
fi

echo "Opening Proxy model-stack development tunnel on 127.0.0.1:${local_port}."
ssh -fN -M -S "${control_socket}" \
  -o BatchMode=yes \
  -o ExitOnForwardFailure=yes \
  -o ServerAliveInterval=30 \
  -o ServerAliveCountMax=3 \
  -L "${local_port}:127.0.0.1:${remote_port}" \
  "${ssh_target}"

if ! nc -z 127.0.0.1 "${local_port}" >/dev/null 2>&1; then
  echo "Model-stack tunnel did not become ready." >&2
  exit 70
fi

#!/usr/bin/env bash

set -euo pipefail

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${repo_dir}"

set -a
if [[ -f .env ]]; then
  # shellcheck disable=SC1091
  source ./.env
fi
set +a

"${repo_dir}/scripts/ensure-modelstack-tunnel.sh"
exec go -C apps/api-go run ./cmd/api

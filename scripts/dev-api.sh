#!/usr/bin/env bash

set -euo pipefail

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${repo_dir}"

set -a
export NO_PROXY="127.0.0.1,localhost,0.0.0.0,::1"
unset http_proxy https_proxy HTTP_PROXY HTTPS_PROXY ALL_PROXY
if [[ -f .env ]]; then
  # shellcheck disable=SC1091
  source ./.env
fi
set +a

# The mobile app relies on persisted identities and refresh tokens. Starting the
# developer API with the in-memory identity repository makes a successful login
# disappear on the next API restart, while the UI still shows a remembered
# account. Fail loudly instead of creating that misleading, unrecoverable state.
if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "DATABASE_URL is required by scripts/dev-api.sh; refusing to start with ephemeral identity/session storage." >&2
  exit 1
fi

if [[ "${MODELSTACK_USE_PI_CONFIG:-}" == "true" ]]; then
  echo "model-stack: using Pi provider registry; SSH gateway tunnel skipped"
elif ! "${repo_dir}/scripts/ensure-modelstack-tunnel.sh"; then
  echo "Model-stack tunnel is unavailable; starting the API with model tasks fail-closed." >&2
fi
exec go -C apps/api-go run ./cmd/api

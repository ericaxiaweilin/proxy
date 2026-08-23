#!/usr/bin/env bash

set -euo pipefail

if (( $# > 0 )); then
  proxy_changed_paths=("$@")
else
  proxy_changed_paths=()
  while IFS= read -r proxy_path; do
    [[ -n "${proxy_path}" ]] && proxy_changed_paths+=("${proxy_path}")
  done < <(git diff --name-only --diff-filter=ACMR HEAD; git ls-files --others --exclude-standard)
fi

proxy_scope="SERVER_UI"
proxy_reason="Only server manifests, data, or documentation changed; no app update is required."

for proxy_path in "${proxy_changed_paths[@]}"; do
  case "${proxy_path}" in
    apps/mobile/android/*|apps/mobile/ios/*|apps/mobile/app.json|apps/mobile/package.json|pnpm-lock.yaml|apps/mobile/assets/*)
      proxy_scope="NATIVE"
      proxy_reason="A native project, dependency, app config, or bundled asset changed; rebuild the platform shell once."
      break
      ;;
    apps/mobile/src/*|packages/contracts/*)
      if [[ "${proxy_scope}" != "NATIVE" ]]; then
        proxy_scope="JS"
        proxy_reason="Mobile JavaScript or a shared renderer contract changed; use Metro in development and OTA in production."
      fi
      ;;
  esac
done

printf '%s\n%s\n' "${proxy_scope}" "${proxy_reason}"

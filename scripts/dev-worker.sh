#!/usr/bin/env bash
# 本机的 outbox / 媒体处理 worker —— 与 scripts/dev-api.sh 同一条基线路径。
#
# 为什么以前没有这个文件：api 有 LaunchAgent（com.user.kake-dev-api），worker 什么都没有，
# 于是"媒体处理在本机从来不跑"变成了事实基线 —— media 表里几百行 UPLOADING 就是它的
# 证据。后果不是"少个后台进程"：图片/视频派生永远不发生，上传的东西扫不到变体，
# 而这条路径在 CI 和单测里都是绿的（单测用内存仓储，不碰真 ffmpeg）。
# 2026-10-03 容器化部署第一次把这条链跑通之后，本机反而成了唯一没 worker 的环境，
# 所以入口补在这里：一条命令、一个 LaunchAgent，和 api 一样。
#
# 用法：
#   scripts/dev-worker.sh                 # 前台跑（launchd 也是这么调的）
# 手工起不要 exec 这条脚本之外的东西 —— 第二条启动路径就是下一个"到底谁在跑"。
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

# 和 dev-api.sh 同一条拒绝理由：worker 处理的是**库里已有的**行，没有真库时它会把
# 事件投进内存仓储然后原地消失 —— 看起来跑通了，其实什么都没发生。
if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "DATABASE_URL is required by scripts/dev-worker.sh; refusing to run against ephemeral storage." >&2
  exit 1
fi

exec go -C apps/api-go run ./cmd/worker

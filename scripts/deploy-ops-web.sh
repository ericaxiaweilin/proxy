#!/usr/bin/env bash
# 运营后台（API + worker + 控制台）部署到服务器栈 ~/proxy-server（Tailscale 内网，非公网）。
# 在 Mac 的仓库根执行：  bash scripts/deploy-ops-web.sh
#
# 做的事（每一步失败即停）：
#   1. 备份：数据库 pg_dump、旧源码目录、旧镜像打 rollback 标签；
#   2. 本机 build 控制台 dist（服务器不跑 npm，见 apps/market-intelligence-console/Dockerfile）；
#   3. rsync 源码 / dist / compose 到服务器；
#   4. docker compose up -d --build api worker console（API 启动时自动应用新迁移）；
#   5. 等 /health/ready，核对迁移已到最新，新路由对未登录返回 401（不是 404）。
# 回滚：docker tag proxy-server-api:rollback-<日期> proxy-server-api:local && compose up -d api worker；
#       库用 ~/backups/proxy-pre-deploy-<日期>.sql.gz 恢复（新迁移是只增不改，回滚代码一般不需要回滚库）。
set -euo pipefail
HOST="${DEPLOY_HOST:-eric@100.96.188.77}"
DAY="$(date +%Y%m%d)"
cd "$(git rev-parse --show-toplevel)"
[ -z "$(git status --porcelain -- apps infrastructure)" ] || { echo "工作区有未提交改动，先提交再部署" >&2; exit 1; }

echo "== 1/5 备份"
ssh "$HOST" "mkdir -p ~/backups && docker exec proxy-server-postgres-1 pg_dump -U proxy proxy | gzip > ~/backups/proxy-pre-deploy-$DAY.sql.gz \
  && rm -rf ~/proxy-server/apps/api-go.bak-$DAY && cp -a ~/proxy-server/apps/api-go ~/proxy-server/apps/api-go.bak-$DAY \
  && docker tag proxy-server-api:local proxy-server-api:rollback-$DAY && docker tag proxy-console:local proxy-console:rollback-$DAY"

echo "== 2/5 build 控制台"
(cd apps/market-intelligence-console && npx tsc --noEmit && npx vite build)

echo "== 3/5 同步"
rsync -a --delete --exclude '/api' --exclude '/worker' apps/api-go/ "$HOST:proxy-server/apps/api-go/"
rsync -a --delete apps/market-intelligence-console/dist/ "$HOST:proxy-server/apps/market-intelligence-console/dist/"
rsync -a apps/market-intelligence-console/Dockerfile apps/market-intelligence-console/nginx.conf "$HOST:proxy-server/apps/market-intelligence-console/"
rsync -a infrastructure/server/docker-compose.yml infrastructure/server/Dockerfile "$HOST:proxy-server/infrastructure/server/"

echo "== 4/5 构建并重启"
ssh "$HOST" "cd ~/proxy-server/infrastructure/server && docker compose --env-file .env up -d --build api worker console"

echo "== 5/5 验证"
ssh "$HOST" 'for i in $(seq 1 60); do curl -fsS http://100.96.188.77:4100/health/ready >/dev/null 2>&1 && break; sleep 3; done; \
  curl -fsS http://100.96.188.77:4100/health/ready; echo; \
  docker exec proxy-server-postgres-1 psql -U proxy -d proxy -At -c "select max(version) from schema_migrations"; \
  for p in moderation appeals authority-requests restrictions demand-gap insights match-preview providers tags; do \
    printf "%-20s %s\n" $p "$(curl -s -o /dev/null -w %{http_code} http://100.96.188.77:4100/v1/operator/$p)"; done; \
  docker logs --tail 5 proxy-server-worker-1 2>&1 | cut -c1-160'
echo "完成。控制台： http://100.96.188.77:5175"

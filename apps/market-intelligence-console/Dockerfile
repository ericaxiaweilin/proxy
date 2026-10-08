# 撮合引擎 / 市场情报控制台的容器。
#
# ⚠️ 这里**只端静态产物**，不在容器里 build。原因不是图快：
# 这个 app 没有 lockfile（仓库里没有 package-lock.json），服务器上 npm install
# 会按 semver 解析到不同的 vite / react 次版本 —— 同一份源码在两台机器上
# 构建出不同的东西，而「控制台里摆的数」是要跟引擎对账的，产物不可复现
# 就等于账本不可复现。所以 dist 在开发机上 build 好（npx vite build）再同步过来。
#
# 重建：开发机 `npx vite build` → rsync dist → `docker compose up -d --build console`
FROM nginx:alpine
COPY dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

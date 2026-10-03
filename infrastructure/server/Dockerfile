# syntax=docker/dockerfile:1
#
# 后端运行时镜像。构建上下文是 apps/api-go（它是独立的 Go module），不是整个仓库：
# apps/mobile + docs 有 ~2.2G，放进上下文只会让每次 build 重新上传。
#   docker compose -f infrastructure/server/docker-compose.yml build
#
# 两阶段：builder 里编译（需要网络拉 Go module，产物缓存挂 volume 复用），
# 运行阶段只留静态二进制 + migrations + ffmpeg。
FROM golang:1.26-alpine AS build

WORKDIR /src

# go.mod 先拷：只有依赖不变时 layer 缓存就命中，改代码不必重下 module。
COPY go.mod go.sum ./
RUN --mount=type=cache,target=/go/pkg/mod go mod download

COPY . .

# 四个都是后端进程：api 是 HTTP 入口，worker 跑 outbox/媒体投影，migrate 供人工核对
# schema，media-audit 是「库里说 READY、盘上有没有字节」的巡检。
RUN --mount=type=cache,target=/go/pkg/mod \
    --mount=type=cache,target=/root/.cache/go-build \
    for c in api worker migrate media-audit; do \
      CGO_ENABLED=0 go build -trimpath -o "/out/$c" "./cmd/$c" || exit 1; \
    done

FROM alpine:3.20

# ffmpeg/ffprobe：internal/media 的标准化链（探测元数据 → H.264+AAC faststart →
# 缩略图 → 水印）直接 exec 这两个二进制，缺了媒体处理会静默失败成 FAILED 资产。
RUN apk add --no-cache ca-certificates tzdata ffmpeg

# 不用 root 跑：容器被攻破时写不到宿主挂载卷之外。
RUN addgroup -S app && adduser -S -G app -u 10001 app

COPY --from=build /out/ /usr/local/bin/
# PROXY_MIGRATIONS_DIR 指向这里；cmd/api 启动时自动 apply（R15.22）。
COPY --from=build /src/migrations /opt/proxy/migrations

# 媒体原件/变体的落盘目录（PROXY_MEDIA_STORE_DIR），compose 里挂 volume。
RUN mkdir -p /var/lib/proxy/media && chown -R app:app /var/lib/proxy
VOLUME /var/lib/proxy/media

USER app
ENV API_HOST=0.0.0.0 \
    API_PORT=4100 \
    PROXY_MIGRATIONS_DIR=/opt/proxy/migrations \
    PROXY_MEDIA_STORE_DIR=/var/lib/proxy/media
EXPOSE 4100

# 镜像本身既是 api 也是 worker：command 由 compose 指定，避免两份几乎一样的 Dockerfile。
#
# 这里必须是 CMD 而不是 ENTRYPOINT —— compose 的 `command:` 是**追加给 ENTRYPOINT 的参数**，
# 只有没有 ENTRYPOINT 时才作为 argv[0] 生效。写成 ENTRYPOINT 的实测后果（2026-10-02 服务器
# 首次部署）：worker 容器跑的是 `/usr/local/bin/api /usr/local/bin/worker`，也就是第二个 API
# 实例，而 migrate 容器同样变成 API —— 两个 API 同时对空库 apply migrations，pg_catalog 上
# 撞 23505（pg_namespace/pg_type duplicate key），API 靠 restart 循环「碰巧」收敛成健康。
CMD ["/usr/local/bin/api"]

# 健康检查走 api 自己的探针；worker 容器用同镜像但没 HTTP 口，compose 里单独关掉。
HEALTHCHECK --interval=15s --timeout=3s --start-period=45s \
  CMD wget -qO- "http://127.0.0.1:${API_PORT}/health/ready" >/dev/null || exit 1

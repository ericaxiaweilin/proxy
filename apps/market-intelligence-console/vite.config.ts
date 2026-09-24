import { defineConfig } from "vite";

export default defineConfig({
  server: {
    port: 5174,
    proxy: {
      // 开发 API 在 4100（scripts/dev-api.sh / launchd com.user.kake-dev-api）；原来写的 8080 连不上。
      "/v1": process.env.PROXY_API_URL ?? "http://localhost:4100",
    },
  },
  build: {
    outDir: "dist",
  },
});

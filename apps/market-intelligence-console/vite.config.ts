import { defineConfig } from "vite";

export default defineConfig({
  server: {
    port: 5174,
    proxy: {
      "/v1": "http://localhost:8080",
    },
  },
  build: {
    outDir: "dist",
  },
});

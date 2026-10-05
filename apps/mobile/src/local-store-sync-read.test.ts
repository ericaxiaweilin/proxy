import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// LOCAL-STORE-SYNC-READ-001（2026-10-05）：expo-file-system 57 的 File.json() 返回 Promise。
// 本机存储模块在模块加载时同步读文件，写成 `file.json() as …` 拿到的是一个 Promise ——
// 「当前商家账号」每次重开都回到列表第一个，黑名单每次重开都是空的（下一次拉黑还会拿空名单
// 覆盖写盘）。同步读一律 JSON.parse(file.textSync())；要用 json() 就必须 await。
const root = fileURLToPath(new URL(".", import.meta.url));

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return name === "node_modules" ? [] : sources(full);
    return /\.(ts|tsx)$/.test(name) && !/\.test\./.test(name) ? [full] : [];
  });
}

describe("LOCAL-STORE-SYNC-READ-001", () => {
  it("没有把 File.json()（Promise）当同步结果用的地方", () => {
    const offenders = sources(root).filter((path) => {
      const src = readFileSync(path, "utf8");
      return /(?<!await\s)\bfile\.json\(\)/.test(src);
    });
    expect(offenders).toEqual([]);
  });
  it("商家账号 / 黑名单都同步读文本再解析", () => {
    for (const name of ["active-merchant-store.ts", "blocked-users-store.ts"]) {
      expect(readFileSync(join(root, name), "utf8")).toContain("JSON.parse(file.textSync())");
    }
  });
});

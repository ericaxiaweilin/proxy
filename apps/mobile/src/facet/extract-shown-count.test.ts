import { describe, expect, it } from "vitest";
import { extractShownCount } from "./extract-shown-count";

describe("extractShownCount (R15.50)", () => {
  it("parses '基础 1 条' → 1", () => {
    expect(extractShownCount("基础 1 条")).toBe(1);
  });

  it("parses '已展示 4 条' → 4", () => {
    expect(extractShownCount("已展示 4 条")).toBe(4);
  });

  it("parses '副空间 3 条' → 3 (R15.44 副空间为主场景)", () => {
    expect(extractShownCount("副空间 3 条")).toBe(3);
  });

  it("parses '已展示 0 条' → 0 (边界值)", () => {
    expect(extractShownCount("已展示 0 条")).toBe(0);
  });

  it("parses '本周新增 16 条' → 16 (取第一匹配)", () => {
    expect(extractShownCount("本周新增 16 条")).toBe(16);
  });

  it("returns null for '内容稀缺' (no number)", () => {
    expect(extractShownCount("内容稀缺")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(extractShownCount("")).toBeNull();
  });

  it("returns null for non-numeric ('两条' = Chinese number, regex 不会拆)", () => {
    // 设计: 不解析中文数字, 保持 server 端数字格式一致
    expect(extractShownCount("两条")).toBeNull();
  });

  it("returns null for null/undefined input", () => {
    expect(extractShownCount(null as unknown as string)).toBeNull();
    expect(extractShownCount(undefined as unknown as string)).toBeNull();
  });
});

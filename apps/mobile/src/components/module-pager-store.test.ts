// 规范 §5 rememberPage 语义的单测：内存级、按模块隔离。
import { beforeEach, describe, expect, it } from "vitest";
import { clearLastPage, getLastPage, setLastPage } from "./module-pager-store";

describe("module-pager-store", () => {
  beforeEach(() => clearLastPage());

  it("首次进入无记录 → undefined", () => {
    expect(getLastPage("voucher")).toBeUndefined();
  });

  it("记住停留页，重进恢复", () => {
    setLastPage("voucher", 2);
    expect(getLastPage("voucher")).toBe(2);
  });

  it("按模块隔离", () => {
    setLastPage("voucher", 1);
    setLastPage("tasks", 3);
    expect(getLastPage("voucher")).toBe(1);
    expect(getLastPage("tasks")).toBe(3);
  });

  it("clear 单个 / 全部", () => {
    setLastPage("voucher", 0);
    setLastPage("tasks", 2);
    clearLastPage("voucher");
    expect(getLastPage("voucher")).toBeUndefined();
    expect(getLastPage("tasks")).toBe(2);
    clearLastPage();
    expect(getLastPage("tasks")).toBeUndefined();
  });
});

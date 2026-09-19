import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// MEDIA-ROW-001: 不管几张图都单行铺开，不做二行/网格；旧的 2x2 网格版本
// 会把第 4 张图漏掉（slice(1,3) 只取 2 个，"+N" 角标条件永远假）。
// 注释先剥掉再断言，只认代码。
const source = readFileSync(fileURLToPath(new URL("./threads-post-media.tsx", import.meta.url)), "utf8");
const stripComments = (code: string): string =>
  code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/[^\n]*/g, "$1");
const code = stripComments(source);

describe("MEDIA-ROW-001 post photos always render in a single row", () => {
  it("has no multi-row grid branch left", () => {
    expect(code).not.toContain("manyFirstColumn");
    expect(code).not.toContain("manySecondColumn");
    expect(code).not.toContain("styles.many");
  });

  it("renders every shown item (2/3/4) in one flex row, not a 2-row grid", () => {
    expect(code).toContain("shown.map((item, i) =>");
    expect(code).toContain("styles.row");
  });

  it("attaches the +N overlay to the last rendered cell, not a fixed index that can go unreached", () => {
    expect(code).toContain("i === shown.length - 1");
    expect(code).not.toContain("i === 2 ?");
    expect(code).not.toContain("i === 3 ?");
  });
});

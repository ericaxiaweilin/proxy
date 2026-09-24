import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// TWIN-GALLERY-GRID-001 —— AI 分身图库点「展开」只铺第一行。
// 展开网格之前用 gap + 32.6% 宽度的 wrap 写法，真机上换行失败；
// 跟「我的」主页 photoTile 同一写法（padding 边槽）才铺得开。
// 这里钉住：grid 不用 gap、tile 用 33.333% + padding、图包在 thumbFrame 里。
const gallery = readFileSync(new URL("./components/twin-gallery-section.tsx", import.meta.url), "utf8");

describe("TWIN-GALLERY-GRID-001 expanded wall wraps all rows", () => {
  it("grid uses padding gutters instead of gap", () => {
    expect(gallery).toMatch(/grid:\s*\{[^}]*flexDirection:\s*"row"[^}]*flexWrap:\s*"wrap"[^}]*\}/);
    expect(gallery).not.toMatch(/grid:\s*\{[^}]*gap:/);
  });

  it("grid tiles size like the profile photo wall", () => {
    expect(gallery).toMatch(/gridThumb:\s*\{[^}]*width:\s*"33\.333%"[^}]*\}/);
    expect(gallery).toMatch(/gridThumb:\s*\{[^}]*padding:\s*2[^}]*\}/);
    expect(gallery).not.toContain('width: "32.6%"');
  });

  it("thumbs wrap the image in a frame instead of absolute-filling the tile", () => {
    expect(gallery).toContain("styles.thumbFrame");
    expect(gallery).toContain("styles.thumbImage");
    expect(gallery).not.toContain("StyleSheet.absoluteFill");
  });

  it("expanded branches render every item without slicing", () => {
    expect(gallery).not.toContain(".slice(");
  });
});

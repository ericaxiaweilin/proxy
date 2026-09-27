import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// SPORT-BADMINTON-HEADER-002（2026-09-25，用户：「返回 logo 没做好」）：
// ProxyIcon 的 chevronLeft 画出来是个**带刺的叉**。
//
// 原因：它当时和 close 共用一条分支 —— 两根长 0.62·size 的方条各转 ±45°，
// 但垂直只错开 23% 高度。45° 下要 ~44% 才能首尾相接，于是两条在顶点交叉、
// 左上角戳出一根刺。真机截图放大后非常明显。
//
// ⚠️ 这个字形**在此之前全仓库只有羽毛球那个功能在用**（别处都写 <Text>‹</Text>），
//    而 proxy-icon 一直没有测试文件 —— 所以它坏了很久没人看见。
//    这个文件就是为了补上这个缺口：字形是共享原语，必须有人钉。
//
// 为什么是源码级 tripwire：vitest 这边没有 RN 渲染器，画不出 View 的旋转，
// 所以钉「用哪种画法」，而不是钉「看起来对不对」。看起来对不对只能靠真机截图。
const here = (p: string): string => fileURLToPath(new URL(p, import.meta.url));
const iconRaw = readFileSync(here("./proxy-icon.tsx"), "utf8");

// 剥注释再断言：文件里的注释会解释「为什么不用方条画 chevron」，
// 不剥的话把实现改回去、注释留着，反向臂照样绿。
const stripComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/[^\n]*/g, "$1");
const icon = stripComments(iconRaw);

describe("SPORT-BADMINTON-HEADER-002 返回字形：真描边路径，不是两根方条", () => {
  it("chevronLeft 走 SVG 路径（原型那条），不再用旋转方条拼", () => {
    // 反向臂写在前面：正向臂是「出现了 case "chevronLeft"」——
    // 把实现改回方条分支时正向臂会红，反向臂就永远走不到了。
    expect(icon, "chevronLeft 又走回方条分支了").not.toContain('name === "chevronLeft"');
    expect(icon, "那套会戳刺的方条样式又回来了").not.toContain("chevronLineA");
    expect(icon).not.toContain("chevronLineB");
    expect(icon).toContain('case "chevronLeft":');
    // 原型 .back-btn svg 的 path 原文（viewBox 0 0 24 24）：
    // <path d="M15 18l-6-6 6-6"/> —— 照抄，别自己重画。
    expect(icon).toContain('d="M15 18l-6-6 6-6"');
  });

  it("close 仍走方条分支（它是个 ×，两根条本来就要交叉）", () => {
    // close 没有顶点要接，不存在「顶点戳刺」的问题 —— 别顺手把它一起改掉。
    expect(icon).toContain('if (name === "close") {');
    expect(icon).toContain("styles.closeLineA");
    expect(icon).toContain("styles.closeLineB");
  });
});

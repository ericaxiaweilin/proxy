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

describe("SCENE-HOME-PROTOTYPE-001 场景名片右向 chevron：真字形，不是文本 ›", () => {
  it("chevronRight 是 switch 里的一条真分支，不是不可达的 if", () => {
    // 反向臂在前：`if (name === "chevronRight")` 这种写法**不可达** ——
    // ProxyIcon 先调 MasterModuleIcon，命中 switch 里的同名 case 就提前 return 了。
    expect(icon, "chevronRight 又写成不可达的 if 分支了").not.toContain('if (name === "chevronRight")');
    expect(icon).toContain('case "chevronRight":');
    // chevronLeft 是 `M15 18l-6-6 6-6`，右向是它的镜像（同一套 18 / 6 折点）——
    // 照抄镜像，别自己重画一条粗细对不上的。
    expect(icon).toContain('d="M9 18l6-6-6-6"');
  });

  it('删掉的 heart 死分支不许回来（跟 switch 里的 case "heart" 同名 ⇒ 永远走不到）', () => {
    // 2026-08-22 的「两根圆角方条拼一颗心」写法 + heartLeft / heartRight / heartPoint
    // 三个 style 于 2026-09-28 删除。留着只会误导：我曾照着它推理，把
    // 「heart 不读 filled」写进了别处的注释（其实 MasterModuleIcon 的 case "heart"
    // 早就读 filled）。
    expect(icon, "heart 死分支又回来了").not.toContain('if (name === "heart")');
    expect(icon).not.toContain("heartLeft");
    expect(icon).not.toContain("heartRight");
    expect(icon).not.toContain("heartPoint");
    // 正向：真字形还在（实心 / 描边靠 filled）。
    expect(icon).toContain('case "heart":');
  });
});

// WALLET-GEM-ICON-001（2026-09-30，用户：「我的钱包 钻石UI怎么不是钻石」）。
//
// diamond 画的是 `M12 4 20 12 12 20 4 12z` —— 四个顶点 (12,4)(20,12)(12,20)(4,12)
// 边长全 11.31，是**正方形转 45°**。它有菱形 / 方片的轮廓，但没有钻石的
// 冠部、腰棱、亭部，所以看着不像钻石。原型钱包（Proxy_Wallet_20260929_0a2f07.html:853,886）
// 用的是 💎 emoji。
//
// 修法是**新增 gem 字形**而不是改 diamond：diamond 还被当通用菱形符号复用着
// （tab bar 市场 / 我的订单 / feed 分类兜底 / 城市选项 / 草稿卡片），
// 改它会把那 5 处一起变成宝石 emoji。
describe("WALLET-GEM-ICON-001 宝石字形：钱包用 gem，diamond 保持菱形", () => {
  it("gem 走 💎 emoji 字符通道，且不读 color（彩色宝石被染成纯色块反而更糟）", () => {
    expect(icon, "gem 字形不见了 —— 钱包钻石又变回菱形").toContain('if (name === "gem") {');
    expect(icon).toContain("💎");
    // emoji 自带切面与高光；钱包 hero 是白字蓝底，宝石被 color 染白就是一个色块。
    // gem 分支里不该出现 borderColor / stroke 这类描边属性。
    const gemBranch = icon.slice(icon.indexOf('if (name === "gem") {'));
    const gemBody = gemBranch.slice(0, gemBranch.indexOf("if (name === \"circle\") {"));
    expect(gemBody).not.toContain("borderColor");
    expect(gemBody).not.toContain("borderWidth");
  });

  it("diamond 保持原来的菱形路径（被 tab bar / 我的订单 / feed 兜底等 5 处复用）", () => {
    expect(icon).toContain('case "diamond":');
    expect(icon).toContain('d="M12 4 20 12 12 20 4 12z"');
  });

  it("diamond 那段 View 死实现已删（被 masterIcon 提前 return 遮住，永不执行）", () => {
    // 它和 switch 里那条路径是两个实现，而 MasterModuleIcon 的提前 return 让
    // View 版本永远到不了 —— 留着只会让人照着错误的那份推理。
    expect(icon, "diamond 的死 View 分支又回来了").not.toContain('if (name === "diamond") {');
    expect(icon, "styles.diamond 已无引用，应一并删除").not.toContain("diamond: {");
  });

  it("钱包的钻石资产两处都用 gem，不用 diamond", () => {
    const wallet = stripComments(readFileSync(here("../surfaces/wallet.tsx"), "utf8"));
    expect(wallet, "钱包钻石资产改回 diamond 了 —— 那不是钻石").not.toContain('name="diamond"');
    expect(wallet).toContain('name="gem"');
  });
});

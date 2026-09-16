// 全 App 唯一一处画二维码的地方 —— 圆点模块 + 圆角定位角 + 圆形品牌徽标。
//
// 为什么要自己画，而不是继续用 react-native-qrcode-svg：
// 它把整个矩阵压成**一条** `strokeWidth={cellSize}`、`strokeLinecap='butt'` 的 <Path>，
// 模块只能是方角。圆点样式在它的 props 里根本没有入口。这里自己取矩阵、自己拼 path，
// 整块矩阵仍然只占 **2 个 <Path> 节点**（模块 + 定位角内芯），跟码的密度无关 ——
// 这点很重要，店铺码是 v7（45×45、1054 个深色模块），逐模块画成 <Rect> 的话
// 光一家店就是 1054 个原生节点，而店铺列表是每店一张、常驻挂载。
//
// 编码用 `qrcode`（纯 JS，无原生依赖）取矩阵，只取矩阵 —— 渲染全在这一个文件里。
// 它是 apps/mobile 的**直接依赖**，别再退回成 react-native-qrcode-svg 的传递依赖：
// pnpm 严格布局下那样从 apps/mobile 里解析不到（详见 src/qrcode.d.ts 的说明）。
//
// 关键取舍：**逐模块圆点，不合并同行**。合并同行能把 path 砍掉一半
// （店铺码 114KB → 57KB），高密度码上看不出差别；但低密度码（个人码 v3 放大到 296px）
// 会从圆点变成连条，丢掉参考样式。所以按样式来，代价用 memo 扛。
//
// 可扫性不是拍脑袋：这套几何（点边长 0.87、定位角 0.30、徽标 24%）在 144 个用例上
// 用 CoreImage 解码器逐张验过 —— 3x（真机实际情况）全过；1x 下 88/104px 的小尺寸
// 会失败，但**不带徽标时同样失败**，是极小尺寸下的固有损失，不是徽标造成的。
// **动这里的任何一个常数，就跑 `apps/mobile/scripts/qr-geometry/run.sh`** ——
// 那个目录里的脚本会用真矩阵重渲染 144 个用例并逐张解码，README 记了基线和踩过的坑。

import { memo, useMemo } from "react";
import { Image, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import Svg, { Path, Rect } from "react-native-svg";
import { create as createQr } from "qrcode";
import { toQrPayload } from "../profile-qr";
import { color } from "../theme";

const QR_LOGO = require("../../assets/proxy-qr-logo.png");

/** 模块圆角，单位 = 1 个模块。相对点边长 0.87 约 0.25 —— 圆角方块，不是圆（量出来的）。 */
const DOT_RADIUS = 0.22;
/**
 * 每个点相对模块的缩进（单位 = 模块）。点边长 = 1 - 2 * DOT_INSET = 0.87。
 *
 * 这个数不是拍出来的，是从参考样式图上量出来的：在 29×29（v3）的参考码上，
 * 相邻两个深色模块的**公共边界是纯白**（134 对全白），点宽中位数 42.0px、
 * 缝宽 6.0px，模块 47.97px —— 即点 ≈ 0.876 模块、缝 ≈ 0.125 模块，7:1。
 * 换句话说参考样式里每个点是**分开的小方块**，不是铺满模块的。铺满时相邻点会连成
 * 一坨，密集区就糊了。
 *
 * 代价是墨量少了两成多（点面积 0.958 → 0.715 模块），所以改这个数必须重跑解码验证。
 */
const DOT_INSET = 0.065;
/** 定位角外圈圆角，单位 = 7 个模块。 */
const FINDER_RADIUS = 0.30;
/** 定位角外圈挖空后，内圈要缩多少（单位 = 模块）。 */
const FINDER_HOLE_INSET = 0.55;
/** 定位角 3×3 内芯的圆角，单位 = 3 个模块。参考样式的内芯明显更接近圆。 */
const FINDER_CORE_RADIUS = 0.40;
/** 徽标直径 / 码边长。 */
const LOGO_RATIO = 0.24;
/** 徽标外白圈（静默环）宽度 / 码边长。 */
const LOGO_RING_RATIO = 0.032;

/**
 * 最短的数字形式：0.22 -> ".22"，1.00 -> "1"。path 字符串直接决定了解析开销。
 *
 * 只保留两位小数是故意的：坐标会被量化到 0.01 模块，在最大的那种尺寸下（29 模块铺满
 * 1002px）也只差 0.17px，肉眼和扫码器都看不见；而点宽 0.87 / 缝 0.13 量化后仍在
 * 0.12~0.14，永远不会把相邻两个点粘上。
 */
function fmt(n: number): string {
  const s = n.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
  if (s.startsWith("0.")) return s.slice(1);
  if (s.startsWith("-0.")) return `-${s.slice(2)}`;
  return s;
}

/** 一段圆角矩形子路径。w=h=1、r 固定时，只有 M 的两个坐标在变。 */
function roundedRect(x: number, y: number, w: number, h: number, r: number): string {
  const kx = fmt(w - 2 * r);
  const ky = fmt(h - 2 * r);
  const rr = fmt(r);
  return (
    `M${fmt(x + r)} ${fmt(y)}h${kx}a${rr} ${rr} 0 0 1 ${rr} ${rr}` +
    `v${ky}a${rr} ${rr} 0 0 1 -${rr} ${rr}` +
    `h-${kx}a${rr} ${rr} 0 0 1 -${rr} -${rr}` +
    `v-${ky}a${rr} ${rr} 0 0 1 ${rr} -${rr}z`
  );
}

/** 三个定位角的左上角坐标。 */
function finderOrigins(n: number): Array<[number, number]> {
  return [
    [0, 0],
    [n - 7, 0],
    [0, n - 7],
  ];
}

/** 模块是否落在定位角区域内 —— 落在里面的不画圆点，改由定位角形状负责。 */
function inFinder(x: number, y: number, n: number): boolean {
  const right = x >= n - 7;
  const bottom = y >= n - 7;
  if (x <= 6 && y <= 6) return true;
  if (right && y <= 6) return true;
  if (x <= 6 && bottom) return true;
  return false;
}

type BuiltQr = { n: number; modules: string; finderCores: string };

function buildQr(value: string, ecl: "L" | "M" | "Q" | "H"): BuiltQr | undefined {
  let qr;
  try {
    qr = createQr(value, { errorCorrectionLevel: ecl });
  } catch {
    // 超长 / 编码失败：调用方 fail-closed，宁可不画，也不画一张扫不出来的码。
    return undefined;
  }
  const n = qr.modules.size;
  const data = qr.modules.data;
  const modules: string[] = [];
  const finderCores: string[] = [];

  for (let y = 0; y < n; y += 1) {
    for (let x = 0; x < n; x += 1) {
      if (!data[y * n + x]) continue;
      if (inFinder(x, y, n)) continue;
      const dot = 1 - DOT_INSET * 2;
      modules.push(roundedRect(x + DOT_INSET, y + DOT_INSET, dot, dot, DOT_RADIUS));
    }
  }

  for (const [ox, oy] of finderOrigins(n)) {
    const outer = 7 * FINDER_RADIUS;
    // 外圈 + 挖空 = 同一段 path 里的嵌套子路径，靠 fillRule="evenodd" 出环。
    modules.push(roundedRect(ox, oy, 7, 7, outer));
    modules.push(roundedRect(ox + 1, oy + 1, 5, 5, outer - FINDER_HOLE_INSET));
    finderCores.push(roundedRect(ox + 2, oy + 2, 3, 3, 3 * FINDER_CORE_RADIUS));
  }

  return { n, modules: modules.join(""), finderCores: finderCores.join("") };
}

export type ProxyQrCodeProps = {
  /** 二维码内容。内部统一过 `toQrPayload`，保证编码进去的永远是 https 全量。 */
  value: string;
  /** 码的边长（含徽标，不含静默区）。静默区由外层容器给。 */
  size: number;
  /** 中间的品牌徽标。默认开；关掉只影响观感，不影响内容。 */
  logo?: boolean | undefined;
  ecl?: "L" | "M" | "Q" | "H" | undefined;
  style?: StyleProp<ViewStyle> | undefined;
};

function ProxyQrCodeInner({
  value,
  size,
  logo = true,
  ecl = "H",
  style,
}: ProxyQrCodeProps): React.JSX.Element | null {
  const payload = toQrPayload(value);
  const built = useMemo(() => buildQr(payload, ecl), [payload, ecl]);
  if (!built) return null;

  const logoSize = Math.round(size * LOGO_RATIO);
  const ringPad = Math.round(size * LOGO_RING_RATIO);
  const badge = logoSize + ringPad * 2;

  return (
    <View style={[styles.root, { width: size, height: size }, style]}>
      <Svg width={size} height={size} viewBox={`0 0 ${built.n} ${built.n}`}>
        <Rect x={0} y={0} width={built.n} height={built.n} fill={color.white} />
        <Path d={built.modules} fill={color.ink} fillRule="evenodd" />
        <Path d={built.finderCores} fill={color.ink} />
      </Svg>
      {logo ? (
        <View
          pointerEvents="none"
          style={[
            styles.badge,
            {
              width: badge,
              height: badge,
              borderRadius: badge / 2,
              top: (size - badge) / 2,
              left: (size - badge) / 2,
            },
          ]}
        >
          <Image
            accessibilityIgnoresInvertColors
            source={QR_LOGO}
            style={{ width: logoSize, height: logoSize, borderRadius: logoSize / 2 }}
          />
        </View>
      ) : null}
    </View>
  );
}

// 码内容不变就不重画 —— 店铺列表里每店一张，重绘一次就是一次 path 解析。
export const ProxyQrCode = memo(ProxyQrCodeInner);

const styles = StyleSheet.create({
  root: { alignItems: "center", backgroundColor: color.white, justifyContent: "center" },
  badge: {
    alignItems: "center",
    backgroundColor: color.white,
    justifyContent: "center",
    position: "absolute",
  },
});

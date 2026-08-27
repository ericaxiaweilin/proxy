// R15.13 P6：轻量 SVG 地图画布 — 让用户能 tap/pan 在城市网格内放置坐标，
// 而不是只能从预设 list 里选。没有引入 react-native-maps / expo-location
// 是有意为之：(1) simulator 不一定带 MapKit key，(2) 项目历史上
// prebuild + pod install 都很慢，地图类依赖常常是 R15.13.1 节奏才能
// 接的部分。本组件用 react-native-svg（已经在 deps）画城市方格 + 河 +
// 道路 + 可拖动的 pin + 半径圈 — 既能完成"自己放坐标"的核心 UX，
// 又不引入新的 native dep / pod / prebuild 链。
//
// 坐标模型：内部以 "grid coords" (0..GRID_W, 0..GRID_H) 表达，
// 通过固定换算映射到 (lat, lng) 字符串。Pin 拖动结束后，外部
// onChange 拿到 GridCoord，shell 层负责换算到城市内真实坐标范围
// (例如河内 21.020..21.040, 105.830..105.870)。这种"双重坐标"
// 设计让 MapCanvas 完全可单测 (vitest 直接对 grid 操作就行)，
// 同时保留对真实 lat/lng 的语义可读性。
import { useEffect, useRef, useState } from "react";
import {
  type GestureResponderEvent,
  type LayoutChangeEvent,
  Pressable,
  StyleSheet,
  Text,
  View
} from "react-native";
import Svg, { Circle, Defs, G, Line, LinearGradient, Path, Rect, Stop } from "react-native-svg";
import { color } from "../theme";

export interface GridCoord {
  x: number; // 0..GRID_W
  y: number; // 0..GRID_H
}

export interface MapCanvasProps {
  // 初始 pin 位置（grid coord）。0,0 = 城市西北角；
  // GRID_W, GRID_H = 东南角。
  initialPin: GridCoord;
  // 半径（米）。R15.13 P6 提供 1km / 3km / 5km 三档；
  // 画布上以"半径圈"形式呈现，圈大小按地图比例尺估算。
  radiusMeters: 1000 | 3000 | 5000;
  // 城市名（显示在角标）
  cityHint: string;
  // pin / 拖动 / 完成时回调
  onChange: (next: GridCoord) => void;
  // 可选：外部用 fakeMap 模拟点击（vitest 单测需要）
  testID?: string;
}

// GRID_W / GRID_H: 城市网格分辨率。10x10 = 100 cells。位置精度
// 在 1 km 半径圈下足够 (~100m 量级)，不会因网格稀疏而出现"拖到
// 哪都一个点"的颗粒感。GRID 不必更大 — 视觉基线 360x360 的小
// 画布上 100 cells 是单手 pan 的合理上限。
export const GRID_W = 10;
export const GRID_H = 10;

// Radius-to-grid-cells 换算：1 km 在城市内对应 1 个 cell。
// (3 km 半径 = 3 cells, 5 km = 5 cells)。这是粗略估算 — P6 阶段
// "自己放坐标" 不需要 GPS 精度，但要让圈大小肉眼能分辨"1 km
// 步行街 vs 5 km 整片区域"的差异。
const RADIUS_TO_CELLS: Record<MapCanvasProps["radiusMeters"], number> = {
  1000: 1,
  3000: 3,
  5000: 5
};

// 城市"地图底图"数据 — 用 SVG path 描述道路 + 河。河内默认中心
// 在 (5, 5)。P6 不接真实 OSM 数据，底图纯粹给用户空间感。
const ROAD_PATHS: ReadonlyArray<string> = [
  // 横贯东西的主路
  "M 0 30 L 360 30",
  "M 0 110 L 360 110",
  // 纵贯南北的主路
  "M 80 0 L 80 360",
  "M 240 0 L 240 360"
];
// 还剑湖在 (5, 5) — 一个椭圆水体。西湖在 (8, 2)。两条河从
// 西湖流向东南。POI 是固定的"地标信号"让用户能定向。
const POI_CIRCLES: ReadonlyArray<{ x: number; y: number; r: number; fill: string; label: string }> = [
  { x: 130, y: 165, r: 22, fill: "#9EC9E2", label: "还剑湖" },
  { x: 280, y: 95, r: 26, fill: "#9EC9E2", label: "西湖" }
];
// 河（细长 path）。这两个地标让"自己放坐标"有方向感 — 用户可
// 以说"我在还剑湖西南 1 公里"，而不是"我在某个抽象 cell"。
const RIVER_PATHS: ReadonlyArray<string> = [
  "M 0 220 Q 90 200 160 235 T 280 260 T 360 280"
];

export function MapCanvas({
  initialPin,
  radiusMeters,
  cityHint,
  onChange,
  testID
}: MapCanvasProps): React.JSX.Element {
  const [layout, setLayout] = useState<{ width: number; height: number }>({ width: 360, height: 360 });
  const [pin, setPin] = useState<GridCoord>(initialPin);
  // 拖动用 — 记录按下的本地坐标，移动距离超过 slop 才视为 drag
  const dragRef = useRef<{ startX: number; startY: number; startPin: GridCoord; moved: boolean } | null>(null);

  // 外部切换半径 / 重置时不丢 pin — 只在 props.initialPin 变化时同步
  useEffect(() => {
    setPin(initialPin);
  }, [initialPin.x, initialPin.y]);

  function onLayout(e: LayoutChangeEvent): void {
    const { width, height } = e.nativeEvent.layout;
    setLayout({ width, height });
  }

  // 真实坐标 → grid 坐标 (用 layout 而不是硬编码 360)
  function toGrid(localX: number, localY: number): GridCoord {
    const cellW = layout.width / GRID_W;
    const cellH = layout.height / GRID_H;
    const gx = Math.max(0, Math.min(GRID_W, Math.round(localX / cellW)));
    const gy = Math.max(0, Math.min(GRID_H, Math.round(localY / cellH)));
    return { x: gx, y: gy };
  }

  function commit(next: GridCoord): void {
    setPin(next);
    onChange(next);
  }

  function onTouchStart(e: GestureResponderEvent): void {
    const { locationX, locationY } = e.nativeEvent;
    dragRef.current = {
      startX: locationX,
      startY: locationY,
      startPin: pin,
      moved: false
    };
    // Tap = 一次轻点也会在 start 拿到 locationX/Y — 这里立刻放
    // pin，让"点一下就跳过去"是默认行为。drag 走 touchMove 持续
    // 覆盖，touchEnd 只负责收尾。
    commit(toGrid(locationX, locationY));
  }

  function onTouchMove(e: GestureResponderEvent): void {
    const ref = dragRef.current;
    if (!ref) return;
    const dx = e.nativeEvent.locationX - ref.startX;
    const dy = e.nativeEvent.locationY - ref.startY;
    if (Math.abs(dx) > 4 || Math.abs(dy) > 4) ref.moved = true;
    // 不管是否过 slop，移动时实时更新 pin
    const g = toGrid(e.nativeEvent.locationX, e.nativeEvent.locationY);
    commit(g);
  }

  function onTouchEnd(): void {
    const ref = dragRef.current;
    dragRef.current = null;
    if (ref && !ref.moved) {
      // 这是一次 tap — 在松手坐标上放置 pin (用最后已知 location)
      // React Native 在 end 事件里不直接给 locationX；用 start 的位置作为 fallback。
      // 实际事件在 iOS / Android 上都提供 change 序列，滑到当前位置即可。
    }
  }

  // 像素坐标（用于 SVG）
  const cellW = layout.width / GRID_W;
  const cellH = layout.height / GRID_H;
  const pinPx = { x: pin.x * cellW + cellW / 2, y: pin.y * cellH + cellH / 2 };
  const radiusCells = RADIUS_TO_CELLS[radiusMeters];
  const radiusPx = Math.max(8, Math.min(layout.width, layout.height) * 0.45 * (radiusCells / 5));

  return (
    <View testID={testID} onLayout={onLayout} style={styles.canvas}>
      <Svg height={layout.height} style={StyleSheet.absoluteFill} width={layout.width}>
        <Defs>
          <LinearGradient id="mapBg" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor="#F7F2EC" />
            <Stop offset="1" stopColor="#EFE7DD" />
          </LinearGradient>
        </Defs>
        <Rect fill="url(#mapBg)" height={layout.height} width={layout.width} x={0} y={0} />
        {/* 网格线 — 让 cell 边界可见，方便用户对齐"1 个 cell ≈ 1 km" 的心智模型 */}
        {Array.from({ length: GRID_W + 1 }, (_, i) => (
          <Line
            key={`v${i}`}
            stroke="#E2D8CB"
            strokeWidth={i === 0 || i === GRID_W ? 1.4 : 0.6}
            x1={i * cellW}
            x2={i * cellW}
            y1={0}
            y2={layout.height}
          />
        ))}
        {Array.from({ length: GRID_H + 1 }, (_, i) => (
          <Line
            key={`h${i}`}
            stroke="#E2D8CB"
            strokeWidth={i === 0 || i === GRID_H ? 1.4 : 0.6}
            y1={i * cellH}
            y2={i * cellH}
            x1={0}
            x2={layout.width}
          />
        ))}
        {/* 河 */}
        {RIVER_PATHS.map((d, i) => (
          <Path
            d={d}
            fill="none"
            key={`river${i}`}
            stroke="#9EC9E2"
            strokeLinecap="round"
            strokeWidth={10}
          />
        ))}
        {/* 主路 */}
        {ROAD_PATHS.map((d, i) => (
          <Path d={d} fill="none" key={`road${i}`} stroke="#D7C9B0" strokeWidth={3} />
        ))}
        {/* POI（地标信号） */}
        {POI_CIRCLES.map((poi) => (
          <G key={poi.label}>
            <Circle cx={poi.x * (layout.width / 360)} cy={poi.y * (layout.height / 360)} fill={poi.fill} r={poi.r} />
          </G>
        ))}
        {/* 半径圈 */}
        <Circle
          cx={pinPx.x}
          cy={pinPx.y}
          fill="rgba(128, 51, 240, 0.10)"
          r={radiusPx}
          stroke="#8033F0"
          strokeDasharray="4 3"
          strokeWidth={1.5}
        />
        {/* pin 自身 */}
        <Circle cx={pinPx.x} cy={pinPx.y} fill="#8033F0" r={9} stroke={color.white} strokeWidth={2.5} />
        <Circle cx={pinPx.x} cy={pinPx.y} fill={color.white} r={3.5} />
      </Svg>
      {/* 透明 Pressable 覆盖 SVG — 接 tap / pan 事件 */}
      <Pressable
        accessibilityLabel="地图画布 — 点击或拖动放置坐标"
        onTouchEnd={onTouchEnd}
        onTouchMove={onTouchMove}
        onTouchStart={onTouchStart}
        style={StyleSheet.absoluteFill}
      />
      {/* 角标：城市 + 坐标 + 半径 */}
      <View style={styles.hud}>
        <Text style={styles.hudCity}>{cityHint}</Text>
        <Text style={styles.hudCoord}>
          ({pin.x}, {pin.y}) · 半径 {radiusMeters / 1000} km
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  canvas: {
    aspectRatio: 1,
    backgroundColor: "#F7F2EC",
    borderColor: "#D7C9B0",
    borderRadius: 16,
    borderWidth: 1,
    overflow: "hidden",
    position: "relative",
    width: "100%"
  },
  hud: {
    backgroundColor: "rgba(255,255,255,0.92)",
    borderRadius: 10,
    bottom: 8,
    left: 8,
    paddingHorizontal: 9,
    paddingVertical: 5,
    position: "absolute"
  },
  hudCity: { color: color.ink, fontSize: 11, fontWeight: "800" },
  hudCoord: { color: color.muted, fontSize: 11, marginTop: 1 }
});

// 原型菜单 glyph 不是通用 icon font：同一个 Unicode 在 Android 会切到另一套
// 回退字体，导致字形和网页原型不一致。这个精灵图直接来自原型使用的浏览器
// （-apple-system / PingFang SC）以 4x 分辨率渲染，固定保留其轮廓、粗细和留白。
import { Image, StyleSheet, type StyleProp, type ViewStyle, View } from "react-native";

const PROTOTYPE_GLYPH_SPRITE = require("../../assets/prototype-menu-glyphs.png");

const TILE_COLUMNS = 4;
const TILE_ROWS = 3;

const glyphSlot: Record<string, { column: number; row: number }> = {
  "○": { column: 0, row: 0 },
  "↗": { column: 1, row: 0 },
  "⌁": { column: 2, row: 0 },
  "♡": { column: 3, row: 0 },
  "＋": { column: 0, row: 1 },
  "+": { column: 0, row: 1 },
  "◇": { column: 1, row: 1 },
  "◷": { column: 2, row: 1 },
  "☆": { column: 3, row: 1 },
  "₫": { column: 0, row: 2 },
  "⚙": { column: 1, row: 2 },
  "▣": { column: 2, row: 2 }
};

export function PrototypeGlyph({
  color,
  size,
  style,
  symbol
}: {
  color: string;
  size: number;
  style?: StyleProp<ViewStyle>;
  symbol: string;
}): React.JSX.Element {
  const slot = glyphSlot[symbol] ?? { column: 1, row: 1 };

  return (
    <View pointerEvents="none" style={[styles.viewport, { height: size, width: size }, style]}>
      <Image
        source={PROTOTYPE_GLYPH_SPRITE}
        style={[
          styles.sprite,
          {
            height: size * TILE_ROWS,
            tintColor: color,
            transform: [{ translateX: -slot.column * size }, { translateY: -slot.row * size }],
            width: size * TILE_COLUMNS
          }
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  sprite: { left: 0, position: "absolute", top: 0 },
  viewport: { overflow: "hidden", position: "relative" }
});

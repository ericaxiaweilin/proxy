import { type StyleProp, StyleSheet, Text, type ViewStyle, View } from "react-native";
import Svg, { Circle, Path } from "react-native-svg";

// Android 的符号回退字体会把 ◎ / ◇ / ○ 等字形压得很小；这里使用固定画布，
// 让图标的可见面积和原型保持一致，不再依赖字体的 glyph metrics。
export type ProxyIconName =
  | "target"
  | "diamond"
  | "circle"
  | "ring"
  | "meRing"
  | "crosshair"
  | "home"
  | "check"
  | "sparkle"
  | "spark"
  | "arrowUpRight"
  | "arrowUp"
  | "chevronLeft"
  | "close"
  | "plus"
  | "clock"
  | "star"
  | "coin"
  | "cup"
  | "ticket"
  | "wallet"
  | "settings"
  | "storefront"
  | "storeLines"
  | "profileRing"
  | "heart"
  | "route"
  | "pin"
  | "user"
  | "mail"
  | "chat"
  | "camera"
  | "microphone"
  | "image"
  | "infoCircle"
  | "qrGrid"
  | "ellipsis"
  | "search"
  | "remix";

const symbolMap: Partial<Record<string, ProxyIconName>> = {
  "home": "home",
  "diamond": "diamond",
  "target": "target",
  "chat": "chat",
  "me-ring": "meRing",
  "ring": "ring",
  "cup": "cup",
  "profile-ring": "profileRing",
  "arrow-up-right": "arrowUpRight",
  "route": "route",
  "plus": "plus",
  "clock": "clock",
  "star": "star",
  "coin": "coin",
  "gear": "settings",
  "ticket": "ticket",
  "store-lines": "storeLines",
  "spark": "spark",
  "○": "ring",
  "◉": "target",
  "◎": "target",
  "◇": "diamond",
  "◈": "diamond",
  "⌖": "crosshair",
  "⌂": "home",
  "✓": "check",
  "✦": "spark",
  "↗": "arrowUpRight",
  "＋": "plus",
  "+": "plus",
  "◷": "clock",
  "₫": "coin",
  "⚙": "settings",
  "▣": "storeLines",
  "▤": "storeLines",
  "◫": "storeLines",
  "♙": "user",
  "✉": "chat",
  "券": "ticket",
  "P": "profileRing"
};

function MasterModuleIcon({ name, size, color }: { name: ProxyIconName; size: number; color: string }): React.JSX.Element | null {
  const common = { fill: "none", stroke: color, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, strokeWidth: 2.2 };
  const canvas = (children: React.ReactNode): React.JSX.Element => (
    <Svg height={size} viewBox="0 0 24 24" width={size}>{children}</Svg>
  );

  switch (name) {
    case "home":
      return canvas(<><Path {...common} d="M4 10.5 12 4l8 6.5"/><Path {...common} d="M6.5 10v9h11v-9"/></>);
    case "diamond":
      return canvas(<Path {...common} d="M12 4 20 12 12 20 4 12z"/>);
    case "target":
      return canvas(<><Circle {...common} cx="12" cy="12" r="7"/><Circle {...common} cx="12" cy="12" r="3"/></>);
    case "chat":
      return canvas(<Path {...common} d="M5 6h14v9H9l-4 3z"/>);
    case "meRing":
      return canvas(<><Circle {...common} cx="12" cy="8" r="3.4"/><Path {...common} d="M6.2 19c1.2-3.5 3.7-5.3 5.8-5.3s4.6 1.8 5.8 5.3"/><Circle {...common} cx="12" cy="12" r="9"/></>);
    case "ring":
    case "circle":
      return canvas(<Circle {...common} cx="12" cy="12" r="7"/>);
    case "cup":
      return canvas(<><Path {...common} d="M6 9h10v5a4 4 0 0 1-4 4h-2a4 4 0 0 1-4-4z"/><Path {...common} d="M16 10h2a2.5 2.5 0 0 1 0 5h-2"/><Path {...common} d="M8 5c0 1-1 1.4-1 2M12 5c0 1-1 1.4-1 2M16 5c0 1-1 1.4-1 2"/></>);
    case "profileRing":
      return canvas(<><Circle {...common} cx="12" cy="12" r="8"/><Circle {...common} cx="12" cy="9" r="2.6"/><Path {...common} d="M7.7 17c1-2.8 2.9-4.2 4.3-4.2s3.3 1.4 4.3 4.2"/></>);
    case "arrowUpRight":
      return canvas(<><Path {...common} d="M7 17 17 7"/><Path {...common} d="M10 7h7v7"/></>);
    case "route":
      return canvas(<><Circle {...common} cx="5" cy="17" r="1.5"/><Circle {...common} cx="18" cy="8" r="1.5"/><Path {...common} d="M6.5 16c2.3-5.6 4.6-7.5 7.2-7.5 1.2 0 2.1.3 2.8.6"/></>);
    case "pin":
      return canvas(<><Path {...common} d="M12 21s-6.5-5.8-6.5-10.5A6.5 6.5 0 0 1 12 4a6.5 6.5 0 0 1 6.5 6.5C18.5 15.2 12 21 12 21z"/><Circle {...common} cx="12" cy="10.3" r="2.3"/></>);
    case "remix":
      return canvas(<><Path {...common} d="M5 7h3.2c2.2 0 3.4 1.2 4.5 3.2l1.1 2C14.9 14.2 16 17 19 17"/><Path {...common} d="m16 14 3 3-3 3"/><Path {...common} d="M5 17h3.2c1.8 0 2.9-.8 3.8-2.3l2-3.4C15.1 9.4 16.2 7 19 7"/><Path {...common} d="m16 4 3 3-3 3"/></>);
    case "plus":
      return canvas(<Path {...common} d="M12 5v14M5 12h14"/>);
    case "clock":
      return canvas(<><Circle {...common} cx="12" cy="12" r="7"/><Path {...common} d="M12 8v4l3 2"/></>);
    case "star":
      return canvas(<Path {...common} d="M12 4l2.2 4.5 5 .7-3.6 3.5.9 5-4.5-2.4-4.5 2.4.9-5L4.8 9.2l5-.7z"/>);
    case "coin":
      return canvas(<><Circle {...common} cx="12" cy="12" r="7"/><Path {...common} d="M9.5 9.5h5M9.5 14.5h5M12 7.5v9"/></>);
    case "settings":
      return canvas(<><Circle {...common} cx="12" cy="12" r="3"/><Path {...common} d="M12 4v2M12 18v2M4 12h2M18 12h2M6.3 6.3l1.4 1.4M16.3 16.3l1.4 1.4M17.7 6.3l-1.4 1.4M7.7 16.3l-1.4 1.4"/></>);
    case "ticket":
      return canvas(<><Path {...common} d="M5 8h14v3a2 2 0 0 0 0 4v3H5v-3a2 2 0 0 0 0-4z"/><Path {...common} d="M12 8v10"/></>);
    case "storeLines":
      return canvas(<Path {...common} d="M6 7h12M7 10h10M7 13h10M7 16h10"/>);
    case "spark":
    case "sparkle":
      return canvas(<Path {...common} d="M12 4l1.7 4.3L18 10l-4.3 1.7L12 16l-1.7-4.3L6 10l4.3-1.7z"/>);
    case "camera":
    case "image":
      return canvas(<><Path {...common} d="M7 7.5h2l1.2-2h3.6l1.2 2h2A2.5 2.5 0 0 1 19.5 10v6A2.5 2.5 0 0 1 17 18.5H7A2.5 2.5 0 0 1 4.5 16v-6A2.5 2.5 0 0 1 7 7.5z"/><Circle {...common} cx="12" cy="13" r="3.1"/><Path {...common} d="M16.6 10.2h.01"/></>);
    case "microphone":
      return canvas(<><Path {...common} d="M12 4a3 3 0 0 1 3 3v4a3 3 0 0 1-6 0V7a3 3 0 0 1 3-3z"/><Path {...common} d="M6.5 11.5v.5a5.5 5.5 0 0 0 11 0v-.5"/><Path {...common} d="M12 17.5V20"/><Path {...common} d="M9.5 20h5"/></>);
    case "arrowUp":
      return canvas(<><Path {...common} d="M12 19V5"/><Path {...common} d="M7.5 9.5 12 5l4.5 4.5"/></>);
    default:
      return null;
  }
}

export function ProxySymbolIcon({
  symbol,
  size,
  color,
  style
}: {
  symbol: string;
  size: number;
  color: string;
  style?: StyleProp<ViewStyle>;
}): React.JSX.Element {
  const iconName = symbolMap[symbol];
  if (iconName) {
    return <ProxyIcon color={color} name={iconName} size={size} style={style} />;
  }

  // Apple 与 Android 对 ♡ / ☆ / ⌁ 的回退字体不同。保留原型符号，但固定
  // 可见尺寸，并用同色阴影补偿 Android 过细的字重。
  const glyphScale = symbol === "♡" ? 0.86 : symbol === "⌁" ? 0.9 : 1;
  return (
    <View pointerEvents="none" style={[styles.frame, { height: size, width: size }, style]}>
      <Text
        allowFontScaling={false}
        style={[
          styles.prototypeGlyph,
          {
            color,
            fontSize: size * glyphScale,
            lineHeight: size,
            textShadowColor: color,
            textShadowOffset: { height: 0, width: 0 },
            textShadowRadius: symbol === "♡" ? 0.8 : 0.35
          }
        ]}
      >
        {symbol}
      </Text>
    </View>
  );
}

export function ProxyIcon({
  name,
  size,
  color,
  style
}: {
  name: ProxyIconName;
  size: number;
  color: string;
  style?: StyleProp<ViewStyle>;
}): React.JSX.Element {
  const stroke = Math.max(1.6, size * 0.11);
  const frame = [styles.frame, { height: size, width: size }, style];
  const masterIcon = MasterModuleIcon({ name, size, color });
  if (masterIcon) {
    return <View pointerEvents="none" style={frame}>{masterIcon}</View>;
  }

  if (name === "diamond") {
    const side = size * 0.58;
    return (
      <View pointerEvents="none" style={frame}>
        <View
          style={[
            styles.diamond,
            {
              borderColor: color,
              borderRadius: size * 0.05,
              borderWidth: stroke,
              height: side,
              width: side
            }
          ]}
        />
      </View>
    );
  }

  if (name === "circle") {
    const diameter = size * 0.68;
    return (
      <View pointerEvents="none" style={frame}>
        <View
          style={[
            styles.circle,
            {
              borderColor: color,
              borderRadius: diameter / 2,
              borderWidth: stroke,
              height: diameter,
              width: diameter
            }
          ]}
        />
      </View>
    );
  }

  if (name === "ring") {
    const diameter = size * 0.78;
    return (
      <View pointerEvents="none" style={frame}>
        <View style={[styles.circle, { borderColor: color, borderRadius: diameter / 2, borderWidth: stroke, height: diameter, width: diameter }]} />
      </View>
    );
  }

  if (name === "profileRing" || name === "meRing") {
    const outer = size * 0.78;
    const head = size * 0.22;
    return (
      <View pointerEvents="none" style={frame}>
        <View style={[styles.profileOuter, { borderColor: color, borderRadius: outer / 2, borderWidth: stroke, height: outer, width: outer }]}>
          <View style={[styles.profileHead, { borderColor: color, borderRadius: head / 2, borderWidth: stroke, height: head, width: head }]} />
          <View style={[styles.profileBody, { borderColor: color, borderTopWidth: stroke, borderLeftWidth: stroke, borderRightWidth: stroke, borderRadius: size * 0.18, height: size * 0.22, width: size * 0.42 }]} />
        </View>
      </View>
    );
  }

  if (name === "crosshair") {
    const dot = size * 0.36;
    return (
      <View pointerEvents="none" style={frame}>
        <View
          style={[
            styles.crosshairDot,
            {
              borderColor: color,
              borderRadius: dot / 2,
              borderWidth: Math.max(1.2, stroke * 0.65),
              height: dot,
              width: dot
            }
          ]}
        />
        <View style={[styles.crosshairH, { backgroundColor: color, height: Math.max(1, stroke * 0.55), width: size * 0.82 }]} />
        <View style={[styles.crosshairV, { backgroundColor: color, height: size * 0.82, width: Math.max(1, stroke * 0.55) }]} />
      </View>
    );
  }

  if (name === "home") {
    const roof = size * 0.49;
    return (
      <View pointerEvents="none" style={frame}>
        <View
          style={[
            styles.homeRoof,
            {
              borderColor: color,
              borderLeftWidth: stroke,
              borderTopWidth: stroke,
              height: roof,
              top: size * 0.11,
              width: roof
            }
          ]}
        />
        <View
          style={[
            styles.homeBody,
            {
              borderColor: color,
              borderWidth: stroke,
              bottom: size * 0.08,
              height: size * 0.42,
              width: size * 0.56
            }
          ]}
        />
      </View>
    );
  }

  if (name === "check") {
    return (
      <View pointerEvents="none" style={frame}>
        <View style={[styles.checkShort, { backgroundColor: color, height: stroke, width: size * 0.34 }]} />
        <View style={[styles.checkLong, { backgroundColor: color, height: stroke, width: size * 0.62 }]} />
      </View>
    );
  }

  if (name === "sparkle" || name === "spark") {
    return (
      <View pointerEvents="none" style={frame}>
        <View style={[styles.sparkleV, { backgroundColor: color, height: size * 0.86, width: stroke }]} />
        <View style={[styles.sparkleH, { backgroundColor: color, height: stroke, width: size * 0.86 }]} />
        <View style={[styles.sparkleD1, { backgroundColor: color, height: stroke, width: size * 0.64 }]} />
        <View style={[styles.sparkleD2, { backgroundColor: color, height: stroke, width: size * 0.64 }]} />
      </View>
    );
  }

  if (name === "arrowUpRight") {
    return (
      <View pointerEvents="none" style={frame}>
        <View style={[styles.arrowDiagonal, { backgroundColor: color, height: stroke, width: size * 0.78 }]} />
        <View style={[styles.arrowHeadA, { borderTopColor: color, borderTopWidth: stroke, height: size * 0.38, right: size * 0.08, top: size * 0.08, width: stroke }]} />
        <View style={[styles.arrowHeadB, { backgroundColor: color, height: stroke, right: size * 0.07, top: size * 0.17, width: size * 0.38 }]} />
      </View>
    );
  }

  if (name === "arrowUp") {
    return (
      <View pointerEvents="none" style={frame}>
        <View style={[styles.arrowUpStem, { backgroundColor: color, height: size * 0.68, width: stroke }]} />
        <View style={[styles.arrowUpLeft, { backgroundColor: color, height: stroke, width: size * 0.38 }]} />
        <View style={[styles.arrowUpRight, { backgroundColor: color, height: stroke, width: size * 0.38 }]} />
      </View>
    );
  }

  if (name === "chevronLeft" || name === "close") {
    const close = name === "close";
    return (
      <View pointerEvents="none" style={frame}>
        <View style={[styles.actionLineA, { backgroundColor: color, height: stroke, width: size * 0.62 }, close ? styles.closeLineA : styles.chevronLineA]} />
        <View style={[styles.actionLineB, { backgroundColor: color, height: stroke, width: size * 0.62 }, close ? styles.closeLineB : styles.chevronLineB]} />
      </View>
    );
  }

  if (name === "plus") {
    return (
      <View pointerEvents="none" style={frame}>
        <View style={[styles.plusH, { backgroundColor: color, height: stroke, width: size * 0.76 }]} />
        <View style={[styles.plusV, { backgroundColor: color, height: size * 0.76, width: stroke }]} />
      </View>
    );
  }

  if (name === "clock") {
    const diameter = size * 0.72;
    return (
      <View pointerEvents="none" style={frame}>
        <View style={[styles.clockFace, { borderColor: color, borderRadius: diameter / 2, borderWidth: stroke, height: diameter, width: diameter }]} />
        <View style={[styles.clockHour, { backgroundColor: color, height: stroke, width: size * 0.23 }]} />
        <View style={[styles.clockMinute, { backgroundColor: color, height: size * 0.23, width: stroke }]} />
      </View>
    );
  }

  if (name === "star") {
    return (
      <View pointerEvents="none" style={frame}>
        <View style={[styles.starV, { backgroundColor: color, height: size * 0.9, width: stroke }]} />
        <View style={[styles.starD1, { backgroundColor: color, height: stroke, width: size * 0.86 }]} />
        <View style={[styles.starD2, { backgroundColor: color, height: stroke, width: size * 0.86 }]} />
      </View>
    );
  }

  if (name === "wallet") {
    return (
      <View pointerEvents="none" style={frame}>
        <View style={[styles.walletBody, { borderColor: color, borderRadius: size * 0.1, borderWidth: stroke, height: size * 0.56, width: size * 0.82 }]} />
        <View style={[styles.walletTab, { backgroundColor: color, borderRadius: stroke, height: stroke * 1.5, right: size * 0.17, width: stroke * 1.5 }]} />
      </View>
    );
  }

  if (name === "settings") {
    const hub = size * 0.38;
    return (
      <View pointerEvents="none" style={frame}>
        <View style={[styles.settingsHub, { borderColor: color, borderRadius: hub / 2, borderWidth: stroke, height: hub, width: hub }]} />
        <View style={[styles.settingsH, { backgroundColor: color, height: stroke, width: size * 0.9 }]} />
        <View style={[styles.settingsV, { backgroundColor: color, height: size * 0.9, width: stroke }]} />
        <View style={[styles.settingsD1, { backgroundColor: color, height: stroke, width: size * 0.72 }]} />
        <View style={[styles.settingsD2, { backgroundColor: color, height: stroke, width: size * 0.72 }]} />
      </View>
    );
  }

  if (name === "cup") {
    return (
      <View pointerEvents="none" style={frame}>
        <View style={[styles.cupBody, { borderColor: color, borderWidth: stroke, borderRadius: size * 0.08, height: size * 0.42, width: size * 0.58 }]} />
        <View style={[styles.cupHandle, { borderColor: color, borderWidth: stroke, borderRadius: size * 0.18, height: size * 0.22, width: size * 0.2 }]} />
        <View style={[styles.cupSteam, { backgroundColor: color, height: size * 0.2, width: stroke, left: size * 0.28 }]} />
        <View style={[styles.cupSteam, { backgroundColor: color, height: size * 0.2, width: stroke, left: size * 0.48, transform: [{ rotate: "12deg" }] }]} />
      </View>
    );
  }

  if (name === "ticket") {
    return (
      <View pointerEvents="none" style={frame}>
        <View style={[styles.ticketBody, { borderColor: color, borderWidth: stroke, borderRadius: size * 0.08, height: size * 0.58, width: size * 0.8 }]} />
        <View style={[styles.ticketCut, { backgroundColor: color, height: stroke, width: size * 0.5 }]} />
      </View>
    );
  }

  if (name === "coin") {
    const diameter = size * 0.72;
    return (
      <View pointerEvents="none" style={frame}>
        <View style={[styles.coinFace, { borderColor: color, borderRadius: diameter / 2, borderWidth: stroke, height: diameter, width: diameter }]} />
        <View style={[styles.coinLine, { backgroundColor: color, height: stroke, width: size * 0.28 }]} />
        <View style={[styles.coinLine, { backgroundColor: color, height: stroke, width: size * 0.28, transform: [{ rotate: "90deg" }] }]} />
      </View>
    );
  }

  if (name === "chat") {
    return (
      <View pointerEvents="none" style={frame}>
        <View style={[styles.chatBubble, { borderColor: color, borderWidth: stroke, borderRadius: size * 0.12, height: size * 0.58, width: size * 0.78 }]} />
        <View style={[styles.chatTail, { borderBottomColor: color, borderBottomWidth: stroke, borderLeftColor: color, borderLeftWidth: stroke, height: size * 0.18, width: size * 0.18 }]} />
      </View>
    );
  }

  if (name === "camera" || name === "image") {
    return (
      <View pointerEvents="none" style={frame}>
        <View style={[styles.cameraFrame, { borderColor: color, borderWidth: stroke, borderRadius: size * 0.08, height: size * 0.58, width: size * 0.8 }]} />
        <View style={[styles.cameraTop, { backgroundColor: color, height: stroke, width: size * 0.25 }]} />
        <View style={[styles.cameraLens, { borderColor: color, borderWidth: stroke, borderRadius: size * 0.13, height: size * 0.25, width: size * 0.25 }]} />
      </View>
    );
  }

  if (name === "microphone") {
    return (
      <View pointerEvents="none" style={frame}>
        <View style={[styles.micHead, { borderColor: color, borderWidth: stroke, borderRadius: size * 0.14, height: size * 0.46, width: size * 0.25 }]} />
        <View style={[styles.micArc, { borderColor: color, borderBottomWidth: stroke, borderLeftWidth: stroke, borderRightWidth: stroke, borderRadius: size * 0.28, height: size * 0.34, width: size * 0.58 }]} />
        <View style={[styles.micStem, { backgroundColor: color, height: size * 0.22, width: stroke }]} />
        <View style={[styles.micBase, { backgroundColor: color, height: stroke, width: size * 0.32 }]} />
      </View>
    );
  }

  if (name === "infoCircle") {
    const diameter = size * 0.78;
    return (
      <View pointerEvents="none" style={frame}>
        <View style={[styles.circle, { borderColor: color, borderRadius: diameter / 2, borderWidth: stroke, height: diameter, width: diameter }]} />
        <View style={[styles.infoDot, { backgroundColor: color, borderRadius: stroke, height: stroke * 1.2, width: stroke * 1.2 }]} />
        <View style={[styles.infoStem, { backgroundColor: color, height: size * 0.25, width: stroke }]} />
      </View>
    );
  }

  if (name === "qrGrid") {
    return (
      <View pointerEvents="none" style={frame}>
        <View style={[styles.qrOutline, { borderColor: color, borderWidth: stroke, height: size * 0.72, width: size * 0.72 }]} />
        <View style={[styles.qrLineA, { backgroundColor: color, height: stroke, width: size * 0.2 }]} />
        <View style={[styles.qrLineB, { backgroundColor: color, height: size * 0.2, width: stroke }]} />
      </View>
    );
  }

  if (name === "ellipsis") {
    return (
      <View pointerEvents="none" style={[frame, styles.ellipsisRow]}>
        {[0, 1, 2].map((item) => <View key={item} style={[styles.ellipsisDot, { backgroundColor: color, borderRadius: size * 0.06, height: size * 0.12, width: size * 0.12 }]} />)}
      </View>
    );
  }

  if (name === "search") {
    const diameter = size * 0.52;
    return (
      <View pointerEvents="none" style={frame}>
        <View style={[styles.searchFace, { borderColor: color, borderRadius: diameter / 2, borderWidth: stroke, height: diameter, width: diameter }]} />
        <View style={[styles.searchHandle, { backgroundColor: color, height: stroke, width: size * 0.36 }]} />
      </View>
    );
  }

  if (name === "storefront") {
    return (
      <View pointerEvents="none" style={frame}>
        <View style={[styles.storeOuter, { borderColor: color, borderWidth: stroke, height: size * 0.7, width: size * 0.74 }]} />
        <View style={[styles.storeInner, { borderColor: color, borderWidth: stroke, height: size * 0.29, width: size * 0.3 }]} />
      </View>
    );
  }

  if (name === "storeLines") {
    return (
      <View pointerEvents="none" style={frame}>
        {[0, 1, 2, 3].map((item) => <View key={item} style={[styles.storeLine, { backgroundColor: color, height: stroke, width: size * 0.64, top: size * (0.2 + item * 0.16) }]} />)}
      </View>
    );
  }

  if (name === "heart") {
    const lobe = size * 0.39;
    return (
      <View pointerEvents="none" style={frame}>
        <View style={[styles.heartLeft, { borderColor: color, borderRadius: lobe / 2, borderWidth: stroke, height: lobe, width: lobe }]} />
        <View style={[styles.heartRight, { borderColor: color, borderRadius: lobe / 2, borderWidth: stroke, height: lobe, width: lobe }]} />
        <View style={[styles.heartPoint, { borderBottomColor: color, borderBottomWidth: stroke, borderRightColor: color, borderRightWidth: stroke, height: size * 0.49, top: size * 0.31, width: size * 0.49 }]} />
      </View>
    );
  }

  if (name === "route") {
    const node = size * 0.22;
    return (
      <View pointerEvents="none" style={frame}>
        <View style={[styles.routeLineA, { backgroundColor: color, height: stroke, width: size * 0.43 }]} />
        <View style={[styles.routeLineB, { backgroundColor: color, height: stroke, width: size * 0.43 }]} />
        <View style={[styles.routeNodeA, { borderColor: color, borderRadius: node / 2, borderWidth: stroke, height: node, width: node }]} />
        <View style={[styles.routeNodeB, { borderColor: color, borderRadius: node / 2, borderWidth: stroke, height: node, width: node }]} />
        <View style={[styles.routeNodeC, { backgroundColor: color, borderRadius: node / 2, height: node, width: node }]} />
      </View>
    );
  }

  if (name === "user") {
    const head = size * 0.34;
    return (
      <View pointerEvents="none" style={frame}>
        <View style={[styles.userHead, { borderColor: color, borderRadius: head / 2, borderWidth: stroke, height: head, width: head }]} />
        <View style={[styles.userBody, { borderColor: color, borderRadius: size * 0.32, borderTopWidth: stroke, height: size * 0.32, width: size * 0.7 }]} />
      </View>
    );
  }

  if (name === "mail") {
    return (
      <View pointerEvents="none" style={frame}>
        <View style={[styles.mailBox, { borderColor: color, borderRadius: size * 0.08, borderWidth: stroke, height: size * 0.57, width: size * 0.78 }]} />
        <View style={[styles.mailFoldLeft, { backgroundColor: color, height: stroke, width: size * 0.46 }]} />
        <View style={[styles.mailFoldRight, { backgroundColor: color, height: stroke, width: size * 0.46 }]} />
      </View>
    );
  }

  const outer = size * 0.78;
  const inner = size * 0.43;
  const center = size * 0.12;
  return (
    <View pointerEvents="none" style={frame}>
      <View
        style={[
          styles.targetOuter,
          {
            borderColor: color,
            borderRadius: outer / 2,
            borderWidth: stroke,
            height: outer,
            width: outer
          }
        ]}
      >
        <View
          style={[
            styles.targetInner,
            {
              borderColor: color,
              borderRadius: inner / 2,
              borderWidth: stroke,
              height: inner,
              width: inner
            }
          ]}
        >
          <View style={{ backgroundColor: color, borderRadius: center / 2, height: center, width: center }} />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { alignItems: "center", justifyContent: "center", position: "relative" },
  prototypeGlyph: { includeFontPadding: false, textAlign: "center", textAlignVertical: "center" },
  diamond: { position: "absolute", transform: [{ rotate: "45deg" }] },
  circle: { position: "absolute" },
  profileOuter: { alignItems: "center", justifyContent: "center", position: "absolute" },
  profileHead: { position: "absolute", top: "18%" },
  profileBody: { bottom: "12%", position: "absolute" },
  crosshairDot: { position: "absolute" },
  crosshairH: { position: "absolute" },
  crosshairV: { position: "absolute" },
  homeRoof: { position: "absolute", transform: [{ rotate: "45deg" }] },
  homeBody: { borderTopWidth: 0, position: "absolute" },
  checkShort: { left: "17%", position: "absolute", top: "57%", transform: [{ rotate: "45deg" }] },
  checkLong: { left: "35%", position: "absolute", top: "47%", transform: [{ rotate: "-45deg" }] },
  sparkleV: { position: "absolute" },
  sparkleH: { position: "absolute" },
  sparkleD1: { position: "absolute", transform: [{ rotate: "45deg" }] },
  sparkleD2: { position: "absolute", transform: [{ rotate: "-45deg" }] },
  arrowDiagonal: { position: "absolute", transform: [{ rotate: "-45deg" }] },
  arrowHeadA: { borderRightWidth: 0, position: "absolute" },
  arrowHeadB: { position: "absolute" },
  arrowUpStem: { position: "absolute", top: "24%" },
  arrowUpLeft: { position: "absolute", right: "50%", top: "18%", transform: [{ rotate: "-45deg" }] },
  arrowUpRight: { left: "50%", position: "absolute", top: "18%", transform: [{ rotate: "45deg" }] },
  actionLineA: { position: "absolute" },
  actionLineB: { position: "absolute" },
  chevronLineA: { right: "33%", top: "35%", transform: [{ rotate: "-45deg" }] },
  chevronLineB: { right: "33%", top: "58%", transform: [{ rotate: "45deg" }] },
  closeLineA: { transform: [{ rotate: "45deg" }] },
  closeLineB: { transform: [{ rotate: "-45deg" }] },
  plusH: { position: "absolute" },
  plusV: { position: "absolute" },
  clockFace: { position: "absolute" },
  clockHour: { left: "50%", position: "absolute", top: "50%" },
  clockMinute: { left: "50%", position: "absolute", top: "31%" },
  starV: { position: "absolute" },
  starD1: { position: "absolute", transform: [{ rotate: "36deg" }] },
  starD2: { position: "absolute", transform: [{ rotate: "-36deg" }] },
  walletBody: { position: "absolute" },
  walletTab: { position: "absolute" },
  settingsHub: { position: "absolute" },
  settingsH: { position: "absolute" },
  settingsV: { position: "absolute" },
  settingsD1: { position: "absolute", transform: [{ rotate: "45deg" }] },
  settingsD2: { position: "absolute", transform: [{ rotate: "-45deg" }] },
  cupBody: { position: "absolute", top: "42%" },
  cupHandle: { position: "absolute", right: "8%", top: "48%" },
  cupSteam: { position: "absolute", top: "13%", transform: [{ rotate: "12deg" }] },
  ticketBody: { position: "absolute" },
  ticketCut: { position: "absolute", transform: [{ rotate: "90deg" }] },
  coinFace: { position: "absolute" },
  coinLine: { position: "absolute" },
  chatBubble: { position: "absolute" },
  chatTail: { bottom: "17%", left: "19%", position: "absolute", transform: [{ rotate: "-25deg" }] },
  cameraFrame: { position: "absolute" },
  cameraTop: { position: "absolute", top: "22%" },
  cameraLens: { position: "absolute" },
  micHead: { position: "absolute", top: "10%" },
  micArc: { bottom: "20%", position: "absolute" },
  micStem: { bottom: "10%", position: "absolute" },
  micBase: { bottom: "7%", position: "absolute" },
  infoDot: { position: "absolute", top: "27%" },
  infoStem: { position: "absolute", top: "45%" },
  qrOutline: { position: "absolute" },
  qrLineA: { position: "absolute", top: "42%" },
  qrLineB: { left: "42%", position: "absolute" },
  ellipsisRow: { flexDirection: "row", gap: 3 },
  ellipsisDot: {},
  searchFace: { position: "absolute", top: "20%" },
  searchHandle: { bottom: "20%", position: "absolute", right: "16%", transform: [{ rotate: "45deg" }] },
  storeOuter: { position: "absolute" },
  storeInner: { position: "absolute" },
  storeLine: { position: "absolute" },
  heartLeft: { left: "16%", position: "absolute", top: "17%" },
  heartRight: { position: "absolute", right: "16%", top: "17%" },
  heartPoint: { position: "absolute", transform: [{ rotate: "45deg" }] },
  routeLineA: { left: "17%", position: "absolute", top: "36%", transform: [{ rotate: "32deg" }] },
  routeLineB: { position: "absolute", right: "17%", top: "62%", transform: [{ rotate: "-32deg" }] },
  routeNodeA: { left: "8%", position: "absolute", top: "18%" },
  routeNodeB: { position: "absolute", right: "8%", top: "70%" },
  routeNodeC: { position: "absolute", top: "39%" },
  userHead: { position: "absolute", top: "9%" },
  userBody: { bottom: "7%", position: "absolute" },
  mailBox: { position: "absolute" },
  mailFoldLeft: { left: "15%", position: "absolute", top: "47%", transform: [{ rotate: "31deg" }] },
  mailFoldRight: { position: "absolute", right: "15%", top: "47%", transform: [{ rotate: "-31deg" }] },
  targetOuter: { alignItems: "center", justifyContent: "center", position: "absolute" },
  targetInner: { alignItems: "center", justifyContent: "center" }
});

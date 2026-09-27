// TooltipOnLongPress — 长按 children 时短暂显示 label。
//
// 用法:
//   <TooltipOnLongPress label="录制语音" onPress={onTap} disabled={busy}>
//     <View style={styles.icon} />
//   </TooltipOnLongPress>
//
// 行为：
//   - onPress：点击（短按）触发
//   - onLongPress：长按 350ms 触发；如果未传则默认行为是仅显示 tooltip
//   - 长按触发后会自动隐藏；如同时存在 onLongPress，仍会显示 tooltip
//
// 动画用 RN 内置 Animated.timing（fade + slide），不影响外层布局。

import { useEffect, useRef, useState } from "react";
import { Animated, Pressable, StyleSheet, Text } from "react-native";
import { color } from "../theme";

type Props = {
  label: string;
  disabled?: boolean;
  children: React.ReactNode;
  onPress?: () => void;
  onLongPress?: () => void;
};

const LONG_PRESS_MS = 350;
const SHOW_MS = 1200;

export function TooltipOnLongPress({ label, disabled, children, onPress, onLongPress }: Props): React.JSX.Element {
  const [visible, setVisible] = useState(false);
  const [wrapWidth, setWrapWidth] = useState<number | null>(null);
  const [wrapHeight, setWrapHeight] = useState<number | null>(null);
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(8)).current;
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 卸载时清理计时器，避免在已卸载的组件上调用 setState
  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, []);

  function show(): void {
    setVisible(true);
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 1, duration: 140, useNativeDriver: true }),
      Animated.timing(slideAnim, { toValue: 0, duration: 140, useNativeDriver: true })
    ]).start();
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(hide, SHOW_MS);
  }

  function hide(): void {
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 0, duration: 120, useNativeDriver: true }),
      Animated.timing(slideAnim, { toValue: 8, duration: 120, useNativeDriver: true })
    ]).start(({ finished }) => {
      if (finished) setVisible(false);
    });
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }

  return (
    <Pressable
      delayLongPress={LONG_PRESS_MS}
      disabled={disabled}
      onPress={onPress}
      onLongPress={() => {
        if (onLongPress) onLongPress();
        show();
      }}
      onLayout={(event) => {
        const { width, height } = event.nativeEvent.layout;
        setWrapWidth(width);
        setWrapHeight(height);
      }}
      style={styles.wrap}
    >
      {children}
      {visible ? (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.tip,
            wrapWidth !== null ? { left: -(TIP_MAX_WIDTH - wrapWidth) / 2 } : null,
            wrapHeight !== null ? { bottom: wrapHeight + 4 } : null,
            { opacity: fadeAnim, transform: [{ translateY: slideAnim }] }
          ]}
        >
          <Text style={styles.tipText}>{label}</Text>
        </Animated.View>
      ) : null}
    </Pressable>
  );
}

const TIP_MAX_WIDTH = 180;

const styles = StyleSheet.create({
  wrap: { position: "relative" },
  tip: {
    backgroundColor: color.ink,
    borderRadius: 10,
    bottom: 46,
    maxWidth: TIP_MAX_WIDTH,
    paddingHorizontal: 8,
    paddingVertical: 4,
    position: "absolute",
    zIndex: 50
  },
  tipText: { color: "#fff", fontSize: 11, fontWeight: "600", textAlign: "center" }
});
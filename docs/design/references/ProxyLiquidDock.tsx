import React, { useCallback, useEffect, useMemo } from 'react';
import {
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { BlurView } from 'expo-blur';
import {
  GlassContainer,
  GlassView,
  isGlassEffectAPIAvailable,
} from 'expo-glass-effect';
import * as Haptics from 'expo-haptics';
import { SymbolView } from 'expo-symbols';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export type ProxyTabKey = 'home' | 'market' | 'feed' | 'messages' | 'me';

export type ProxyLiquidDockProps = {
  activeKey: ProxyTabKey;
  onChange: (key: ProxyTabKey) => void;
  tone?: 'light' | 'dark';
  maxWidth?: number;
  horizontalMargin?: number;
  bottomOffset?: number;
};

type TabSpec = {
  key: ProxyTabKey;
  label: string;
  icon: string;
};

const TABS: readonly TabSpec[] = [
  { key: 'home', label: '首页', icon: 'house.fill' },
  { key: 'market', label: '市场', icon: 'magnifyingglass' },
  { key: 'feed', label: '动态', icon: 'square.stack.3d.up.fill' },
  { key: 'messages', label: '信息', icon: 'message.fill' },
  { key: 'me', label: '我的', icon: 'person.fill' },
] as const;

const DOCK_HEIGHT = 68;
const EDGE = 6;
const LENS_HEIGHT = 54;
const SPRING = {
  damping: 24,
  stiffness: 285,
  mass: 0.72,
  overshootClamping: false,
} as const;

const AnimatedGlassView = Animated.createAnimatedComponent(GlassView);

function clamp(value: number, min: number, max: number) {
  'worklet';
  return Math.min(max, Math.max(min, value));
}

function NativeOrFallbackDockGlass({
  nativeGlass,
  tone,
}: {
  nativeGlass: boolean;
  tone: 'light' | 'dark';
}) {
  if (nativeGlass) {
    return (
      <GlassView
        pointerEvents="none"
        style={StyleSheet.absoluteFill}
        glassEffectStyle="clear"
        colorScheme={tone}
        tintColor={tone === 'light' ? 'rgba(255,255,255,0.08)' : 'rgba(16,16,16,0.10)'}
      />
    );
  }

  return (
    <BlurView
      pointerEvents="none"
      intensity={72}
      tint={tone === 'light' ? 'systemUltraThinMaterialLight' : 'systemUltraThinMaterialDark'}
      style={StyleSheet.absoluteFill}
    />
  );
}

function NativeOrFallbackLensGlass({
  nativeGlass,
  tone,
}: {
  nativeGlass: boolean;
  tone: 'light' | 'dark';
}) {
  if (nativeGlass) {
    return (
      <GlassView
        pointerEvents="none"
        style={StyleSheet.absoluteFill}
        glassEffectStyle="regular"
        colorScheme={tone}
        tintColor={tone === 'light' ? 'rgba(255,255,255,0.13)' : 'rgba(255,255,255,0.06)'}
      />
    );
  }

  return (
    <BlurView
      pointerEvents="none"
      intensity={92}
      tint={tone === 'light' ? 'systemThinMaterialLight' : 'systemThinMaterialDark'}
      style={StyleSheet.absoluteFill}
    />
  );
}

export function ProxyLiquidDock({
  activeKey,
  onChange,
  tone = 'light',
  maxWidth = 430,
  horizontalMargin = 14,
  bottomOffset = 8,
}: ProxyLiquidDockProps) {
  const { width: screenWidth } = useWindowDimensions();
  const insets = useSafeAreaInsets();

  const dockWidth = Math.min(maxWidth, screenWidth - horizontalMargin * 2);
  const contentWidth = dockWidth - EDGE * 2;
  const slotWidth = contentWidth / TABS.length;
  const lensWidth = Math.min(64, slotWidth - 6);
  const activeIndex = Math.max(0, TABS.findIndex((tab) => tab.key === activeKey));

  const nativeGlass = useMemo(
    () => Platform.OS === 'ios' && isGlassEffectAPIAvailable(),
    [],
  );

  const xForIndex = useCallback(
    (index: number) => EDGE + slotWidth * index + (slotWidth - lensWidth) / 2,
    [lensWidth, slotWidth],
  );

  const lensX = useSharedValue(xForIndex(activeIndex));
  const dragStartX = useSharedValue(xForIndex(activeIndex));
  const stretch = useSharedValue(0);
  const lean = useSharedValue(0);

  useEffect(() => {
    lensX.value = withSpring(xForIndex(activeIndex), SPRING);
  }, [activeIndex, lensX, xForIndex]);

  const commitIndex = useCallback(
    (index: number) => {
      const next = TABS[index];
      if (!next) return;
      void Haptics.selectionAsync();
      onChange(next.key);
    },
    [onChange],
  );

  const pressTab = useCallback(
    (index: number) => {
      lensX.value = withSpring(xForIndex(index), SPRING);
      stretch.value = withSpring(0, SPRING);
      lean.value = withSpring(0, SPRING);
      commitIndex(index);
    },
    [commitIndex, lean, lensX, stretch, xForIndex],
  );

  const minLensX = xForIndex(0);
  const maxLensX = xForIndex(TABS.length - 1);

  const panGesture = useMemo(
    () =>
      Gesture.Pan()
        .activeOffsetX([-7, 7])
        .failOffsetY([-16, 16])
        .onBegin(() => {
          dragStartX.value = lensX.value;
        })
        .onUpdate((event) => {
          const next = clamp(
            dragStartX.value + event.translationX,
            minLensX,
            maxLensX,
          );
          lensX.value = next;

          const motion = Math.min(
            1,
            Math.abs(event.translationX) / 90 + Math.abs(event.velocityX) / 1800,
          );
          stretch.value = motion;
          lean.value = clamp(event.velocityX / 1800, -1, 1);
        })
        .onEnd(() => {
          const center = lensX.value + lensWidth / 2;
          const rawIndex = (center - EDGE) / slotWidth - 0.5;
          const index = clamp(Math.round(rawIndex), 0, TABS.length - 1);

          const targetX = EDGE + slotWidth * index + (slotWidth - lensWidth) / 2;
          lensX.value = withSpring(targetX, SPRING);
          stretch.value = withSpring(0, SPRING);
          lean.value = withSpring(0, SPRING);
          scheduleOnRN(commitIndex, index);
        })
        .onFinalize(() => {
          stretch.value = withSpring(0, SPRING);
          lean.value = withSpring(0, SPRING);
        }),
    [
      commitIndex,
      dragStartX,
      lean,
      lensWidth,
      lensX,
      maxLensX,
      minLensX,
      slotWidth,
      stretch,
      xForIndex,
    ],
  );

  const lensAnimatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: lensX.value },
      { translateY: stretch.value * 0.4 },
      { scaleX: 1 + stretch.value * 0.16 },
      { scaleY: 1 - stretch.value * 0.055 },
      { rotateZ: `${lean.value * 1.15}deg` },
    ],
  }));

  const ink = tone === 'light' ? '#101010' : '#FFFFFF';
  const inactiveInk = tone === 'light' ? 'rgba(16,16,16,0.46)' : 'rgba(255,255,255,0.52)';
  const border = tone === 'light' ? 'rgba(255,255,255,0.28)' : 'rgba(255,255,255,0.18)';

  return (
    <View
      pointerEvents="box-none"
      style={[
        styles.positioner,
        {
          bottom: Math.max(insets.bottom, bottomOffset),
          width: dockWidth,
        },
      ]}
    >
      <GestureDetector gesture={panGesture}>
        <Animated.View
          style={[
            styles.dock,
            {
              width: dockWidth,
              borderColor: border,
              backgroundColor:
                tone === 'light' ? 'rgba(255,255,255,0.055)' : 'rgba(0,0,0,0.055)',
            },
          ]}
        >
          {nativeGlass ? (
            <GlassContainer pointerEvents="none" spacing={10} style={StyleSheet.absoluteFill}>
              <GlassView
                style={StyleSheet.absoluteFill}
                glassEffectStyle="clear"
                colorScheme={tone}
                tintColor={tone === 'light' ? 'rgba(255,255,255,0.08)' : 'rgba(16,16,16,0.10)'}
              />

              <AnimatedGlassView
                style={[
                  styles.lens,
                  { width: lensWidth },
                  lensAnimatedStyle,
                ]}
                glassEffectStyle="regular"
                colorScheme={tone}
                tintColor={tone === 'light' ? 'rgba(255,255,255,0.13)' : 'rgba(255,255,255,0.06)'}
              />
            </GlassContainer>
          ) : (
            <>
              <NativeOrFallbackDockGlass nativeGlass={false} tone={tone} />
              <Animated.View
                pointerEvents="none"
                style={[
                  styles.lens,
                  { width: lensWidth },
                  lensAnimatedStyle,
                ]}
              >
                <NativeOrFallbackLensGlass nativeGlass={false} tone={tone} />
              </Animated.View>
            </>
          )}

          {/* Optical surface treatment: no drop shadow, only thin refraction highlights. */}
          <View pointerEvents="none" style={styles.topRefraction} />
          <View pointerEvents="none" style={styles.bottomRefraction} />
          <View pointerEvents="none" style={styles.leftGlint} />
          <View pointerEvents="none" style={styles.rightGlint} />

          <View style={styles.tabsRow}>
            {TABS.map((tab, index) => {
              const selected = index === activeIndex;
              return (
                <Pressable
                  key={tab.key}
                  accessibilityRole="tab"
                  accessibilityState={{ selected }}
                  accessibilityLabel={tab.label}
                  hitSlop={8}
                  onPress={() => pressTab(index)}
                  style={[styles.tab, { width: slotWidth }]}
                >
                  <SymbolView
                    name={tab.icon as never}
                    size={22}
                    weight={selected ? 'semibold' : 'regular'}
                    tintColor={selected ? ink : inactiveInk}
                  />
                  <Text
                    numberOfLines={1}
                    style={[
                      styles.label,
                      {
                        color: selected ? ink : inactiveInk,
                        fontWeight: selected ? '600' : '500',
                      },
                    ]}
                  >
                    {tab.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </Animated.View>
      </GestureDetector>
    </View>
  );
}

const styles = StyleSheet.create({
  positioner: {
    position: 'absolute',
    alignSelf: 'center',
    zIndex: 100,
  },
  dock: {
    height: DOCK_HEIGHT,
    borderRadius: 34,
    borderCurve: 'continuous',
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  lens: {
    position: 'absolute',
    left: 0,
    top: (DOCK_HEIGHT - LENS_HEIGHT) / 2,
    height: LENS_HEIGHT,
    borderRadius: 28,
    borderCurve: 'continuous',
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.34)',
    backgroundColor: 'rgba(255,255,255,0.035)',
  },
  tabsRow: {
    position: 'absolute',
    left: EDGE,
    right: EDGE,
    top: 0,
    bottom: 0,
    flexDirection: 'row',
    alignItems: 'stretch',
  },
  tab: {
    height: DOCK_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  label: {
    fontSize: 10.5,
    lineHeight: 13,
    letterSpacing: -0.12,
  },
  topRefraction: {
    position: 'absolute',
    top: 1,
    left: 24,
    right: 24,
    height: StyleSheet.hairlineWidth,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.50)',
  },
  bottomRefraction: {
    position: 'absolute',
    bottom: 1,
    left: 34,
    right: 34,
    height: StyleSheet.hairlineWidth,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.10)',
  },
  leftGlint: {
    position: 'absolute',
    left: 2,
    top: 18,
    width: StyleSheet.hairlineWidth,
    height: 28,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.20)',
  },
  rightGlint: {
    position: 'absolute',
    right: 2,
    top: 18,
    width: StyleSheet.hairlineWidth,
    height: 28,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
});

import type { ReactNode } from "react";
import {
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
  type ImageSourcePropType,
  type StyleProp,
  type TextStyle,
  type ViewStyle
} from "react-native";
import { foundation } from "../theme";

type ButtonTone = "primary" | "secondary" | "ghost" | "danger";

export function ProxyButton({
  children,
  disabled = false,
  onPress,
  tone = "primary",
  style
}: {
  children: ReactNode;
  disabled?: boolean;
  onPress?: () => void;
  tone?: ButtonTone;
  style?: StyleProp<ViewStyle>;
}): React.JSX.Element {
  const textTone: Record<ButtonTone, StyleProp<TextStyle>> = {
    primary: styles.buttonTextInverse,
    secondary: styles.buttonText,
    ghost: styles.buttonText,
    danger: styles.buttonTextInverse
  };
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[styles.button, styles[`button_${tone}`], disabled && styles.disabled, style]}
    >
      {typeof children === "string" ? <Text style={[styles.buttonText, textTone[tone]]}>{children}</Text> : children}
    </Pressable>
  );
}

export function ProxyIconButton({
  accessibilityLabel,
  children,
  disabled = false,
  onPress,
  selected = false,
  style
}: {
  accessibilityLabel: string;
  children: ReactNode;
  disabled?: boolean;
  onPress?: () => void;
  selected?: boolean;
  style?: StyleProp<ViewStyle>;
}): React.JSX.Element {
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      accessibilityState={{ disabled, selected }}
      disabled={disabled}
      onPress={onPress}
      style={[styles.iconButton, selected && styles.iconButtonSelected, disabled && styles.disabled, style]}
    >
      {children}
    </Pressable>
  );
}

export function ProxyAvatar({
  accessibilityLabel,
  fallback,
  size = 44,
  source
}: {
  accessibilityLabel: string;
  fallback: string;
  size?: 32 | 44 | 60;
  source?: ImageSourcePropType;
}): React.JSX.Element {
  return (
    <View accessibilityLabel={accessibilityLabel} style={[styles.avatar, { height: size, width: size }]}>
      {source ? <Image source={source} style={styles.avatarImage} /> : <Text style={styles.avatarFallback}>{fallback.slice(0, 1)}</Text>}
    </View>
  );
}

export function ProxyTabs<T extends string>({
  activeId,
  items,
  onChange,
  style
}: {
  activeId: T;
  items: ReadonlyArray<{ id: T; label: string }>;
  onChange: (id: T) => void;
  style?: StyleProp<ViewStyle>;
}): React.JSX.Element {
  return (
    <View accessibilityRole="tablist" style={[styles.tabs, style]}>
      {items.map((item) => {
        const active = item.id === activeId;
        return (
          <Pressable
            key={item.id}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            onPress={() => onChange(item.id)}
            style={styles.tab}
          >
            <Text style={[styles.tabText, active && styles.tabTextActive]}>{item.label}</Text>
            {active ? <View style={styles.tabUnderline} /> : null}
          </Pressable>
        );
      })}
    </View>
  );
}

export function ProxySwitch({
  accessibilityLabel,
  onChange,
  value
}: {
  accessibilityLabel: string;
  onChange: (value: boolean) => void;
  value: boolean;
}): React.JSX.Element {
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="switch"
      accessibilityState={{ checked: value }}
      onPress={() => onChange(!value)}
      style={[styles.switch, value && styles.switchOn]}
    >
      <View style={[styles.switchKnob, value && styles.switchKnobOn]} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  avatar: { alignItems: "center", backgroundColor: foundation.surfaceSecondary, borderColor: foundation.line, borderRadius: foundation.radius.full, borderWidth: 1, justifyContent: "center", overflow: "hidden" },
  avatarFallback: { color: foundation.ink, fontSize: foundation.text.sm, fontWeight: "800" },
  avatarImage: { height: "100%", width: "100%" },
  button: { alignItems: "center", borderRadius: foundation.radius.sm, borderWidth: 1, flexDirection: "row", gap: foundation.space.two, justifyContent: "center", minHeight: foundation.control.md, paddingHorizontal: 14 },
  button_primary: { backgroundColor: foundation.ink, borderColor: foundation.ink },
  button_secondary: { backgroundColor: foundation.surface, borderColor: foundation.line },
  button_ghost: { backgroundColor: "transparent", borderColor: "transparent" },
  button_danger: { backgroundColor: foundation.danger, borderColor: foundation.danger },
  buttonText: { color: foundation.ink, fontSize: foundation.text.sm, fontWeight: "800" },
  buttonTextInverse: { color: foundation.surface },
  disabled: { opacity: 0.42 },
  iconButton: { alignItems: "center", backgroundColor: foundation.surface, borderColor: foundation.line, borderRadius: foundation.radius.full, borderWidth: 1, height: foundation.control.md, justifyContent: "center", width: foundation.control.md },
  iconButtonSelected: { backgroundColor: foundation.ink, borderColor: foundation.ink },
  tabs: { borderBottomColor: foundation.line, borderBottomWidth: 1, flexDirection: "row", gap: foundation.space.four },
  tab: { alignItems: "center", flex: 1, minHeight: foundation.control.md, justifyContent: "center", paddingHorizontal: 1, position: "relative" },
  tabText: { color: foundation.muted, fontSize: foundation.text.sm },
  tabTextActive: { color: foundation.ink, fontWeight: "800" },
  tabUnderline: { backgroundColor: foundation.ink, bottom: -1, height: 2, left: 0, position: "absolute", right: 0 },
  switch: { backgroundColor: foundation.surfaceSecondary, borderColor: foundation.line, borderRadius: foundation.radius.full, borderWidth: 1, height: 28, justifyContent: "center", padding: 3, width: 46 },
  switchOn: { backgroundColor: foundation.ink, borderColor: foundation.ink },
  switchKnob: { backgroundColor: foundation.surface, borderColor: foundation.line, borderRadius: foundation.radius.full, borderWidth: 1, height: 20, width: 20 },
  switchKnobOn: { transform: [{ translateX: 18 }] }
});

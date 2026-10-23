// SITE-SEARCH-001：各个「搜索」按钮通往全站搜索页的统一入口。
//
// 每个页面自己的搜索框仍然做**就地筛选**（动态筛已加载的帖子、消息筛会话、场景页筛场景……），
// 那是最快的路径；但它们的范围各不相同，谁也不是「全站」。这个入口把「换到全站搜」变成一步：
//   · variant="box"  —— 长得像搜索框、其实是入口（点开就是全站搜索页），用在没有就地搜索框的页面；
//   · variant="row"  —— 用户已经在就地搜索框里输入了词，这一行把同一个词带去全站搜：
//                       「全站搜索“咖啡”」。词为空时不该出现（调用方负责），因为空词没有可带的东西。
// 文案走 i18n（六种语言齐），所以宿主页面是不是已经国际化无所谓。
import { Pressable, StyleSheet, Text, type StyleProp, type ViewStyle } from "react-native";
import { color } from "../theme";
import { useI18n } from "../i18n";
import { ProxyIcon } from "./proxy-icon";

export function SiteSearchEntry({
  variant,
  query,
  onPress,
  style,
}: {
  variant: "box" | "row";
  /** row 变体带去全站搜的词；box 变体忽略。 */
  query?: string | undefined;
  onPress: () => void;
  style?: StyleProp<ViewStyle>;
}): React.JSX.Element {
  const { t } = useI18n();
  const word = (query ?? "").trim();
  const label = variant === "box"
    ? t("siteSearchPlaceholder")
    : word === "" ? t("siteSearchEntry") : t("siteSearchEntryFor", { q: word });
  return (
    <Pressable
      accessibilityLabel={variant === "box" ? t("siteSearchEntry") : label}
      accessibilityRole="button"
      onPress={onPress}
      style={[variant === "box" ? styles.box : styles.row, style]}
    >
      <ProxyIcon color={color.muted} name="search" size={variant === "box" ? 16 : 15} />
      <Text numberOfLines={1} selectable style={variant === "box" ? styles.boxText : styles.rowText}>{label}</Text>
      {variant === "row" ? <ProxyIcon color={color.muted} name="chevronRight" size={14} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  box: { alignItems: "center", backgroundColor: color.white, borderColor: color.line, borderRadius: 13, borderWidth: 1, flexDirection: "row", gap: 8, minHeight: 44, paddingHorizontal: 12 },
  boxText: { color: color.muted, flex: 1, fontSize: 14, fontWeight: "700" },
  row: { alignItems: "center", backgroundColor: color.surface, borderRadius: 12, flexDirection: "row", gap: 8, minHeight: 42, paddingHorizontal: 12 },
  rowText: { color: color.ink, flex: 1, fontSize: 13.5, fontWeight: "900" },
});

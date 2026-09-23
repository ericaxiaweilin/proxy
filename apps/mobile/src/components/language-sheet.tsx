// HOME-I18N-001：原型页头那个「中」按钮点开的面板（deepseek_html_20260922_1c2e2c.html
// 的 .lang-sheet / .lang-list / .lang-item）。
//
// 尺寸/间距照原型的 CSS：面板圆角 24、header 居中 + 1px 分隔线、每行
// padding 14/16 + 圆角 14 + gap 14、旗标 24、名称 14/800、副标题 11.5/500、
// 选中行浅色底 + ✓。
//
// 两个本仓的取舍：
//
// 1. **副标题用 12 而不是原型的 11.5**：design-system-r3 要求 UI 文本 >= 11pt，
//    11.5 虽然过线，但这里统一取整更稳。
// 2. **选中底用的是 token `color.stateInfoBg`（#F1F7FF）**，不是原型的字面
//    量 #f0f4ff —— 两者几乎同色，但走 token 才跟主题一起变。
//
// 这是一个 **Modal**，不是内嵌覆盖层：它挂在首页（不在任何 Modal 里），
// 所以没有「更多」整页那种 iOS 嵌套 Modal 被吞的问题（见 requester-home.tsx
// 的 HOME-MORE-SHEET-004）。如果以后要把它挂进「更多」页内部，必须先改成
// 普通 View 覆盖层，否则点了不会弹。

import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { color } from "../theme";
import { LANGUAGES, useI18n, type Language } from "../i18n";
import { saveLanguage } from "../preferences";

export function LanguageSheet({
  visible,
  onClose
}: {
  visible: boolean;
  onClose: () => void;
}): React.JSX.Element {
  const { lang, t, setLanguage } = useI18n();

  function choose(code: Language): void {
    // 先改内存态（界面立刻切换），再落盘。落盘失败不该挡住用户 ——
    // 本次会话已经切过去了，最多是下次冷启动回到旧语言。
    setLanguage(code);
    void saveLanguage(code);
    onClose();
  }

  return (
    <Modal transparent animationType="fade" visible={visible} onRequestClose={onClose}>
      <Pressable accessibilityLabel={t("cancel")} onPress={onClose} style={styles.backdrop}>
        {/* onStartShouldSetResponder 挡住"点面板本身也关掉"的冒泡 */}
        <View onStartShouldSetResponder={() => true} style={styles.sheet}>
          <View style={styles.grab} />
          <View style={styles.header}>
            <Text style={styles.title}>{t("selectLanguage")}</Text>
          </View>
          <View style={styles.list}>
            {LANGUAGES.map((option) => {
              const on = option.code === lang;
              return (
                <Pressable
                  key={option.code}
                  accessibilityLabel={`${option.name} / ${option.english}${on ? t("selectedSuffix") : ""}`}
                  accessibilityState={{ selected: on }}
                  onPress={() => choose(option.code)}
                  style={[styles.item, on && styles.itemOn]}
                >
                  <Text style={styles.flag}>{option.flag}</Text>
                  <View style={styles.info}>
                    <Text style={styles.name}>{option.name}</Text>
                    <Text style={styles.native}>{option.english}</Text>
                  </View>
                  {on ? <Text style={styles.check}>✓</Text> : null}
                </Pressable>
              );
            })}
          </View>
        </View>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    backgroundColor: "rgba(0,0,0,0.32)",
    bottom: 0,
    justifyContent: "flex-end",
    left: 0,
    position: "absolute",
    right: 0,
    top: 0
  },
  sheet: {
    backgroundColor: color.white,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingBottom: 20
  },
  grab: {
    alignSelf: "center",
    backgroundColor: "#DDD",
    borderRadius: 4,
    height: 4,
    marginTop: 10,
    width: 42
  },
  header: {
    alignItems: "center",
    borderBottomColor: color.line,
    borderBottomWidth: 1,
    padding: 20
  },
  title: { color: color.ink, fontSize: 16, fontWeight: "800" },
  list: { paddingBottom: 12, paddingHorizontal: 12, paddingTop: 8 },
  item: {
    alignItems: "center",
    borderRadius: 14,
    flexDirection: "row",
    gap: 14,
    paddingHorizontal: 16,
    paddingVertical: 14
  },
  itemOn: { backgroundColor: color.stateInfoBg },
  flag: { fontSize: 24 },
  info: { flex: 1, minWidth: 0 },
  name: { color: color.ink, fontSize: 14, fontWeight: "800", marginBottom: 2 },
  native: { color: color.muted, fontSize: 12, fontWeight: "500" },
  check: { color: color.violet, fontSize: 16, fontWeight: "800" }
});

// MARKET-QUOTE-SHEET-001: 报价从详情页的 4 格选择 + 一个小输入框,
// 变成一屏独立的"你的报价" sheet。
//
// 这件事为什么单独一屏：详情页同时承担了"读订单"和"出价"两件事 ——
// 用户先要看清楚客户、时间、地点, 然后再单独决定金额。Prototype 也是
// 这么分的。把报价挤压在详情底部一个 grid 里, 等于强迫用户在"理解订单"
// 和"想好金额"之间来回切, 而且报价区的"参考区间 / 私密度声明 / 锚定说明"
// 都没有地方放。
//
// 这里钉的:
  //   · 输入用 K VND(prototype 同款), 不直接堆 6 位数 ——
 //     prototype 是「120」+「K VND」两段, 不是 120000。
//   · 顶部明确写「这不是你的固定价格」—— 参考区间只供锚定, 不能让报价 UI
//     看起来像是在定一个长期价。
//   · 三个预设从参考区间内插 (low/mid/high), 用户不点预设也要落到 mid。

import { useMemo, useState } from "react";
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { MarketTypeLogo, type MarketOpportunityType } from "../components/market-type-logo";
import { TYPE_LABEL, type OpportunityType, inferOpportunityTypeForFilter } from "./r37-opportunity-card";
import { color } from "../theme";

export type QuoteSheetOpportunity = {
  id: string;
  title: string;
  // price 是客户预算的原串(可能含 ₫ / 逗号 / TBD), 服务端权威, client 只解析。
  price: string;
  desc?: string;
  date: string;
  time: string;
  location: string;
  opportunityType?: MarketOpportunityType;
  theme?: string;
  skills?: string;
};

export type OpportunityQuoteSheetProps = {
  visible: boolean;
  opportunity: QuoteSheetOpportunity;
  // 参考区间(单位 K VND)。预算不可解析时(low=high=0) 不显示区间 + 预设。
  fairLowK: number;
  fairHighK: number;
  busy: boolean;
  onClose: () => void;
  // 父组件拿到 K VND 整数(120 表示 120,000₫), 自己拼字符串后再走 onApply。
  onSubmit: (quoteK: number) => void;
};

export function OpportunityQuoteSheet(props: OpportunityQuoteSheetProps): React.JSX.Element {
  const { visible, opportunity, fairLowK, fairHighK, busy, onClose, onSubmit } = props;
  const type: OpportunityType = inferOpportunityTypeForFilter(opportunity);
  const typeLabel = TYPE_LABEL[type];
  // 中位默认 = round((low+high)/2), 锚到 10 的倍数, 跟 prototype 的 100/120/150 一致。
  const defaultMid = useMemo(() => {
    if (fairLowK <= 0 || fairHighK <= 0) return 0;
    return Math.max(10, Math.round(((fairLowK + fairHighK) / 2) / 10) * 10);
  }, [fairLowK, fairHighK]);
  const [value, setValue] = useState<number>(defaultMid);
  const [error, setError] = useState<string | undefined>(undefined);

  // visible 切到 true 时重置输入 —— 否则上次输到一半下一次打开还在。
  const openKey = visible ? "open" : "closed";
  const [openedAt, setOpenedAt] = useState<number>(0);
  if (visible && openedAt !== opportunity.id.length) {
    setValue(defaultMid);
    setError(undefined);
    setOpenedAt(opportunity.id.length);
  }

  const presets: ReadonlyArray<number> = fairLowK > 0 && fairHighK > 0
    ? [Math.round(fairLowK), defaultMid, Math.round(fairHighK)]
    : [];
  const hasRange = fairLowK > 0 && fairHighK > 0;

  const submit = (): void => {
    if (!Number.isFinite(value) || value <= 0) {
      setError("请输入一个大于 0 的金额。");
      return;
    }
    setError(undefined);
    onSubmit(value);
  };

  // prototype 的"今天 15:00 · Cầu Giấy · 正常咖啡交流"是一行小灰字。
  const contextLine = [opportunity.date, opportunity.time, opportunity.location, opportunity.desc ? opportunity.desc.split(/[，。.；;]/)[0] : undefined].filter(Boolean).join(" · ");

  return (
    <Modal animationType="slide" presentationStyle="formSheet" visible={visible} onRequestClose={onClose}>
      <View style={styles.root}>
        <View style={styles.head}>
          <Pressable onPress={onClose} style={styles.back}>
            <Text selectable style={styles.backText}>‹</Text>
          </Pressable>
          <Text selectable style={styles.headTitle}>你的报价</Text>
          <View style={styles.headSpacer} />
        </View>

        <View style={styles.body}>
          <Text selectable style={styles.kicker}>{typeLabel.sub.toUpperCase()} · {hasRange ? `${fairLowK}–${fairHighK}K` : "费用待面谈"}</Text>
          <Text selectable style={styles.title}>为这一类订单提交你的报价</Text>
          <View style={styles.divider} />

          <View style={styles.typeRow}>
            <MarketTypeLogo type={type} size="FILTER" />
            <View style={styles.typeMeta}>
              <Text selectable style={styles.typeMetaLabel}>订单类型</Text>
              <Text selectable style={styles.typeMetaTitle}>{typeLabel.label}</Text>
            </View>
          </View>

          {contextLine ? <Text selectable style={styles.context}>{contextLine}</Text> : null}

          <View style={styles.rangeRow}>
            <Text selectable style={styles.rangeLabel}>当前参考区间</Text>
            <Text selectable style={styles.rangeValue}>{hasRange ? `${fairLowK}–${fairHighK}K` : "—"}</Text>
            {hasRange ? <Text selectable style={styles.rangeNote}>可协商</Text> : null}
          </View>

          <View style={[styles.bigInput, error && styles.bigInputError]}>
            <TextInput
              accessibilityLabel="报价金额（千越南盾）"
              keyboardType="number-pad"
              maxLength={4}
              onChangeText={(text) => {
                const digits = text.replace(/[^0-9]/g, "");
                setValue(digits === "" ? 0 : Number(digits));
                setError(undefined);
              }}
              placeholder="0"
              placeholderTextColor="#A9A2B0"
              style={styles.bigInputField}
              value={value > 0 ? String(value) : ""}
            />
            <Text selectable style={styles.bigInputUnit}>K VND</Text>
          </View>
          <Text selectable style={styles.private}>你的报价是私密的 · 客户可接受或继续协商</Text>

          {presets.length === 3 ? (
            <View style={styles.presetRow}>
              {presets.map((preset) => (
                <Pressable key={preset} onPress={() => { setValue(preset); setError(undefined); }} style={[styles.preset, value === preset && styles.presetOn]}>
                  <Text selectable style={[styles.presetText, value === preset && styles.presetTextOn]}>{preset}K</Text>
                </Pressable>
              ))}
            </View>
          ) : null}

          {error ? <Text selectable style={styles.error}>{error}</Text> : null}

          <Pressable disabled={busy} onPress={submit} style={[styles.submit, busy && styles.submitBusy]}>
            <Text selectable style={styles.submitText}>{busy ? "提交中…" : "提交报名"}</Text>
          </Pressable>

          <Text selectable style={styles.foot}>参考区间只供你锚定, 不是固定价格, 你可以在合理范围内自行报价, Proxy 只在后台做极异常筛查(异常报价)。</Text>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { backgroundColor: color.white, flex: 1 },
  head: { alignItems: "center", flexDirection: "row", paddingHorizontal: 14, paddingVertical: 10 },
  back: { paddingHorizontal: 6, paddingVertical: 4, width: 32 },
  backText: { color: color.ink, fontSize: 22, fontWeight: "700" },
  headTitle: { color: color.ink, flex: 1, fontSize: 16, fontWeight: "800", textAlign: "center" },
  headSpacer: { width: 32 },
  body: { paddingHorizontal: 18, paddingTop: 6 },
  kicker: { color: "#AAA49C", fontSize: 11, fontWeight: "700", letterSpacing: 0.5, marginBottom: 4 },
  title: { color: color.ink, fontSize: 17, fontWeight: "800", lineHeight: 24 },
  divider: { backgroundColor: color.line, height: StyleSheet.hairlineWidth, marginBottom: 16, marginTop: 12 },
  typeRow: { alignItems: "center", flexDirection: "row", gap: 10, marginBottom: 16 },
  typeMeta: { flex: 1, minWidth: 0 },
  typeMetaLabel: { color: "#AAA49C", fontSize: 10, fontWeight: "700", letterSpacing: 0.3 },
  typeMetaTitle: { color: color.ink, fontSize: 13, fontWeight: "800", lineHeight: 17, marginTop: 2 },
  context: { color: "#8F8A82", fontSize: 11, lineHeight: 16, marginBottom: 14 },
  rangeRow: { alignItems: "center", flexDirection: "row", marginBottom: 12 },
  rangeLabel: { color: "#AAA49C", flex: 1, fontSize: 11, fontWeight: "700", letterSpacing: 0.3 },
  rangeValue: { color: color.ink, fontSize: 13, fontWeight: "800" },
  rangeNote: { color: "#8F8A82", fontSize: 11, marginLeft: 8 },
  bigInput: { alignItems: "center", borderColor: color.line, borderRadius: 12, borderWidth: 1, flexDirection: "row", gap: 8, justifyContent: "center", marginTop: 4, minHeight: 84, paddingHorizontal: 16 },
  bigInputError: { borderColor: "#A32D2D" },
  bigInputField: { color: color.ink, fontSize: 42, fontWeight: "900", minWidth: 80, paddingVertical: 12, textAlign: "right" },
  bigInputUnit: { color: "#7A7570", fontSize: 13, fontWeight: "800" },
  private: { color: "#8F8A82", fontSize: 11, lineHeight: 16, marginTop: 8, textAlign: "center" },
  presetRow: { flexDirection: "row", gap: 10, marginTop: 18 },
  preset: { alignItems: "center", backgroundColor: color.white, borderColor: color.line, borderRadius: 10, borderWidth: 1, flex: 1, paddingVertical: 12 },
  presetOn: { backgroundColor: "#F1ECE3", borderColor: "#1F1B16" },
  presetText: { color: "#1F1B16", fontSize: 13, fontWeight: "800" },
  presetTextOn: { color: color.ink },
  error: { color: "#A32D2D", fontSize: 12, marginTop: 10 },
  submit: { alignItems: "center", backgroundColor: color.ink, borderRadius: 12, marginTop: 22, paddingVertical: 14 },
  submitBusy: { opacity: 0.6 },
  submitText: { color: color.white, fontSize: 14, fontWeight: "900" },
  foot: { color: "#8F8A82", fontSize: 11, lineHeight: 17, marginTop: 12 },
});
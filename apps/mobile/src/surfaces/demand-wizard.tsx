// DemandWizard — R58 发布需求一期向导（Moment 模板 → 规格确认 → 成功）。
//
// 一期范围：模板与参考价为前端常量；发布走 marketplace.publish
// （与现有“发布订单”同通道，成功即进市场）；选人匹配与备注走二期
// 草稿流，一期不收不做，成功页对象恒为公开市场。
import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import type { MarketplaceClient } from "../marketplace-client";
import type { MarketOpportunity } from "../market-fixtures";
import { color, shadows } from "../theme";
import { buildDemandPublishInput, defaultSpecsFor, MOMENT_TEMPLATES, type DemandSpecs, type MomentTemplate } from "../demand-moments";

type Step = "moment" | "specs" | "done";

const DURATIONS = ["2 小时", "半天", "全天"];
const PREF_OPTIONS = ["公共场所见面", "中文", "附近"];

export function DemandWizard({ marketplace, onBack, onPublished, onViewMarket }: {
  marketplace: MarketplaceClient;
  onBack: () => void;
  onPublished: (opportunity: MarketOpportunity) => void;
  onViewMarket: () => void;
}): React.JSX.Element {
  const [step, setStep] = useState<Step>("moment");
  const [template, setTemplate] = useState<MomentTemplate>(MOMENT_TEMPLATES[0]!);
  const [specs, setSpecs] = useState<DemandSpecs>(() => defaultSpecsFor(MOMENT_TEMPLATES[0]!));
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState<string>();
  const [result, setResult] = useState<MarketOpportunity>();

  function pickTemplate(next: MomentTemplate): void {
    setTemplate(next);
    setSpecs(defaultSpecsFor(next));
    setError(undefined);
    setStep("specs");
  }

  function togglePref(pref: string): void {
    setSpecs((prev) => ({
      ...prev,
      prefs: prev.prefs.includes(pref) ? prev.prefs.filter((item) => item !== pref) : [...prev.prefs, pref]
    }));
  }

  async function publish(): Promise<void> {
    if (publishing) return;
    if (specs.price.trim() === "") {
      setError("请填写预计服务价（可按参考价填，可协商）。");
      return;
    }
    setPublishing(true);
    setError(undefined);
    try {
      const opportunity = await marketplace.publish(buildDemandPublishInput(template, specs));
      setResult(opportunity);
      onPublished(opportunity);
      setStep("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "发布失败，请重试。");
    } finally {
      setPublishing(false);
    }
  }

  function restart(): void {
    const first = MOMENT_TEMPLATES[0]!;
    setTemplate(first);
    setSpecs(defaultSpecsFor(first));
    setError(undefined);
    setResult(undefined);
    setStep("moment");
  }

  return (
    <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <View style={styles.head}>
        <Pressable accessibilityLabel="返回" onPress={() => { if (step === "moment") onBack(); else if (step === "specs") setStep("moment"); }} style={styles.backBtn}>
          <Text style={styles.backText}>‹</Text>
        </Pressable>
        <Text style={styles.title}>{step === "done" ? "✓ 需求已发布" : "发布需求"}</Text>
        <View style={styles.headSpacer} />
      </View>

      {step === "moment" ? (
        <>
          <Text style={styles.sectionTitle}>想约什么？左边找方向，右边直接选一个 Moment。</Text>
          <Text style={styles.sectionSub}>Moment · 人与场景优先</Text>
          {MOMENT_TEMPLATES.map((item) => (
            <Pressable key={item.id} accessibilityLabel={`选择${item.title}`} onPress={() => pickTemplate(item)} style={styles.momentCard}>
              <View style={styles.momentEmoji}><Text style={styles.momentEmojiText}>{item.emoji}</Text></View>
              <View style={styles.momentCopy}>
                <Text style={styles.momentTitle}>{item.title}</Text>
                <Text style={styles.momentDesc}>{item.venueLabel}</Text>
                <Text style={styles.momentMeta}>{item.defaultRatio} · {item.defaultTime} · 参考 {item.priceRef}</Text>
              </View>
            </Pressable>
          ))}
        </>
      ) : step === "specs" ? (
        <>
          <View style={styles.confirmCard}>
            <View style={styles.confirmCopy}>
              <Text style={styles.confirmEyebrow}>Moment · {specs.ratio}</Text>
              <Text style={styles.confirmTitle}>{template.title}</Text>
            </View>
            <Pressable onPress={() => setStep("moment")}><Text style={styles.linkText}>更换</Text></Pressable>
          </View>

          <Text style={styles.fieldLabel}>你们几人</Text>
          <View style={styles.chipRow}>
            {template.ratios.map((ratio) => (
              <Pressable key={ratio} onPress={() => setSpecs((prev) => ({ ...prev, ratio }))} style={[styles.chip, specs.ratio === ratio && styles.chipOn]}>
                <Text style={[styles.chipText, specs.ratio === ratio && styles.chipTextOn]}>{ratio}</Text>
              </Pressable>
            ))}
          </View>

          <Text style={styles.fieldLabel}>时间段</Text>
          <TextInput onChangeText={(time) => setSpecs((prev) => ({ ...prev, time }))} placeholder={template.defaultTime} placeholderTextColor={color.muted} style={styles.input} value={specs.time} />

          <Text style={styles.fieldLabel}>时长</Text>
          <View style={styles.chipRow}>
            {DURATIONS.map((duration) => (
              <Pressable key={duration} onPress={() => setSpecs((prev) => ({ ...prev, duration }))} style={[styles.chip, specs.duration === duration && styles.chipOn]}>
                <Text style={[styles.chipText, specs.duration === duration && styles.chipTextOn]}>{duration}</Text>
              </Pressable>
            ))}
          </View>

          <Text style={styles.fieldLabel}>地点</Text>
          <TextInput onChangeText={(place) => setSpecs((prev) => ({ ...prev, place }))} placeholder={template.venue} placeholderTextColor={color.muted} style={styles.input} value={specs.place} />

          <Text style={styles.fieldLabel}>场景偏好</Text>
          <View style={styles.chipRow}>
            {PREF_OPTIONS.map((pref) => (
              <Pressable key={pref} onPress={() => togglePref(pref)} style={[styles.chip, specs.prefs.includes(pref) && styles.chipOn]}>
                <Text style={[styles.chipText, specs.prefs.includes(pref) && styles.chipTextOn]}>{pref}</Text>
              </Pressable>
            ))}
          </View>

          <Text style={styles.fieldLabel}>预计服务价</Text>
          <TextInput keyboardType="numbers-and-punctuation" onChangeText={(price) => setSpecs((prev) => ({ ...prev, price }))} placeholder={template.defaultPrice} placeholderTextColor={color.muted} style={styles.input} value={specs.price} />
          <Text style={styles.hint}>参考 {template.priceRef} · 可协商；现场消费不包含在内。</Text>

          {error ? <Text style={styles.error}>{error}</Text> : null}
          <Pressable disabled={publishing} onPress={() => void publish()} style={[styles.primaryBtn, publishing && styles.disabled]}>
            <Text style={styles.primaryBtnText}>{publishing ? "发布中…" : "发布到市场"}</Text>
          </Pressable>
        </>
      ) : (
        <>
          <Text style={styles.doneSub}>你的需求已经进入市场。</Text>
          <View style={styles.summaryCard}>
            <Text style={styles.summaryEyebrow}>Opportunity</Text>
            <Text style={styles.summaryTitle}>{result?.title ?? template.title}</Text>
            <SummaryRow label="对象" value="公开市场" />
            <SummaryRow label="人数" value={specs.ratio} />
            <SummaryRow label="时间" value={`${specs.time} · ${specs.duration}`} />
            <SummaryRow label="地点" value={specs.place} />
            <SummaryRow label="价格" value={`${specs.price} · 可协商`} last />
          </View>
          <View style={styles.doneRow}>
            <Pressable onPress={restart} style={styles.secondaryBtn}><Text style={styles.secondaryBtnText}>再发一个</Text></Pressable>
            <Pressable onPress={onViewMarket} style={styles.primaryBtnFlex}><Text style={styles.primaryBtnText}>查看市场</Text></Pressable>
          </View>
        </>
      )}
    </ScrollView>
  );
}

function SummaryRow({ label, value, last }: { label: string; value: string; last?: boolean }): React.JSX.Element {
  return (
    <View style={[styles.summaryRow, last && styles.summaryRowLast]}>
      <Text style={styles.summaryLabel}>{label}</Text>
      <Text style={styles.summaryValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { paddingBottom: 32, paddingHorizontal: 16, paddingTop: 8 },
  head: { alignItems: "center", flexDirection: "row", marginBottom: 12 },
  backBtn: { alignItems: "center", height: 38, justifyContent: "center", width: 38 },
  backText: { color: color.ink, fontSize: 24, fontWeight: "800", lineHeight: 28 },
  title: { color: color.ink, flex: 1, fontSize: 20, fontWeight: "900", textAlign: "center" },
  headSpacer: { width: 38 },
  sectionTitle: { color: color.ink, fontSize: 16, fontWeight: "800" },
  sectionSub: { color: color.muted, fontSize: 12, marginBottom: 12, marginTop: 4 },
  momentCard: { alignItems: "center", backgroundColor: color.white, borderColor: color.line, borderRadius: 18, borderWidth: 1, flexDirection: "row", gap: 12, marginBottom: 10, padding: 14 },
  momentEmoji: { alignItems: "center", backgroundColor: color.surface, borderRadius: 22, height: 44, justifyContent: "center", width: 44 },
  momentEmojiText: { color: color.ink, fontSize: 20, fontWeight: "800" },
  momentCopy: { flex: 1 },
  momentTitle: { color: color.ink, fontSize: 16, fontWeight: "800" },
  momentDesc: { color: color.muted, fontSize: 12, marginTop: 2 },
  momentMeta: { color: color.violet, fontSize: 11, fontWeight: "700", marginTop: 4 },
  confirmCard: { alignItems: "center", backgroundColor: color.white, borderColor: color.line, borderRadius: 18, borderWidth: 1, flexDirection: "row", marginBottom: 6, padding: 14 },
  confirmCopy: { flex: 1 },
  confirmEyebrow: { color: color.violet, fontSize: 11, fontWeight: "800" },
  confirmTitle: { color: color.ink, fontSize: 19, fontWeight: "900", marginTop: 2 },
  linkText: { color: color.violet, fontSize: 13, fontWeight: "700" },
  fieldLabel: { color: color.ink, fontSize: 13, fontWeight: "800", marginBottom: 6, marginTop: 14 },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { backgroundColor: color.white, borderColor: color.line, borderRadius: 999, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 8 },
  chipOn: { backgroundColor: color.ink, borderColor: color.ink },
  chipText: { color: color.ink, fontSize: 13, fontWeight: "700" },
  chipTextOn: { color: color.white },
  input: { backgroundColor: color.white, borderColor: color.line, borderRadius: 12, borderWidth: 1, color: color.ink, fontSize: 15, paddingHorizontal: 14, paddingVertical: 10 },
  hint: { color: color.muted, fontSize: 11, marginTop: 6 },
  error: { color: color.error, fontSize: 12, marginTop: 12, textAlign: "center" },
  primaryBtn: { alignItems: "center", backgroundColor: color.magenta, borderRadius: 14, marginTop: 18, minHeight: 50, justifyContent: "center" },
  primaryBtnFlex: { alignItems: "center", backgroundColor: color.magenta, borderRadius: 14, flex: 1, minHeight: 50, justifyContent: "center" },
  primaryBtnText: { color: color.white, fontSize: 15, fontWeight: "900" },
  secondaryBtn: { alignItems: "center", borderColor: color.line, borderRadius: 14, borderWidth: 1, flex: 1, minHeight: 50, justifyContent: "center" },
  secondaryBtnText: { color: color.ink, fontSize: 15, fontWeight: "800" },
  disabled: { opacity: 0.5 },
  doneSub: { color: color.muted, fontSize: 13, marginBottom: 12 },
  summaryCard: { backgroundColor: color.white, borderColor: color.line, borderRadius: 18, borderWidth: 1, padding: 14 },
  summaryEyebrow: { color: color.violet, fontSize: 11, fontWeight: "800" },
  summaryTitle: { color: color.ink, fontSize: 19, fontWeight: "900", marginTop: 2 },
  summaryRow: { borderBottomColor: color.line, borderBottomWidth: 1, flexDirection: "row", justifyContent: "space-between", paddingVertical: 10 },
  summaryRowLast: { borderBottomWidth: 0 },
  summaryLabel: { color: color.muted, fontSize: 13 },
  summaryValue: { color: color.ink, fontSize: 13, fontWeight: "700" },
  doneRow: { flexDirection: "row", gap: 10, marginTop: 16 }
});

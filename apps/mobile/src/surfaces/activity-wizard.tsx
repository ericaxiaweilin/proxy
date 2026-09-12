// ActivityWizard — R58 创建活动二期向导（模板 → 设置 → 预览 → 成功）。
//
// 发布走 activities.publish（与旧表单同通道）；新增字段（场地类型扩展、
// 报名方式、主题、展示编号）由服务端支撑。费用映射见 activity-moments。
import { useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import type { ActivityClient } from "../activity-client";
import type { Activity } from "@proxy/contracts";
import { color } from "../theme";
import {
  ACTIVITY_FEES,
  ACTIVITY_SIGNUPS,
  ACTIVITY_SIZES,
  ACTIVITY_TEMPLATES,
  ACTIVITY_THEMES,
  ACTIVITY_TIMES,
  buildActivityPublishInput,
  defaultActivitySpecs,
  type ActivityFeeId,
  type ActivitySpecs,
  type ActivityTemplate
} from "../activity-moments";

type Step = "template" | "settings" | "preview" | "done";

export function ActivityWizard({ activities, scenes, onBack, onPublished, onViewActivities, onOpenDemand, onReloadScenes }: {
  activities: ActivityClient;
  scenes: Activity[];
  onBack: () => void;
  onPublished: (activity: Activity) => void;
  onViewActivities: () => void;
  onOpenDemand: () => void;
  onReloadScenes: () => void;
}): React.JSX.Element {
  const [step, setStep] = useState<Step>("template");
  const [template, setTemplate] = useState<ActivityTemplate>(ACTIVITY_TEMPLATES[0]!);
  const [specs, setSpecs] = useState<ActivitySpecs>(() => defaultActivitySpecs(ACTIVITY_TEMPLATES[0]!));
  const [sceneId, setSceneId] = useState("");
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState<string>();
  const [result, setResult] = useState<Activity>();

  const sceneOptions = useMemo(() => {
    const unique = new Map<string, Activity>();
    scenes.forEach((item) => {
      if (item.realitySceneId && !unique.has(item.realitySceneId)) unique.set(item.realitySceneId, item);
    });
    return [...unique.values()];
  }, [scenes]);

  function pickTemplate(next: ActivityTemplate): void {
    setTemplate(next);
    setSpecs(defaultActivitySpecs(next));
    setError(undefined);
    setStep("settings");
  }

  async function publish(): Promise<void> {
    if (publishing) return;
    if (!sceneId) {
      setError("请先选择一个地点 / Scene。");
      return;
    }
    if (specs.capacity < 2 || specs.capacity > 50) {
      setError("人数须为 2–50 人。");
      return;
    }
    setPublishing(true);
    setError(undefined);
    try {
      const created = await activities.publish(buildActivityPublishInput(template, specs, sceneId));
      setResult(created);
      onPublished(created);
      setStep("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "创建失败，请重试。");
    } finally {
      setPublishing(false);
    }
  }

  function restart(): void {
    const first = ACTIVITY_TEMPLATES[0]!;
    setTemplate(first);
    setSpecs(defaultActivitySpecs(first));
    setSceneId("");
    setError(undefined);
    setResult(undefined);
    setStep("template");
  }

  function back(): void {
    if (step === "template") onBack();
    else if (step === "settings") setStep("template");
    else if (step === "preview") setStep("settings");
  }

  return (
    <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <View style={styles.head}>
        <Pressable accessibilityLabel="返回" onPress={back} style={styles.backBtn}>
          <Text style={styles.backText}>‹</Text>
        </Pressable>
        <Text style={styles.title}>{step === "done" ? "✓ 活动已创建" : "创建活动"}</Text>
        <View style={styles.headSpacer} />
      </View>
      {step === "done" ? null : (
        <View style={styles.tabs}>
          <Pressable accessibilityLabel="去发布需求" onPress={onOpenDemand} style={styles.tab}>
            <Text style={styles.tabText}>发布需求</Text>
          </Pressable>
          <View style={[styles.tab, styles.tabActive]}><Text style={[styles.tabText, styles.tabTextActive]}>创建活动</Text></View>
        </View>
      )}

      {step === "template" ? (
        <>
          <View style={styles.hero}>
            <Text style={styles.heroTitle}>想组织什么？</Text>
            <Text style={styles.heroSub}>活动强调多人参与；先选一个完整玩法。</Text>
          </View>
          <View style={styles.sectionHead}>
            <Text style={styles.sectionTitle}>热门活动</Text>
            <Text style={styles.sectionHint}>直接选</Text>
          </View>
          <View style={styles.activityGrid}>
            {ACTIVITY_TEMPLATES.map((item) => (
              <Pressable key={item.id} accessibilityLabel={`选择${item.title}`} onPress={() => pickTemplate(item)} style={styles.activityPreset}>
                <Text style={styles.activityMark}>{item.emoji}</Text>
                <Text style={styles.activityPresetTitle} numberOfLines={1}>{item.title}</Text>
                <Text style={styles.activityPresetMeta} numberOfLines={1}>{item.meta}</Text>
              </Pressable>
            ))}
          </View>
          <View style={styles.currentCard}>
            <Text style={styles.currentLabel}>当前活动</Text>
            <Text style={styles.currentValue}>{template.title}</Text>
          </View>
        </>
      ) : step === "settings" ? (
        <>
          <View style={styles.confirmCard}>
            <View style={styles.confirmCopy}>
              <Text style={styles.confirmEyebrow}>Activity</Text>
              <Text style={styles.confirmTitle}>{template.title}</Text>
            </View>
            <Pressable onPress={() => setStep("template")}><Text style={styles.linkText}>更换</Text></Pressable>
          </View>

          <Text style={styles.fieldLabel}>参与人数</Text>
          <View style={styles.chipRow}>
            {ACTIVITY_SIZES.map((size) => (
              <Pressable key={size.label} onPress={() => setSpecs((prev) => ({ ...prev, capacity: size.value }))} style={[styles.chip, specs.capacity === size.value && styles.chipOn]}>
                <Text style={[styles.chipText, specs.capacity === size.value && styles.chipTextOn]}>{size.label}</Text>
              </Pressable>
            ))}
          </View>

          <Text style={styles.fieldLabel}>时间段</Text>
          <View style={styles.chipRow}>
            {ACTIVITY_TIMES.map((time) => (
              <Pressable key={time} onPress={() => setSpecs((prev) => ({ ...prev, time }))} style={[styles.chip, specs.time === time && styles.chipOn]}>
                <Text style={[styles.chipText, specs.time === time && styles.chipTextOn]}>{time}</Text>
              </Pressable>
            ))}
          </View>
          <TextInput onChangeText={(time) => setSpecs((prev) => ({ ...prev, time }))} placeholder="自定义时间" placeholderTextColor={color.muted} style={[styles.input, styles.gapTop]} value={specs.time} />

          <Text style={styles.fieldLabel}>地点 / Scene</Text>
          {sceneOptions.length === 0 ? (
            <View style={styles.emptyRow}>
              <Text style={styles.hint}>暂无可选场景，可能是列表尚未加载成功。</Text>
              <Pressable accessibilityLabel="重新加载场景" onPress={onReloadScenes} style={styles.retryBtn}>
                <Text style={styles.retryText}>重新加载</Text>
              </Pressable>
            </View>
          ) : (
            <View style={styles.chipRow}>
              {sceneOptions.map((scene) => (
                <Pressable key={scene.realitySceneId} onPress={() => { setSceneId(scene.realitySceneId ?? ""); setSpecs((prev) => ({ ...prev, venueName: scene.venueName })); }} style={[styles.chip, sceneId === scene.realitySceneId && styles.chipOn]}>
                  <Text style={[styles.chipText, sceneId === scene.realitySceneId && styles.chipTextOn]}>{scene.venueName}</Text>
                </Pressable>
              ))}
            </View>
          )}
          <TextInput onChangeText={(venueName) => setSpecs((prev) => ({ ...prev, venueName }))} placeholder={template.venueName} placeholderTextColor={color.muted} style={[styles.input, styles.gapTop]} value={specs.venueName} />

          <Text style={styles.fieldLabel}>主题</Text>
          <View style={styles.chipRow}>
            {ACTIVITY_THEMES.map((theme) => (
              <Pressable key={theme} onPress={() => setSpecs((prev) => ({ ...prev, theme: theme === "无主题" ? "" : theme }))} style={[styles.chip, (specs.theme === theme || (theme === "无主题" && specs.theme === "")) && styles.chipOn]}>
                <Text style={[styles.chipText, (specs.theme === theme || (theme === "无主题" && specs.theme === "")) && styles.chipTextOn]}>{theme}</Text>
              </Pressable>
            ))}
          </View>

          <Text style={styles.fieldLabel}>报名方式</Text>
          <View style={styles.chipRow}>
            {ACTIVITY_SIGNUPS.map((signup) => (
              <Pressable key={signup.id} onPress={() => setSpecs((prev) => ({ ...prev, signup: signup.id }))} style={[styles.chip, specs.signup === signup.id && styles.chipOn]}>
                <Text style={[styles.chipText, specs.signup === signup.id && styles.chipTextOn]}>{signup.label}</Text>
              </Pressable>
            ))}
          </View>

          <Text style={styles.fieldLabel}>费用</Text>
          <View style={styles.chipRow}>
            {ACTIVITY_FEES.map((fee) => (
              <Pressable key={fee.id} onPress={() => setSpecs((prev) => ({ ...prev, fee: fee.id }))} style={[styles.chip, specs.fee === fee.id && styles.chipOn]}>
                <Text style={[styles.chipText, specs.fee === fee.id && styles.chipTextOn]}>{fee.label}</Text>
              </Pressable>
            ))}
          </View>
          {specs.fee === "CUSTOM" ? (
            <TextInput onChangeText={(customFee) => setSpecs((prev) => ({ ...prev, customFee }))} placeholder="自定义金额，如 300K" placeholderTextColor={color.muted} style={[styles.input, styles.gapTop]} value={specs.customFee} />
          ) : null}

          <Text style={styles.fieldLabel}>补充说明 · 可选</Text>
          <TextInput maxLength={500} multiline onChangeText={(notes) => setSpecs((prev) => ({ ...prev, notes }))} placeholder="补充说明" placeholderTextColor={color.muted} style={[styles.input, styles.notesInput]} value={specs.notes} />

          {error ? <Text style={styles.error}>{error}</Text> : null}
          <Pressable disabled={publishing} onPress={() => setStep("preview")} style={[styles.primaryBtn, styles.gapTop]}>
            <Text style={styles.primaryBtnText}>下一步 · 预览</Text>
          </Pressable>
        </>
      ) : step === "preview" ? (
        <>
          <Text style={styles.sectionTitle}>发布预览</Text>
          <View style={styles.summaryCard}>
            <Text style={styles.summaryTitle}>{template.title}</Text>
            <SummaryRow label="人数" value={`${specs.capacity} 人`} />
            <SummaryRow label="时间" value={specs.time} />
            <SummaryRow label="地点" value={specs.venueName} />
            <SummaryRow label="报名" value={ACTIVITY_SIGNUPS.find((item) => item.id === specs.signup)?.label ?? specs.signup} />
            <SummaryRow label="费用" value={specs.fee === "FREE" ? "免费" : specs.fee === "AA" ? "AA" : `自定义（${specs.customFee || "待定"}）`} last />
          </View>
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <View style={styles.doneRow}>
            <Pressable onPress={() => setStep("settings")} style={styles.secondaryBtn}><Text style={styles.secondaryBtnText}>上一步</Text></Pressable>
            <Pressable disabled={publishing} onPress={() => void publish()} style={[styles.primaryBtnFlex, publishing && styles.disabled]}>
              <Text style={styles.primaryBtnText}>{publishing ? "创建中…" : "创建活动"}</Text>
            </Pressable>
          </View>
        </>
      ) : (
        <>
          <Text style={styles.doneSub}>活动已经进入市场 · 活动，其他用户可以查看并报名。</Text>
          <View style={styles.summaryCard}>
            <Text style={styles.summaryEyebrow}>Activity</Text>
            <Text style={styles.summaryTitle}>{result?.title ?? template.title}</Text>
            <SummaryRow label="活动编号" value={result?.code ?? ""} />
            <SummaryRow label="人数" value={`${specs.capacity} 人`} />
            <SummaryRow label="时间" value={specs.time} />
            <SummaryRow label="地点" value={specs.venueName} />
            <SummaryRow label="报名" value={ACTIVITY_SIGNUPS.find((item) => item.id === specs.signup)?.label ?? specs.signup} last />
          </View>
          <View style={styles.doneRow}>
            <Pressable onPress={restart} style={styles.secondaryBtn}><Text style={styles.secondaryBtnText}>再建一个</Text></Pressable>
            <Pressable onPress={onViewActivities} style={styles.primaryBtnFlex}><Text style={styles.primaryBtnText}>查看活动</Text></Pressable>
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
      <Text selectable style={styles.summaryValue}>{value}</Text>
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
  tabs: { flexDirection: "row", gap: 8, marginBottom: 10 },
  tab: { alignItems: "center", borderColor: color.line, borderRadius: 12, borderWidth: 1, flex: 1, paddingVertical: 10 },
  tabActive: { backgroundColor: color.ink, borderColor: color.ink },
  tabText: { color: color.ink, fontSize: 14, fontWeight: "800" },
  tabTextActive: { color: color.white },
  sectionTitle: { color: color.ink, fontSize: 16, fontWeight: "800", marginBottom: 12 },
  sectionHead: { alignItems: "baseline", flexDirection: "row", gap: 7, marginBottom: 4, marginTop: 10 },
  sectionHint: { color: color.muted, fontSize: 11 },
  // R58 热门活动 grid preset 卡。
  hero: { paddingTop: 2 },
  heroTitle: { color: color.ink, fontSize: 24, fontWeight: "900" },
  heroSub: { color: color.muted, fontSize: 13, marginTop: 3 },
  activityGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  activityPreset: { backgroundColor: color.white, borderColor: color.line, borderRadius: 16, borderWidth: 1, padding: 11, width: "48%" },
  activityMark: { color: color.ink, fontSize: 16, fontWeight: "800" },
  activityPresetTitle: { color: color.ink, fontSize: 14, fontWeight: "800", marginTop: 6 },
  activityPresetMeta: { color: color.muted, fontSize: 11, marginTop: 3 },
  currentCard: { backgroundColor: color.surface, borderRadius: 14, marginTop: 12, padding: 12 },
  currentLabel: { color: color.muted, fontSize: 11, fontWeight: "700" },
  currentValue: { color: color.ink, fontSize: 14, fontWeight: "800", marginTop: 2 },
  momentCard: { alignItems: "center", backgroundColor: color.white, borderColor: color.line, borderRadius: 18, borderWidth: 1, flexDirection: "row", gap: 12, marginBottom: 10, padding: 14 },
  momentEmoji: { alignItems: "center", backgroundColor: color.surface, borderRadius: 22, height: 44, justifyContent: "center", width: 44 },
  momentEmojiText: { color: color.ink, fontSize: 20, fontWeight: "800" },
  momentCopy: { flex: 1 },
  momentTitle: { color: color.ink, fontSize: 16, fontWeight: "800" },
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
  emptyRow: { alignItems: "center", flexDirection: "row", gap: 10, marginVertical: 6 },
  retryBtn: { borderColor: color.violet, borderRadius: 999, borderWidth: 1.5, paddingHorizontal: 14, paddingVertical: 7 },
  retryText: { color: color.violet, fontSize: 12, fontWeight: "800" },
  gapTop: { marginTop: 8 },
  notesInput: { minHeight: 64, textAlignVertical: "top" },
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

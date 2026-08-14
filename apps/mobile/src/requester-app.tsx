import { useMemo, useState } from "react";
import { ActivityIndicator, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { DemandClient, DemandCommandRejectedError } from "./demand-client";
import {
  buildTaskDraftChanges,
  createInitialNeedForm,
  describeNeed,
  scenarioLabel,
  validateNeedForm,
  type NeedForm,
  type NeedFormErrors,
  type RequesterScenario
} from "./requester-experience";

type Route = "HOME" | "CAPTURE" | "PREVIEW" | "PROGRESS";

type Journey = {
  draftId: string;
  version: number;
  status: "DRAFT" | "READY" | "PENDING" | "COMMITTED";
  operationRef?: string;
};

type ConfirmationState = {
  scope: boolean;
  materialChange: boolean;
  funding: boolean;
};

const inspiration: Array<{ scenario: RequesterScenario; eyebrow: string; title: string; body: string }> = [
  { scenario: "STORE_OPENING", eyebrow: "门店场景", title: "让开业现场更从容", body: "接待、签到、引导与现场负责人，一次说清结果。" },
  { scenario: "EVENT_SUPPORT", eyebrow: "活动场景", title: "把临时现场工作交出去", body: "从人数、时间到交付证据，先预览再决定。" },
  { scenario: "ADMIN_SUPPORT", eyebrow: "商务场景", title: "补上短期执行缺口", body: "行政协助、资料整理与现场支持都可以形成需求。" }
];

export function RequesterApp({ demandClient, onSignOut }: { demandClient: DemandClient; onSignOut: () => Promise<void> }): React.JSX.Element {
  const [route, setRoute] = useState<Route>("HOME");
  const [form, setForm] = useState<NeedForm>(() => createInitialNeedForm());
  const [formErrors, setFormErrors] = useState<NeedFormErrors>({});
  const [journey, setJourney] = useState<Journey>();
  const [confirmation, setConfirmation] = useState<ConfirmationState>({ scope: false, materialChange: false, funding: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const allConfirmed = confirmation.scope && confirmation.materialChange && confirmation.funding;

  const title = useMemo(() => {
    if (route === "CAPTURE") return "把想法变成可执行需求";
    if (route === "PREVIEW") return "先看方案，再做决定";
    if (route === "PROGRESS") return journey?.status === "COMMITTED" ? "需求已发布" : "正在完成发布门禁";
    return "今天想让什么结果发生？";
  }, [journey?.status, route]);

  function updateField<Key extends keyof NeedForm>(key: Key, value: NeedForm[Key]): void {
    setForm((current) => ({ ...current, [key]: value }));
    setFormErrors((current) => ({ ...current, [key]: undefined, ...(key === "startTime" || key === "endTime" || key === "date" ? { timeRange: undefined } : {}) }));
  }

  function startFromScenario(scenario: RequesterScenario): void {
    setForm((current) => ({
      ...current,
      scenario,
      sourceInput: scenario === "STORE_OPENING"
        ? "希望开业现场的来宾被及时接待、签到和引导"
        : scenario === "ADMIN_SUPPORT"
          ? "需要临时行政人员协助整理资料并完成现场支持"
          : "需要现场人员协助活动执行，让流程有序完成"
    }));
    setRoute("CAPTURE");
  }

  async function preparePreview(): Promise<void> {
    const errors = validateNeedForm(form);
    setFormErrors(errors);
    if (Object.keys(errors).length > 0) return;
    setBusy(true);
    setError(undefined);
    try {
      let draftId = journey?.draftId;
      let version = journey?.version;
      if (!draftId || !version) {
        const created = await demandClient.createDraft(form.sourceInput.trim());
        draftId = created.aggregate!.id;
        version = created.aggregate!.version;
      }
      const updated = await demandClient.updateDraft(draftId, version, buildTaskDraftChanges(form));
      version = updated.aggregate!.version;
      await demandClient.previewDraft(draftId, version);
      setJourney({ draftId, version, status: "READY" });
      setConfirmation({ scope: false, materialChange: false, funding: false });
      setRoute("PREVIEW");
    } catch (caught) {
      setError(messageFor(caught));
    } finally {
      setBusy(false);
    }
  }

  async function publish(): Promise<void> {
    if (!journey || !allConfirmed) return;
    setBusy(true);
    setError(undefined);
    try {
      const confirmationPayload = {
        scopeConfirmed: confirmation.scope,
        materialChangePolicyConfirmed: confirmation.materialChange,
        fundingAuthorizationConfirmed: confirmation.funding,
        maxBudgetMinor: Math.round(Number(form.budget) * 100)
      };
      const updated = await demandClient.updateDraft(journey.draftId, journey.version, buildTaskDraftChanges(form, confirmationPayload));
      const result = await demandClient.publishTask(journey.draftId, updated.aggregate!.version);
      setJourney({
        draftId: journey.draftId,
        version: result.aggregate?.version ?? updated.aggregate!.version,
        status: result.outcome === "ACCEPTED" || result.outcome === "ALREADY_APPLIED" ? "COMMITTED" : "PENDING",
        ...(result.operationRef ? { operationRef: result.operationRef } : {})
      });
      setRoute("PROGRESS");
    } catch (caught) {
      setError(messageFor(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.topBar}>
        {route === "HOME" ? <Text style={styles.wordmark}>PROXY</Text> : (
          <Pressable accessibilityRole="button" onPress={() => setRoute(route === "CAPTURE" ? "HOME" : "CAPTURE")} style={styles.backButton}>
            <Text style={styles.backText}>‹ 返回</Text>
          </Pressable>
        )}
        <View style={styles.principalPill}><View style={styles.onlineDot} /><Text style={styles.principalText}>个人需求方</Text></View>
      </View>

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.eyebrow}>{route === "HOME" ? "REQUESTER COCKPIT" : "NEED → OUTCOME"}</Text>
        <Text style={styles.pageTitle}>{title}</Text>
        {route === "HOME" ? <Home journey={journey} form={form} onCreate={() => setRoute("CAPTURE")} onContinue={() => setRoute(journey?.status === "PENDING" || journey?.status === "COMMITTED" ? "PROGRESS" : "PREVIEW")} onScenario={startFromScenario} /> : null}
        {route === "CAPTURE" ? <Capture form={form} errors={formErrors} busy={busy} error={error} onChange={updateField} onPreview={() => void preparePreview()} /> : null}
        {route === "PREVIEW" ? <Preview form={form} confirmation={confirmation} busy={busy} error={error} onConfirmation={setConfirmation} onPublish={() => void publish()} /> : null}
        {route === "PROGRESS" && journey ? <Progress journey={journey} form={form} onHome={() => setRoute("HOME")} /> : null}

        {route === "HOME" ? (
          <Pressable accessibilityRole="button" onPress={() => void onSignOut()} style={styles.signOutButton}>
            <Text style={styles.signOutText}>退出当前账户</Text>
          </Pressable>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function Home({ journey, form, onCreate, onContinue, onScenario }: { journey: Journey | undefined; form: NeedForm; onCreate: () => void; onContinue: () => void; onScenario: (scenario: RequesterScenario) => void }): React.JSX.Element {
  return (
    <>
      <Pressable onPress={onCreate} style={({ pressed }) => [styles.heroCard, pressed && styles.pressed]}>
        <View style={styles.heroIcon}><Text style={styles.heroIconText}>＋</Text></View>
        <View style={styles.flexOne}>
          <Text style={styles.heroTitle}>创建一个需求</Text>
          <Text style={styles.heroBody}>先说想要的结果，Proxy 帮你形成可执行方案。</Text>
        </View>
        <Text style={styles.arrow}>→</Text>
      </Pressable>

      <SectionTitle title="进行中" action={journey ? "继续" : undefined} />
      {journey ? (
        <Pressable onPress={onContinue} style={({ pressed }) => [styles.progressCard, pressed && styles.pressed]}>
          <View style={styles.rowBetween}><Text style={styles.cardTitle}>{describeNeed(form)}</Text><StatusPill status={journey.status} /></View>
          <Text style={styles.cardBody}>{journey.status === "READY" ? "方案已生成，等待你的明确确认。" : journey.status === "PENDING" ? "准入或资金门禁处理中，不会显示虚假成功。" : "需求已进入执行准备。"}</Text>
          <View style={styles.progressTrack}><View style={[styles.progressFill, { width: journey.status === "READY" ? "72%" : journey.status === "PENDING" ? "86%" : "100%" }]} /></View>
        </Pressable>
      ) : <EmptyCard title="暂无进行中的需求" body="新需求会在这里展示真实进展、待确认事项和下一步。" />}

      <SectionTitle title="与你可能相关" />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.horizontalList}>
        {inspiration.map((item) => (
          <Pressable key={item.scenario} onPress={() => onScenario(item.scenario)} style={({ pressed }) => [styles.inspirationCard, pressed && styles.pressed]}>
            <Text style={styles.inspirationEyebrow}>{item.eyebrow}</Text>
            <Text style={styles.inspirationTitle}>{item.title}</Text>
            <Text style={styles.cardBody}>{item.body}</Text>
            <Text style={styles.inlineAction}>试试这个 →</Text>
          </Pressable>
        ))}
      </ScrollView>

      <View style={styles.twoColumn}>
        <View style={styles.halfCard}><Text style={styles.miniIcon}>◎</Text><Text style={styles.cardTitle}>可信的人与团队</Text><Text style={styles.cardBody}>完成合作后，可在这里快速复用。</Text></View>
        <View style={styles.halfCard}><Text style={styles.miniIcon}>↗</Text><Text style={styles.cardTitle}>最近结果</Text><Text style={styles.cardBody}>结果验证后，会保留事实与证据。</Text></View>
      </View>
    </>
  );
}

function Capture({ form, errors, busy, error, onChange, onPreview }: { form: NeedForm; errors: NeedFormErrors; busy: boolean; error: string | undefined; onChange: <Key extends keyof NeedForm>(key: Key, value: NeedForm[Key]) => void; onPreview: () => void }): React.JSX.Element {
  return (
    <View style={styles.formCard}>
      <Text style={styles.stepLabel}>01 · 先说结果</Text>
      <Field label="你希望发生什么？" error={errors.sourceInput}>
        <TextInput multiline onChangeText={(value) => onChange("sourceInput", value)} placeholder="例如：希望开业现场来宾被及时接待，签到不混乱" placeholderTextColor="#6F6C78" style={[styles.input, styles.textArea]} value={form.sourceInput} />
      </Field>

      <Text style={styles.fieldLabel}>场景</Text>
      <View style={styles.chipRow}>{(["STORE_OPENING", "EVENT_SUPPORT", "ADMIN_SUPPORT"] as RequesterScenario[]).map((scenario) => (
        <Pressable key={scenario} onPress={() => onChange("scenario", scenario)} style={[styles.chip, form.scenario === scenario && styles.chipActive]}>
          <Text style={[styles.chipText, form.scenario === scenario && styles.chipTextActive]}>{scenarioLabel(scenario)}</Text>
        </Pressable>
      ))}</View>

      <Field label="执行地点" error={errors.location}><TextInput onChangeText={(value) => onChange("location", value)} placeholder="地点或区域" placeholderTextColor="#6F6C78" style={styles.input} value={form.location} /></Field>
      <View style={styles.inputRow}>
        <View style={styles.inputGrow}><Field label="日期" error={errors.date}><TextInput onChangeText={(value) => onChange("date", value)} placeholder="YYYY-MM-DD" placeholderTextColor="#6F6C78" style={styles.input} value={form.date} /></Field></View>
        <View style={styles.inputSmall}><Field label="开始" error={errors.startTime}><TextInput onChangeText={(value) => onChange("startTime", value)} placeholder="09:00" placeholderTextColor="#6F6C78" style={styles.input} value={form.startTime} /></Field></View>
        <View style={styles.inputSmall}><Field label="结束" error={errors.endTime}><TextInput onChangeText={(value) => onChange("endTime", value)} placeholder="12:00" placeholderTextColor="#6F6C78" style={styles.input} value={form.endTime} /></Field></View>
      </View>
      {errors.timeRange ? <Text style={styles.fieldError}>{errors.timeRange}</Text> : null}
      <View style={styles.inputRow}>
        <View style={styles.inputGrow}><Field label="需要人数" error={errors.quantity}><TextInput keyboardType="number-pad" onChangeText={(value) => onChange("quantity", value)} style={styles.input} value={form.quantity} /></Field></View>
        <View style={styles.inputGrow}><Field label="最高预算（USD）" error={errors.budget}><TextInput keyboardType="decimal-pad" onChangeText={(value) => onChange("budget", value)} style={styles.input} value={form.budget} /></Field></View>
      </View>
      <InfoStrip text="此步骤只形成 Draft 和方案预览，不会自动收费或发布。" />
      {error ? <Text style={styles.errorText}>{error}</Text> : null}
      <PrimaryButton disabled={busy} label={busy ? "正在形成方案…" : "生成方案预览"} onPress={onPreview} />
    </View>
  );
}

function Preview({ form, confirmation, busy, error, onConfirmation, onPublish }: { form: NeedForm; confirmation: ConfirmationState; busy: boolean; error: string | undefined; onConfirmation: (next: ConfirmationState) => void; onPublish: () => void }): React.JSX.Element {
  const items = [
    ["目标", form.sourceInput],
    ["安排", describeNeed(form)],
    ["地点", form.location],
    ["预算上限", `$${Number(form.budget).toFixed(0)}`],
    ["匹配方式", "精选匹配 · 先校验资格与可用性"]
  ];
  return (
    <>
      <View style={styles.previewCard}>
        <View style={styles.rowBetween}><Text style={styles.stepLabel}>02 · 方案预览</Text><StatusPill status="READY" /></View>
        {items.map(([label, value]) => <View key={label} style={styles.summaryRow}><Text style={styles.summaryLabel}>{label}</Text><Text style={styles.summaryValue}>{value}</Text></View>)}
      </View>
      <View style={styles.formCard}>
        <Text style={styles.stepLabel}>03 · 明确确认</Text>
        <ConfirmationRow checked={confirmation.scope} label="范围与交付符合我的需求" onPress={() => onConfirmation({ ...confirmation, scope: !confirmation.scope })} />
        <ConfirmationRow checked={confirmation.materialChange} label="重大变化需重新向我确认" onPress={() => onConfirmation({ ...confirmation, materialChange: !confirmation.materialChange })} />
        <ConfirmationRow checked={confirmation.funding} label={`授权最高预算 $${Number(form.budget).toFixed(0)}`} onPress={() => onConfirmation({ ...confirmation, funding: !confirmation.funding })} />
        <InfoStrip text="发布仍需通过服务端准入与资金门禁；状态未知时只显示处理中。" />
        {error ? <Text style={styles.errorText}>{error}</Text> : null}
        <PrimaryButton disabled={busy || !(confirmation.scope && confirmation.materialChange && confirmation.funding)} label={busy ? "正在提交门禁…" : "确认并发布需求"} onPress={onPublish} />
      </View>
    </>
  );
}

function Progress({ journey, form, onHome }: { journey: Journey; form: NeedForm; onHome: () => void }): React.JSX.Element {
  const committed = journey.status === "COMMITTED";
  return (
    <View style={styles.progressPanel}>
      <View style={[styles.resultIcon, committed ? styles.resultIconSuccess : styles.resultIconPending]}><Text style={styles.resultIconText}>{committed ? "✓" : "…"}</Text></View>
      <Text style={styles.resultTitle}>{committed ? "需求已进入执行准备" : "已收到，正在完成门禁"}</Text>
      <Text style={styles.resultBody}>{committed ? "后续匹配与进展会在 Requester Cockpit 中持续更新。" : "准入或资金确认尚未完成。Proxy 不会在结果未知时显示已发布。"}</Text>
      <View style={styles.referenceCard}>
        <Text style={styles.referenceLabel}>需求摘要</Text><Text style={styles.referenceValue}>{describeNeed(form)}</Text>
        <Text style={styles.referenceLabel}>Draft reference</Text><Text style={styles.referenceMono}>{journey.draftId}</Text>
        {journey.operationRef ? <><Text style={styles.referenceLabel}>Operation reference</Text><Text style={styles.referenceMono}>{journey.operationRef}</Text></> : null}
      </View>
      <PrimaryButton label="返回需求方首页" onPress={onHome} />
    </View>
  );
}

function Field({ label, error, children }: { label: string; error: string | undefined; children: React.ReactNode }): React.JSX.Element {
  return <View style={styles.field}><Text style={styles.fieldLabel}>{label}</Text>{children}{error ? <Text style={styles.fieldError}>{error}</Text> : null}</View>;
}

function SectionTitle({ title, action }: { title: string; action?: string | undefined }): React.JSX.Element {
  return <View style={styles.sectionTitleRow}><Text style={styles.sectionTitle}>{title}</Text>{action ? <Text style={styles.sectionAction}>{action} →</Text> : null}</View>;
}

function EmptyCard({ title, body }: { title: string; body: string }): React.JSX.Element {
  return <View style={styles.emptyCard}><View style={styles.emptyDot} /><View style={styles.flexOne}><Text style={styles.cardTitle}>{title}</Text><Text style={styles.cardBody}>{body}</Text></View></View>;
}

function StatusPill({ status }: { status: Journey["status"] }): React.JSX.Element {
  const label = status === "READY" ? "待确认" : status === "PENDING" ? "处理中" : status === "COMMITTED" ? "已发布" : "草稿";
  return <View style={styles.statusPill}><Text style={styles.statusText}>{label}</Text></View>;
}

function ConfirmationRow({ checked, label, onPress }: { checked: boolean; label: string; onPress: () => void }): React.JSX.Element {
  return <Pressable onPress={onPress} style={styles.confirmationRow}><View style={[styles.checkbox, checked && styles.checkboxChecked]}><Text style={styles.checkboxText}>{checked ? "✓" : ""}</Text></View><Text style={styles.confirmationText}>{label}</Text></Pressable>;
}

function InfoStrip({ text }: { text: string }): React.JSX.Element {
  return <View style={styles.infoStrip}><Text style={styles.infoIcon}>i</Text><Text style={styles.infoText}>{text}</Text></View>;
}

function PrimaryButton({ label, onPress, disabled = false }: { label: string; onPress: () => void; disabled?: boolean }): React.JSX.Element {
  return <Pressable disabled={disabled} onPress={onPress} style={({ pressed }) => [styles.primaryButton, disabled && styles.disabled, pressed && styles.pressed]}><Text style={styles.primaryButtonText}>{label}</Text><Text style={styles.primaryArrow}>→</Text></Pressable>;
}

function messageFor(error: unknown): string {
  if (error instanceof DemandCommandRejectedError) {
    const code = error.result.error?.errorCode;
    if (code === "TASK_DRAFT_VERSION_CONFLICT") return "需求已在其他位置更新，请返回后重试。";
    if (code === "TASK_DRAFT_INCOMPLETE") return "还有必要信息未完成，请检查后再试。";
    if (code === "AUTHENTICATION_UNAVAILABLE" || code === "INVALID_ACCESS_TOKEN") return "安全会话不可用，请重新登录。";
    return `服务端未接受本次操作（${code ?? "UNKNOWN"}）。`;
  }
  return "暂时无法连接 Proxy 服务，请稍后重试。";
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: "#F4F2ED" },
  topBar: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", paddingHorizontal: 20, paddingVertical: 12 },
  wordmark: { color: "#17151B", fontSize: 20, fontWeight: "900", letterSpacing: 4 },
  backButton: { paddingVertical: 6 },
  backText: { color: "#5E2EBF", fontSize: 15, fontWeight: "700" },
  principalPill: { alignItems: "center", backgroundColor: "#FFFFFF", borderRadius: 999, flexDirection: "row", gap: 7, paddingHorizontal: 12, paddingVertical: 8 },
  onlineDot: { backgroundColor: "#37A56C", borderRadius: 4, height: 8, width: 8 },
  principalText: { color: "#4B4851", fontSize: 12, fontWeight: "700" },
  content: { paddingBottom: 48, paddingHorizontal: 20, paddingTop: 20 },
  eyebrow: { color: "#7653B8", fontSize: 11, fontWeight: "800", letterSpacing: 1.8, marginBottom: 10 },
  pageTitle: { color: "#17151B", fontSize: 32, fontWeight: "800", letterSpacing: -1.1, lineHeight: 39, marginBottom: 24, maxWidth: 360 },
  heroCard: { alignItems: "center", backgroundColor: "#5E2EBF", borderRadius: 24, flexDirection: "row", gap: 14, padding: 20 },
  heroIcon: { alignItems: "center", backgroundColor: "rgba(255,255,255,0.16)", borderRadius: 16, height: 48, justifyContent: "center", width: 48 },
  heroIconText: { color: "#FFFFFF", fontSize: 28, fontWeight: "300" },
  heroTitle: { color: "#FFFFFF", fontSize: 18, fontWeight: "800", marginBottom: 5 },
  heroBody: { color: "#E5D8FF", fontSize: 13, lineHeight: 19 },
  arrow: { color: "#FFFFFF", fontSize: 22 },
  flexOne: { flex: 1 },
  sectionTitleRow: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", marginBottom: 12, marginTop: 28 },
  sectionTitle: { color: "#242127", fontSize: 18, fontWeight: "800" },
  sectionAction: { color: "#6B3BC5", fontSize: 13, fontWeight: "700" },
  progressCard: { backgroundColor: "#FFFFFF", borderColor: "#E3DFD8", borderRadius: 20, borderWidth: 1, padding: 18 },
  rowBetween: { alignItems: "center", flexDirection: "row", gap: 12, justifyContent: "space-between" },
  cardTitle: { color: "#26232A", fontSize: 15, fontWeight: "800", lineHeight: 20 },
  cardBody: { color: "#77727D", fontSize: 13, lineHeight: 19, marginTop: 7 },
  progressTrack: { backgroundColor: "#EEEAE4", borderRadius: 4, height: 6, marginTop: 16, overflow: "hidden" },
  progressFill: { backgroundColor: "#6D3CC8", borderRadius: 4, height: 6 },
  statusPill: { backgroundColor: "#F0E7FF", borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6 },
  statusText: { color: "#6231BD", fontSize: 11, fontWeight: "800" },
  emptyCard: { alignItems: "center", backgroundColor: "#FFFFFF", borderColor: "#E3DFD8", borderRadius: 20, borderWidth: 1, flexDirection: "row", gap: 14, padding: 18 },
  emptyDot: { backgroundColor: "#D6D0C7", borderRadius: 7, height: 14, width: 14 },
  horizontalList: { gap: 12, paddingRight: 20 },
  inspirationCard: { backgroundColor: "#242127", borderRadius: 20, minHeight: 190, padding: 18, width: 240 },
  inspirationEyebrow: { color: "#B79AEE", fontSize: 11, fontWeight: "800", letterSpacing: 1, marginBottom: 18 },
  inspirationTitle: { color: "#FFFFFF", fontSize: 18, fontWeight: "800", lineHeight: 23 },
  inlineAction: { color: "#CDB8F7", fontSize: 13, fontWeight: "800", marginTop: 18 },
  twoColumn: { flexDirection: "row", gap: 12, marginTop: 24 },
  halfCard: { backgroundColor: "#FFFFFF", borderColor: "#E3DFD8", borderRadius: 20, borderWidth: 1, flex: 1, padding: 16 },
  miniIcon: { color: "#6940B6", fontSize: 23, marginBottom: 20 },
  signOutButton: { alignItems: "center", marginTop: 28, padding: 12 },
  signOutText: { color: "#817C85", fontSize: 13, fontWeight: "700" },
  formCard: { backgroundColor: "#FFFFFF", borderColor: "#E3DFD8", borderRadius: 24, borderWidth: 1, gap: 4, padding: 20 },
  stepLabel: { color: "#6C3CC5", fontSize: 12, fontWeight: "900", letterSpacing: 1.2, marginBottom: 16 },
  field: { marginBottom: 16 },
  fieldLabel: { color: "#39353D", fontSize: 13, fontWeight: "800", marginBottom: 8 },
  input: { backgroundColor: "#F7F5F1", borderColor: "#E3DFD8", borderRadius: 14, borderWidth: 1, color: "#1F1C22", fontSize: 15, paddingHorizontal: 14, paddingVertical: 13 },
  textArea: { minHeight: 104, textAlignVertical: "top" },
  fieldError: { color: "#B73E53", fontSize: 11, marginTop: 6 },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 18 },
  chip: { backgroundColor: "#F1EEE9", borderColor: "#E3DFD8", borderRadius: 999, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 9 },
  chipActive: { backgroundColor: "#EEE4FF", borderColor: "#8A5CD6" },
  chipText: { color: "#625D67", fontSize: 12, fontWeight: "700" },
  chipTextActive: { color: "#5E2EBF" },
  inputRow: { flexDirection: "row", gap: 10 },
  inputGrow: { flex: 1 },
  inputSmall: { width: 82 },
  infoStrip: { alignItems: "flex-start", backgroundColor: "#F1EBFC", borderRadius: 14, flexDirection: "row", gap: 10, marginTop: 4, padding: 13 },
  infoIcon: { color: "#6231BD", fontSize: 13, fontWeight: "900" },
  infoText: { color: "#62566F", flex: 1, fontSize: 12, lineHeight: 18 },
  errorText: { color: "#B73E53", fontSize: 12, lineHeight: 18, marginTop: 12 },
  primaryButton: { alignItems: "center", backgroundColor: "#5E2EBF", borderRadius: 15, flexDirection: "row", justifyContent: "space-between", marginTop: 18, paddingHorizontal: 18, paddingVertical: 16 },
  primaryButtonText: { color: "#FFFFFF", fontSize: 15, fontWeight: "800" },
  primaryArrow: { color: "#FFFFFF", fontSize: 18 },
  disabled: { opacity: 0.42 },
  pressed: { opacity: 0.78 },
  previewCard: { backgroundColor: "#242127", borderRadius: 24, marginBottom: 14, padding: 20 },
  summaryRow: { borderTopColor: "#3B3740", borderTopWidth: 1, paddingVertical: 14 },
  summaryLabel: { color: "#A9A2B0", fontSize: 11, fontWeight: "700", marginBottom: 5 },
  summaryValue: { color: "#FFFFFF", fontSize: 14, fontWeight: "700", lineHeight: 20 },
  confirmationRow: { alignItems: "center", borderBottomColor: "#EEEAE4", borderBottomWidth: 1, flexDirection: "row", gap: 12, paddingVertical: 14 },
  checkbox: { alignItems: "center", borderColor: "#B9B2BE", borderRadius: 7, borderWidth: 1.5, height: 24, justifyContent: "center", width: 24 },
  checkboxChecked: { backgroundColor: "#5E2EBF", borderColor: "#5E2EBF" },
  checkboxText: { color: "#FFFFFF", fontSize: 14, fontWeight: "900" },
  confirmationText: { color: "#38343C", flex: 1, fontSize: 14, fontWeight: "700", lineHeight: 20 },
  progressPanel: { alignItems: "center", backgroundColor: "#FFFFFF", borderColor: "#E3DFD8", borderRadius: 24, borderWidth: 1, padding: 24 },
  resultIcon: { alignItems: "center", borderRadius: 34, height: 68, justifyContent: "center", marginBottom: 18, width: 68 },
  resultIconSuccess: { backgroundColor: "#DDF4E8" },
  resultIconPending: { backgroundColor: "#EEE4FF" },
  resultIconText: { color: "#5E2EBF", fontSize: 28, fontWeight: "900" },
  resultTitle: { color: "#211E24", fontSize: 22, fontWeight: "900", textAlign: "center" },
  resultBody: { color: "#756F79", fontSize: 14, lineHeight: 21, marginTop: 10, textAlign: "center" },
  referenceCard: { alignSelf: "stretch", backgroundColor: "#F6F3EE", borderRadius: 16, marginTop: 22, padding: 16 },
  referenceLabel: { color: "#8A848E", fontSize: 10, fontWeight: "800", letterSpacing: 0.8, marginTop: 8, textTransform: "uppercase" },
  referenceValue: { color: "#312D35", fontSize: 13, fontWeight: "700", marginTop: 4 },
  referenceMono: { color: "#5D5862", fontFamily: "monospace", fontSize: 11, marginTop: 4 }
});

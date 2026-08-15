import { useMemo, useState } from "react";
import { Pressable, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
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
import { color, Gradient, shadows } from "./theme";

type Route = "HOME" | "CAPTURE" | "PREVIEW" | "PROGRESS" | "PRINCIPAL";
type Principal = "INDIVIDUAL" | "BUSINESS";

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

const absoluteFillStyle = { bottom: 0, left: 0, position: "absolute" as const, right: 0, top: 0 };

type NeedFact = { label: string; value: string; state: "CONFIRMED" | "INFERRED" | "UNKNOWN" };

export function RequesterApp({ demandClient, onSignOut }: { demandClient: DemandClient; onSignOut: () => Promise<void> }): React.JSX.Element {
  const [route, setRoute] = useState<Route>("HOME");
  const [principal, setPrincipal] = useState<Principal>("INDIVIDUAL");
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
    if (route === "PRINCIPAL") return "以谁的名义使用 Proxy？";
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

  function goBack(): void {
    setRoute(route === "CAPTURE" ? "HOME" : route === "PRINCIPAL" ? "HOME" : "CAPTURE");
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <ChromeHeader
        mode={route === "HOME" ? "home" : "back"}
        principal={principal}
        onBack={goBack}
        onPrincipal={() => setRoute("PRINCIPAL")}
      />

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.eyebrow}>{route === "HOME" ? "REQUESTER COCKPIT" : route === "PRINCIPAL" ? "PRINCIPAL SWITCH" : "NEED → OUTCOME"}</Text>
        {route === "HOME" ? <Home journey={journey} form={form} onCreate={() => setRoute("CAPTURE")} onContinue={() => setRoute(journey?.status === "PENDING" || journey?.status === "COMMITTED" ? "PROGRESS" : "PREVIEW")} onScenario={startFromScenario} /> : null}
        {route === "CAPTURE" ? <Capture form={form} errors={formErrors} busy={busy} error={error} onChange={updateField} onPreview={() => void preparePreview()} /> : null}
        {route === "PREVIEW" ? <Preview form={form} confirmation={confirmation} busy={busy} error={error} onConfirmation={setConfirmation} onPublish={() => void publish()} /> : null}
        {route === "PROGRESS" && journey ? <Progress journey={journey} form={form} onHome={() => setRoute("HOME")} /> : null}
        {route === "PRINCIPAL" ? <Principal current={principal} onChange={setPrincipal} onDone={() => setRoute("HOME")} /> : null}

        {route === "HOME" ? (
          <Pressable accessibilityRole="button" onPress={() => void onSignOut()} style={styles.signOutButton}>
            <Text style={styles.signOutText}>退出当前账户</Text>
          </Pressable>
        ) : null}
      </ScrollView>

      <BottomNav active={route === "HOME" ? "Home" : undefined} onHome={() => setRoute("HOME")} />
    </SafeAreaView>
  );
}

function ChromeHeader({ mode, principal, onBack, onPrincipal }: { mode: "home" | "back"; principal: Principal; onBack: () => void; onPrincipal: () => void }): React.JSX.Element {
  return (
    <View style={styles.header}>
      {mode === "home" ? (
        <View style={styles.brandRow}>
          <Gradient from={color.magenta} to={color.violet} style={styles.logo}>
            <Text style={styles.logoText}>P</Text>
          </Gradient>
          <Text style={styles.wordmark}>PROXY</Text>
        </View>
      ) : (
        <Pressable onPress={onBack} style={styles.headerBack}>
          <Text style={styles.headerBackText}>‹ 返回</Text>
        </Pressable>
      )}
      <Pressable onPress={onPrincipal} style={styles.rolePill}>
        <View style={styles.onlineDot} />
        <Text style={styles.roleText}>{principal === "INDIVIDUAL" ? "个人需求方" : "Business"}</Text>
      </Pressable>
    </View>
  );
}

function Home({ journey, form, onCreate, onContinue, onScenario }: { journey: Journey | undefined; form: NeedForm; onCreate: () => void; onContinue: () => void; onScenario: (scenario: RequesterScenario) => void }): React.JSX.Element {
  return (
    <>
      <Gradient from={color.magenta} to={color.violet} style={[styles.hero, shadows.hero]}>
        <Text style={styles.heroTitle}>你现在想把什么事情推进掉？</Text>
        <Text style={styles.heroBody}>从模糊结果开始，Proxy 帮你说清楚、比较方案并推进。</Text>
        <View style={styles.chipRow}>
          <Chip label="Outcome-first" variant="white" />
          <Chip label="Task-first" variant="lime" />
        </View>
      </Gradient>

      <CtaButton label="说说我想达成的结果" variant="primary" onPress={onCreate} />

      <SectionHead title="需要你处理" meta={journey ? "1 项" : "0 项"} />
      {journey ? (
        <Pressable onPress={onContinue} style={({ pressed }) => [styles.attentionCard, pressed && styles.pressed]}>
          <Text style={styles.attentionTitle}>{describeNeed(form)}</Text>
          <Text style={styles.attentionBody}>
            {journey.status === "READY" ? "方案已生成，等待你的明确确认。" : journey.status === "PENDING" ? "准入或资金门禁处理中，不会显示虚假成功。" : "需求已进入执行准备。"}
          </Text>
          <View style={styles.progressTrack}><View style={[styles.progressFill, { width: journey.status === "READY" ? "72%" : journey.status === "PENDING" ? "86%" : "100%" }]} /></View>
        </Pressable>
      ) : (
        <Card title="暂无进行中的需求" body="新需求会在这里展示真实进展、待确认事项和下一步。" />
      )}

      <SectionHead title="即将发生" meta="未来 7 天" />
      <Card title={journey ? describeNeed(form) : "还没有已排期的任务"} body={journey ? "你的需求已保存，可随时回来继续。" : "从上面的入口发布需求后会出现在这里。"} />

      <SectionHead title="可复用的任务" />
      <ServiceRow icon="↻" title="Reuse last opening crew" body="上次 Outcome 已验证 · 需要时再用" />

      <SectionHead title="与你近期场景有关" />
      {inspiration.map((item) => (
        <Pressable key={item.scenario} onPress={() => onScenario(item.scenario)} style={({ pressed }) => [styles.inspirationCard, pressed && styles.pressed]}>
          <Text style={styles.inspirationEyebrow}>{item.eyebrow}</Text>
          <Text style={styles.inspirationTitle}>{item.title}</Text>
          <Text style={styles.inspirationBody}>{item.body}</Text>
          <Text style={styles.inlineAction}>试试这个 →</Text>
        </Pressable>
      ))}
    </>
  );
}

function Capture({ form, errors, busy, error, onChange, onPreview }: { form: NeedForm; errors: NeedFormErrors; busy: boolean; error: string | undefined; onChange: <Key extends keyof NeedForm>(key: Key, value: NeedForm[Key]) => void; onPreview: () => void }): React.JSX.Element {
  const facts = needFacts(form);
  return (
    <>
      <Text style={styles.pageTitle}>你想让现实中发生什么变化？</Text>
      <Text style={styles.sub}>先说结果。你随时可以回来继续，内容不会因为切页消失。</Text>

      <View style={styles.objective}>
        <TextInput
          multiline
          onChangeText={(value) => onChange("sourceInput", value)}
          placeholder="例如：希望开业现场来宾被及时接待，签到不混乱"
          placeholderTextColor={color.muted}
          style={styles.objectiveInput}
          value={form.sourceInput}
        />
      </View>
      {errors.sourceInput ? <Text style={styles.fieldError}>{errors.sourceInput}</Text> : null}

      <View style={styles.savedline}>
        <Text style={styles.savedlineText}>尚未显式保存 · 每次操作写入 Draft</Text>
        <Text style={styles.savedlineState}>DRAFT</Text>
      </View>

      <Text style={styles.factHeading}>Proxy 当前理解的事实</Text>
      {facts.map((fact) => <FactRow key={fact.label} fact={fact} />)}

      <Card title="规则" body="INFERRED 只帮助澄清；UNKNOWN 必须继续问或保留未知。只有用户确认后才能成为 Hard Requirement。" dark />

      <Text style={styles.stepLabel}>01 · 先说结果</Text>
      <View style={styles.formCard}>
        <Text style={styles.fieldLabel}>场景</Text>
        <View style={styles.chipRow}>{(["STORE_OPENING", "EVENT_SUPPORT", "ADMIN_SUPPORT"] as RequesterScenario[]).map((scenario) => (
          <Pressable key={scenario} onPress={() => onChange("scenario", scenario)} style={[styles.chip, form.scenario === scenario && styles.chipActive]}>
            <Text style={[styles.chipText, form.scenario === scenario && styles.chipTextActive]}>{scenarioLabel(scenario)}</Text>
          </Pressable>
        ))}</View>

        <Field label="执行地点" error={errors.location}><TextInput onChangeText={(value) => onChange("location", value)} placeholder="地点或区域" placeholderTextColor={color.muted} style={styles.input} value={form.location} /></Field>
        <View style={styles.inputRow}>
          <View style={styles.inputGrow}><Field label="日期" error={errors.date}><TextInput onChangeText={(value) => onChange("date", value)} placeholder="YYYY-MM-DD" placeholderTextColor={color.muted} style={styles.input} value={form.date} /></Field></View>
          <View style={styles.inputSmall}><Field label="开始" error={errors.startTime}><TextInput onChangeText={(value) => onChange("startTime", value)} placeholder="09:00" placeholderTextColor={color.muted} style={styles.input} value={form.startTime} /></Field></View>
          <View style={styles.inputSmall}><Field label="结束" error={errors.endTime}><TextInput onChangeText={(value) => onChange("endTime", value)} placeholder="12:00" placeholderTextColor={color.muted} style={styles.input} value={form.endTime} /></Field></View>
        </View>
        {errors.timeRange ? <Text style={styles.fieldError}>{errors.timeRange}</Text> : null}
        <View style={styles.inputRow}>
          <View style={styles.inputGrow}><Field label="需要人数" error={errors.quantity}><TextInput keyboardType="number-pad" onChangeText={(value) => onChange("quantity", value)} style={styles.input} value={form.quantity} /></Field></View>
          <View style={styles.inputGrow}><Field label="最高预算（USD）" error={errors.budget}><TextInput keyboardType="decimal-pad" onChangeText={(value) => onChange("budget", value)} style={styles.input} value={form.budget} /></Field></View>
        </View>
        <InfoStrip text="此步骤只形成 Draft 和方案预览，不会自动收费或发布。" />
        {error ? <Text style={styles.errorText}>{error}</Text> : null}
        <CtaButton disabled={busy} label={busy ? "正在形成方案…" : "生成方案预览"} variant="primary" onPress={onPreview} />
      </View>
    </>
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
  const confirmed = confirmation.scope && confirmation.materialChange && confirmation.funding;
  return (
    <>
      <View style={styles.inlineRow}>
        <Text style={styles.pageTitle}>需求预览</Text>
        <Chip label="v1" variant="lime" />
      </View>
      <View style={styles.darkPreviewCard}>
        {items.map(([label, value]) => <View key={label} style={styles.summaryRow}><Text style={styles.summaryLabel}>{label}</Text><Text style={styles.summaryValue}>{value}</Text></View>)}
      </View>
      <View style={styles.formCard}>
        <Text style={styles.stepLabel}>03 · 明确确认</Text>
        <ConfirmationRow checked={confirmation.scope} label="范围与交付符合我的需求" onPress={() => onConfirmation({ ...confirmation, scope: !confirmation.scope })} />
        <ConfirmationRow checked={confirmation.materialChange} label="重大变化需重新向我确认" onPress={() => onConfirmation({ ...confirmation, materialChange: !confirmation.materialChange })} />
        <ConfirmationRow checked={confirmation.funding} label={`授权最高预算 $${Number(form.budget).toFixed(0)}`} onPress={() => onConfirmation({ ...confirmation, funding: !confirmation.funding })} />
        <InfoStrip text="发布仍需通过服务端准入与资金门禁；状态未知时只显示处理中。" />
        {error ? <Text style={styles.errorText}>{error}</Text> : null}
        <CtaButton disabled={busy || !confirmed} label={busy ? "正在提交门禁…" : "确认并发布需求"} variant="primary" onPress={onPublish} />
      </View>
    </>
  );
}

function Progress({ journey, form, onHome }: { journey: Journey; form: NeedForm; onHome: () => void }): React.JSX.Element {
  const committed = journey.status === "COMMITTED";
  return (
    <View style={styles.progressPanel}>
      <Gradient from={color.magenta} to={color.violet} style={[styles.resultIcon, shadows.hero]}>
        <Text style={styles.resultIconText}>{committed ? "✓" : "…"}</Text>
      </Gradient>
      <Text style={styles.resultTitle}>{committed ? "需求已进入执行准备" : "已收到，正在完成门禁"}</Text>
      <Text style={styles.resultBody}>{committed ? "后续匹配与进展会在 Requester Cockpit 中持续更新。" : "准入或资金确认尚未完成。Proxy 不会在结果未知时显示已发布。"}</Text>
      <View style={styles.referenceCard}>
        <Text style={styles.referenceLabel}>需求摘要</Text><Text style={styles.referenceValue}>{describeNeed(form)}</Text>
        <Text style={styles.referenceLabel}>Draft reference</Text><Text style={styles.referenceMono}>{journey.draftId}</Text>
        {journey.operationRef ? <><Text style={styles.referenceLabel}>Operation reference</Text><Text style={styles.referenceMono}>{journey.operationRef}</Text></> : null}
      </View>
      <CtaButton label="返回需求方首页" variant="primary" onPress={onHome} />
    </View>
  );
}

function Principal({ current, onChange, onDone }: { current: Principal; onChange: (next: Principal) => void; onDone: () => void }): React.JSX.Element {
  return (
    <>
      <Text style={styles.pageTitle}>以谁的名义使用 Proxy？</Text>
      <Pressable onPress={() => onChange("INDIVIDUAL")} style={[styles.principalCard, current === "INDIVIDUAL" && styles.principalCardActive]}>
        <Text style={styles.principalTitle}>Individual · Nguyen A</Text>
        <Text style={styles.principalBody}>个人 Requester · 独立 Trust / Spend</Text>
      </Pressable>
      <Pressable onPress={() => onChange("BUSINESS")} style={[styles.principalDarkCard, current === "BUSINESS" && styles.principalDarkActive]}>
        <Text style={styles.principalDarkTitle}>Lotus Coffee</Text>
        <Text style={styles.principalDarkBody}>Business Principal · ACTIVE membership · Task / Spend / Trusted Team 归公司。</Text>
      </Pressable>
      <Card title="Canonical Rule" body="切换 Principal 不创建第二个账号；UserAccount 仍然是同一个。" />
      <CtaButton label={current === "BUSINESS" ? "使用 Business" : "使用 Individual"} variant="primary" onPress={onDone} />
    </>
  );
}

function needFacts(form: NeedForm): NeedFact[] {
  const confirmedIf = (value: string, confirmed: "CONFIRMED" | "INFERRED"): "CONFIRMED" | "INFERRED" | "" => (value.trim() ? confirmed : "");
  const timeText = form.date && form.startTime && form.endTime ? `${form.date} ${form.startTime}–${form.endTime}` : "";
  return [
    { label: "你的目标", value: form.sourceInput.trim() || "—", state: confirmedIf(form.sourceInput, "CONFIRMED") || "UNKNOWN" },
    { label: "可能场景", value: scenarioLabel(form.scenario), state: "CONFIRMED" },
    { label: "时间", value: timeText || "—", state: confirmedIf(timeText, "INFERRED") || "UNKNOWN" },
    { label: "地点", value: form.location.trim() || "—", state: confirmedIf(form.location, "INFERRED") || "UNKNOWN" },
    { label: "人数", value: form.quantity.trim() || "—", state: confirmedIf(form.quantity, "CONFIRMED") || "UNKNOWN" },
    { label: "预算", value: form.budget.trim() ? `$${Number(form.budget).toFixed(0)}` : "—", state: confirmedIf(form.budget, "CONFIRMED") || "UNKNOWN" }
  ];
}

function Card({ title, body, dark = false }: { title: string; body: string; dark?: boolean }): React.JSX.Element {
  return (
    <View style={[styles.card, dark && styles.cardDark]}>
      <Text style={[styles.cardTitle, dark && styles.cardTitleDark]}>{title}</Text>
      <Text style={[styles.cardBody, dark && styles.cardBodyDark]}>{body}</Text>
    </View>
  );
}

function SectionHead({ title, meta }: { title: string; meta?: string }): React.JSX.Element {
  return (
    <View style={styles.sectionHead}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {meta ? <Text style={styles.sectionMeta}>{meta}</Text> : null}
    </View>
  );
}

function ServiceRow({ icon, title, body, onPress }: { icon: string; title: string; body: string; onPress?: () => void }): React.JSX.Element {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.serviceCard, pressed && styles.pressed]}>
      <View style={styles.serviceIcon}><Text style={styles.serviceIconText}>{icon}</Text></View>
      <View style={styles.flexOne}>
        <Text style={styles.serviceTitle}>{title}</Text>
        <Text style={styles.serviceBody}>{body}</Text>
      </View>
      <Text style={styles.chev}>›</Text>
    </Pressable>
  );
}

function Chip({ label, variant = "surface" }: { label: string; variant?: "surface" | "lime" | "dark" | "white" }): React.JSX.Element {
  return (
    <View style={[styles.chip, variant === "lime" && styles.chipLime, variant === "dark" && styles.chipDark, variant === "white" && styles.chipWhite]}>
      <Text style={[styles.chipText, variant === "lime" && styles.chipTextLime, variant === "dark" && styles.chipTextDark, variant === "white" && styles.chipTextWhite]}>{label}</Text>
    </View>
  );
}

function FactRow({ fact }: { fact: NeedFact }): React.JSX.Element {
  return (
    <View style={styles.factRow}>
      <Text style={styles.factLabel}>{fact.label}</Text>
      <Text style={styles.factValue}>{fact.value}</Text>
      <Text style={[styles.factState, fact.state === "CONFIRMED" && styles.factConfirmed, fact.state === "INFERRED" && styles.factInferred, fact.state === "UNKNOWN" && styles.factUnknown]}>{fact.state}</Text>
    </View>
  );
}

function Field({ label, error, children }: { label: string; error: string | undefined; children: React.ReactNode }): React.JSX.Element {
  return <View style={styles.field}><Text style={styles.fieldLabel}>{label}</Text>{children}{error ? <Text style={styles.fieldError}>{error}</Text> : null}</View>;
}

function InfoStrip({ text }: { text: string }): React.JSX.Element {
  return <View style={styles.infoStrip}><Text style={styles.infoIcon}>i</Text><Text style={styles.infoText}>{text}</Text></View>;
}

function CtaButton({ label, onPress, variant = "primary", disabled = false }: { label: string; onPress: () => void; variant?: "primary" | "dark" | "light" | "lime"; disabled?: boolean }): React.JSX.Element {
  if (variant === "primary") {
    return (
      <View style={[styles.cta, styles.ctaPrimary, disabled && styles.disabled]}>
        <Gradient from={color.magenta} to={color.violet} style={absoluteFillStyle} />
        <Pressable disabled={disabled} onPress={onPress} style={styles.ctaPressable}>
          <Text style={styles.ctaText}>{label}</Text>
        </Pressable>
      </View>
    );
  }
  return (
    <Pressable disabled={disabled} onPress={onPress} style={({ pressed }) => [
      styles.cta,
      variant === "dark" && styles.ctaDark,
      variant === "light" && styles.ctaLight,
      variant === "lime" && styles.ctaLime,
      disabled && styles.disabled,
      pressed && styles.pressed
    ]}>
      <Text style={[styles.ctaText, variant === "light" && styles.ctaTextLight, variant === "lime" && styles.ctaTextLime]}>{label}</Text>
    </Pressable>
  );
}

function ConfirmationRow({ checked, label, onPress }: { checked: boolean; label: string; onPress: () => void }): React.JSX.Element {
  return <Pressable onPress={onPress} style={styles.confirmationRow}><View style={[styles.checkbox, checked && styles.checkboxChecked]}><Text style={styles.checkboxText}>{checked ? "✓" : ""}</Text></View><Text style={styles.confirmationText}>{label}</Text></Pressable>;
}

function BottomNav({ active, onHome }: { active?: "Home" | undefined; onHome: () => void }): React.JSX.Element {
  const tabs: Array<[string, string, string | undefined]> = [
    ["⌂", "Home", active === "Home" ? "on" : undefined],
    ["◇", "Tasks", undefined],
    ["◫", "Wallet", undefined],
    ["○", "Me", undefined]
  ];
  return (
    <View style={styles.bottomNav}>
      {tabs.map(([icon, label, state]) => (
        <Pressable key={label} onPress={label === "Home" ? onHome : undefined} style={[styles.bottomTab, state === "on" && styles.bottomTabOn]}>
          <Text style={[styles.bottomIcon, state === "on" && styles.bottomIconOn]}>{icon}</Text>
          <Text style={[styles.bottomLabel, state === "on" && styles.bottomIconOn]}>{label}</Text>
        </Pressable>
      ))}
    </View>
  );
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
  safeArea: { backgroundColor: color.offWhite, flex: 1 },
  header: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", paddingHorizontal: 18, paddingVertical: 12 },
  brandRow: { alignItems: "center", flexDirection: "row", gap: 10 },
  logo: { alignItems: "center", borderRadius: 10, height: 32, justifyContent: "center", width: 32 },
  logoText: { color: color.white, fontSize: 17, fontWeight: "900" },
  wordmark: { color: color.ink, fontSize: 19, fontWeight: "900", letterSpacing: 3 },
  headerBack: { paddingVertical: 6 },
  headerBackText: { color: color.violet, fontSize: 15, fontWeight: "800" },
  rolePill: { alignItems: "center", backgroundColor: color.ink, borderRadius: 999, flexDirection: "row", gap: 6, paddingHorizontal: 11, paddingVertical: 7 },
  onlineDot: { backgroundColor: color.mint, borderRadius: 4, height: 7, width: 7 },
  roleText: { color: color.white, fontSize: 10, fontWeight: "800" },
  content: { paddingBottom: 92, paddingHorizontal: 18, paddingTop: 8 },
  eyebrow: { color: color.violet, fontSize: 11, fontWeight: "900", letterSpacing: 1.8, marginBottom: 12 },
  pageTitle: { color: color.ink, fontSize: 25, fontWeight: "900", letterSpacing: -0.6, lineHeight: 31, marginBottom: 8 },
  sub: { color: color.muted, fontSize: 13, lineHeight: 20, marginBottom: 4 },
  inlineRow: { alignItems: "center", flexDirection: "row", gap: 8, justifyContent: "space-between", marginBottom: 8 },
  hero: { borderRadius: 23, marginBottom: 12, marginTop: 6, padding: 18 },
  heroTitle: { color: color.white, fontSize: 24, fontWeight: "900", lineHeight: 30 },
  heroBody: { color: "rgba(255,255,255,0.9)", fontSize: 13, lineHeight: 19, marginTop: 8 },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 7, marginTop: 14 },
  chip: { backgroundColor: color.surface, borderColor: "transparent", borderRadius: 999, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 6 },
  chipLime: { backgroundColor: color.lime },
  chipDark: { backgroundColor: color.ink },
  chipWhite: { backgroundColor: color.white },
  chipText: { color: color.ink, fontSize: 11, fontWeight: "800" },
  chipTextLime: { color: color.ink },
  chipTextDark: { color: color.white },
  chipTextWhite: { color: color.magenta },
  sectionHead: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", marginBottom: 8, marginTop: 24 },
  sectionTitle: { color: color.ink, fontSize: 16, fontWeight: "900" },
  sectionMeta: { color: color.muted, fontSize: 11, fontWeight: "600" },
  card: { ...shadows.card, backgroundColor: color.white, borderColor: color.cardBorder, borderRadius: 17, borderWidth: 1, marginBottom: 8, padding: 13 },
  cardDark: { backgroundColor: color.ink, borderColor: "transparent" },
  cardTitle: { color: color.ink, fontSize: 14, fontWeight: "800", lineHeight: 19 },
  cardTitleDark: { color: color.white },
  cardBody: { color: color.muted, fontSize: 12, lineHeight: 18, marginTop: 3 },
  cardBodyDark: { color: color.darkCardText },
  attentionCard: { ...shadows.card, backgroundColor: color.attentionBg, borderColor: color.attentionBorder, borderRadius: 18, borderWidth: 1, marginBottom: 8, padding: 14 },
  attentionTitle: { color: color.ink, fontSize: 14, fontWeight: "900" },
  attentionBody: { color: color.muted, fontSize: 12, lineHeight: 18, marginTop: 5 },
  progressTrack: { backgroundColor: color.surface, borderRadius: 5, height: 7, marginTop: 13, overflow: "hidden" },
  progressFill: { backgroundColor: color.violet, borderRadius: 5, height: 7 },
  serviceCard: { ...shadows.card, alignItems: "center", backgroundColor: color.white, borderColor: color.cardBorder, borderRadius: 17, borderWidth: 1, flexDirection: "row", gap: 11, marginBottom: 8, padding: 12 },
  serviceIcon: { alignItems: "center", backgroundColor: color.lime, borderRadius: 13, height: 42, justifyContent: "center", width: 42 },
  serviceIconText: { color: color.ink, fontSize: 18, fontWeight: "900" },
  serviceTitle: { color: color.ink, fontSize: 13, fontWeight: "800" },
  serviceBody: { color: color.muted, fontSize: 11, lineHeight: 16, marginTop: 2 },
  chev: { color: "#A59CAB", fontSize: 22 },
  flexOne: { flex: 1 },
  inspirationCard: { backgroundColor: color.ink, borderRadius: 20, marginBottom: 8, padding: 16 },
  inspirationEyebrow: { color: "#B79AEE", fontSize: 11, fontWeight: "900", letterSpacing: 1, marginBottom: 12 },
  inspirationTitle: { color: color.white, fontSize: 18, fontWeight: "900", lineHeight: 23 },
  inspirationBody: { color: "#D8D1E0", fontSize: 12, lineHeight: 18, marginTop: 6 },
  inlineAction: { color: "#CDB8F7", fontSize: 13, fontWeight: "800", marginTop: 14 },
  signOutButton: { alignItems: "center", marginTop: 26, padding: 12 },
  signOutText: { color: color.muted, fontSize: 13, fontWeight: "700" },
  objective: { backgroundColor: color.white, borderColor: "#DCD5E3", borderRadius: 18, borderWidth: 1.5, marginBottom: 4, marginTop: 10, padding: 13 },
  objectiveInput: { color: color.ink, fontSize: 15, lineHeight: 22, minHeight: 92, textAlignVertical: "top" },
  savedline: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", marginBottom: 14, marginTop: 6 },
  savedlineText: { color: color.muted, fontSize: 11 },
  savedlineState: { color: color.mint, fontSize: 11, fontWeight: "900", letterSpacing: 0.6 },
  factHeading: { color: color.muted, fontSize: 11, fontWeight: "800", letterSpacing: 0.8, marginBottom: 8, textTransform: "uppercase" },
  factRow: { alignItems: "center", backgroundColor: color.white, borderColor: color.line, borderRadius: 12, borderWidth: 1, flexDirection: "row", gap: 8, marginBottom: 6, paddingHorizontal: 10, paddingVertical: 8 },
  factLabel: { color: color.muted, fontSize: 11, width: 74 },
  factValue: { color: color.ink, flex: 1, fontSize: 12, fontWeight: "700" },
  factState: { borderRadius: 999, fontSize: 9, fontWeight: "900", overflow: "hidden", paddingHorizontal: 6, paddingVertical: 3 },
  factConfirmed: { backgroundColor: color.factConfirmedBg, color: color.factConfirmedFg },
  factInferred: { backgroundColor: color.factInferredBg, color: color.factInferredFg },
  factUnknown: { backgroundColor: color.factUnknownBg, color: color.factUnknownFg },
  stepLabel: { color: color.violet, fontSize: 12, fontWeight: "900", letterSpacing: 1.2, marginBottom: 12, marginTop: 18 },
  formCard: { backgroundColor: color.white, borderColor: color.line, borderRadius: 20, borderWidth: 1, marginTop: 8, padding: 16 },
  field: { marginBottom: 14 },
  fieldLabel: { color: "#39353D", fontSize: 13, fontWeight: "800", marginBottom: 8 },
  input: { backgroundColor: color.surface, borderColor: color.line, borderRadius: 13, borderWidth: 1, color: color.ink, fontSize: 15, paddingHorizontal: 13, paddingVertical: 12 },
  fieldError: { color: color.error, fontSize: 11, marginTop: 6 },
  chipActive: { backgroundColor: "#EEE4FF", borderColor: "#8A5CD6" },
  chipTextActive: { color: "#5E2EBF" },
  inputRow: { flexDirection: "row", gap: 10 },
  inputGrow: { flex: 1 },
  inputSmall: { width: 84 },
  infoStrip: { alignItems: "flex-start", backgroundColor: color.surface, borderRadius: 14, flexDirection: "row", gap: 10, marginTop: 4, padding: 12 },
  infoIcon: { color: color.violet, fontSize: 13, fontWeight: "900" },
  infoText: { color: "#62566F", flex: 1, fontSize: 12, lineHeight: 18 },
  errorText: { color: color.error, fontSize: 12, lineHeight: 18, marginTop: 12 },
  cta: { alignItems: "center", borderRadius: 14, marginTop: 10, minHeight: 48, overflow: "hidden", paddingHorizontal: 14, paddingVertical: 12 },
  ctaPressable: { ...absoluteFillStyle, alignItems: "center", justifyContent: "center" },
  ctaPrimary: { ...shadows.hero },
  ctaDark: { backgroundColor: color.ink },
  ctaLight: { backgroundColor: color.white, borderColor: color.line, borderWidth: 1 },
  ctaLime: { backgroundColor: color.lime },
  ctaText: { color: color.white, fontSize: 14, fontWeight: "900" },
  ctaTextLight: { color: color.ink },
  ctaTextLime: { color: color.ink },
  disabled: { opacity: 0.45 },
  pressed: { opacity: 0.78 },
  darkPreviewCard: { backgroundColor: color.ink, borderRadius: 20, marginBottom: 12, padding: 16 },
  summaryRow: { borderTopColor: "#3B3740", borderTopWidth: 1, paddingVertical: 13 },
  summaryLabel: { color: "#A9A2B0", fontSize: 11, fontWeight: "700", marginBottom: 5 },
  summaryValue: { color: color.white, fontSize: 14, fontWeight: "700", lineHeight: 20 },
  confirmationRow: { alignItems: "center", borderBottomColor: color.line, borderBottomWidth: 1, flexDirection: "row", gap: 12, paddingVertical: 14 },
  checkbox: { alignItems: "center", borderColor: "#B9B2BE", borderRadius: 7, borderWidth: 1.5, height: 24, justifyContent: "center", width: 24 },
  checkboxChecked: { backgroundColor: color.violet, borderColor: color.violet },
  checkboxText: { color: color.white, fontSize: 14, fontWeight: "900" },
  confirmationText: { color: color.ink, flex: 1, fontSize: 14, fontWeight: "700", lineHeight: 20 },
  progressPanel: { alignItems: "center", backgroundColor: color.white, borderColor: color.line, borderRadius: 24, borderWidth: 1, padding: 24 },
  resultIcon: { alignItems: "center", borderRadius: 34, height: 68, justifyContent: "center", marginBottom: 18, width: 68 },
  resultIconText: { color: color.white, fontSize: 30, fontWeight: "900" },
  resultTitle: { color: color.ink, fontSize: 22, fontWeight: "900", textAlign: "center" },
  resultBody: { color: color.muted, fontSize: 14, lineHeight: 21, marginTop: 10, textAlign: "center" },
  referenceCard: { alignSelf: "stretch", backgroundColor: color.surface, borderRadius: 16, marginTop: 22, padding: 16 },
  referenceLabel: { color: color.muted, fontSize: 10, fontWeight: "800", letterSpacing: 0.8, marginTop: 8, textTransform: "uppercase" },
  referenceValue: { color: color.ink, fontSize: 13, fontWeight: "700", marginTop: 4 },
  referenceMono: { color: "#5D5862", fontFamily: "monospace", fontSize: 11, marginTop: 4 },
  principalCard: { ...shadows.card, backgroundColor: color.white, borderColor: color.line, borderRadius: 17, borderWidth: 1.5, marginBottom: 10, padding: 15 },
  principalCardActive: { borderColor: color.magenta, borderWidth: 2 },
  principalTitle: { color: color.ink, fontSize: 15, fontWeight: "900" },
  principalBody: { color: color.muted, fontSize: 12, lineHeight: 18, marginTop: 4 },
  principalDarkCard: { ...shadows.card, backgroundColor: color.ink, borderColor: "transparent", borderRadius: 17, borderWidth: 1.5, marginBottom: 10, padding: 15 },
  principalDarkActive: { borderColor: color.lime, borderWidth: 2 },
  principalDarkTitle: { color: color.white, fontSize: 15, fontWeight: "900" },
  principalDarkBody: { color: color.darkCardText, fontSize: 12, lineHeight: 18, marginTop: 4 },
  bottomNav: { backgroundColor: color.white, borderColor: color.line, borderRadius: 18, borderWidth: 1, bottom: 12, flexDirection: "row", left: 18, padding: 6, position: "absolute", right: 18 },
  bottomTab: { alignItems: "center", borderRadius: 11, flex: 1, paddingVertical: 6 },
  bottomTabOn: { backgroundColor: color.bottomActiveBg },
  bottomIcon: { color: "#83798B", fontSize: 17, fontWeight: "800" },
  bottomIconOn: { color: color.magenta },
  bottomLabel: { color: "#83798B", fontSize: 10, fontWeight: "700", marginTop: 2 }
});

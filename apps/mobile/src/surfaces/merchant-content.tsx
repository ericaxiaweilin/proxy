import { useCallback, useEffect, useState } from "react";
import { Linking, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import * as Clipboard from "expo-clipboard";
import { Image } from "expo-image";
import { ProxyBackGlyph } from "../components/proxy-foundation";
import {
  CONTENT_PLATFORMS,
  CONTENT_TYPE_LABEL,
  STAGE_LABEL,
  canApprove,
  contentErrorText,
  formatDuration,
  formatTaskTime,
  platformLabel,
  publishProgress,
  taskTitle,
  tasksForTab,
  type ContentStage,
  type ContentTab,
  type ContentTaskCounts,
  type ContentTaskView,
} from "../content-task";
import { mediaThumbUrl } from "../media-thumb-url";
import { formatWan } from "../merchant-promo-format";
import { localApiBaseUrl } from "../native-clients";
import type { SupplyClient } from "../supply-client";

// CONTENT-TASK-001（2026-10-04，用户：商家侧 我的 → Creator 经营 → 生产内容「接一下」，原型
// docs/design/references/Proxy_Content_Tasks_20261004_b3a766.html「生产内容 - 精修版」）。
//
// 取代 MERCHANT-CREATOR-CONTENT-001 的邀约列表页（那页只能列邀约、「已交付成片」只能写 —，
// 因为当时没有交付数据）。现在服务端有内容任务（一张 UGC 邀约 + 稿件 / 审核 / 发布链接），
// 数据源仍是同一批邀约（ListMerchantContentTasks 按商家读邀约，UGC 的自动补成任务）。
//
// 照原型做的：四个数、五个 tab、任务卡（按阶段给操作）、内容审核、内容详情（分平台发布）。
// 原型里有、这里**不画**的（没有真数据，不编）：
//   - 播放 / 点赞 / 评论 / 热评 / 总播放量：没接 TikTok / IG / FB 开放接口；
//   - 「通过本视频到店 / 核销」按视频归因：专属码按（店, 达人）发，只能按达人统计 —— 卡片上
//     给的是这位达人专属码的战绩，并写明口径；
//   - 审核要点的「✓ 通过」自动结果：只有「站外联系方式」是服务端扫文案自动判的，
//     门店画面 / 与实物相符 / 竞品露出只有人看得出来，由商家勾；
//   - 「导出分平台报表」：没有报表导出能力，不摆按钮；
//   - 「自有平台自动同步」：还没有审核通过后自动发到 Proxy 动态的流程。

type Creator = { agentId: string; name: string; photoUri?: string | undefined };
type Sheet = { kind: "review" | "detail"; task: ContentTaskView } | { kind: "create" };

const TABS: Array<{ id: ContentTab; label: string; count: (c: ContentTaskCounts) => number }> = [
  { id: "ALL", label: "全部", count: (c) => c.total },
  { id: "AWAITING", label: "待接单", count: (c) => c.awaiting },
  { id: "SHOOTING", label: "拍摄中", count: (c) => c.shooting },
  { id: "IN_REVIEW", label: "待审核", count: (c) => c.inReview },
  { id: "PUBLISHED", label: "已发布", count: (c) => c.published },
];

export function MerchantContentSurface({ supply, merchantId, creators, onBack, onOpenCreators }: {
  supply: SupplyClient;
  merchantId: string;
  // 人才库：发任务时选人 + 取头像。
  creators: Creator[];
  onBack: () => void;
  onOpenCreators: () => void;
}): React.JSX.Element {
  const [tasks, setTasks] = useState<ContentTaskView[] | undefined>(undefined);
  const [counts, setCounts] = useState<ContentTaskCounts>({ total: 0, awaiting: 0, shooting: 0, inReview: 0, published: 0 });
  const [tab, setTab] = useState<ContentTab>("ALL");
  const [loadError, setLoadError] = useState<string | undefined>(undefined);
  const [sheet, setSheet] = useState<Sheet | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | undefined>(undefined);
  const [sheetError, setSheetError] = useState<string | undefined>(undefined);

  const reload = useCallback(async (): Promise<void> => {
    try {
      const listed = await supply.listMerchantContentTasks({ merchantId });
      setTasks(listed.tasks);
      setCounts(listed.counts);
      setLoadError(undefined);
    } catch (e) {
      setTasks((prev) => prev ?? []);
      setLoadError(contentErrorText(e instanceof Error ? e.message : ""));
    }
  }, [supply, merchantId]);

  useEffect(() => { void reload(); }, [reload]);

  const photoOf = (t: ContentTaskView): string | undefined =>
    creators.find((c) => c.agentId === t.agentId)?.photoUri ?? (t.creatorPhoto.startsWith("http") ? t.creatorPhoto : undefined);

  const run = async (label: string, action: () => Promise<void>, inSheet = false): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setNotice(undefined);
    setSheetError(undefined);
    try {
      await action();
      await reload();
      if (inSheet) setSheet(undefined);
      setNotice(label);
    } catch (e) {
      const text = contentErrorText(e instanceof Error ? e.message : "");
      if (inSheet) setSheetError(text); else setNotice(text);
    } finally {
      setBusy(false);
    }
  };

  const nudge = (t: ContentTaskView): Promise<void> => run("已提醒，达人会收到站内通知", () => supply.nudgeContentTask({ merchantId, taskId: t.id }));
  const withdraw = (t: ContentTaskView): Promise<void> => run("已撤回邀请", () => supply.cancelInvitation({ merchantId, invitationId: t.invitationId }));

  const visible = tasksForTab(tasks ?? [], tab);
  return (
    <View>
      <View style={s.subHeader}>
        <Pressable onPress={onBack} accessibilityLabel="返回 Creator 经营" style={s.backBtn}><ProxyBackGlyph /></Pressable>
        <View style={{ flex: 1 }}>
          <Text selectable style={s.h1}>生产内容</Text>
          <Text selectable style={s.sub}>内容任务 · 多平台发布 · 效果追踪</Text>
        </View>
      </View>
      {loadError ? <Text selectable style={s.error}>{loadError}</Text> : null}

      <View style={s.dashGrid}>
        <Dash value={tasks ? counts.total.toString() : "—"} label="本店内容任务" />
        <Dash value={tasks ? counts.published.toString() : "—"} label="已通过 / 已发布" />
        <Dash value={tasks ? counts.inReview.toString() : "—"} label="待审核" />
        <Dash value={tasks ? counts.shooting.toString() : "—"} label="拍摄中" />
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.tabRow}>
        {TABS.map((t) => (
          <Pressable key={t.id} onPress={() => setTab(t.id)} style={[s.chip, tab === t.id && s.chipOn]} accessibilityLabel={`${t.label}任务`}>
            <Text selectable style={[s.chipText, tab === t.id && s.chipTextOn]}>{`${t.label} (${t.count(counts)})`}</Text>
          </Pressable>
        ))}
      </ScrollView>

      <View style={s.sectionTitle}>
        <Text selectable style={s.h2}>内容任务</Text>
        <Pressable onPress={() => { setSheetError(undefined); setSheet({ kind: "create" }); }} accessibilityLabel="发内容任务" style={s.addBtn}>
          <Text selectable style={s.addText}>＋ 发任务</Text>
        </Pressable>
      </View>
      {notice ? <Text selectable style={s.ok}>{notice}</Text> : null}
      {tasks !== undefined && visible.length === 0 ? (
        <View style={s.card}>
          <Text selectable style={s.emptyTitle}>{tab === "ALL" ? "还没有内容合作" : "这个阶段没有任务"}</Text>
          <Text selectable style={s.hint}>点「＋ 发任务」挑一位达人发内容任务；她接单后在这里交稿、你审核，通过后她去各平台发布并贴回链接。</Text>
          <Pressable onPress={onOpenCreators} style={s.btnAction} accessibilityLabel="去 Creator 人才库挑人"><Text selectable style={s.btnText}>去人才库看看</Text></Pressable>
        </View>
      ) : null}
      {visible.map((t) => (
        <TaskCard
          key={t.id}
          task={t}
          photoUri={photoOf(t)}
          busy={busy}
          onReview={() => { setSheetError(undefined); setSheet({ kind: "review", task: t }); }}
          onDetail={() => { setSheetError(undefined); setSheet({ kind: "detail", task: t }); }}
          onNudge={() => void nudge(t)}
          onWithdraw={() => void withdraw(t)}
        />
      ))}

      <Modal animationType="slide" transparent visible={sheet !== undefined} onRequestClose={() => setSheet(undefined)}>
        {/* 背景和弹层是兄弟节点：弹层不能包在可点的 Pressable 里（会吃掉滑动手势），
            ScrollView 要能收缩（RN 默认 flexShrink 0，长表单会被 maxHeight 裁掉、滑不动）。 */}
        <View style={s.modalRoot}>
          <Pressable style={s.backdrop} onPress={() => setSheet(undefined)} accessibilityLabel="关闭" />
          <View style={s.sheet}>
            <ScrollView keyboardShouldPersistTaps="handled" style={s.sheetScroll}>
              {sheet?.kind === "review" ? (
                <ReviewSheet
                  task={sheet.task}
                  busy={busy}
                  error={sheetError}
                  onSubmit={(decision, note, checks) => void run(decision === "APPROVE" ? "已通过，达人可以去发布了" : "已打回，达人会收到修改意见",
                    async () => { await supply.reviewContentDraft({ merchantId, taskId: sheet.task.id, decision, note, checks }); }, true)}
                />
              ) : null}
              {sheet?.kind === "detail" ? <DetailSheet task={sheet.task} /> : null}
              {sheet?.kind === "create" ? (
                <CreateSheet
                  creators={creators}
                  busy={busy}
                  error={sheetError}
                  onError={setSheetError}
                  onSubmit={(input) => void run("任务已发出，等达人接单", async () => { await supply.createContentTask({ merchantId, ...input }); }, true)}
                />
              ) : null}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function TaskCard({ task: t, photoUri, busy, onReview, onDetail, onNudge, onWithdraw }: {
  task: ContentTaskView;
  photoUri?: string | undefined;
  busy: boolean;
  onReview: () => void;
  onDetail: () => void;
  onNudge: () => void;
  onWithdraw: () => void;
}): React.JSX.Element {
  const published = new Set(t.publications.map((p) => p.platform));
  const planned = [...new Set([...t.platforms, ...published])];
  const showStats = (t.stage === "PUBLISHED" || t.stage === "APPROVED") && t.promoStats;
  return (
    <View style={s.card}>
      <View style={s.cardHeader}>
        <View style={s.creatorRow}>
          <Avatar name={t.creatorName} photoUri={photoUri} />
          <View>
            <Text selectable style={s.creatorName}>{t.creatorName || "达人"}</Text>
            {t.creatorHandle ? <Text selectable style={s.creatorHandle}>{`@${t.creatorHandle}`}</Text> : null}
          </View>
        </View>
        <Text selectable style={[s.status, STAGE_TONE[t.stage]]}>{STAGE_LABEL[t.stage]}</Text>
      </View>
      {planned.length > 0 ? (
        <View style={s.platformRow}>
          {planned.map((p) => (
            <Text key={p} selectable style={[s.platformTag, published.has(p) && s.platformTagOn]}>{`${published.has(p) ? "✓ " : ""}${platformLabel(p)}`}</Text>
          ))}
        </View>
      ) : null}
      <Text selectable style={s.taskTitle}>{`“${taskTitle(t)}”`}</Text>
      {t.stage === "SHOOTING" && t.review?.decision === "REJECT" ? (
        <View style={s.reasonLine}><View style={[s.dot, { backgroundColor: P.danger }]} /><Text selectable style={s.reasonText}>{`已打回：${t.review.note}`}</Text></View>
      ) : null}
      {showStats && t.promoStats ? (
        <>
          <View style={s.codeStats}>
            <Stat value={t.promoStats.newCustomers.toLocaleString()} label="新客" />
            <Stat value={t.promoStats.redeemed.toLocaleString()} label="核销" />
            <Stat value={t.promoStats.issued.toLocaleString()} label="发券" />
            <Stat value={formatWan(t.promoStats.spendVnd)} label="消费 VND" />
          </View>
          <Text selectable style={s.meta}>{`专属码 ${t.promoCode} 的战绩 · 按达人统计，不是单条视频`}</Text>
        </>
      ) : null}
      <View style={s.cardActions}>
        {t.stage === "AWAITING" ? (
          <>
            <Btn label="撤回邀请" onPress={onWithdraw} disabled={busy} />
            <Btn label={t.canNudge ? "再次提醒" : "今天已提醒"} onPress={onNudge} disabled={busy || !t.canNudge} primary />
          </>
        ) : null}
        {t.stage === "SHOOTING" ? (
          <>
            <Btn label={t.canNudge ? "催促提醒" : "今天已提醒"} onPress={onNudge} disabled={busy || !t.canNudge} />
            <Btn label="查看进度" onPress={onDetail} primary />
          </>
        ) : null}
        {t.stage === "IN_REVIEW" ? (
          <>
            <Btn label="查看并审核" onPress={onReview} primary />
            <Btn label="查看详情" onPress={onDetail} />
          </>
        ) : null}
        {t.stage === "APPROVED" || t.stage === "PUBLISHED" || t.stage === "CLOSED" ? <Btn label="查看详情" onPress={onDetail} primary={t.stage !== "CLOSED"} /> : null}
      </View>
    </View>
  );
}

function ReviewSheet({ task: t, busy, error, onSubmit }: {
  task: ContentTaskView;
  busy: boolean;
  error?: string | undefined;
  onSubmit: (decision: "APPROVE" | "REJECT", note: string, checks: { storeClear: boolean; matchesReality: boolean; noCompetitor: boolean }) => void;
}): React.JSX.Element {
  const [storeClear, setStoreClear] = useState(false);
  const [matchesReality, setMatchesReality] = useState(false);
  const [noCompetitor, setNoCompetitor] = useState(false);
  const [note, setNote] = useState("");
  const [localError, setLocalError] = useState<string | undefined>(undefined);
  const draft = t.draft;
  const checks = { storeClear, matchesReality, noCompetitor };
  const approvable = canApprove(checks, t.draftHasContact);
  return (
    <View>
      <Text selectable style={s.sheetTitle}>内容审核</Text>
      <Text selectable style={s.sub}>{`${t.creatorName} · 计划发 ${t.platforms.length} 个平台${draft && draft.round > 1 ? ` · 第 ${draft.round} 稿` : ""}`}</Text>
      <Text selectable style={s.sheetQuote}>{`“${taskTitle(t)}”`}</Text>
      {t.platforms.length > 0 ? <View style={s.platformRow}>{t.platforms.map((p) => <Text key={p} selectable style={s.platformTag}>{platformLabel(p)}</Text>)}</View> : null}
      <InfoRow label="提交人" value={`${t.creatorName}${t.creatorHandle ? ` @${t.creatorHandle}` : ""}`} />
      <InfoRow label="内容类型" value={CONTENT_TYPE_LABEL[t.contentType] ?? t.contentType} />
      {draft && draft.durationSec > 0 ? <InfoRow label="时长" value={formatDuration(draft.durationSec)} /> : null}
      {draft ? <InfoRow label="提交时间" value={formatTaskTime(draft.submittedAt) || "—"} /> : null}
      {draft && draft.mediaAssetIds.length > 0 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.mediaRow}>
          {draft.mediaAssetIds.map((id) => {
            const uri = mediaThumbUrl(id, localApiBaseUrl);
            return uri ? <Image key={id} cachePolicy="memory-disk" contentFit="cover" source={{ uri }} style={s.mediaThumb} transition={0} /> : null;
          })}
        </ScrollView>
      ) : null}
      {draft?.caption ? <Text selectable style={s.caption}>{draft.caption}</Text> : null}

      <Text selectable style={s.label}>审核要点</Text>
      <CheckRow label="门店画面是否清晰" on={storeClear} onToggle={() => setStoreClear((v) => !v)} okText="✓ 清晰" />
      <View style={s.checkRow}>
        <Text selectable style={s.checkLabel}>是否含站外联系方式</Text>
        <Text selectable style={[s.checkAuto, t.draftHasContact && { color: P.danger }]}>{t.draftHasContact ? "⚠ 文案里有（自动检查）" : "✓ 无（自动检查文案）"}</Text>
      </View>
      <CheckRow label="是否与实物相符" on={matchesReality} onToggle={() => setMatchesReality((v) => !v)} okText="✓ 相符" />
      <CheckRow label="是否有竞品露出" on={noCompetitor} onToggle={() => setNoCompetitor((v) => !v)} okText="✓ 无竞品" />
      <TextInput
        multiline
        onChangeText={setNote}
        placeholder="打回原因 / 修改意见（打回必填）"
        placeholderTextColor={P.sub}
        style={[s.input, { height: 72, paddingTop: 10 }]}
        value={note}
      />
      {localError ?? error ? <Text selectable style={s.error}>{localError ?? error}</Text> : null}
      <View style={s.cardActions}>
        <Btn
          label="打回重拍"
          disabled={busy}
          onPress={() => {
            if (note.trim() === "") { setLocalError("打回要写原因，达人才知道怎么改"); return; }
            setLocalError(undefined);
            onSubmit("REJECT", note.trim(), checks);
          }}
        />
        <Btn
          label="✓ 审核通过"
          primary
          disabled={busy || !approvable}
          onPress={() => { setLocalError(undefined); onSubmit("APPROVE", note.trim(), checks); }}
        />
      </View>
      {!approvable ? <Text selectable style={s.meta}>{t.draftHasContact ? "文案里有站外联系方式，只能打回。" : "三项人工检查都确认后才能通过。"}</Text> : null}
    </View>
  );
}

function DetailSheet({ task: t }: { task: ContentTaskView }): React.JSX.Element {
  const [copied, setCopied] = useState(false);
  const progress = publishProgress(t);
  const byPlatform = new Map(t.publications.map((p) => [p.platform, p]));
  const platforms = [...new Set([...t.platforms, ...t.publications.map((p) => p.platform)])];
  const firstPublished = [...t.publications].sort((a, b) => (a.publishedAt < b.publishedAt ? -1 : 1))[0];
  const reviewText = t.review ? (t.review.decision === "APPROVE" ? "✓ 已通过" : `已打回：${t.review.note}`) : t.draft ? "待审核" : "未交稿";
  return (
    <View>
      <Text selectable style={s.sheetTitle}>内容详情</Text>
      <Text selectable style={s.sub}>{`${t.creatorName} · ${STAGE_LABEL[t.stage]}${progress.done > 0 ? ` · ${progress.done} 个平台已发布` : ""}`}</Text>
      <Text selectable style={s.sheetQuote}>{`“${taskTitle(t)}”`}</Text>
      {t.brief && t.title ? <Text selectable style={s.caption}>{t.brief}</Text> : null}
      <InfoRow label="创作者" value={`${t.creatorName}${t.creatorHandle ? ` @${t.creatorHandle}` : ""}`} />
      <InfoRow label="内容类型" value={CONTENT_TYPE_LABEL[t.contentType] ?? t.contentType} />
      <InfoRow label="出价" value={t.priceMinVnd > 0 || t.priceMaxVnd > 0 ? `${formatWan(t.priceMinVnd)}–${formatWan(t.priceMaxVnd)} VND` : "待商议"} />
      <InfoRow label="审核状态" value={reviewText} />
      {firstPublished ? <InfoRow label="首次发布" value={formatTaskTime(firstPublished.publishedAt) || "—"} /> : null}
      {platforms.length > 0 ? <InfoRow label="发布平台" value={`${progress.done} / ${progress.planned} 已发布`} /> : null}

      {platforms.map((p) => {
        const pub = byPlatform.get(p);
        return (
          <View key={p} style={s.platformCard}>
            <View style={s.platformHead}>
              <Text selectable style={s.platformName}>{platformLabel(p)}</Text>
              <Text selectable style={[s.platformState, pub && { color: "#1E8E3E" }]}>{pub ? "✓ 已发布" : "未发布"}</Text>
            </View>
            {pub ? (
              <>
                <InfoRow label="发布时间" value={formatTaskTime(pub.publishedAt) || "—"} />
                <Pressable onPress={() => void Linking.openURL(pub.url)} accessibilityLabel={`打开${platformLabel(p)}链接`} style={s.linkRow}>
                  <Text selectable style={s.basisLabel}>发布链接</Text>
                  <Text selectable style={s.link}>查看 ↗</Text>
                </Pressable>
              </>
            ) : (
              <Text selectable style={s.meta}>{t.stage === "APPROVED" ? "审核已通过，等达人发布后贴回链接" : "审核通过后达人发布并贴回链接"}</Text>
            )}
          </View>
        );
      })}
      {t.publications.length > 0 ? <Text selectable style={s.meta}>播放 / 点赞 / 评论：Proxy 还没接各平台的数据接口，点链接去平台看。</Text> : null}

      {t.promoStats && t.promoCode ? (
        <>
          <Text selectable style={s.label}>{`到店转化（专属码 ${t.promoCode}，按达人统计）`}</Text>
          <InfoRow label="到店新客" value={`${t.promoStats.newCustomers} 人`} />
          <InfoRow label="专属码核销" value={`${t.promoStats.redeemed} 单`} />
          <InfoRow label="带动消费" value={`${formatWan(t.promoStats.spendVnd)} VND`} />
        </>
      ) : null}
      {!t.promoCode && (t.stage === "APPROVED" || t.stage === "PUBLISHED") ? (
        <Text selectable style={s.meta}>到店转化：这位达人还没有本店专属码（打开「带来到店新客」系统会自动发），有了码才能统计到店和核销。</Text>
      ) : null}
      {t.publications.length > 0 ? (
        <Pressable
          onPress={() => void Clipboard.setStringAsync(t.publications.map((p) => `${platformLabel(p.platform)}: ${p.url}`).join("\n")).then(() => setCopied(true))}
          style={[s.btnAction, { marginTop: 14 }]}
          accessibilityLabel="复制全部平台链接"
        >
          <Text selectable style={s.btnText}>{copied ? "已复制" : "复制全部平台链接"}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function CreateSheet({ creators, busy, error, onError, onSubmit }: {
  creators: Creator[];
  busy: boolean;
  error?: string | undefined;
  onError: (message: string | undefined) => void;
  onSubmit: (input: { agentId: string; title: string; brief: string; contentType: string; platforms: string[]; priceMinVnd: number; priceMaxVnd: number; negotiable: boolean }) => void;
}): React.JSX.Element {
  const [agentId, setAgentId] = useState<string | undefined>(undefined);
  const [title, setTitle] = useState("");
  const [brief, setBrief] = useState("");
  const [contentType, setContentType] = useState("VIDEO");
  const [platforms, setPlatforms] = useState<string[]>(["tiktok"]);
  const [minText, setMinText] = useState("");
  const [maxText, setMaxText] = useState("");
  const [negotiable, setNegotiable] = useState(true);
  const toggle = (p: string): void => setPlatforms((cur) => (cur.includes(p) ? cur.filter((x) => x !== p) : [...cur, p]));
  const submit = (): void => {
    if (!agentId) { onError("先选一位达人"); return; }
    if (title.trim() === "") { onError("写一个任务标题，比如「二层包厢初体验」"); return; }
    if (platforms.length === 0) { onError("至少选一个发布平台"); return; }
    const parse = (v: string): number => (v.trim() === "" ? 0 : Number(v.replace(/[^\d]/g, "")));
    const lo = parse(minText);
    const hi = parse(maxText);
    // 只填一端 = 一口价；都空 = 出价待商议（和「邀请合作」同一个规则）。
    const min = lo || hi;
    const max = hi || lo;
    if (min > max) { onError("出价最低不能高于最高"); return; }
    onError(undefined);
    onSubmit({ agentId, title: title.trim(), brief: brief.trim(), contentType, platforms, priceMinVnd: min, priceMaxVnd: max, negotiable });
  };
  return (
    <View>
      <Text selectable style={s.sheetTitle}>发内容任务</Text>
      <Text selectable style={s.sub}>达人会在「收到的合作邀请」里看到，接单后交稿给你审核。</Text>
      <Text selectable style={s.label}>选达人</Text>
      {creators.length === 0 ? <Text selectable style={s.hint}>人才库暂时没有可匹配的达人。</Text> : null}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.creatorPick}>
        {creators.map((c) => (
          <Pressable key={c.agentId} onPress={() => setAgentId(c.agentId)} style={[s.pickItem, agentId === c.agentId && s.pickItemOn]} accessibilityLabel={`选${c.name}`}>
            <Avatar name={c.name} photoUri={c.photoUri} />
            <Text selectable numberOfLines={1} style={s.pickName}>{c.name}</Text>
          </Pressable>
        ))}
      </ScrollView>
      <Text selectable style={s.label}>任务标题</Text>
      <TextInput maxLength={60} onChangeText={setTitle} placeholder="如：二层包厢初体验" placeholderTextColor={P.sub} style={s.input} value={title} />
      <Text selectable style={s.label}>拍摄说明（可选）</Text>
      <TextInput maxLength={300} multiline onChangeText={setBrief} placeholder="想突出什么、必须拍到什么、不要拍什么" placeholderTextColor={P.sub} style={[s.input, { height: 72, paddingTop: 10 }]} value={brief} />
      <Text selectable style={s.label}>内容类型</Text>
      <View style={s.chipRow}>
        {Object.entries(CONTENT_TYPE_LABEL).map(([id, label]) => (
          <Pressable key={id} onPress={() => setContentType(id)} style={[s.chip, contentType === id && s.chipOn]} accessibilityLabel={label}>
            <Text selectable style={[s.chipText, contentType === id && s.chipTextOn]}>{label}</Text>
          </Pressable>
        ))}
      </View>
      <Text selectable style={s.label}>计划发布平台</Text>
      <View style={s.chipRow}>
        {CONTENT_PLATFORMS.map((p) => (
          <Pressable key={p} onPress={() => toggle(p)} style={[s.chip, platforms.includes(p) && s.chipOn]} accessibilityLabel={platformLabel(p)}>
            <Text selectable style={[s.chipText, platforms.includes(p) && s.chipTextOn]}>{platformLabel(p)}</Text>
          </Pressable>
        ))}
      </View>
      <Text selectable style={s.label}>出价区间 VND（都空 = 待商议）</Text>
      <View style={{ flexDirection: "row", gap: 8 }}>
        <TextInput keyboardType="number-pad" onChangeText={setMinText} placeholder="最低" placeholderTextColor={P.sub} style={[s.input, { flex: 1 }]} value={minText} />
        <TextInput keyboardType="number-pad" onChangeText={setMaxText} placeholder="最高" placeholderTextColor={P.sub} style={[s.input, { flex: 1 }]} value={maxText} />
      </View>
      <Pressable onPress={() => setNegotiable((v) => !v)} style={[s.chip, negotiable && s.chipOn, { alignSelf: "flex-start" }]} accessibilityLabel="出价可谈">
        <Text selectable style={[s.chipText, negotiable && s.chipTextOn]}>{negotiable ? "✓ 出价可谈" : "一口价"}</Text>
      </Pressable>
      {error ? <Text selectable style={s.error}>{error}</Text> : null}
      <Pressable disabled={busy} onPress={submit} style={[s.btnAction, s.btnPrimary, { marginTop: 14 }]} accessibilityLabel="发出任务">
        <Text selectable style={s.btnText}>{busy ? "发送中…" : "发出任务"}</Text>
      </Pressable>
    </View>
  );
}

function Avatar({ name, photoUri }: { name: string; photoUri?: string | undefined }): React.JSX.Element {
  const [broken, setBroken] = useState(false);
  return photoUri && !broken
    ? <Image cachePolicy="memory-disk" contentFit="cover" onError={() => setBroken(true)} source={{ uri: photoUri }} style={s.avatar} transition={0} />
    : <View style={[s.avatar, s.avatarFallback]}><Text style={s.avatarText}>{(name || "?").slice(0, 1).toUpperCase()}</Text></View>;
}

function Dash({ value, label }: { value: string; label: string }): React.JSX.Element {
  return (
    <View style={s.dashItem}>
      <Text selectable style={s.dashValue}>{value}</Text>
      <Text selectable style={s.dashLabel}>{label}</Text>
    </View>
  );
}

function Stat({ value, label }: { value: string; label: string }): React.JSX.Element {
  return (
    <View style={s.statItem}>
      <Text selectable style={s.statValue}>{value}</Text>
      <Text selectable style={s.statLabel}>{label}</Text>
    </View>
  );
}

function Btn({ label, onPress, primary, disabled }: { label: string; onPress: () => void; primary?: boolean; disabled?: boolean }): React.JSX.Element {
  return (
    <Pressable disabled={disabled} onPress={onPress} style={[s.btnAction, primary && s.btnPrimary, disabled && s.btnDisabled]} accessibilityLabel={label}>
      <Text selectable style={s.btnText}>{label}</Text>
    </Pressable>
  );
}

function InfoRow({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <View style={s.basisRow}>
      <Text selectable style={s.basisLabel}>{label}</Text>
      <Text selectable style={s.basisValue}>{value}</Text>
    </View>
  );
}

function CheckRow({ label, on, onToggle, okText }: { label: string; on: boolean; onToggle: () => void; okText: string }): React.JSX.Element {
  return (
    <Pressable onPress={onToggle} style={s.checkRow} accessibilityLabel={label}>
      <Text selectable style={s.checkLabel}>{label}</Text>
      <Text selectable style={[s.checkManual, on && s.checkManualOn]}>{on ? okText : "人工确认 ›"}</Text>
    </Pressable>
  );
}

const P = { bg: "#F4F5F7", text: "#111111", sub: "#86868B", accent: "#D0F55C", ok: "#34C759", danger: "#FF3B30", border: "#EAEAEA", soft: "#F9F9FB" };

const STAGE_TONE: Record<ContentStage, { backgroundColor: string; color: string }> = {
  AWAITING: { backgroundColor: "rgba(142,142,147,0.15)", color: "#636366" },
  SHOOTING: { backgroundColor: "rgba(100,210,255,0.15)", color: "#0071E3" },
  IN_REVIEW: { backgroundColor: "rgba(255,149,0,0.15)", color: "#B36B00" },
  APPROVED: { backgroundColor: "rgba(52,199,89,0.12)", color: "#1E8E3E" },
  PUBLISHED: { backgroundColor: "rgba(52,199,89,0.15)", color: "#1E8E3E" },
  CLOSED: { backgroundColor: "rgba(142,142,147,0.12)", color: "#8E8E93" },
};

const s = StyleSheet.create({
  subHeader: { alignItems: "center", flexDirection: "row", gap: 12, marginBottom: 16 },
  backBtn: { alignItems: "center", backgroundColor: "#FFFFFF", borderColor: P.border, borderRadius: 20, borderWidth: 1, height: 40, justifyContent: "center", width: 40 },
  h1: { color: P.text, fontSize: 20, fontWeight: "800", letterSpacing: -0.5 },
  h2: { color: P.text, fontSize: 16, fontWeight: "800" },
  sub: { color: P.sub, fontSize: 11, marginTop: 2 },
  hint: { color: P.sub, fontSize: 12, lineHeight: 17, marginBottom: 8 },
  meta: { color: P.sub, fontSize: 11, lineHeight: 15, marginTop: 6 },
  label: { color: "#333333", fontSize: 12, fontWeight: "700", marginBottom: 8, marginTop: 14 },
  error: { color: P.danger, fontSize: 12, marginVertical: 6 },
  ok: { color: "#1E8E3E", fontSize: 12, fontWeight: "700", marginBottom: 8 },
  emptyTitle: { color: P.text, fontSize: 14, fontWeight: "800", marginBottom: 6 },
  dashGrid: { flexDirection: "row", flexWrap: "wrap", gap: 12, marginBottom: 14 },
  dashItem: { alignItems: "center", backgroundColor: "#FFFFFF", borderColor: P.border, borderRadius: 20, borderWidth: 1, flexBasis: "47%", flexGrow: 1, padding: 16 },
  dashValue: { color: P.text, fontSize: 22, fontWeight: "800", marginBottom: 4 },
  dashLabel: { color: P.sub, fontSize: 12, fontWeight: "500" },
  tabRow: { gap: 8, paddingBottom: 4 },
  sectionTitle: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", marginBottom: 12, marginTop: 16 },
  addBtn: { backgroundColor: "#1A1A1E", borderRadius: 999, paddingHorizontal: 14, paddingVertical: 7 },
  addText: { color: "#FFFFFF", fontSize: 12, fontWeight: "800" },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 6 },
  chip: { backgroundColor: "#FFFFFF", borderColor: P.border, borderRadius: 999, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 8 },
  chipOn: { backgroundColor: "#1A1A1E", borderColor: "#1A1A1E" },
  chipText: { color: P.text, fontSize: 13, fontWeight: "600" },
  chipTextOn: { color: "#FFFFFF" },
  card: { backgroundColor: "#FFFFFF", borderColor: P.border, borderRadius: 20, borderWidth: 1, marginBottom: 12, padding: 16 },
  cardHeader: { alignItems: "flex-start", flexDirection: "row", justifyContent: "space-between", marginBottom: 10 },
  creatorRow: { alignItems: "center", flexDirection: "row", gap: 10 },
  avatar: { borderRadius: 22, height: 44, width: 44 },
  avatarFallback: { alignItems: "center", backgroundColor: P.accent, justifyContent: "center" },
  avatarText: { color: P.text, fontSize: 16, fontWeight: "800" },
  creatorName: { color: P.text, fontSize: 15, fontWeight: "800" },
  creatorHandle: { color: P.sub, fontSize: 11 },
  status: { borderRadius: 6, fontSize: 11, fontWeight: "700", overflow: "hidden", paddingHorizontal: 8, paddingVertical: 3 },
  platformRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 10 },
  platformTag: { backgroundColor: P.soft, borderColor: P.border, borderRadius: 6, borderWidth: 1, color: P.sub, fontSize: 11, fontWeight: "700", overflow: "hidden", paddingHorizontal: 8, paddingVertical: 3 },
  platformTagOn: { backgroundColor: "rgba(52,199,89,0.12)", borderColor: "rgba(52,199,89,0.3)", color: "#1E8E3E" },
  taskTitle: { color: P.text, fontSize: 14, fontWeight: "700", lineHeight: 20, marginBottom: 8 },
  reasonLine: { alignItems: "center", backgroundColor: P.soft, borderRadius: 10, flexDirection: "row", gap: 6, marginBottom: 8, paddingHorizontal: 10, paddingVertical: 8 },
  dot: { backgroundColor: P.ok, borderRadius: 2, height: 4, width: 4 },
  reasonText: { color: P.sub, flex: 1, fontSize: 11, lineHeight: 15 },
  codeStats: { borderTopColor: "#F0F0F0", borderTopWidth: 1, flexDirection: "row", paddingTop: 12 },
  statItem: { alignItems: "center", flex: 1 },
  statValue: { color: P.text, fontSize: 15, fontWeight: "800" },
  statLabel: { color: P.sub, fontSize: 11, marginTop: 3 },
  cardActions: { borderTopColor: "#F0F0F0", borderTopWidth: 1, flexDirection: "row", gap: 8, marginTop: 12, paddingTop: 12 },
  btnAction: { alignItems: "center", backgroundColor: "#FFFFFF", borderColor: P.border, borderRadius: 10, borderWidth: 1, flex: 1, padding: 10 },
  btnPrimary: { backgroundColor: P.accent, borderColor: P.accent },
  btnDisabled: { opacity: 0.45 },
  btnText: { color: P.text, fontSize: 12, fontWeight: "700" },
  input: { backgroundColor: P.soft, borderColor: P.border, borderRadius: 12, borderWidth: 1, color: P.text, fontSize: 14, height: 44, marginBottom: 8, paddingHorizontal: 14 },
  modalRoot: { backgroundColor: "rgba(0,0,0,0.35)", flex: 1, justifyContent: "flex-end" },
  backdrop: { bottom: 0, left: 0, position: "absolute", right: 0, top: 0 },
  sheetScroll: { flexShrink: 1 },
  sheet: { backgroundColor: "#FFFFFF", borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: "88%", padding: 20, paddingBottom: 34 },
  sheetTitle: { color: P.text, fontSize: 16, fontWeight: "800" },
  sheetQuote: { color: P.text, fontSize: 15, fontWeight: "800", lineHeight: 21, marginBottom: 10, marginTop: 10 },
  caption: { backgroundColor: P.soft, borderRadius: 10, color: "#333333", fontSize: 12, lineHeight: 18, marginVertical: 8, padding: 10 },
  basisRow: { borderBottomColor: "#F2F2F2", borderBottomWidth: 1, flexDirection: "row", justifyContent: "space-between", paddingVertical: 9 },
  basisLabel: { color: P.sub, fontSize: 12 },
  basisValue: { color: P.text, flexShrink: 1, fontSize: 12, fontWeight: "700", marginLeft: 12, textAlign: "right" },
  mediaRow: { gap: 8, marginVertical: 10 },
  mediaThumb: { backgroundColor: P.soft, borderRadius: 10, height: 120, width: 90 },
  checkRow: { alignItems: "center", borderBottomColor: "#F2F2F2", borderBottomWidth: 1, flexDirection: "row", justifyContent: "space-between", paddingVertical: 11 },
  checkLabel: { color: P.text, fontSize: 13 },
  checkAuto: { color: "#1E8E3E", fontSize: 12, fontWeight: "700" },
  checkManual: { color: "#0071E3", fontSize: 12, fontWeight: "700" },
  checkManualOn: { color: "#1E8E3E" },
  platformCard: { backgroundColor: P.soft, borderRadius: 14, marginTop: 10, padding: 12 },
  platformHead: { flexDirection: "row", justifyContent: "space-between", marginBottom: 4 },
  platformName: { color: P.text, fontSize: 14, fontWeight: "800" },
  platformState: { color: P.sub, fontSize: 12, fontWeight: "700" },
  linkRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 9 },
  link: { color: "#0071E3", fontSize: 12, fontWeight: "700" },
  creatorPick: { gap: 10, paddingVertical: 4 },
  pickItem: { alignItems: "center", borderColor: P.border, borderRadius: 14, borderWidth: 1, padding: 8, width: 72 },
  pickItemOn: { backgroundColor: "rgba(208,245,92,0.35)", borderColor: "#9CC62B" },
  pickName: { color: P.text, fontSize: 11, fontWeight: "700", marginTop: 4 },
});

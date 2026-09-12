// FulfillmentWorkspace（稳定 Surface）：UIPlan 面板宿主。
// 流程：fixture/模型产出 UIPlan → validate（fail-closed）→ hydrate → json-render 渲染。
// UIPlan 校验失败时自动降级为该类目的确定性 fallback 计划（Gate I）。
// 视觉基线：原型 requesterflow / citycompanion 屏（backbtn + flowpill + unifiedStage）。
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import type { ConversationClient } from "../conversation-client";
import type { DemandClient } from "../demand-client";
import { UIPlanRenderer } from "../components/registry";
import { color } from "../theme";
import { fallbackPlanFor } from "../uiplan/fallback";
import { fixturePlanFor, resolveReadModel } from "../uiplan/fixtures";
import { planToSpec } from "../uiplan/orchestrator";
import { isHardDemandCategory, type HardDemandCategory, type UIPlan } from "../uiplan/types";
import { validateUIPlan } from "../uiplan/validator";

export interface WorkspaceTarget {
  category: HardDemandCategory;
  goal: string;
}

interface ChatMessage {
  id: string;
  sender: string;
  body: string;
  time: string;
  isOwn: boolean;
  isAI?: boolean;
}

// 基线 .unifiedStage：理解 → 匹配 → 确认（当前阶段：匹配）。
const STAGES = ["理解", "匹配", "确认"] as const;

export function FulfillmentWorkspace({
  target,
  conversationClient,
  demandClient,
  onBack
}: {
  target: WorkspaceTarget;
  conversationClient?: ConversationClient;
  demandClient?: DemandClient;
  onBack: () => void;
}): React.JSX.Element {
  const [actionNote, setActionNote] = useState<string>();
  // 本地已选候选（草稿同步失败/无连接时仍保留选择并展示）。
  const [selectedCandidateId, setSelectedCandidateId] = useState<string | undefined>(undefined);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [convId, setConvId] = useState<string | undefined>();
  const [draftId, setDraftId] = useState<string | undefined>();
  const [draftVersion, setDraftVersion] = useState(0);
  const scrollRef = useRef<ScrollView>(null);
  const contentScrollRef = useRef<ScrollView>(null);

  const { spec, plan, observability } = useMemo(() => {
    const candidatePlan: UIPlan = fixturePlanFor(target.category, target.goal);
    let decision = validateUIPlan(toWire(candidatePlan));
    let usedPlan = candidatePlan;
    if ((!decision.ok || !isHardDemandCategory(usedPlan.demandCategory)) && isHardDemandCategory(target.category)) {
      usedPlan = fallbackPlanFor(target.category);
      decision = validateUIPlan(toWire(usedPlan));
    }
    const result = planToSpec(decision, resolveReadModel);
    return { spec: result.spec, plan: decision.plan ?? usedPlan, observability: result.observability };
  }, [target]);

  // 自动滚到底部
  useEffect(() => {
    if (chatMessages.length > 0) {
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
    }
  }, [chatMessages]);

  // actionNote 出现时自动滚到底部
  useEffect(() => {
    if (actionNote) {
      setTimeout(() => contentScrollRef.current?.scrollToEnd({ animated: true }), 100);
    }
  }, [actionNote]);

  // 进入工作区时自动创建 TaskDraft
  useEffect(() => {
    if (!demandClient || draftId) return;
    void demandClient.createDraft(target.goal).then((result) => {
      if (result.aggregate?.type === "TaskDraft") {
        setDraftId(result.aggregate.id);
        setDraftVersion(result.aggregate.version ?? 0);
      }
    }).catch(() => {
      // 草稿建失败就直说，不把英文技术错抛给用户看。
      setActionNote("工作区创建失败，请检查连接后重试。");
    });
  }, [demandClient, target.goal, draftId]);

  const parseOperationRef = useCallback((result: Record<string, unknown>): Record<string, unknown> | undefined => {
    const ref = typeof result?.operationRef === "string" ? result.operationRef : undefined;
    if (!ref) return undefined;
    try { return JSON.parse(ref) as Record<string, unknown>; } catch { return undefined; }
  }, []);

  // 发送消息到 Plan 讨论
  async function sendPlanMessage(): Promise<void> {
    if (!draft.trim() || sending || !conversationClient) return;
    setSending(true);
    const userText = draft.trim();
    const userMsg: ChatMessage = {
      id: `msg_${Date.now()}`,
      sender: "你",
      body: userText,
      time: new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }),
      isOwn: true
    };
    setChatMessages((prev) => [...prev, userMsg]);
    setDraft("");

    try {
      // 首次发送时创建会话
      if (!convId) {
        const startResult = await conversationClient.startConversation({
          originType: "TASK",
          originId: target.goal,
          participantId: "user_proxy_ai",
          firstMessage: `[Plan讨论] 需求: ${target.goal}\n用户: ${userText}`
        });
        const payload = parseOperationRef(startResult);
        if (payload?.conversationId) setConvId(payload.conversationId as string);
        const aiMsg = payload?.aiMessage as Record<string, unknown> | undefined;
        if (aiMsg) {
          setChatMessages((prev) => [...prev, {
            id: (aiMsg.messageId as string) || "ai_1",
            sender: "Proxy AI",
            body: (aiMsg.body as string) || "",
            time: new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }),
            isOwn: false,
            isAI: true
          }]);
        }
      } else {
        const result = await conversationClient.sendMessage(convId, userText);
        const payload = parseOperationRef(result);
        const aiMsg = payload?.aiMessage as Record<string, unknown> | undefined;
        if (aiMsg) {
          setChatMessages((prev) => [...prev, {
            id: (aiMsg.messageId as string) || `ai_${Date.now()}`,
            sender: "Proxy AI",
            body: (aiMsg.body as string) || "",
            time: new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }),
            isOwn: false,
            isAI: true
          }]);
        }
      }
    } catch {
      // 发送失败不能静默：用户已经看到自己的气泡，必须撤回乐观消息、
      // 恢复草稿并明说，否则"发出去了"全是假的。
      setChatMessages((prev) => prev.filter((msg) => msg.id !== userMsg.id));
      setDraft(userText);
      setActionNote("消息发送失败，请检查连接后重试。");
    } finally {
      setSending(false);
    }
  }

  return (
    <View style={styles.root}>
      <View style={styles.topBar}>
        <Pressable onPress={onBack} style={styles.backButton}>
          <Text style={styles.backText}>‹</Text>
        </Pressable>
        <Text numberOfLines={1} style={styles.title}>
          {plan.title}
        </Text>
      </View>
      <View style={styles.flowRow}>
        <View style={styles.flowPill}>
          <View style={styles.flowDot} />
          <Text style={styles.flowPillText}>履约进行中 · {plan.taskArchetype ?? plan.demandCategory}</Text>
        </View>
      </View>
      <View style={styles.stageRail}>
        {STAGES.map((stage) => (
          <Text key={stage} style={[styles.stage, stage === "匹配" && styles.stageActive]}>
            {stage}
          </Text>
        ))}
      </View>

      {/* Plan 讨论区 */}
      <View style={styles.chatSection}>
        <View style={styles.chatHeader}>
          <Text style={styles.chatTitle}>Plan 讨论</Text>
          <Text style={styles.chatHint}>和 AI 讨论调整计划</Text>
        </View>
        <ScrollView
          ref={scrollRef}
          style={styles.chatMessages}
          contentContainerStyle={styles.chatContent}
        >
          {chatMessages.length === 0 && (
            <View style={styles.chatEmpty}>
              <Text style={styles.chatEmptyText}>有任何问题或调整想法，直接告诉 AI</Text>
            </View>
          )}
          {chatMessages.map((msg) => (
            <View key={msg.id} style={[styles.chatBubble, msg.isOwn ? styles.chatBubbleOwn : msg.isAI ? styles.chatBubbleAI : styles.chatBubbleOther]}>
              {!msg.isOwn && <Text style={styles.chatSender}>{msg.sender}</Text>}
              <Text style={[styles.chatBody, msg.isOwn && styles.chatBodyOwn]}>{msg.body}</Text>
              <Text style={[styles.chatTime, msg.isOwn && styles.chatTimeOwn]}>{msg.time}</Text>
            </View>
          ))}
        </ScrollView>
        <View style={styles.chatComposer}>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            placeholder="讨论计划、调整需求..."
            placeholderTextColor="#A9A2B0"
            style={styles.chatInput}
            multiline
            editable={!sending}
          />
          <Pressable
            disabled={!draft.trim() || sending}
            onPress={() => void sendPlanMessage()}
            style={[styles.chatSendBtn, (!draft.trim() || sending) && styles.chatSendBtnDisabled]}
          >
            <Text style={styles.chatSendText}>{sending ? "..." : "发送"}</Text>
          </Pressable>
        </View>
      </View>

      <ScrollView ref={contentScrollRef} contentContainerStyle={styles.content}>
        {target.goal !== "" ? <Text style={styles.goalEcho}>你的目标：{target.goal}</Text> : null}
        <UIPlanRenderer
          spec={spec}
          state={{ critical_answer: "" }}
          onAction={(actionName, params) => {
            if (actionName === "answer_critical_question") {
              // 将关键问题回答写入 Domain Truth
              if (demandClient && draftId) {
                const questionKey = (params?.questionKey as string) ?? "critical_answer";
                const answer = (params?.answer as string) ?? String(params?.selectedId ?? "");
                void demandClient.updateDraft(draftId, draftVersion, {
                  [questionKey]: answer
                } as Record<string, string>).then((result) => {
                  if (result.aggregate?.version) setDraftVersion(result.aggregate.version);
                  setActionNote("已记录关键问题回答，已写入 Domain Truth。");
                }).catch(() => {
                  setActionNote("已记录关键问题回答（本地暂存，服务端同步中）。");
                });
              } else {
                setActionNote("已记录关键问题回答（等待服务端连接）。");
              }
            } else if (actionName === "select_candidate") {
              // 候选选择落盘到 TaskDraft（与关键问题回答同链路）；
              // 无连接时只记本地选择，不谎称已成交。
              const agentId = params?.agentId !== undefined ? String(params.agentId) : "";
              if (demandClient && draftId && agentId) {
                void demandClient.updateDraft(draftId, draftVersion, {
                  selectedCandidate: agentId
                } as Record<string, string>).then((result) => {
                  if (result.aggregate?.version) setDraftVersion(result.aggregate.version);
                  setSelectedCandidateId(agentId);
                  setActionNote(`已选择候选（${agentId}），已写入草稿。`);
                }).catch(() => {
                  setSelectedCandidateId(agentId);
                  setActionNote(`已选择候选（${agentId}，本地暂存，服务端同步中）。`);
                });
              } else {
                if (agentId) setSelectedCandidateId(agentId);
                setActionNote(agentId ? `已选择候选（${agentId}，等待服务端连接）。` : "已选择候选。");
              }
            }
          }}
        />
        {actionNote ? (
          <View style={styles.actionNoteRow}>
            <Text style={styles.actionNote}>{actionNote}</Text>
            {actionNote.includes("失败") ? (
              <Pressable onPress={() => {
                setActionNote(undefined);
                setDraftId(undefined);
              }} style={styles.retryBtn}>
                <Text style={styles.retryBtnText}>重试</Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}
        {selectedCandidateId && !actionNote ? (
          <View style={styles.actionNoteRow}>
            <Text style={styles.actionNote}>已选候选（{selectedCandidateId}）</Text>
          </View>
        ) : null}
        {observability ? (
          <Text style={styles.obs}>
            UIPlan {observability.uiPlanId} · 请求 {observability.requestedComponents} / 渲染 {observability.renderedComponents} / 拒绝{" "}
            {observability.rejectedComponents.length}
            {observability.fallbackUsed ? " · fallback" : ""}
          </Text>
        ) : null}
      </ScrollView>
    </View>
  );
}

// 领域对象 → 契约线格式（snake_case），与模型输出同形，统一走 zod 校验。
function toWire(plan: UIPlan): Record<string, unknown> {
  return {
    ui_plan_id: plan.uiPlanId,
    schema_version: plan.schemaVersion,
    surface: plan.surface,
    context: plan.context,
    demand_category: plan.demandCategory,
    task_archetype: plan.taskArchetype,
    title: plan.title,
    panels: plan.panels.map((panel) => ({
      component_id: panel.componentId,
      priority: panel.priority,
      ...(panel.dataRef ? { data_ref: panel.dataRef } : {})
    }))
  };
}

const styles = StyleSheet.create({
  root: { backgroundColor: color.offWhite, flex: 1 },
  topBar: { alignItems: "center", flexDirection: "row", gap: 6, paddingHorizontal: 12, paddingTop: 2 },
  backButton: { alignItems: "center", height: 30, justifyContent: "center", width: 30 },
  backText: { color: color.ink, fontSize: 24, lineHeight: 28 },
  title: { color: color.ink, flex: 1, fontSize: 15, fontWeight: "900" },
  flowRow: { paddingHorizontal: 16, paddingTop: 4 },
  flowPill: {
    alignItems: "center",
    alignSelf: "flex-start",
    backgroundColor: color.ink,
    borderRadius: 999,
    flexDirection: "row",
    gap: 5,
    paddingHorizontal: 9,
    paddingVertical: 5
  },
  flowDot: { backgroundColor: color.lime, borderRadius: 999, height: 7, width: 7 },
  flowPillText: { color: color.white, fontSize: 11, fontWeight: "900" },
  stageRail: { flexDirection: "row", gap: 5, paddingHorizontal: 16, paddingTop: 8 },
  stage: {
    backgroundColor: "#F0EBF3",
    borderRadius: 999,
    color: "#756B7A",
    flex: 1,
    fontSize: 11,
    fontWeight: "700",
    paddingVertical: 5,
    textAlign: "center"
  },
  stageActive: { backgroundColor: color.ink, color: color.white, fontWeight: "900" },
  content: { gap: 10, padding: 16, paddingBottom: 32 },
  goalEcho: { color: color.muted, fontSize: 11, fontStyle: "italic", lineHeight: 16 },
  actionNote: {
    backgroundColor: color.stateInfoBg,
    borderColor: color.stateInfoBorder,
    borderRadius: 12,
    borderWidth: 1,
    color: color.ink,
    flex: 1,
    fontSize: 12,
    lineHeight: 17,
    padding: 12
  },
  actionNoteRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8
  },
  retryBtn: {
    backgroundColor: color.ink,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8
  },
  retryBtnText: { color: color.white, fontSize: 11, fontWeight: "700" },
  obs: { color: color.brandSmall, fontSize: 11, textAlign: "center" },

  // Plan 讨论区
  chatSection: {
    backgroundColor: color.white,
    borderColor: color.line,
    borderTopWidth: 1,
    flex: 1
  },
  chatHeader: {
    borderBottomColor: color.line,
    borderBottomWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: 12,
    paddingVertical: 8
  },
  chatTitle: { color: color.ink, fontSize: 12, fontWeight: "700" },
  chatHint: { color: color.muted, fontSize: 11 },
  chatMessages: { flex: 1 },
  chatContent: { gap: 8, padding: 12 },
  chatEmpty: { alignItems: "center", paddingVertical: 20 },
  chatEmptyText: { color: color.muted, fontSize: 11 },
  chatBubble: { borderRadius: 12, maxWidth: "80%", padding: 10 },
  chatBubbleOwn: { alignSelf: "flex-end", backgroundColor: color.ink },
  chatBubbleOther: { alignSelf: "flex-start", backgroundColor: color.surface, borderColor: color.line, borderWidth: 1 },
  chatBubbleAI: { alignSelf: "flex-start", backgroundColor: "#F0EBF5", borderColor: "#C4B5D4", borderWidth: 1 },
  chatSender: { color: color.muted, fontSize: 11, fontWeight: "700", marginBottom: 3 },
  chatBody: { color: color.ink, fontSize: 11, lineHeight: 16 },
  chatBodyOwn: { color: color.white },
  chatTime: { color: color.muted, fontSize: 11, marginTop: 4, textAlign: "right" },
  chatTimeOwn: { color: "rgba(255,255,255,0.6)" },
  chatComposer: {
    alignItems: "center",
    backgroundColor: color.white,
    borderTopColor: color.line,
    borderTopWidth: 1,
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8
  },
  chatInput: {
    backgroundColor: color.surface,
    borderColor: color.line,
    borderRadius: 12,
    borderWidth: 1,
    color: color.ink,
    flex: 1,
    fontSize: 11,
    maxHeight: 60,
    paddingHorizontal: 10,
    paddingVertical: 8
  },
  chatSendBtn: { backgroundColor: color.ink, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10 },
  chatSendBtnDisabled: { opacity: 0.5 },
  chatSendText: { color: color.white, fontSize: 11, fontWeight: "700" }
});

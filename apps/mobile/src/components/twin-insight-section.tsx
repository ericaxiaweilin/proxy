import { useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type {
  ListTwinInsightsPayload,
  TwinOperateAction,
} from "@proxy/contracts";
import { TwinInsightClient } from "../twin-insight-client";
import { AiPersonaClient } from "../ai-persona-client";
import type { TransportResponse, TransportRequest } from "../auth-client";
import { color, foundation } from "../theme";
import { ProxyEmptyState } from "./proxy-foundation";
import { TwinInsightCard, TwinTargetRail } from "./twin-insight-card";

// TWIN-INSIGHT-002 — AI 分身中心「好友洞察」段。
//
// 落位（owner 定向）：用户 2026-09-21 原型明确把好友洞察放在 AI 分身页
// （tab「AI 分身」active）。AI-CLUSTER-BOUNDARY-001 说这屏只管数字资产、
// 访问战绩归好友页——那条指的是复用 MEDIA-DWELL 明细两屏各画一遍；
// 本段数据走独立的 TwinInsight wire（服务端算好的洞察，不是好友页明细
// 的复制），不违反「同一份数据只画一次」。见 PRD §6。
//
// 数据策略（**后端已落地**）：
//  - 只走服务端：`GET /v1/ai/twins/{id}/insights`（internal/twininsight）。
//  - **没有任何兜底数据**。原先那份演示兜底模块（6 个编造好友
//    Alex/Tom/Minh/Brandon/陈先生/王老板 + 编造的分数与建议）已删除 ——
//    用户 2026-09-22 的反馈是「数据也不是真的」，而虚构兜底正是它的成因：
//    endpoint 一 404 就静默降级成假数据，屏幕上还挂一个演示角标，
//    看起来像功能做完了。（本文件刻意不再出现那个角标的文案，
//    twin-insight-section.test.ts 反向钉住它。）
//  - 分身就地激活（TWIN-SUBSPACE-ACTIVATE-001）：读之前先 ensure ——
//    有分身直接用，没有就建一个个人副空间。激活失败（年龄门禁/断网）
//    走错误态；空态只留给"分身在但没目标"。
//  - 三种结果必须分开显示，不许互相冒充：
//       insights: []  = 真的没有洞察（空态）
//       请求失败      = 读不出来（错误态 + 重试）
//       缺字段        = 协议异常（同样走错误态，fail-closed）
//   把「读不出来」显示成「还没有好友洞察」就是骗用户，反之亦然。

type AuthChannel = {
  request(path: string, init: { method: TransportRequest["method"]; body?: unknown }): Promise<TransportResponse>;
};

function messageFor(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  return "读取好友洞察失败";
}

export function TwinInsightSection({ authClient, ownerId, resolveMediaUrl }: {
  authClient: AuthChannel;
  ownerId: string | undefined;
  /** TWIN-INSIGHT-AVATAR-001: 服务端 avatarUrl 是相对路径，必须拼 base 才能显示。 */
  resolveMediaUrl?: ((path: string) => string) | undefined;
}): React.JSX.Element {
  const insightClient = useMemo(
    () =>
      new TwinInsightClient({
        requester: {
          requestPublic: (path, init) => authClient.request(path, init),
          request: (path, init) => authClient.request(path, init),
        },
        baseUrl: "",
      }),
    [authClient],
  );
  const personaClient = useMemo(() => new AiPersonaClient({ authClient }), [authClient]);

  const [payload, setPayload] = useState<ListTwinInsightsPayload | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [attempt, setAttempt] = useState(0);
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined);
  const [expanded, setExpanded] = useState(false);
  const [acting, setActing] = useState(false);
  const [notice, setNotice] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (!ownerId) {
      setPayload(undefined);
      setError(undefined);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(undefined);
    void (async () => {
      try {
        // TWIN-SUBSPACE-ACTIVATE-001：分身是个人副空间，进页面就地激活 ——
        // 有就用，没有就建。建失败（年龄门禁/断网）进错误态，不进空态：
        // 空态只留给"分身在但没目标"（见下面 ProxyEmptyState）。
        const twin = await personaClient.ensurePersonalTwin(ownerId);
        const data = await insightClient.listInsights(twin.id);
        if (!cancelled) {
          setPayload(data);
          setSelectedId(data.insights[0]?.targetId);
        }
      } catch (err) {
        // fail-closed：读不出来就是读不出来，绝不补一份假数据上去。
        if (!cancelled) setError(messageFor(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [insightClient, personaClient, ownerId, attempt]);

  const insights = payload?.insights ?? [];
  const selected = insights.find((entry) => entry.targetId === selectedId) ?? insights[0];

  async function act(action: TwinOperateAction): Promise<void> {
    if (!selected || !payload || acting) return;
    setActing(true);
    setNotice(undefined);
    try {
      await insightClient.operate(payload.twinId, selected.targetId, action);
      setNotice(action === "operate" ? `已开启对 ${selected.displayName} 的单独运营` : "已标记为观察");
    } catch (err) {
      setNotice(messageFor(err));
    } finally {
      setActing(false);
    }
  }

  async function refreshSummary(): Promise<void> {
    if (!selected || !payload || acting) return;
    setActing(true);
    try {
      const updated = await insightClient.refreshSummary(payload.twinId, selected.targetId);
      setPayload((prev) =>
        prev ? { ...prev, insights: prev.insights.map((entry) => (entry.targetId === updated.targetId ? updated : entry)) } : prev,
      );
      setNotice("已重新总结");
    } catch (err) {
      setNotice(messageFor(err));
    } finally {
      setActing(false);
    }
  }

  return (
    <View style={styles.section}>
      <Text style={styles.title}>好友洞察</Text>
      <Text style={styles.sub}>谁值得运营 · 谁只是路人</Text>

      {error ? (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>{error}</Text>
          <Pressable
            accessibilityLabel="重试读取好友洞察"
            onPress={() => setAttempt((prev) => prev + 1)}
            style={styles.retryButton}
          >
            <Text style={styles.retryText}>重试</Text>
          </Pressable>
        </View>
      ) : loading && !payload ? (
        <Text style={styles.stateText}>正在读取好友洞察…</Text>
      ) : insights.length === 0 ? (
        <ProxyEmptyState title="还没有好友洞察" sub="有人找你聊天或来看过主页后，这里会告诉你谁值得运营" />
      ) : (
        <View style={styles.body}>
          <TwinTargetRail
            insights={insights}
            selectedId={selected?.targetId}
            resolveMediaUrl={resolveMediaUrl}
            onSelect={(targetId) => {
              setSelectedId(targetId);
              setExpanded(false);
              setNotice(undefined);
            }}
          />
          {selected && payload ? (
            <TwinInsightCard
              insight={selected}
              thresholds={payload.thresholds}
              expanded={expanded}
              acting={acting}
              resolveMediaUrl={resolveMediaUrl}
              onToggle={() => setExpanded((prev) => !prev)}
              onObserve={() => void act("observe")}
              onOperate={() => void act("operate")}
              onRefreshSummary={() => void refreshSummary()}
            />
          ) : null}
          {notice ? <Text style={styles.notice}>{notice}</Text> : null}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { marginTop: foundation.space.four },
  title: { color: foundation.ink, fontSize: 18, fontWeight: "800" },
  sub: { color: color.muted, fontSize: 12, marginBottom: foundation.space.three, marginTop: 2 },
  errorBox: {
    alignItems: "flex-start",
    backgroundColor: color.chipNeutralBg,
    borderRadius: 10,
    gap: 8,
    marginHorizontal: foundation.space.four,
    padding: foundation.space.three,
  },
  errorText: { color: color.muted, fontSize: 13 },
  retryButton: { borderColor: color.line, borderRadius: 8, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 6 },
  retryText: { color: foundation.ink, fontSize: 13, fontWeight: "700" },
  body: { marginHorizontal: -16 },
  stateText: { color: color.muted, fontSize: 13, paddingHorizontal: foundation.space.four, paddingVertical: 12 },
  notice: { color: color.muted, fontSize: 12, paddingHorizontal: foundation.space.four, paddingBottom: foundation.space.three },
});

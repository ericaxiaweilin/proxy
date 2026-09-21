import { useEffect, useMemo, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
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
import { DEMO_PAYLOAD } from "./twin-insight-demo";

// TWIN-INSIGHT-001 — AI 分身中心「好友洞察」段。
//
// 落位（owner 定向）：用户 2026-09-21 原型明确把好友洞察放在 AI 分身页
// （tab「AI 分身」active）。AI-CLUSTER-BOUNDARY-001 说这屏只管数字资产、
// 访问战绩归好友页——那条指的是复用 MEDIA-DWELL 明细两屏各画一遍；
// 本段数据走独立的 TwinInsight wire（服务端算好的洞察，不是好友页明细
// 的复制），不违反「同一份数据只画一次」。见 PRD §6。
//
// 数据策略（后端未落地前）：
//  - 登录用户：先 listMine 取首个分身 → listInsights；成功则渲染服务端真相；
//    任何失败（endpoint 未实现/网络/解析）→ 本机演示数据兜底（badge 明示）；
//  - 未登录：直接本机演示（读通道无 token，不发请求）。
//  - wire 失败 fail-closed 的部分保留：服务端返回但解析失败同样进兜底并
//    badge，不同的是「没有洞察 []」和「没读出来」仍然分开（空数组走空态）。
//  - 演示数据的 advice/summary 全是纯文本（无 <strong>），测试钉住。
//  - 后端落地后删 DEMO 段 + badge（TODO: TWIN-INSIGHT-002 Go wire）。

type AuthChannel = {
  request(path: string, init: { method: TransportRequest["method"]; body?: unknown }): Promise<TransportResponse>;
};

export function TwinInsightSection({ authClient, ownerId }: {
  authClient: AuthChannel;
  ownerId: string | undefined;
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
  const [demo, setDemo] = useState(false);
  const [loading, setLoading] = useState(false);
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined);
  const [expanded, setExpanded] = useState(false);
  const [acting, setActing] = useState(false);
  const [notice, setNotice] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (!ownerId) {
      setPayload(DEMO_PAYLOAD);
      setDemo(true);
      return;
    }
    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        const personas = await personaClient.listMine(ownerId);
        const twinId = personas[0]?.id;
        if (!twinId) throw new Error("no twin");
        const data = await insightClient.listInsights(twinId);
        if (!cancelled) {
          setPayload(data);
          setDemo(false);
          setSelectedId(data.insights[0]?.targetId);
        }
      } catch {
        if (!cancelled) {
          setPayload(DEMO_PAYLOAD);
          setDemo(true);
          setSelectedId(DEMO_PAYLOAD.insights[0]?.targetId);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [insightClient, personaClient, ownerId]);

  const insights = payload?.insights ?? [];
  const selected = insights.find((entry) => entry.targetId === selectedId) ?? insights[0];

  async function act(action: TwinOperateAction): Promise<void> {
    if (!selected || acting) return;
    if (demo || !payload || payload.twinId === "demo") {
      setNotice("本机演示数据：接服务端后可用");
      return;
    }
    setActing(true);
    setNotice(undefined);
    try {
      await insightClient.operate(payload.twinId, selected.targetId, action);
      setNotice(action === "operate" ? `已开启对 ${selected.displayName} 的单独运营` : "已标记为观察");
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "操作失败，请稍后重试");
    } finally {
      setActing(false);
    }
  }

  async function refreshSummary(): Promise<void> {
    if (!selected || acting) return;
    if (demo || !payload || payload.twinId === "demo") {
      setNotice("本机演示数据：接服务端后可用");
      return;
    }
    setActing(true);
    try {
      const updated = await insightClient.refreshSummary(payload.twinId, selected.targetId);
      setPayload((prev) =>
        prev ? { ...prev, insights: prev.insights.map((entry) => (entry.targetId === updated.targetId ? updated : entry)) } : prev,
      );
      setNotice("已重新总结");
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "重新总结失败，请稍后重试");
    } finally {
      setActing(false);
    }
  }

  return (
    <View style={styles.section}>
      <Text style={styles.title}>好友洞察</Text>
      <View style={styles.subRow}>
        <Text style={styles.sub}>谁值得运营 · 谁只是路人</Text>
        {demo ? (
          <View style={styles.demoBadge}>
            <Text style={styles.demoBadgeText}>本机演示</Text>
          </View>
        ) : null}
      </View>

      {loading && !payload ? (
        <Text style={styles.stateText}>正在读取好友洞察…</Text>
      ) : insights.length === 0 ? (
        <ProxyEmptyState title="还没有好友洞察" sub="创建分身并加好友后，这里会告诉你谁值得运营" />
      ) : (
        <View style={styles.body}>
          <TwinTargetRail
            insights={insights}
            selectedId={selected?.targetId}
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
  subRow: { alignItems: "center", flexDirection: "row", gap: 8, marginBottom: foundation.space.three, marginTop: 2 },
  sub: { color: color.muted, fontSize: 12 },
  demoBadge: { backgroundColor: color.chipNeutralBg, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  demoBadgeText: { color: color.chipNeutralText, fontSize: 11, fontWeight: "700" },
  body: { marginHorizontal: -16 },
  stateText: { color: color.muted, fontSize: 13, paddingHorizontal: foundation.space.four, paddingVertical: 12 },
  notice: { color: color.muted, fontSize: 12, paddingHorizontal: foundation.space.four, paddingBottom: foundation.space.three },
});

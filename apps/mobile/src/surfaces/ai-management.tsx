import { useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Svg, Circle, Line } from "react-native-svg";
import { AiPersonaClient } from "../ai-persona-client";
import type { TransportResponse, TransportRequest } from "../auth-client";
import { ProxyIcon } from "../components/proxy-icon";
import { color } from "../theme";

// AIManagementSurface — 「我的 → 账户 → AI 管理」。
//
// 原型：deepseek_html_20260923_83b40b（AI 管理：logo + 状态卡 + 管理项）。
// 落地口径（只画真数，三个原型件不做）：
//   - 状态卡三格 = 本人真实照片数 / 视频数 / 动态数（调用方从 profilePosts +
//     profileMedia 算好传进来，跟 AI 分身页同一份数据源）。
//   - 分身状态 = listMine 有没有 USER_TWIN（真查询，不是写死的"运行中"）。
//   - 管理项只有两条有真实去处的：出图管理 → AI 分身页，动态管理 → 个人主页。
//   - 原型的暂停按钮 / Token 用量 / 三个设置 sheet（对话风格-节奏-权限、
//     出图厂商-模型绑定、动态自动发布）没有任何后端，不做 —— 暂停 AI 是
//     服务端能力，本地开关会撒谎；模型直连违反"客户端不直绑 provider"
//     架构约束；自动发布没有服务端任务。缺的后端见 handoff。
//   - logo 用原型里的 SVG（圆点网络），状态点跟分身存在性走（有分身=绿），
//     不伪造"运行中"。

type AuthChannel = {
  request(path: string, init: { method: TransportRequest["method"]; body?: unknown }): Promise<TransportResponse>;
};

export function AILogo({ active }: { active: boolean }): React.JSX.Element {
  return (
    <View style={styles.logo} accessibilityLabel={active ? "AI 分身已激活" : "AI 分身未激活"}>
      <Svg width={20} height={20} viewBox="0 0 24 24">
        <Circle cx={12} cy={12} r={2} fill="#fff" />
        <Circle cx={6} cy={7} r={1.4} fill="#fff" />
        <Circle cx={18} cy={7} r={1.4} fill="#fff" />
        <Circle cx={6} cy={17} r={1.4} fill="#fff" />
        <Circle cx={18} cy={17} r={1.4} fill="#fff" />
        <Line x1={12} y1={12} x2={6} y2={7} stroke="#fff" strokeWidth={1.1} strokeLinecap="round" />
        <Line x1={12} y1={12} x2={18} y2={7} stroke="#fff" strokeWidth={1.1} strokeLinecap="round" />
        <Line x1={12} y1={12} x2={6} y2={17} stroke="#fff" strokeWidth={1.1} strokeLinecap="round" />
        <Line x1={12} y1={12} x2={18} y2={17} stroke="#fff" strokeWidth={1.1} strokeLinecap="round" />
      </Svg>
      <View style={[styles.logoDot, active ? styles.logoDotOn : styles.logoDotOff]} />
    </View>
  );
}

export function AIManagementSurface({
  onBack,
  viewerAccountId,
  authClient,
  imageCount,
  videoCount,
  postCount,
  onOpenImageManage,
  onOpenPostManage,
}: {
  onBack: () => void;
  viewerAccountId: string | undefined;
  authClient: AuthChannel;
  imageCount: number;
  videoCount: number;
  postCount: number;
  onOpenImageManage: () => void;
  onOpenPostManage: () => void;
}): React.JSX.Element {
  const personaClient = useMemo(() => new AiPersonaClient({ authClient }), [authClient]);
  const [twinExists, setTwinExists] = useState<boolean | undefined>(undefined);
  const [twinError, setTwinError] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (!viewerAccountId) {
      setTwinExists(undefined);
      setTwinError(undefined);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const personas = await personaClient.listMine(viewerAccountId);
        if (!cancelled) {
          setTwinExists(personas.length > 0);
          setTwinError(undefined);
        }
      } catch (err) {
        if (!cancelled) {
          setTwinExists(undefined);
          setTwinError(err instanceof Error ? err.message : "分身状态没读出来");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [personaClient, viewerAccountId]);

  const statusTitle = twinExists === undefined ? "分身状态未知" : twinExists ? "分身已激活" : "分身未激活";
  const statusSub =
    twinError ?? (twinExists === undefined ? "登录后查看分身状态" : twinExists ? "AI 正在用你的授权形象出内容" : "进 AI 分身页自动激活副空间");

  return (
    <View style={styles.root}>
      <View style={styles.nav}>
        <Pressable accessibilityLabel="返回" onPress={onBack} hitSlop={12}>
          <Text style={styles.back}>‹</Text>
        </Pressable>
        <AILogo active={twinExists === true} />
        <Text style={styles.title}>AI 管理</Text>
      </View>
      <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent}>
        <View style={styles.statusCard}>
          <View style={styles.statusHead}>
            <View style={[styles.statusDot, twinExists === true && styles.statusDotOn]} />
            <Text style={styles.statusLabel}>{statusTitle}</Text>
          </View>
          <Text style={styles.statusSub}>{statusSub}</Text>
          <View style={styles.nums}>
            <View style={styles.num}>
              <Text style={styles.numVal}>{imageCount}</Text>
              <Text style={styles.numLabel}>照片</Text>
            </View>
            <View style={styles.num}>
              <Text style={styles.numVal}>{videoCount}</Text>
              <Text style={styles.numLabel}>视频</Text>
            </View>
            <View style={styles.num}>
              <Text style={styles.numVal}>{postCount}</Text>
              <Text style={styles.numLabel}>动态</Text>
            </View>
          </View>
        </View>
        <Text style={styles.sectionTitle}>管理项</Text>
        <Pressable accessibilityLabel="出图管理" onPress={onOpenImageManage} style={styles.card}>
          <View style={[styles.cardIcon, styles.cardIconPurple]}>
            <ProxyIcon name="camera" color="#6d28d9" size={22} />
          </View>
          <View style={styles.cardText}>
            <Text style={styles.cardName}>出图管理</Text>
            <Text style={styles.cardSub}>{`${imageCount} 张照片 · 去 AI 分身页管理`}</Text>
          </View>
          <Text style={styles.cardArrow}>›</Text>
        </Pressable>
        <Pressable accessibilityLabel="动态管理" onPress={onOpenPostManage} style={styles.card}>
          <View style={[styles.cardIcon, styles.cardIconGreen]}>
            <ProxyIcon name="editProfile" color="#2f7a44" size={22} />
          </View>
          <View style={styles.cardText}>
            <Text style={styles.cardName}>动态管理</Text>
            <Text style={styles.cardSub}>{`${postCount} 条动态 · 去个人主页管理`}</Text>
          </View>
          <Text style={styles.cardArrow}>›</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#fafafa" },
  nav: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 20, paddingTop: 16, paddingBottom: 8 },
  back: { fontSize: 24, color: "#1a1a1a", width: 24 },
  logo: {
    width: 34,
    height: 34,
    borderRadius: 11,
    backgroundColor: "#1a1a1a",
    alignItems: "center",
    justifyContent: "center",
  },
  logoDot: {
    position: "absolute",
    top: -3,
    right: -3,
    width: 10,
    height: 10,
    borderRadius: 5,
    borderWidth: 2,
    borderColor: "#fafafa",
  },
  logoDotOn: { backgroundColor: "#4caf7d" },
  logoDotOff: { backgroundColor: "#ccc" },
  title: { flex: 1, fontSize: 18, fontWeight: "800", color: "#1a1a1a" },
  body: { flex: 1 },
  bodyContent: { paddingHorizontal: 20, paddingBottom: 30 },
  statusCard: { backgroundColor: "#1a1a1a", borderRadius: 20, padding: 18, marginBottom: 24 },
  statusHead: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 6 },
  statusDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: "#666" },
  statusDotOn: { backgroundColor: "#4caf7d" },
  statusLabel: { fontSize: 12, fontWeight: "700", color: "rgba(255,255,255,0.85)" },
  statusSub: { fontSize: 12, color: "rgba(255,255,255,0.6)", marginBottom: 14 },
  nums: { flexDirection: "row", gap: 16 },
  num: { flex: 1 },
  numVal: { fontSize: 22, fontWeight: "800", color: "#fff", marginBottom: 6 },
  numLabel: { fontSize: 11, color: "rgba(255,255,255,0.55)", fontWeight: "600" },
  sectionTitle: { fontSize: 13, fontWeight: "800", color: "#1a1a1a", marginBottom: 10, paddingLeft: 2 },
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    backgroundColor: "#fff",
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: "#f0f0f0",
    padding: 14,
    marginBottom: 8,
  },
  cardIcon: { width: 42, height: 42, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  cardIconPurple: { backgroundColor: "#f0e8ff" },
  cardIconGreen: { backgroundColor: "#e8f7ee" },
  cardText: { flex: 1 },
  cardName: { fontSize: 15, fontWeight: "700", color: "#1a1a1a", marginBottom: 2 },
  cardSub: { fontSize: 12, color: "#888" },
  cardArrow: { fontSize: 18, color: "#bbb" },
});

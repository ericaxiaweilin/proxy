import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, Text, TextInput, View } from "react-native";
import { color } from "../theme";
import { styles } from "./me-styles";
import { nativeSecureSessionStore, sessionAuthClient } from "../native-clients";
import {
  StoreOnboardingClient,
  StoreRecommendationRejectedError,
  type StoreRecommendation,
  type StoreRecommendationDecision,
  type StoreRecommendationOrigin,
  type StoreRecommendationQueueStatus
} from "../storeonboarding-client";

// STORE-REC-002/004: 运营评估队列（App 内）。
//
// 为什么必须存在：STORE-REC-001 只做了受理，记录写进 business.store_recommendations
// 之后没有任何读路径，运营在 App 里评估这件事做不到，「推荐商铺进体系」变成
// 只进不出的黑洞。这一屏就是那条读路径的调用方。
//
// STORE-REC-004 补上了另一半：光能看不能判，运营读完一条推荐，结论只存在他脑子里
// —— 队列就成了一条只读的死胡同。现在每条都能记「采纳 / 不采纳」。
//
// 最重要的一条纪律：**「没有权限」和「没有数据」必须长不一样**。
// 两者都表现为列表为空，混在一起会让运营以为「没人推荐这家店」，
// 而真实情况是他根本看不到。所以被拒时明确显示权限原因，不显示空列表。

// 「没有权限」和「没有数据」必须长不一样；同理，「推荐不存在」也不能
// 长成一句笼统的「记录失败」—— 那只会让运营反复点同一个按钮。
const FORBIDDEN_CODE = "OPERATOR_PRIVILEGE_REQUIRED";
const NOT_FOUND_CODE = "DISPOSITION_RECOMMENDATION_NOT_FOUND";

type OriginFilter = "ALL" | StoreRecommendationOrigin;

const ORIGIN_FILTERS: Array<{ id: OriginFilter; label: string }> = [
  { id: "ALL", label: "全部" },
  { id: "USER", label: "用户推荐" },
  { id: "AI", label: "小美推荐" }
];

// STORE-REC-005: 队列的四种看法。
//
// 之前这里是个「只看待评估」的开关（布尔），只能表达两种状态。那够用是因为
// 当时的队列只有这两种看法；但采纳是个死胡同 —— 一点采纳，这条推荐就只存在于
// 「全部」那一堆里，运营看不到自己批过什么，更没法跟进商家实际入驻。
// 布尔值表达不了四态，所以换成 status。
//
// 「已采纳 · 待接入」这个名字是刻意的：采纳 = 运营批准接入，**不等于店铺已经
// 存在**。商家真正入驻是另一件事，这里不伪造那个结果。
type StatusFilter = "ALL" | StoreRecommendationQueueStatus;

const STATUS_FILTERS: Array<{ id: StatusFilter; label: string; empty: string }> = [
  { id: "PENDING", label: "待评估", empty: "待评估的都处理完了。" },
  { id: "ACCEPTED", label: "已采纳 · 待接入", empty: "还没有采纳过任何推荐。" },
  { id: "REJECTED", label: "不采纳", empty: "还没有不采纳的记录。" },
  { id: "ALL", label: "全部", empty: "当前筛选条件下还没有推荐记录。" }
];

function when(iso: string): string {
  // 服务端给的是 RFC3339（UTC）。本地展示取到分钟即可，
  // 不做「几小时前」这类会随时间漂移、且无法核对的模糊表达。
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function StoreRecommendationQueue(): React.JSX.Element {
  const [city, setCity] = useState("");
  const [origin, setOrigin] = useState<OriginFilter>("ALL");
  // 默认看「待评估」：评估完一条它还杵在默认列表里，队列会越用越长。
  // 但另外三种看法必须存在 —— 采纳完就查不到，等于把这条推荐扔进黑洞。
  const [status, setStatus] = useState<StatusFilter>("PENDING");
  const [rows, setRows] = useState<StoreRecommendation[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [actingId, setActingId] = useState<string | undefined>(undefined);
  const [rejectFor, setRejectFor] = useState<string | undefined>(undefined);
  const [rejectReason, setRejectReason] = useState("");

  const load = useCallback(async () => {
    setBusy(true);
    setError(undefined);
    setForbidden(false);
    try {
      const client = new StoreOnboardingClient({
        authClient: sessionAuthClient,
        secureSessionStore: nativeSecureSessionStore
      });
      // 仓库开了 exactOptionalPropertyTypes：可选字段不能显式传 undefined，
      // 只能不写这个键。
      const query: {
        city: string;
        limit: number;
        origin?: StoreRecommendationOrigin;
        status?: StoreRecommendationQueueStatus;
      } = { city, limit: 50 };
      if (origin !== "ALL") query.origin = origin;
      if (status !== "ALL") query.status = status;
      const next = await client.listRecommendations(query);
      setRows(next);
    } catch (err) {
      const code =
        err instanceof StoreRecommendationRejectedError ? err.result.error?.errorCode : undefined;
      if (code === FORBIDDEN_CODE) {
        // 不是「还没有人推荐」，是「这个账号看不到」。必须说清楚。
        setForbidden(true);
      } else {
        setError(err instanceof Error ? err.message : "推荐队列读取失败");
      }
      setRows(null);
    } finally {
      setBusy(false);
    }
  }, [city, origin, status]);

  useEffect(() => {
    void load();
  }, [load]);

  async function decide(id: string, decision: StoreRecommendationDecision, reason?: string): Promise<void> {
    setActingId(id);
    setError(undefined);
    try {
      const client = new StoreOnboardingClient({
        authClient: sessionAuthClient,
        secureSessionStore: nativeSecureSessionStore
      });
      const input: { recommendationId: string; decision: StoreRecommendationDecision; reason?: string } = {
        recommendationId: id,
        decision
      };
      // 不采纳必须给理由：服务端会拒，但这里也别发一次注定失败的请求。
      if (decision === "REJECT") {
        if (!rejectReason.trim()) {
          setError("不采纳必须写理由 —— 否则以后没人知道当时为什么否掉这家店。");
          return;
        }
        input.reason = rejectReason.trim();
      }
      await client.decideRecommendation(input);
      setRejectFor(undefined);
      setRejectReason("");
      await load();
    } catch (err) {
      const code =
        err instanceof StoreRecommendationRejectedError ? err.result.error?.errorCode : undefined;
      // STORE-REC-006: 推荐已经不存在了。不说清楚的话运营只会看到一句「记录失败」，
      // 于是反复点 —— 而队列里那条还杵在那儿，看起来就像系统坏了。
      if (code === NOT_FOUND_CODE) {
        setError("这条推荐已经不存在了（可能已被清理）。刷新一下队列。");
      } else {
        setError(err instanceof Error ? err.message : "结论记录失败");
      }
    } finally {
      setActingId(undefined);
    }
  }

  return (
    <View>
      <Text style={styles.appBehaviorCardDesc}>
        用户与小美（AI）推荐进体系的商铺都会留在这里，按城市 / 来源筛选后逐条评估。
        推荐记录 append-only，只增不改 —— 评估结论记在另一张表里，也不改原记录。
      </Text>

      <Text style={styles.socialEditorLabel}>城市（可选）</Text>
      <TextInput
        placeholder="不填 = 全部城市"
        style={styles.socialEditorInput}
        value={city}
        onChangeText={setCity}
      />

      <Text style={styles.socialEditorLabel}>来源</Text>
      <View style={{ flexDirection: "row", gap: 8, marginTop: 2 }}>
        {ORIGIN_FILTERS.map((option) => {
          const active = origin === option.id;
          return (
            <Pressable
              key={option.id}
              onPress={() => setOrigin(option.id)}
              style={{
                backgroundColor: active ? color.magenta : color.white,
                borderColor: active ? color.magenta : color.line,
                borderRadius: 999,
                borderWidth: 1,
                paddingHorizontal: 12,
                paddingVertical: 7
              }}
            >
              <Text style={{ color: active ? color.white : color.ink, fontSize: 11, fontWeight: "700" }}>
                {option.label}
              </Text>
            </Pressable>
          );
        })}
        <View style={{ flex: 1 }} />
        <Pressable
          disabled={busy}
          onPress={() => void load()}
          style={[styles.appBehaviorReturn, { marginTop: 0, paddingHorizontal: 16, paddingVertical: 7 }, busy && { opacity: 0.5 }]}
        >
          <Text style={styles.appBehaviorReturnText}>{busy ? "读取中…" : "刷新"}</Text>
        </Pressable>
      </View>

      <Text style={[styles.socialEditorLabel, { marginTop: 12 }]}>结论</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 2 }}>
        {STATUS_FILTERS.map((option) => {
          const active = status === option.id;
          return (
            <Pressable
              key={option.id}
              onPress={() => setStatus(option.id)}
              style={{
                backgroundColor: active ? "#1B7F4D" : color.white,
                borderColor: active ? "#1B7F4D" : color.line,
                borderRadius: 999,
                borderWidth: 1,
                paddingHorizontal: 12,
                paddingVertical: 7
              }}
            >
              <Text style={{ color: active ? color.white : color.ink, fontSize: 11, fontWeight: "700" }}>
                {option.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
      {/* 采纳不等于店铺已存在。这句话必须说，否则运营会以为批完就完事了，
          而实际上商家还没入驻 —— 队列看起来「办结了」，事情却没发生。 */}
      {status === "ACCEPTED" ? (
        <Text style={[styles.appBehaviorCardDesc, { marginTop: 6 }]}>
          已采纳只代表运营批准接入，商家实际入驻是另一件事 —— 这一列就是待跟进的名单。
        </Text>
      ) : null}

      {busy && rows === null ? (
        <View style={{ paddingVertical: 18, alignItems: "center" }}>
          <ActivityIndicator />
        </View>
      ) : null}

      {forbidden ? (
        <View style={styles.infoNote}>
          <Text style={styles.infoNoteText}>
            这个账号没有运营权限，看不到推荐队列。
          </Text>
          <Text style={[styles.appBehaviorCardDesc, { marginTop: 4 }]}>
            注意：这不是「还没有人推荐」。队列内容只对运营白名单内的账号开放
            （服务端 PROXY_OPERATOR_PRINCIPALS），因为推荐记录里有推荐人的账号与理由。
          </Text>
        </View>
      ) : null}

      {error ? <Text style={{ color: "#B3261E", fontSize: 12, marginTop: 8 }}>{error}</Text> : null}

      {!forbidden && !error && rows && rows.length === 0 ? (
        <View style={styles.infoNote}>
          <Text style={styles.infoNoteText}>
            {STATUS_FILTERS.find((option) => option.id === status)?.empty ?? "当前筛选条件下还没有推荐记录。"}
          </Text>
        </View>
      ) : null}

      {rows?.map((row) => (
        <View key={row.recommendationId} style={styles.prototypeCard}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <Text style={styles.prototypeCardTitle}>{row.storeName}</Text>
            <Text
              style={{
                backgroundColor: row.origin === "AI" ? "#EFE6FB" : "#EAF3EE",
                borderRadius: 999,
                color: row.origin === "AI" ? "#6B3FA0" : "#1B7F4D",
                // R3 排版守卫：正文最小 11pt，这里不能为了「小标签好看」降到 9。
                fontSize: 11,
                fontWeight: "800",
                overflow: "hidden",
                paddingHorizontal: 8,
                paddingVertical: 2
              }}
            >
              {row.origin === "AI" ? "小美" : "用户"}
            </Text>
          </View>
          <Text style={styles.prototypeCardDesc}>
            {row.city}
            {row.category ? ` · ${row.category}` : ""} · {when(row.createdAt)}
          </Text>
          <Text style={styles.prototypeCardDesc}>{row.reason}</Text>
          <Text style={[styles.prototypeCardDesc, { marginTop: 4 }]}>
            {/* origin=AI 表示内容由小美产出，recommendedBy 是发起对话的账号 —— 两个
                身份都要留着：前者说明谁写的，后者保证举证链能回访。 */}
            {row.origin === "AI"
              ? `小美整理 · 发起账号 ${row.recommendedByAccountId}`
              : `推荐人 ${row.recommendedByAccountId}`}
          </Text>

          {row.decision ? (
            // 已经出过结论：把结论连同人与时间显示出来，不留「默默被处理掉了」的观感。
            <View style={{ marginTop: 8 }}>
              <Text style={[styles.prototypeCardDesc, { color: row.decision === "ACCEPT" ? "#1B7F4D" : "#8C5A2B", fontWeight: "800" }]}>
                {row.decision === "ACCEPT" ? "已采纳" : "已不采纳"}
                {row.decisionReason ? ` · ${row.decisionReason}` : ""}
              </Text>
              <Text style={[styles.prototypeCardDesc, { marginTop: 4 }]}>
                {row.decidedBy}
                {row.decidedAt ? ` · ${when(row.decidedAt)}` : ""}
              </Text>
            </View>
          ) : (
            <View style={{ marginTop: 8 }}>
              {rejectFor === row.recommendationId ? (
                <View>
                  <Text style={styles.socialEditorLabel}>为什么不采纳（必填）</Text>
                  <TextInput
                    placeholder="例如：同品类已接入三家"
                    style={[styles.socialEditorInput, { minHeight: 60 }]}
                    multiline
                    value={rejectReason}
                    onChangeText={setRejectReason}
                  />
                  <View style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>
                    <Pressable
                      disabled={actingId === row.recommendationId}
                      onPress={() => void decide(row.recommendationId, "REJECT")}
                      style={{ backgroundColor: color.ink, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 8, opacity: actingId === row.recommendationId ? 0.5 : 1 }}
                    >
                      <Text style={{ color: color.white, fontSize: 11, fontWeight: "900" }}>确认不采纳</Text>
                    </Pressable>
                    <Pressable
                      onPress={() => { setRejectFor(undefined); setRejectReason(""); }}
                      style={{ backgroundColor: color.white, borderColor: color.line, borderRadius: 10, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 8 }}
                    >
                      <Text style={{ color: color.ink, fontSize: 11, fontWeight: "900" }}>取消</Text>
                    </Pressable>
                  </View>
                </View>
              ) : (
                <View style={{ flexDirection: "row", gap: 8 }}>
                  <Pressable
                    disabled={actingId === row.recommendationId}
                    onPress={() => void decide(row.recommendationId, "ACCEPT")}
                    style={{ backgroundColor: color.ink, borderRadius: 10, paddingHorizontal: 16, paddingVertical: 8, opacity: actingId === row.recommendationId ? 0.5 : 1 }}
                  >
                    <Text style={{ color: color.white, fontSize: 11, fontWeight: "900" }}>采纳</Text>
                  </Pressable>
                  <Pressable
                    disabled={actingId === row.recommendationId}
                    onPress={() => setRejectFor(row.recommendationId)}
                    style={{ backgroundColor: color.white, borderColor: color.line, borderRadius: 10, borderWidth: 1, paddingHorizontal: 16, paddingVertical: 8, opacity: actingId === row.recommendationId ? 0.5 : 1 }}
                  >
                    <Text style={{ color: color.ink, fontSize: 11, fontWeight: "900" }}>不采纳</Text>
                  </Pressable>
                </View>
              )}
            </View>
          )}
        </View>
      ))}
    </View>
  );
}

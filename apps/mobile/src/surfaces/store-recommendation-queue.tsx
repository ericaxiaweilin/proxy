import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, Text, TextInput, View } from "react-native";
import { color } from "../theme";
import { styles } from "./me-styles";
import { nativeSecureSessionStore, sessionAuthClient } from "../native-clients";
import {
  StoreOnboardingClient,
  StoreRecommendationRejectedError,
  type StoreRecommendation,
  type StoreRecommendationOrigin
} from "../storeonboarding-client";

// STORE-REC-002: 运营评估队列（App 内）。
//
// 为什么必须存在：STORE-REC-001 只做了受理，记录写进 business.store_recommendations
// 之后没有任何读路径，运营在 App 里评估这件事做不到，「推荐商铺进体系」变成
// 只进不出的黑洞。这一屏就是那条读路径的调用方。
//
// 最重要的一条纪律：**「没有权限」和「没有数据」必须长不一样**。
// 两者都表现为列表为空，混在一起会让运营以为「没人推荐这家店」，
// 而真实情况是他根本看不到。所以被拒时明确显示权限原因，不显示空列表。

const FORBIDDEN_CODE = "OPERATOR_PRIVILEGE_REQUIRED";

type OriginFilter = "ALL" | StoreRecommendationOrigin;

const ORIGIN_FILTERS: Array<{ id: OriginFilter; label: string }> = [
  { id: "ALL", label: "全部" },
  { id: "USER", label: "用户推荐" },
  { id: "AI", label: "小美推荐" }
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
  const [rows, setRows] = useState<StoreRecommendation[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

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
      const query: { city: string; limit: number; origin?: StoreRecommendationOrigin } = {
        city,
        limit: 50
      };
      if (origin !== "ALL") query.origin = origin;
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
  }, [city, origin]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <View>
      <Text style={styles.appBehaviorCardDesc}>
        用户与小美（AI）推荐进体系的商铺都会留在这里，按城市 / 来源筛选后逐条评估。
        记录 append-only，只增不改 —— 评估结论在别处推进，这里不伪造结果。
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
          <Text style={styles.infoNoteText}>当前筛选条件下还没有推荐记录。</Text>
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
            推荐人 {row.recommendedByAccountId}
          </Text>
        </View>
      ))}
    </View>
  );
}

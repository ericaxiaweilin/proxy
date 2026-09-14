import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { color } from "../theme";
import { styles } from "./me-styles";
import { nativeSecureSessionStore, sessionAuthClient } from "../native-clients";
import { StoreOnboardingClient, type StoreRecommendation } from "../storeonboarding-client";

// STORE-REC-007: 「我推荐的店」—— 推荐人看见自己那条的进展。
//
// 为什么必须存在：运营队列是 operator-only，普通用户看不到。于是推荐人提交完
// 就再无回音，永远不知道自己推荐的那家店被采纳了没有。
//
// 而**能完成入驻的人通常就是他**：采纳只代表运营批准接入，**不等于店铺已存在**。
// 他看不到「该去建店了」，那条「已采纳 · 待接入」的记录就永远等不到人 ——
// 队列看起来办结了，事情却没发生。这一屏就是把这句话送到该看到的人眼前。
//
// 纪律沿用队列那一套：**「读不出来」和「确实没有」必须长不一样**。
// 两者列表都为空，混在一起会让人以为「我没推荐过」。

function when(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function MyStoreRecommendations(): React.JSX.Element {
  const [rows, setRows] = useState<StoreRecommendation[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  const load = useCallback(async () => {
    setBusy(true);
    setError(undefined);
    try {
      const client = new StoreOnboardingClient({
        authClient: sessionAuthClient,
        secureSessionStore: nativeSecureSessionStore
      });
      setRows(await client.listMyRecommendations({ limit: 50 }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "读取失败");
      setRows(null);
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <View>
      <Text style={styles.appBehaviorCardDesc}>
        你推荐进体系的店都在这里。采纳只代表运营批准接入，商家真正入驻是另一件事 ——
        看到「已采纳」就该去建店了，否则这条推荐只是被批准了，店铺并不会自己出现。
      </Text>

      {busy && rows === null ? (
        <View style={{ paddingVertical: 18, alignItems: "center" }}>
          <ActivityIndicator />
        </View>
      ) : null}

      {error ? <Text style={{ color: "#B3261E", fontSize: 12, marginTop: 8 }}>{error}</Text> : null}

      {!error && rows && rows.length === 0 ? (
        <View style={styles.infoNote}>
          <Text style={styles.infoNoteText}>你还没有推荐过店铺。</Text>
        </View>
      ) : null}

      {rows?.map((row) => (
        <View key={row.recommendationId} style={styles.prototypeCard}>
          <Text style={styles.prototypeCardTitle}>{row.storeName}</Text>
          <Text style={styles.prototypeCardDesc}>
            {row.city}
            {row.category ? ` · ${row.category}` : ""} · 推荐于 {when(row.createdAt)}
          </Text>

          {row.decision === "ACCEPT" ? (
            <View style={{ marginTop: 8 }}>
              <Text style={[styles.prototypeCardDesc, { color: "#1B7F4D", fontWeight: "800" }]}>
                已采纳 · 等你建店
              </Text>
              <Text style={[styles.prototypeCardDesc, { marginTop: 4 }]}>
                运营已经批准这家店进体系了。批准不等于店铺已存在 ——
                需要你在「我的店铺」里把店铺建出来，它才算真的接入。
              </Text>
            </View>
          ) : null}

          {row.decision === "REJECT" ? (
            <View style={{ marginTop: 8 }}>
              <Text style={[styles.prototypeCardDesc, { color: "#8C5A2B", fontWeight: "800" }]}>
                这次没有采纳
              </Text>
              {/* 理由是运营必填的。不给理由的拒绝无法解释，所以这里照实显示。 */}
              {row.decisionReason ? (
                <Text style={[styles.prototypeCardDesc, { marginTop: 4 }]}>
                  原因：{row.decisionReason}
                </Text>
              ) : null}
            </View>
          ) : null}

          {!row.decision ? (
            <Text style={[styles.prototypeCardDesc, { marginTop: 8 }]}>运营还在评估中。</Text>
          ) : null}
        </View>
      ))}

      <Pressable
        disabled={busy}
        onPress={() => void load()}
        style={[styles.appBehaviorReturn, { marginTop: 12 }, busy && { opacity: 0.5 }]}
      >
        <Text style={styles.appBehaviorReturnText}>{busy ? "读取中…" : "刷新"}</Text>
      </Pressable>
    </View>
  );
}

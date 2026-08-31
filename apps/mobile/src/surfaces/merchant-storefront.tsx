// MERCHANT_STOREFRONT — 商家店铺去占位化
// 接线：BusinessClient 真实读模型（ListMyBusinessAccounts / ListBusinessStores）
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { color, shadows } from "../theme";
import type { BusinessClient } from "../business-client";

export function MerchantStorefrontSurface({ client }: { client: BusinessClient }): React.JSX.Element {
  const [accounts, setAccounts] = useState<Array<{ id: string; name: string; status: string }> | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  useEffect(() => {
    let c = false;
    (async () => {
      try { const a = await client.listMyAccounts(); if (!c) setAccounts(a); } catch (e) { if (!c) setError(e instanceof Error ? e.message : String(e)); }
    })();
    return () => { c = true; };
  }, [client]);
  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.container}>
      <Text style={styles.title}>商家店铺</Text>
      <Text style={styles.sub}>来自 Business Workspace 真实数据，非占位。</Text>
      {accounts === undefined && !error ? <ActivityIndicator /> : null}
      {error ? <View style={styles.card}><Text style={styles.empty}>加载失败：{error}</Text></View> : null}
      {accounts !== undefined && accounts.length === 0 ? <View style={styles.card}><Text style={styles.empty}>暂无商家账号 — 在“商家”Tab 创建</Text></View> : null}
      {accounts?.map((a) => (
        <View key={a.id} style={styles.card}>
          <Text style={styles.name}>{a.name}</Text>
          <Text style={styles.meta}>{a.id.slice(0,8)} · {a.status}</Text>
        </View>
      ))}
    </ScrollView>
  );
}
const styles = StyleSheet.create({
  root: { backgroundColor: color.offWhite, flex: 1 },
  container: { gap: 10, padding: 16, paddingBottom: 24 },
  title: { color: color.ink, fontSize: 18, fontWeight: "900" },
  sub: { color: color.muted, fontSize: 12 },
  card: { backgroundColor: color.white, borderColor: color.line, borderRadius: 14, borderWidth: 1, padding: 14, ...shadows.card },
  name: { color: color.ink, fontSize: 14, fontWeight: "800" },
  meta: { color: color.muted, fontSize: 12, marginTop: 4 },
  empty: { color: color.muted, fontSize: 12 },
});

// BenefitRedeemScreen — merchant/staff scan and confirm benefit redemption.
// R0: Simple scan → verify → confirm flow.
import { useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { color } from "../theme";
import type { Redemption } from "../benefit-client";
import { BenefitClient } from "../benefit-client";
import { ProxyLoading } from "../components/proxy-foundation";

type Screen = "SCAN" | "CONFIRM" | "SUCCESS" | "ERROR";

export function BenefitRedeemScreen({
  client,
  merchantId,
  staffId,
  onBack,
}: {
  client: BenefitClient;
  merchantId: string;
  staffId?: string;
  onBack: () => void;
}): React.JSX.Element {
  const [screen, setScreen] = useState<Screen>("SCAN");
  const [claimToken, setClaimToken] = useState("");
  const [redemption, setRedemption] = useState<Redemption | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function handleRedeem() {
    if (!claimToken.trim()) {
      setError("请输入验证码");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const result = await client.redeemBenefit({
        claimToken: claimToken.trim(),
        merchantId,
        ...(staffId ? { staffId } : {}),
        evidenceType: "MERCHANT_SCAN",
        idempotencyKey: `redeem_${claimToken}_${Date.now()}`,
      });
      setRedemption(result);
      setScreen("SUCCESS");
    } catch (e) {
      setError(e instanceof Error ? e.message : "核销失败");
      setScreen("ERROR");
    } finally {
      setBusy(false);
    }
  }

  if (screen === "SUCCESS" && redemption) {
    return (
      <View style={styles.container}>
        <View style={styles.successBox}>
          <Text style={styles.successIcon}>✓</Text>
          <Text style={styles.successTitle}>核销成功</Text>
          <View style={styles.receiptBox}>
            <ReceiptRow label="核销 ID" value={redemption.redemptionId} />
            <ReceiptRow label="应收金额" value={`${redemption.userPayMinor}₫`} bold />
            <ReceiptRow label="Proxy 补贴" value={`${redemption.proxySubsidyMinor}₫`} />
            <ReceiptRow label="商家让利" value={`${redemption.merchantContributionMinor}₫`} />
            <ReceiptRow label="时间" value={new Date(redemption.redeemedAt).toLocaleString("zh-CN")} />
          </View>
          <Pressable onPress={onBack} style={styles.backButton}>
            <Text style={styles.backButtonText}>完成</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Pressable onPress={onBack} style={styles.backArrow}>
          <Text style={styles.backArrowText}>‹</Text>
        </Pressable>
        <Text style={styles.title}>扫描核销</Text>
      </View>

      <View style={styles.scanBox}>
        <Text style={styles.scanHint}>请输入用户出示的验证码</Text>
        <TextInput
          style={styles.input}
          value={claimToken}
          onChangeText={setClaimToken}
          placeholder="输入 6 位验证码"
          placeholderTextColor="#9CA3AF"
          autoCapitalize="characters"
          maxLength={12}
        />
      </View>

      {busy ? <ProxyLoading tone="brand" style={styles.spinner} /> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}

      <Pressable
        onPress={handleRedeem}
        disabled={busy || !claimToken.trim()}
        style={[styles.redeemButton, (!claimToken.trim() || busy) && styles.redeemButtonDisabled]}
      >
        <Text style={styles.redeemButtonText}>{busy ? "核销中..." : "确认核销"}</Text>
      </Pressable>
    </View>
  );
}

function ReceiptRow({ label, value, bold }: { label: string; value: string; bold?: boolean }): React.JSX.Element {
  return (
    <View style={styles.receiptRow}>
      <Text style={styles.receiptLabel}>{label}</Text>
      <Text style={[styles.receiptValue, bold && styles.receiptValueBold]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, backgroundColor: "#FAFAFA" },
  header: { flexDirection: "row", alignItems: "center", marginBottom: 24 },
  backArrow: { marginRight: 8, padding: 4 },
  backArrowText: { fontSize: 28, color: color.ink },
  title: { fontSize: 20, fontWeight: "600", color: color.ink },
  scanBox: { backgroundColor: "#FFF", borderRadius: 12, padding: 20, marginBottom: 16 },
  scanHint: { fontSize: 14, color: "#6B7280", marginBottom: 12 },
  input: {
    borderWidth: 1,
    borderColor: "#E5E7EB",
    borderRadius: 8,
    padding: 14,
    fontSize: 18,
    fontWeight: "600",
    color: color.ink,
    textAlign: "center",
    letterSpacing: 2,
  },
  spinner: { marginVertical: 16 },
  error: { color: "#DC2626", textAlign: "center", marginVertical: 8 },
  redeemButton: {
    backgroundColor: color.magenta,
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: "center",
  },
  redeemButtonDisabled: { opacity: 0.5 },
  redeemButtonText: { color: "#FFF", fontSize: 16, fontWeight: "600" },
  successBox: { flex: 1, justifyContent: "center", alignItems: "center" },
  successIcon: { fontSize: 48, color: "#059669", marginBottom: 16 },
  successTitle: { fontSize: 22, fontWeight: "700", color: color.ink, marginBottom: 24 },
  receiptBox: {
    backgroundColor: "#FFF",
    borderRadius: 12,
    padding: 16,
    width: "100%",
    marginBottom: 24,
  },
  receiptRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: "#F3F4F6" },
  receiptLabel: { fontSize: 14, color: "#6B7280" },
  receiptValue: { fontSize: 14, color: color.ink },
  receiptValueBold: { fontWeight: "700", fontSize: 16 },
  backButton: { backgroundColor: color.magenta, borderRadius: 8, paddingVertical: 12, paddingHorizontal: 32 },
  backButtonText: { color: "#FFF", fontSize: 16, fontWeight: "600" },
});

// BenefitClaimScreen — shows available benefits and handles claiming.
// R0: Simple claim flow — view benefit → claim → show QR token for merchant scan.
import { useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { color } from "../theme";
import type { Campaign, BenefitDefinition, Claim } from "../benefit-client";
import { BenefitClient } from "../benefit-client";
import { ProxyLoading, ProxyEmptyState } from "../components/proxy-foundation";

type Screen = "LIST" | "DETAIL" | "CLAIMED" | "ERROR";

const CAMPAIGN_LABELS: Record<string, { label: string; color: string }> = {
  SCENE_IGNITION: { label: "场景点火", color: "#E85D3A" },
  CREATOR_SEED: { label: "创作者种子", color: "color.proxyPurple" },
  NEW_TO_SCENE: { label: "新客到店", color: "#059669" },
  REACTIVATION: { label: "召回沉默", color: "#D97706" },
  NEWCOMER: { label: "新城市", color: "#2563EB" },
  ACTIVITY_ATTACH: { label: "活动挂载", color: "#DB2777" },
  ORDER_COMPLETION: { label: "订单完成", color: "#4F46E5" },
  CREATOR_GIFT: { label: "创作者礼物", color: "#EC4899" },
  MERCHANT_CAMPAIGN: { label: "商家活动", color: "#0891B2" },
};

const BENEFIT_ICONS: Record<string, string> = {
  FREE_DRINK: "☕",
  FREE_MEAL: "🍽️",
  DISCOUNT_PERCENT: "%",
  DISCOUNT_FIXED: "₫",
  GIFT: "🎁",
  UPGRADE: "⬆️",
  VOUCHER: "🎫",
  ACTIVITY_CREDIT: "🎟️",
};

function formatMoney(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

function BenefitCard({
  campaign,
  benefit,
  onPress,
}: {
  campaign: Campaign;
  benefit: BenefitDefinition;
  onPress: () => void;
}): React.JSX.Element {
  const campaignStyle = CAMPAIGN_LABELS[campaign.type] ?? { label: campaign.type, color: "#6B7280" };
  return (
    <Pressable onPress={onPress} style={[styles.card, { borderLeftColor: campaignStyle.color }]}>
      <View style={styles.cardHeader}>
        <Text style={[styles.campaignTag, { color: campaignStyle.color }]}>{campaignStyle.label}</Text>
        <Text style={styles.benefitIcon}>{BENEFIT_ICONS[benefit.kind] ?? "•"}</Text>
      </View>
      <Text style={styles.benefitLabel}>{benefit.label}</Text>
      {benefit.description ? <Text style={styles.benefitDesc}>{benefit.description}</Text> : null}
      <View style={styles.cardFooter}>
        <Text style={styles.value}>
          {benefit.userPayMinor === 0 ? "免费" : `${formatMoney(benefit.userPayMinor)}₫`}
        </Text>
        <Text style={styles.retailValue}>原价 {formatMoney(benefit.retailValueMinor)}₫</Text>
      </View>
    </Pressable>
  );
}

export function BenefitClaimScreen({
  client,
  campaignId,
  onBack,
  onClaimed,
}: {
  client: BenefitClient;
  campaignId: string;
  onBack: () => void;
  onClaimed: (claim: Claim, claimToken: string) => void;
}): React.JSX.Element {
  const [screen, setScreen] = useState<Screen>("LIST");
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [benefits, setBenefits] = useState<BenefitDefinition[]>([]);
  // 我已领取的（listClaims 真实数据）：目录接口 R1 才有，目录为空时
  // 这里至少展示领取记录 + 重试入口，不留死屏。
  const [myClaims, setMyClaims] = useState<Claim[]>([]);
  const [selectedBenefit, setSelectedBenefit] = useState<BenefitDefinition | null>(null);
  const [claimToken, setClaimToken] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>("");

  useEffect(() => {
    loadCampaign();
  }, [campaignId]);

  async function loadCampaign() {
    setBusy(true);
    setError("");
    try {
      const camp = await client.getCampaign(campaignId);
      setCampaign(camp);
      // For R0, benefits are loaded from the campaign
      // In R1, this would be a separate listBenefitsByCampaign call
      setBenefits([]);
      // 目录没有，领取记录有：拉我在这场活动下的 claims，空也不吞错。
      try {
        const claims = await client.listClaims();
        setMyClaims(claims.filter((c) => c.campaignId === campaignId));
      } catch {
        setMyClaims([]);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load campaign");
    } finally {
      setBusy(false);
    }
  }

  async function handleClaim(benefit: BenefitDefinition) {
    setSelectedBenefit(benefit);
    setBusy(true);
    setError("");
    try {
      const result = await client.claimBenefit({
        campaignId,
        benefitId: benefit.benefitId,
      });
      setClaimToken(result.claimToken);
      setScreen("CLAIMED");
      onClaimed(
        {
          claimId: result.claimId,
          campaignId,
          benefitId: benefit.benefitId,
          userId: "",
          claimToken: result.claimToken,
          status: "CLAIMED",
          createdAt: new Date().toISOString(),
          version: 1,
        },
        result.claimToken
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to claim benefit");
      setScreen("ERROR");
    } finally {
      setBusy(false);
    }
  }

  if (screen === "CLAIMED") {
    return (
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.successBox}>
          <Text style={styles.successIcon}>✓</Text>
          <Text style={styles.successTitle}>领取成功</Text>
          <Text style={styles.successText}>
            请出示以下验证码给店员扫描
          </Text>
          <View style={styles.tokenBox}>
            <Text style={styles.tokenText}>{claimToken}</Text>
          </View>
          <Text style={styles.successHint}>
            验证码有效期为 5 分钟，请尽快使用
          </Text>
          <Pressable onPress={onBack} style={styles.backButton}>
            <Text style={styles.backButtonText}>返回</Text>
          </Pressable>
        </View>
      </ScrollView>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View style={styles.header}>
        <Pressable onPress={onBack} style={styles.backArrow}>
          <Text style={styles.backArrowText}>‹</Text>
        </Pressable>
        <Text style={styles.title}>可用权益</Text>
      </View>

      {busy ? <ProxyLoading tone="brand" style={styles.spinner} /> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}

      {campaign ? (
        <View style={styles.campaignInfo}>
          <Text style={styles.campaignGoal}>{campaign.goal}</Text>
          <Text style={styles.campaignBudget}>
            预算: {formatMoney(campaign.budgetMinor)}₫
          </Text>
        </View>
      ) : null}

      {benefits.map((benefit) => (
        <BenefitCard
          key={benefit.benefitId}
          campaign={campaign ?? ({} as Campaign)}
          benefit={benefit}
          onPress={() => handleClaim(benefit)}
        />
      ))}

      {!busy && benefits.length === 0 ? (
        <ProxyEmptyState title="暂无可用权益" sub="该活动暂无面向您的权益（权益目录 R1 接入）" cta={{ label: "重新加载", onPress: () => void loadCampaign() }} />
      ) : null}

      {myClaims.length > 0 ? (
        <View>
          <Text style={styles.sectionTitle}>我已领取 · {myClaims.length}</Text>
          {myClaims.map((claim) => (
            <Pressable
              key={claim.claimId}
              onPress={() => onClaimed(claim, claim.claimToken)}
              style={styles.claimRow}
            >
              <Text style={styles.claimRowTitle}>{claim.benefitId}</Text>
              <Text style={styles.claimRowMeta}>{claim.status} · {new Date(claim.createdAt).toLocaleString()} ›</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, backgroundColor: "#FAFAFA" },
  header: { flexDirection: "row", alignItems: "center", marginBottom: 16 },
  backArrow: { marginRight: 8, padding: 4 },
  backArrowText: { fontSize: 28, color: color.ink },
  title: { fontSize: 20, fontWeight: "600", color: color.ink },
  spinner: { marginVertical: 24 },
  error: { color: "#DC2626", textAlign: "center", marginVertical: 12 },
  campaignInfo: { marginBottom: 16, padding: 12, backgroundColor: "#F3F4F6", borderRadius: 8 },
  campaignGoal: { fontSize: 14, color: color.ink, fontWeight: "500" },
  campaignBudget: { fontSize: 12, color: "#6B7280", marginTop: 4 },
  card: {
    backgroundColor: "#FFF",
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderLeftWidth: 4,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  cardHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 },
  campaignTag: { fontSize: 11, fontWeight: "600", textTransform: "uppercase" },
  benefitIcon: { fontSize: 20 },
  benefitLabel: { fontSize: 16, fontWeight: "600", color: color.ink, marginBottom: 4 },
  benefitDesc: { fontSize: 13, color: "#6B7280", marginBottom: 8 },
  cardFooter: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  value: { fontSize: 18, fontWeight: "700", color: color.magenta },
  retailValue: { fontSize: 12, color: "#9CA3AF", textDecorationLine: "line-through" },
  successBox: { alignItems: "center", paddingVertical: 32 },
  successIcon: { fontSize: 48, color: "#059669", marginBottom: 16 },
  successTitle: { fontSize: 22, fontWeight: "700", color: color.ink, marginBottom: 8 },
  successText: { fontSize: 14, color: "#6B7280", textAlign: "center", marginBottom: 24 },
  tokenBox: {
    backgroundColor: "#F3F4F6",
    borderRadius: 12,
    paddingVertical: 16,
    paddingHorizontal: 32,
    marginBottom: 16,
  },
  tokenText: { fontSize: 28, fontWeight: "700", color: color.ink, letterSpacing: 4 },
  successHint: { fontSize: 12, color: "#9CA3AF", textAlign: "center", marginBottom: 24 },
  backButton: { backgroundColor: color.magenta, borderRadius: 8, paddingVertical: 12, paddingHorizontal: 32 },
  backButtonText: { color: "#FFF", fontSize: 16, fontWeight: "600" },
  empty: { alignItems: "center", paddingVertical: 48 },
  emptyTitle: { fontSize: 16, fontWeight: "600", color: color.ink, marginBottom: 8 },
  emptyText: { fontSize: 13, color: "#9CA3AF" },
  sectionTitle: { fontSize: 14, fontWeight: "700", color: color.ink, marginBottom: 8, marginTop: 8 },
  claimRow: { backgroundColor: "#FFF", borderRadius: 10, marginBottom: 8, padding: 12 },
  claimRowTitle: { fontSize: 13, fontWeight: "700", color: color.ink },
  claimRowMeta: { fontSize: 11, color: "#6B7280", marginTop: 4 },
});

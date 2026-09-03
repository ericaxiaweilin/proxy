// BenefitHomeCard — compact benefit card for the home screen.
// Shows a single contextual benefit offer with claim action.
import { Pressable, StyleSheet, Text, View } from "react-native";
import { color } from "../theme";
import type { Campaign, BenefitDefinition } from "../benefit-client";

const CAMPAIGN_COLORS: Record<string, string> = {
  SCENE_IGNITION: "#E85D3A",
  CREATOR_SEED: "#7C3AED",
  NEW_TO_SCENE: "#059669",
  REACTIVATION: "#D97706",
  NEWCOMER: "#2563EB",
  ACTIVITY_ATTACH: "#DB2777",
  ORDER_COMPLETION: "#4F46E5",
  CREATOR_GIFT: "#EC4899",
  MERCHANT_CAMPAIGN: "#0891B2",
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

export function BenefitHomeCard({
  campaign,
  benefit,
  onPress,
}: {
  campaign: Campaign;
  benefit: BenefitDefinition;
  onPress: () => void;
}): React.JSX.Element {
  const accentColor = CAMPAIGN_COLORS[campaign.type] ?? "#6B7280";
  return (
    <Pressable onPress={onPress} style={[styles.card, { borderColor: accentColor }]}>
      <View style={styles.row}>
        <Text style={styles.icon}>{BENEFIT_ICONS[benefit.kind] ?? "•"}</Text>
        <View style={styles.info}>
          <Text style={styles.label} numberOfLines={1}>{benefit.label}</Text>
          <Text style={styles.sub} numberOfLines={1}>
            {benefit.userPayMinor === 0 ? "免费" : `${formatMoney(benefit.userPayMinor)}₫`}
          </Text>
        </View>
        <View style={[styles.badge, { backgroundColor: accentColor }]}>
          <Text style={styles.badgeText}>领取</Text>
        </View>
      </View>
    </Pressable>
  );
}

export function BenefitHomeSection({
  campaigns,
  benefits,
  onOpenBenefit,
}: {
  campaigns: Campaign[];
  benefits: BenefitDefinition[];
  onOpenBenefit: (campaignId: string) => void;
}): React.JSX.Element | null {
  if (campaigns.length === 0) return null;
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>为你推荐</Text>
      {campaigns.slice(0, 3).map((camp) => {
        const benefit = benefits.find((b) => b.campaignId === camp.campaignId);
        if (!benefit) return null;
        return (
          <BenefitHomeCard
            key={camp.campaignId}
            campaign={camp}
            benefit={benefit}
            onPress={() => onOpenBenefit(camp.campaignId)}
          />
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { marginBottom: 16 },
  sectionTitle: { fontSize: 16, fontWeight: "600", color: color.ink, marginBottom: 12 },
  card: {
    backgroundColor: "#FFF",
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
    borderLeftWidth: 3,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 2,
    elevation: 1,
  },
  row: { flexDirection: "row", alignItems: "center" },
  icon: { fontSize: 24, marginRight: 12 },
  info: { flex: 1 },
  label: { fontSize: 14, fontWeight: "600", color: color.ink },
  sub: { fontSize: 12, color: "#6B7280", marginTop: 2 },
  badge: { borderRadius: 6, paddingVertical: 6, paddingHorizontal: 12 },
  badgeText: { color: "#FFF", fontSize: 12, fontWeight: "600" },
});

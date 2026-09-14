import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { styles } from "./me-styles";
import { sessionAuthClient } from "../native-clients";
import { BenefitClient, BenefitError, type Campaign } from "../benefit-client";
import { BenefitClaimScreen } from "./BenefitClaimScreen";

// BENEFIT-WIRE-001: 把已经写好但没人调用的权益链路接进 App。
//
// 扫描发现的问题：BenefitClaimScreen / BenefitRedeemScreen / benefit-home-card
// 三个组件都写好了，benefit-client 的方法也齐全，服务端命令也在契约里 ——
// 但**没有任何界面渲染它们**，client 的 listCampaigns / getClaim / checkEligibility
// 也一个都没人调。命令、客户端、UI 三者之间缺一段接线，用户永远看不到入口。
// 这是本项目第六次出现「通道建好了，没有调用方」。
//
// 这里补的是最上游那一段：先列出可领取的活动，用户点进去才进 BenefitClaimScreen
// —— 后者需要 campaignId，所以「列活动」这一步省不掉，不能直接跳进去。

const CAMPAIGN_LABEL: Record<string, string> = {
  SCENE_IGNITION: "场景冷启动",
  CREATOR_SEED: "创作者扶持",
  NEW_TO_SCENE: "新场景首单",
  REACTIVATION: "回归唤醒",
  NEWCOMER: "新人礼",
  ACTIVITY_ATTACH: "活动加挂",
  ORDER_COMPLETION: "完单返利"
};

function campaignTitle(campaign: Campaign): string {
  return CAMPAIGN_LABEL[campaign.type] ?? campaign.type;
}

export function BenefitHubSurface({ onBack }: { onBack: () => void }): React.JSX.Element {
  const [client] = useState(() => new BenefitClient({ authClient: sessionAuthClient }));
  const [campaigns, setCampaigns] = useState<Campaign[] | null>(null);
  const [openId, setOpenId] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  const load = useCallback(async () => {
    setBusy(true);
    setError(undefined);
    try {
      // 只拉 ACTIVE：DRAFT / ENDED 的活动对用户没有意义，
      // 列出来只会让人点进去发现领不了。
      setCampaigns(await client.listCampaigns({ status: "ACTIVE" }));
    } catch (err) {
      setCampaigns(null);
      setError(err instanceof BenefitError ? err.message : "权益活动读取失败");
    } finally {
      setBusy(false);
    }
  }, [client]);

  useEffect(() => {
    void load();
  }, [load]);

  // 选中活动后整屏交给 BenefitClaimScreen。onBack / onClaimed 都回到列表并重新
  // 拉一次 —— 领取后 myClaims 会变，不刷新的话用户看不到自己刚领的那条。
  if (openId) {
    return (
      <BenefitClaimScreen
        client={client}
        campaignId={openId}
        onBack={() => { setOpenId(undefined); void load(); }}
        onClaimed={() => { setOpenId(undefined); void load(); }}
      />
    );
  }

  return (
    <ScrollView>
      <Text style={styles.appBehaviorCardDesc}>
        平台与商家发放的权益活动列在这里。领取后生成一次性验证码，到店出示给商家
        核销 —— 不伪造「已到账」，状态一律以服务端为准。
      </Text>

      {busy && campaigns === null ? (
        <View style={{ paddingVertical: 18, alignItems: "center" }}>
          <ActivityIndicator />
        </View>
      ) : null}

      {error ? <Text style={{ color: "#B3261E", fontSize: 12, marginTop: 8 }}>{error}</Text> : null}

      {/* 「读不出来」和「确实没有活动」必须长不一样 —— 同为空列表，
          前者是故障，后者是事实。 */}
      {!error && campaigns && campaigns.length === 0 ? (
        <View style={styles.infoNote}>
          <Text style={styles.infoNoteText}>当前没有进行中的权益活动。</Text>
        </View>
      ) : null}

      {campaigns?.map((campaign) => (
        <Pressable
          key={campaign.campaignId}
          onPress={() => setOpenId(campaign.campaignId)}
          style={styles.prototypeCard}
        >
          <Text style={styles.prototypeCardTitle}>{campaignTitle(campaign)}</Text>
          <Text style={styles.prototypeCardDesc}>{campaign.goal}</Text>
          <Text style={[styles.prototypeCardDesc, { marginTop: 4 }]}>
            活动 {campaign.campaignId}
          </Text>
        </Pressable>
      ))}

      <Pressable onPress={onBack} style={[styles.lightCta, { marginTop: 12 }]}>
        <Text style={styles.lightCtaText}>返回我的</Text>
      </Pressable>
    </ScrollView>
  );
}

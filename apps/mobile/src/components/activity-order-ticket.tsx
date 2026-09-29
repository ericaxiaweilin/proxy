// ORDER-RECIPE-001（用户「我的订单没有存原始的 recipe 么 …… for you 的我看丢了很多
// 和原始 recipe 不一样」）：活动报名的票面（原型 deepseek_html_20260928_d7fef9
// 「我的票券」）以前只长在 For You 下单成功页里、从四宫格的实时状态拼出来，
// 「我的订单」没有同一张票可画。现在票面只从**下单快照**画（服务端在下单那一刻
// 存的 activity + For You 选择），成功页和「我的订单」共用这一个组件，两边不会
// 再各画各的、慢慢走样。
//
// 原型里删掉的两样照旧不画（都是没有真能力的东西，理由见 requester-home 的
// HOME-FORYOU-ORDER-003）：二维码（位置换成订单编号）、开场前的通知（App 没有推送通道）。
import { Image, type ImageSource } from "expo-image";
import { Pressable, StyleSheet, Text, View, type ViewStyle } from "react-native";
import type { ActivityOrderSnapshot } from "@proxy/contracts";
import { ProxyIcon } from "./proxy-icon";
import { color } from "../theme";
import { stripAreaSuffix } from "../requester-home-combo";

// 单边虚线在 iOS 上画不出来（RN 只支持四边等宽的虚线边框），用一排小方块自己画。
function DashedRule({ ruleColor, style }: { ruleColor: string; style?: ViewStyle }): React.JSX.Element {
  return (
    <View pointerEvents="none" style={[styles.dashedRule, style]}>
      {Array.from({ length: 24 }, (_, index) => (
        <View key={index} style={[styles.dashedRuleDash, { backgroundColor: ruleColor }]} />
      ))}
    </View>
  );
}

export type ActivityOrderTicketProps = {
  snapshot: ActivityOrderSnapshot;
  copied: boolean;
  onCopyOrderNo: () => void;
  /** 下单成功页手头有打包在 App 里的同行人头像（快照里存不了本地图），可以传进来。 */
  companionPhotoSource?: ImageSource | undefined;
  /** 票券上沿是否叠进上方 hero 的圆角（成功页 hero 在时用）。 */
  overlapHero?: boolean | undefined;
  /**
   * HOME-FORYOU-PERSON-001：没有同行人时说清楚**为什么**没有（老订单没存 / 直接报名
   * 本来就没有），不再笼统写成"这活动没人推荐"——For You 订单一定有人。
   */
  noCompanionText?: string | undefined;
};

export function peopleCountLabel(snapshot: ActivityOrderSnapshot): string {
  const { joined, capacity } = snapshot.activity;
  return capacity && capacity > 0 ? `${joined} / ${capacity} 人` : `${joined} 人`;
}

export function ActivityOrderTicket({ snapshot, copied, onCopyOrderNo, companionPhotoSource, overlapHero, noCompanionText }: ActivityOrderTicketProps): React.JSX.Element {
  const { activity, companion, place } = snapshot;
  const photo = companionPhotoSource ?? (companion?.photoUrl ? { uri: companion.photoUrl } : undefined);
  return (
    <View>
      <View style={[styles.ticket, overlapHero ? styles.ticketOverlap : null]}>
        <View style={styles.ticketBody}>
          <Pressable accessibilityLabel="复制订单编号" onPress={onCopyOrderNo} style={styles.codeChip}>
            <ProxyIcon color={color.ink} name="ticket" size={14} />
            <Text selectable style={styles.codeText}>{snapshot.orderNo}</Text>
          </Pressable>
          <Text selectable style={styles.codeHint}>{copied ? "订单编号已复制" : "订单编号 · 点击复制"}</Text>
        </View>
        <View style={styles.tear}>
          <DashedRule ruleColor={color.line} style={styles.tearLine} />
          <View style={[styles.tearHole, styles.tearHoleLeft]} />
          <View style={[styles.tearHole, styles.tearHoleRight]} />
        </View>
        <View style={styles.metaBlock}>
          <View style={styles.metaRow}>
            <DashedRule ruleColor={color.line} style={styles.metaRule} />
            <Text selectable style={styles.metaLabel}>活动</Text>
            <View style={styles.metaValueCol}>
              <Text selectable style={styles.metaValue}>{activity.title}</Text>
              <Text selectable style={styles.bodyText}>报名不等于到场</Text>
            </View>
          </View>
          <View style={styles.metaRow}>
            <DashedRule ruleColor={color.line} style={styles.metaRule} />
            <Text selectable style={styles.metaLabel}>时间</Text>
            <Text selectable style={styles.metaValue}>{snapshot.time || activity.time || "—"}</Text>
          </View>
          <View style={styles.metaRow}>
            <DashedRule ruleColor={color.line} style={styles.metaRule} />
            <Text selectable style={styles.metaLabel}>地点</Text>
            <View style={styles.metaValueCol}>
              {/* 原型「地点」= 名称一行 + 区域一行；店名自带的「· 区域」后缀去掉，免得同一个区域写两遍。 */}
              <Text selectable style={styles.metaValue}>{place ? stripAreaSuffix(place.name, place.area) : activity.venueName || "—"}</Text>
              {place?.area ? <Text selectable style={styles.bodyText}>{place.area}</Text> : null}
            </View>
          </View>
          <View style={styles.metaRow}>
            {activity.venueSpend ? <DashedRule ruleColor={color.line} style={styles.metaRule} /> : null}
            <Text selectable style={styles.metaLabel}>费用</Text>
            <Text selectable style={[styles.metaValue, activity.moneyFlow === "FREE" && styles.valueGood]}>{activity.priceLabel || "—"}</Text>
          </View>
          {activity.venueSpend ? (
            <View style={styles.metaRow}>
              <Text selectable style={styles.metaLabel}>到店消费</Text>
              <View style={styles.metaValueCol}>
                <Text selectable style={styles.metaValue}>{activity.venueSpend}</Text>
                <Text selectable style={styles.bodyText}>直接付给商家，不经过平台</Text>
              </View>
            </View>
          ) : null}
        </View>
      </View>
      <View style={styles.block}>
        <View style={styles.peopleLabel}>
          <Text selectable style={styles.peopleTitle}>一起的人</Text>
          <Text selectable style={styles.peopleCount}>{peopleCountLabel(snapshot)}</Text>
        </View>
        {companion ? (
          <View style={styles.personRow}>
            {photo ? (
              <Image source={photo} style={styles.personAvatar} />
            ) : (
              <View style={[styles.personAvatar, styles.personAvatarFallback]}>
                <Text selectable style={styles.personInitials}>{companion.name.slice(0, 1).toUpperCase()}</Text>
              </View>
            )}
            <View style={styles.personInfo}>
              <Text selectable style={styles.personName}>{companion.name} · 系统推荐同行</Text>
              {companion.bio ? <Text selectable style={styles.bodyText}>{companion.bio}</Text> : null}
            </View>
          </View>
        ) : (
          <Text selectable style={styles.bodyText}>{noCompanionText ?? "这笔订单没有同行人记录"}</Text>
        )}
      </View>
      <View style={styles.reminder}>
        <ProxyIcon color={color.warnBannerText} name="infoCircle" size={16} />
        <Text selectable style={styles.reminderText}>推荐的同行人不代表对方已确认参加。报名成功即算加入名额，不代表已到场。</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  dashedRule: { flexDirection: "row", height: 1.5, justifyContent: "space-between", overflow: "hidden" },
  dashedRuleDash: { borderRadius: 1, height: 1.5, width: 5 },
  ticket: { backgroundColor: color.white, borderColor: color.line, borderRadius: 18, borderWidth: 1, overflow: "hidden" },
  ticketOverlap: { marginTop: -14 },
  ticketBody: { paddingHorizontal: 16, paddingTop: 16 },
  codeChip: { alignItems: "center", alignSelf: "center", backgroundColor: color.surface, borderRadius: 10, flexDirection: "row", gap: 7, paddingHorizontal: 13, paddingVertical: 9 },
  codeText: { color: color.ink, fontSize: 13.5, fontWeight: "900", letterSpacing: 1 },
  codeHint: { color: color.muted, fontSize: 11, fontWeight: "700", marginTop: 7, textAlign: "center" },
  tear: { height: 26, position: "relative" },
  tearLine: { left: 22, position: "absolute", right: 22, top: 12 },
  tearHole: { backgroundColor: color.offWhite, borderRadius: 11, height: 22, position: "absolute", top: 2, width: 22 },
  tearHoleLeft: { left: -10 },
  tearHoleRight: { right: -10 },
  metaBlock: { paddingBottom: 16, paddingHorizontal: 16, paddingTop: 6 },
  metaRow: { flexDirection: "row", gap: 12, justifyContent: "space-between", paddingVertical: 10, position: "relative" },
  metaRule: { bottom: 0, left: 0, position: "absolute", right: 0 },
  metaLabel: { color: color.muted, fontSize: 11.5, fontWeight: "800", paddingTop: 2 },
  metaValueCol: { alignItems: "flex-end", flex: 1 },
  metaValue: { color: color.ink, fontSize: 13, fontWeight: "900", textAlign: "right" },
  valueGood: { color: color.proxyGreen },
  bodyText: { color: color.muted, fontSize: 12, lineHeight: 18, marginTop: 4 },
  block: { backgroundColor: color.white, borderColor: color.line, borderRadius: 16, borderWidth: 1, marginTop: 12, padding: 14 },
  peopleLabel: { alignItems: "baseline", flexDirection: "row", justifyContent: "space-between", marginBottom: 12 },
  peopleTitle: { color: color.muted, fontSize: 11, fontWeight: "900", letterSpacing: 0.4, textTransform: "uppercase" },
  peopleCount: { color: color.muted, fontSize: 11, fontWeight: "800" },
  personRow: { alignItems: "center", flexDirection: "row", gap: 12 },
  personAvatar: { borderRadius: 26, height: 52, width: 52 },
  personAvatarFallback: { alignItems: "center", backgroundColor: color.offWhite, justifyContent: "center" },
  personInitials: { color: color.ink, fontSize: 28, fontWeight: "900" },
  personInfo: { flex: 1, minWidth: 0 },
  personName: { color: color.ink, fontSize: 14.5, fontWeight: "900" },
  reminder: { alignItems: "flex-start", backgroundColor: color.warnBannerBg, borderColor: color.warnBannerBorder, borderRadius: 16, borderWidth: 1.5, flexDirection: "row", gap: 10, marginTop: 12, padding: 14 },
  reminderText: { color: color.warnBannerText, flex: 1, fontSize: 12, fontWeight: "700", lineHeight: 19 },
});

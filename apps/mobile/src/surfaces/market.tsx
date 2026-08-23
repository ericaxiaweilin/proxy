// Market Surface（R15.12.7 Market Map Parity Freeze）：市场 Root = 体验 / 机会 / 活动。
// 三类一级对象冻结；Market 保留 LIST / MAP 双模式，右上角固定图标切换（不新增文字 Tab）。
// Map 只展示对象公开地点 / 区域（Experience Venue · Opportunity 任务区域 · Activity Venue），
// 严格禁止 Creator / Host / Participant 实时 GPS、未授权的私人集合点、精确个人地址。
// REMOTE 机会只存在于 LIST；MAP 不强行生成地理 Pin，提示切回列表。
// 视觉基线：Proxy_P0_Prototype_R15_12_7_Market_Map_Parity_Freeze.html（screens.market + r162*）。
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import type { Activity } from "@proxy/contracts";
import { type ActivityClient } from "../activity-client";
import {
  MAP_DISTRICTS,
  MARKET_EXPERIENCES,
  MARKET_HOSTS,
  MARKET_OPPORTUNITIES,
  OPPORTUNITY_LENS_LABEL,
  OPPORTUNITY_MAP_COORDS,
  marketExperience,
  marketHost,
  type MarketOpportunity,
  type MarketTab,
  type OpportunityLens
} from "../market-fixtures";
import { ProxyIcon } from "../components/proxy-icon";
import { color, Gradient, shadows } from "../theme";
import { ActivityDetail, ActivityFeedCard } from "./tasks";

export type MarketViewMode = "LIST" | "MAP";

type ActivityFilter = "RECOMMENDED" | "CAFE" | "RESTAURANT" | "MINE";

const EXPERIENCE_LENS = ["推荐", "附近", "本周", "摄影", "城市"] as const;
const ACTIVITY_LENS = ["趋势", "附近", "本周", "新活动"] as const;
const ACTIVITY_FILTERS: ReadonlyArray<{ id: ActivityFilter; label: string }> = [
  { id: "RECOMMENDED", label: "趋势" },
  { id: "CAFE", label: "附近" },
  { id: "RESTAURANT", label: "本周" },
  { id: "MINE", label: "我的活动" }
];

const OPPORTUNITY_COORDS: Array<[number, number]> = OPPORTUNITY_MAP_COORDS;

export function MarketSurface({
  activities,
  marketLabel,
  initialTab = "EXPERIENCE",
  onOpenExperience,
  onOpenActivity
}: {
  activities: ActivityClient;
  marketLabel: string;
  initialTab?: MarketTab;
  onOpenExperience: (experienceId: string) => void;
  onOpenActivity: (activity: Activity) => void;
}): React.JSX.Element {
  const [tab, setTab] = useState<MarketTab>(initialTab);
  const [view, setView] = useState<MarketViewMode>("LIST");
  const [lens, setLens] = useState<OpportunityLens>("NOW");
  const [activityFilter, setActivityFilter] = useState<ActivityFilter>("RECOMMENDED");
  const [search, setSearch] = useState("");
  const [activityPhase, setActivityPhase] = useState<"LOADING" | "READY" | "ERROR">("LOADING");
  const [activityItems, setActivityItems] = useState<Activity[]>([]);
  const [activityDetail, setActivityDetail] = useState<Activity | null>(null);
  const [interestedIn, setInterestedIn] = useState<ReadonlySet<string>>(new Set());
  const [joinedIds, setJoinedIds] = useState<ReadonlySet<string>>(new Set());
  const [busy, setBusy] = useState(false);

  const loadActivities = useCallback(async (): Promise<void> => {
    setActivityPhase("LOADING");
    try {
      const read = await activities.listActivities();
      setActivityItems(read);
      setActivityPhase("READY");
    } catch {
      setActivityPhase("ERROR");
    }
  }, [activities]);

  useEffect(() => {
    if (tab === "ACTIVITY") {
      void loadActivities();
    }
  }, [tab, loadActivities]);

  function upsertActivity(next: Activity): void {
    setActivityItems((current) => current.map((entry) => (entry.activityId === next.activityId ? next : entry)));
  }

  async function toggleInterest(activityId: string): Promise<void> {
    if (busy) return;
    setBusy(true);
    try {
      const { activity, interested } = await activities.toggleInterest(activityId);
      upsertActivity(activity);
      const next = new Set(interestedIn);
      if (interested) next.add(activityId);
      else next.delete(activityId);
      setInterestedIn(next);
    } catch {
      // fail-closed：命令失败保持原状态
    } finally {
      setBusy(false);
    }
  }

  async function joinActivity(activityId: string): Promise<void> {
    if (busy) return;
    setBusy(true);
    try {
      const { activity } = await activities.join(activityId);
      upsertActivity(activity);
      const next = new Set(joinedIds);
      next.add(activityId);
      setJoinedIds(next);
    } catch {
      // fail-closed：命令失败保持原状态
    } finally {
      setBusy(false);
    }
  }

  const visibleActivities = activityItems.filter((item) => {
    if (activityFilter === "CAFE") return item.venueType === "CAFE";
    if (activityFilter === "RESTAURANT") return item.venueType === "RESTAURANT";
    if (activityFilter === "MINE") return joinedIds.has(item.activityId) || interestedIn.has(item.activityId);
    return true;
  });

  const remoteLens = lens === "REMOTE";

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      {/* 基线 .r157MarketHead：市场 + 本地范围 + 右上 map/list 图标切换 + ＋ 发布 */}
      <View style={styles.marketHead}>
        <View>
          <Text style={styles.marketTitle}>市场</Text>
          <Text style={styles.marketSub}>{marketLabel} · 体验 / 机会 / 活动</Text>
        </View>
        <View style={styles.headActions}>
          <Pressable
            onPress={() => setView(view === "MAP" ? "LIST" : "MAP")}
            style={[styles.viewToggle, view === "MAP" && styles.viewToggleOn]}
          >
            <Text style={[styles.viewToggleText, view === "MAP" && styles.viewToggleTextOn]}>
              {view === "MAP" ? "▤" : "⌖"}
            </Text>
          </Pressable>
          <Pressable style={styles.plusBtn}>
            <Text style={styles.plusBtnText}>＋</Text>
          </Pressable>
        </View>
      </View>

      {/* 基线 .r162Tabs：体验 / 机会 / 活动 三 Tab，无第四个 Market Object */}
      <View style={styles.tabs}>
        {(
          [
            ["EXPERIENCE", "体验"],
            ["OPPORTUNITY", "机会"],
            ["ACTIVITY", "活动"]
          ] as ReadonlyArray<[MarketTab, string]>
        ).map(([id, label]) => (
          <Pressable
            key={id}
            onPress={() => {
              setTab(id);
              setActivityDetail(null);
            }}
            style={[styles.tab, tab === id && styles.tabOn]}
          >
            <Text style={[styles.tabText, tab === id && styles.tabTextOn]}>{label}</Text>
          </Pressable>
        ))}
      </View>

      {view === "MAP" ? (
        <MarketMap
          tab={tab}
          lens={lens}
          remoteLens={remoteLens}
          marketLabel={marketLabel}
          onOpenExperience={onOpenExperience}
          onOpenOpportunity={() => undefined}
          onOpenActivity={(a) => setActivityDetail(a)}
        />
      ) : tab === "EXPERIENCE" ? (
        <ExperienceTab search={search} setSearch={setSearch} onOpenExperience={onOpenExperience} />
      ) : tab === "OPPORTUNITY" ? (
        <OpportunityTab lens={lens} setLens={setLens} marketLabel={marketLabel} />
      ) : (
        <>
          <View style={styles.searchRow}>
            <View style={styles.searchBox}>
              <TextInput
                onChangeText={setSearch}
                placeholder="搜活动、地点、主题…"
                placeholderTextColor="#A9A2B0"
                style={styles.searchInput}
                value={search}
              />
              <Text style={styles.searchIcon}>⌕</Text>
            </View>
          </View>
          <View style={styles.lensRow}>
            {ACTIVITY_FILTERS.map((entry) => (
              <Pressable
                key={entry.id}
                onPress={() => setActivityFilter(entry.id)}
                style={[styles.lens, activityFilter === entry.id && styles.lensOn]}
              >
                <Text style={[styles.lensText, activityFilter === entry.id && styles.lensTextOn]}>{entry.label}</Text>
              </Pressable>
            ))}
          </View>
          <View style={styles.sectionHead}>
            <Text style={styles.sectionTitle}>趋势活动</Text>
            <Text style={styles.sectionHint}>多人 / 兴趣 / 品牌场景</Text>
          </View>
          {activityPhase === "LOADING" ? (
            <View style={styles.emptyBox}>
              <ActivityIndicator color={color.magenta} />
              <Text style={styles.emptyText}>正在读取活动读模型（ListActivities）…</Text>
            </View>
          ) : activityPhase === "ERROR" ? (
            <View style={styles.emptyBox}>
              <Text style={styles.emptyText}>活动读模型暂时不可用（本地 API 未连接？）。</Text>
              <Pressable onPress={() => void loadActivities()} style={styles.retryBtn}>
                <Text style={styles.retryText}>重试</Text>
              </Pressable>
            </View>
          ) : visibleActivities.length === 0 ? (
            <View style={styles.emptyBox}>
              <Text style={styles.emptyText}>
                {activityFilter === "MINE" ? "还没有参加或感兴趣的活动。" : "附近暂时没有符合的活动。"}
              </Text>
            </View>
          ) : activityDetail ? (
            <ActivityDetail
              item={activityDetail}
              interested={interestedIn.has(activityDetail.activityId)}
              joined={joinedIds.has(activityDetail.activityId)}
              busy={busy}
              onToggleInterested={() => void toggleInterest(activityDetail.activityId)}
              onJoin={() => void joinActivity(activityDetail.activityId)}
              onBack={() => setActivityDetail(null)}
            />
          ) : (
            visibleActivities.map((item) => (
              <View key={item.activityId}>
                <ActivityFeedCard item={item} onPress={() => setActivityDetail(item)} />
                <View style={styles.hostFlag}>
                  <Text style={styles.hostFlagText}>Host / Creator 可参与</Text>
                </View>
              </View>
            ))
          )}
        </>
      )}
    </ScrollView>
  );
}

// R15.12.10：体验入口按 Creator 的身份、档期和开放对象组织；不是动态流，也不是 OTA 商品目录。
function ExperienceTab({
  search,
  setSearch,
  onOpenExperience
}: {
  search: string;
  setSearch: (value: string) => void;
  onOpenExperience: (experienceId: string) => void;
}): React.JSX.Element {
  const [activeFilter, setActiveFilter] = useState("本周可参加");
  const normalizedSearch = search.trim().toLocaleLowerCase();
  const creators = MARKET_HOSTS.filter((host) => {
    const openExperiences = MARKET_EXPERIENCES.filter((experience) => experience.hosts.includes(host.id));
    if (!normalizedSearch) return true;
    return [host.name, host.topic, host.sub, ...openExperiences.flatMap((experience) => [experience.title, experience.place])]
      .join(" ")
      .toLocaleLowerCase()
      .includes(normalizedSearch);
  });
  return (
    <>
      <View style={styles.searchRow}>
        <View style={styles.searchBox}>
          <TextInput
            onChangeText={setSearch}
            placeholder="搜 Creator、时间、地点、体验…"
            placeholderTextColor="#A9A2B0"
            style={styles.searchInput}
            value={search}
          />
          <Text style={styles.searchIcon}>⌕</Text>
        </View>
      </View>
      <View style={styles.lensRow}>
        {["本周可参加", "关注", "附近", "摄影", "中文"].map((label) => (
          <Pressable key={label} onPress={() => setActiveFilter(label)} style={[styles.lens, activeFilter === label && styles.lensOn]}>
            <Text style={[styles.lensText, activeFilter === label && styles.lensTextOn]}>{label}</Text>
          </Pressable>
        ))}
      </View>

      <View style={styles.creatorUtilityBar}>
        <View style={styles.creatorUtilityCopy}>
          <Text style={styles.creatorUtilityTitle}>按 Creator 看开放体验</Text>
          <Text style={styles.creatorUtilitySub}>不是动态流，也不是旅游商品目录</Text>
        </View>
        <Text style={styles.creatorUtilityCount}>9 位可参加 · 24 个开放</Text>
      </View>

      <View style={styles.externalNote}>
        <View style={styles.externalNoteBadge}><Text style={styles.externalNoteBadgeText}>TK</Text></View>
        <View style={styles.externalNoteCopy}>
          <Text style={styles.externalNoteTitle}>内容继续在 TikTok / Instagram 运营</Text>
          <Text style={styles.externalNoteText}>Proxy 不复制 Creator Feed；这里只承接身份、档期、可参加对象、预约与后续关系。</Text>
        </View>
      </View>

      {creators.map((creator) => (
        <CreatorAvailabilityCard key={creator.id} creatorId={creator.id} onOpenExperience={onOpenExperience} />
      ))}
      {creators.length === 0 ? <Text style={styles.creatorEmpty}>没有匹配的 Creator 或开放体验。</Text> : null}
      <Text style={styles.creatorMarketHint}>
        Creator 是发现入口；真正的价格与 Scope 仍属于具体体验。外部内容平台负责流量，Proxy 负责把流量接到可执行的本地商业对象。
      </Text>
    </>
  );
}

const CREATOR_CHANNELS: Record<string, { handle: string; followers: string; relation: string; available: string; meta: string }> = {
  linh: { handle: "@linh.hanoi", followers: "12.4k", relation: "已关注", available: "周六可约", meta: "城市陪同 · 中文 / 越南语" },
  mai: { handle: "@mai.frames", followers: "8.7k", relation: "新发现", available: "今天可约", meta: "摄影 Creator · 西湖" },
  anh: { handle: "@anh.local", followers: "19.1k", relation: "已联系", available: "本周可约", meta: "本地接待 · 还剑" },
  thao: { handle: "@thao.hn", followers: "4.8k", relation: "推荐", available: "周日可约", meta: "中文口译 · 河内 / 北宁" }
};

function CreatorAvailabilityCard({
  creatorId,
  onOpenExperience
}: {
  creatorId: string;
  onOpenExperience: (experienceId: string) => void;
}): React.JSX.Element {
  const creator = marketHost(creatorId);
  const channel = CREATOR_CHANNELS[creator.id] ?? CREATOR_CHANNELS.linh!;
  const openExperiences = MARKET_EXPERIENCES.filter((experience) => experience.hosts.includes(creator.id));
  const firstExperience = openExperiences[0];

  return (
    <View style={styles.creatorCard}>
      <View style={styles.creatorTop}>
        <View style={styles.creatorPortraitWrap}>
          <Image resizeMode="cover" source={{ uri: creator.photo }} style={styles.creatorPortrait} />
          <View style={styles.creatorAvailability}><Text style={styles.creatorAvailabilityText}>{channel.available}</Text></View>
        </View>
        <View style={styles.creatorInfo}>
          <View style={styles.creatorNameRow}>
            <Text style={styles.creatorName}>{creator.name}</Text>
            <Text style={styles.creatorVerified}>✓ VERIFIED</Text>
          </View>
          <Text style={styles.creatorMeta}>{channel.meta}{"\n"}履约 {creator.fulfill} · 已完成 {creator.done} 次</Text>
          <View style={styles.creatorChannelRow}>
            <View style={styles.creatorChannel}><Text style={styles.creatorChannelMark}>TK</Text><Text style={styles.creatorChannelText}>{channel.handle} · {channel.followers}</Text></View>
            <Text style={styles.creatorRelation}>{channel.relation}</Text>
          </View>
          <View style={styles.creatorActions}>
            <Pressable accessibilityLabel={`${creator.name} 主页`} style={styles.creatorAction}><Text style={styles.creatorActionText}>主页</Text></Pressable>
            {firstExperience ? (
              <Pressable accessibilityLabel={`查看 ${creator.name} 开放体验`} onPress={() => onOpenExperience(firstExperience.id)} style={[styles.creatorAction, styles.creatorActionPrimary]}>
                <Text style={[styles.creatorActionText, styles.creatorActionPrimaryText]}>看开放体验</Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      </View>
      <View style={styles.creatorOpenHead}>
        <Text style={styles.creatorOpenTitle}>本周开放</Text>
        <Text style={styles.creatorOpenCount}>{openExperiences.length} 个可参加对象</Text>
      </View>
      <View style={styles.creatorOpenList}>
        {openExperiences.slice(0, 2).map((experience) => (
          <Pressable key={experience.id} onPress={() => onOpenExperience(experience.id)} style={styles.creatorOpenItem}>
            <View style={styles.creatorOpenIcon}><ProxyMark /></View>
            <View style={styles.creatorOpenCopy}>
              <Text numberOfLines={1} style={styles.creatorOpenItemTitle}>{experience.title}</Text>
              <Text numberOfLines={1} style={styles.creatorOpenItemSub}>{experience.next} · {experience.duration} · {experience.place}</Text>
            </View>
            <Text style={styles.creatorOpenArrow}>›</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

function ProxyMark(): React.JSX.Element {
  return <ProxyIcon color="#6840A0" name="target" size={13} />;
}

// 基线 .r162ExperienceCard：hero 图 + 类目徽章 + Host 行 + scope 元信息 + 价格。
function ExperienceCard({ experienceId, onOpen }: { experienceId: string; onOpen: () => void }): React.JSX.Element {
  const experience = marketExperience(experienceId);
  const host = marketHost(experience.hosts[0] ?? "");
  return (
    <Pressable onPress={onOpen} style={styles.experienceCard}>
      <View style={styles.experienceHero}>
        <Image resizeMode="cover" source={{ uri: experience.photo }} style={styles.experienceHeroImage} />
        <View style={styles.experienceHeroScrim} />
        <View style={styles.experienceBadge}>
          <Text style={styles.experienceBadgeText}>{experience.category}</Text>
        </View>
        <View style={styles.hostLine}>
          <View style={styles.hostMiniAva}>
            <Image resizeMode="cover" source={{ uri: host.photo }} style={styles.hostMiniAvaImage} />
          </View>
          <View style={styles.hostMiniCopy}>
            <Text style={styles.hostMiniName}>
              Host {host.name}
              {experience.hosts.length > 1 ? " · 可选" : ""}
            </Text>
            <Text style={styles.hostMiniSub}>{experience.hosts.length} 位可选 Host</Text>
          </View>
        </View>
      </View>
      <View style={styles.experienceBody}>
        <Text style={styles.experienceTitle}>{experience.title}</Text>
        <Text style={styles.experienceMeta}>{experience.meta}</Text>
        <View style={styles.experienceMetaRow}>
          <Text style={styles.experienceMetaChip}>{experience.duration}</Text>
          <Text style={styles.experienceMetaChip}>{experience.place}</Text>
          <Text style={styles.experienceMetaChip}>{experience.next}</Text>
        </View>
        <View style={styles.experienceFoot}>
          <Text style={styles.experienceScopeHint}>明确体验 Scope · 进入详情后选 Host</Text>
          <View style={styles.experiencePriceBlock}>
            <Text style={styles.experiencePrice}>{experience.price}</Text>
            <Text style={styles.experiencePriceUnit}> / 本体验</Text>
          </View>
        </View>
      </View>
    </Pressable>
  );
}

// 机会 LIST：Search + 现在/附近/预约/远程 + 本地范围说明 + Opportunity Cards。
function OpportunityTab({
  lens,
  setLens,
  marketLabel
}: {
  lens: OpportunityLens;
  setLens: (lens: OpportunityLens) => void;
  marketLabel: string;
}): React.JSX.Element {
  const items = MARKET_OPPORTUNITIES.filter((o) => o.lens.includes(lens));
  const sorted =
    lens === "NOW" || lens === "NEARBY"
      ? [...items].sort((a, b) => (a.travel ?? 999) - (b.travel ?? 999))
      : items;
  return (
    <>
      <View style={styles.searchRow}>
        <View style={styles.searchBox}>
          <TextInput placeholder="搜机会、主题、地点…" placeholderTextColor="#A9A2B0" style={styles.searchInput} />
          <Text style={styles.searchIcon}>⌕</Text>
        </View>
      </View>
      <View style={styles.lensRow}>
        {(Object.keys(OPPORTUNITY_LENS_LABEL) as OpportunityLens[]).map((id) => (
          <Pressable key={id} onPress={() => setLens(id)} style={[styles.lens, lens === id && styles.lensOn]}>
            <Text style={[styles.lensText, lens === id && styles.lensTextOn]}>{OPPORTUNITY_LENS_LABEL[id]}</Text>
          </Pressable>
        ))}
      </View>
      <View style={styles.localScope}>
        <Text style={styles.localScopeGlyph}>⌖</Text>
        <Text style={styles.localScopeText}>
          {lens === "REMOTE" ? "远程 · 不受通勤半径限制" : `${marketLabel} · 默认只展示可履约范围`}
        </Text>
      </View>
      <View style={styles.oppStack}>
        {sorted.map((opportunity) => (
          <OpportunityCard key={opportunity.id} opportunity={opportunity} />
        ))}
      </View>
    </>
  );
}

interface OpportunityCardProps {
  opportunity: MarketOpportunity;
}

// 基线 .r158Opportunity：类目 mark + 时间 / 地点 / 验证 + 信号 / 应答 / 报酬。
function OpportunityCard({ opportunity }: OpportunityCardProps): React.JSX.Element {
  const local = opportunity.travel != null;
  return (
    <Pressable style={styles.opportunity}>
      <View style={styles.oppTop}>
        <View style={styles.oppCatMark}>
          <Text style={styles.oppCatMarkText}>{opportunity.shortTitle.slice(0, 1)}</Text>
        </View>
        <View style={styles.oppCopy}>
          <Text style={styles.oppTitle}>{opportunity.shortTitle}</Text>
          <Text style={styles.oppLine}>◷ {opportunity.date} {opportunity.time}</Text>
          <Text style={styles.oppLine}>
            ⌖ {opportunity.location}
            {local ? ` · ${opportunity.travel}min 可达` : ""}
          </Text>
        </View>
        {opportunity.verified ? (
          <View style={styles.oppVerify}>
            <Text style={styles.oppVerifyText}>✓已验证</Text>
          </View>
        ) : null}
      </View>
      <View style={styles.oppFoot}>
        <Text style={[styles.oppSignal, opportunity.signalClass === "hot" && styles.oppSignalHot]}>
          {opportunity.signal}
        </Text>
        <Text style={styles.oppFootText}>{opportunity.responses} 应答</Text>
        <Text style={styles.oppFootText}>报酬见详情</Text>
        <Text style={styles.oppCount}>{opportunity.countdown} ›</Text>
      </View>
    </Pressable>
  );
}

interface OpportunityCardProps {
  opportunity: MarketOpportunity;
}

// MAP：三类对象共用同一视图规则；Pin 只代表对象地点 / 区域，不代表真人实时位置。
function MarketMap({
  tab,
  lens,
  remoteLens,
  marketLabel,
  onOpenExperience,
  onOpenOpportunity,
  onOpenActivity
}: {
  tab: MarketTab;
  lens: OpportunityLens;
  remoteLens: boolean;
  marketLabel: string;
  onOpenExperience: (experienceId: string) => void;
  onOpenOpportunity: (id: string) => void;
  onOpenActivity: (activity: Activity) => void;
}): React.JSX.Element {
  const [detailActivity, setDetailActivity] = useState<Activity | null>(null);
  const config = mapConfig(tab);
  return (
    <View style={styles.mapWrap}>
      <View style={styles.mapLegend}>
        <Text style={styles.mapLegendTitle}>{config.title}</Text>
        <Text style={styles.mapLegendSub}>{config.sub}</Text>
      </View>
      <View style={styles.geoMap}>
        {MAP_DISTRICTS.map((district) => (
          <Text key={district.label} style={[styles.geoDistrict, { left: `${district.left}%`, top: `${district.top}%` }]}>
            {district.label}
          </Text>
        ))}
        {config.pins.map((pin) => (
          <Pressable
            key={pin.label}
            onPress={() => {
              if (tab === "EXPERIENCE") onOpenExperience(pin.id);
              else if (tab === "OPPORTUNITY") onOpenOpportunity(pin.id);
              else onOpenActivity(pin.activity as Activity);
            }}
            style={[styles.geoPin, { left: `${pin.left}%`, top: `${pin.top}%` }]}
          >
            <Text style={styles.geoPinText}>{pin.label}</Text>
          </Pressable>
        ))}
      </View>
      <View style={styles.geoPrivacy}>
        <Text style={styles.geoPrivacyGlyph}>⌖</Text>
        <View style={styles.geoPrivacyCopy}>
          <Text style={styles.geoPrivacyTitle}>{config.privacyTitle}</Text>
          <Text style={styles.geoPrivacyText}>{config.privacyText}</Text>
        </View>
      </View>
      {remoteLens ? (
        <View style={styles.mapRemote}>
          <Text style={styles.mapRemoteText}>
            远程机会不依赖地理位置。
            {"\n"}地图仅保留可定位的本地机会；远程机会请切回列表查看完整结果。
          </Text>
        </View>
      ) : null}
      {config.results}
    </View>
  );
}

function mapConfig(tab: MarketTab): {
  title: string;
  sub: string;
  privacyTitle: string;
  privacyText: string;
  pins: Array<{ id: string; label: string; left: number; top: number; activity?: Activity }>;
  results: React.JSX.Element;
} {
  if (tab === "OPPORTUNITY") {
    const local = MARKET_OPPORTUNITIES.filter((o) => o.location !== "远程").slice(0, 6);
    return {
      title: "机会地图",
      sub: "河内 · 仅公开 / 粗粒度任务区域",
      privacyTitle: "任务区域",
      privacyText: "地图用于附近探索与可达性判断；具体地址仅在业务确实需要且授权后提升精度。",
      pins: local.map((o, i) => ({
        id: o.id,
        label: String(i + 1),
        left: (OPPORTUNITY_COORDS[i % OPPORTUNITY_COORDS.length] ?? [50, 50])[0],
        top: (OPPORTUNITY_COORDS[i % OPPORTUNITY_COORDS.length] ?? [50, 50])[1]
      })),
      results: (
        <View>
          {local.slice(0, 2).map((o) => (
            <View key={o.id} style={styles.mapResult}>
              <Text style={styles.mapResultTitle}>{o.shortTitle}</Text>
              <Text style={styles.mapResultMeta}>
                {o.date} {o.time} · {o.location}
                {o.travel != null ? ` · ${o.travel}min 可达` : ""}
              </Text>
              <Pressable style={styles.mapResultBtn}>
                <Text style={styles.mapResultBtnText}>查看机会</Text>
              </Pressable>
            </View>
          ))}
        </View>
      )
    };
  }
  if (tab === "ACTIVITY") {
    return {
      title: "活动地图",
      sub: "公开 Activity Venue / 区域",
      privacyTitle: "公开活动地点",
      privacyText: "只展示 Activity 对外公开的 Venue / 区域；参与者和 Creator 的实时位置不展示。",
      pins: [
        { id: "photo_walk", label: "1", left: 28, top: 34 },
        { id: "coffee_chat", label: "2", left: 66, top: 40 },
        { id: "merchant_open", label: "3", left: 22, top: 54 },
        { id: "proxy_meetup", label: "4", left: 54, top: 68 }
      ],
      results: (
        <View>
          {MARKET_EXPERIENCES.slice(0, 2).map((experience) => (
            <View key={experience.id} style={styles.mapResult}>
              <Text style={styles.mapResultTitle}>{experience.title}</Text>
              <Text style={styles.mapResultMeta}>{experience.meta} · 已参加</Text>
              <Pressable style={styles.mapResultBtn}>
                <Text style={styles.mapResultBtnText}>查看活动</Text>
              </Pressable>
            </View>
          ))}
        </View>
      )
    };
  }
  return {
    title: "体验地图",
    sub: "按公开体验地点 / Venue 展示",
    privacyTitle: "体验地点",
    privacyText: "地图展示 Experience 的公开地点或粗粒度区域；Host 真人实时位置不进入地图。",
    pins: MARKET_EXPERIENCES.map((x, i) => ({ id: x.id, label: String(i + 1), left: x.coord[0], top: x.coord[1] })),
    results: (
      <View>
        {MARKET_EXPERIENCES.slice(0, 2).map((experience) => (
          <View key={experience.id} style={styles.mapResult}>
            <Text style={styles.mapResultTitle}>{experience.title}</Text>
            <Text style={styles.mapResultMeta}>{experience.meta} · {experience.price}</Text>
            <Pressable style={styles.mapResultBtn}>
              <Text style={styles.mapResultBtnText}>查看体验</Text>
            </Pressable>
          </View>
        ))}
      </View>
    )
  };
}

const styles = StyleSheet.create({
  root: { backgroundColor: color.offWhite, flex: 1 },
  content: { paddingBottom: 24, paddingHorizontal: 18, paddingTop: 10 },

  // 基线 .r157MarketHead：space-between align-end margin 4 0 8。
  marketHead: { alignItems: "flex-end", flexDirection: "row", justifyContent: "space-between", marginVertical: 4 },
  marketTitle: { color: color.ink, fontSize: 30, fontWeight: "800", lineHeight: 36 },
  marketSub: { color: color.muted, fontSize: 12, lineHeight: 17, marginTop: 3 },
  headActions: { alignItems: "center", flexDirection: "row", gap: 6 },
  viewToggle: {
    alignItems: "center",
    backgroundColor: color.white,
    borderColor: color.line,
    borderRadius: 11,
    borderWidth: 1,
    height: 44,
    justifyContent: "center",
    width: 44,
    ...shadows.card
  },
  viewToggleOn: { backgroundColor: color.ink, borderColor: color.ink },
  viewToggleText: { color: color.ink, fontSize: 15, fontWeight: "800" },
  viewToggleTextOn: { color: color.white },
  plusBtn: {
    alignItems: "center",
    backgroundColor: color.ink,
    borderRadius: 13,
    height: 44,
    justifyContent: "center",
    width: 44
  },
  plusBtnText: { color: color.white, fontSize: 22, fontWeight: "700" },

  // 基线 .r162Tabs：3 列 surface 底 + 白激活胶囊。
  tabs: {
    backgroundColor: color.surface,
    borderRadius: 14,
    flexDirection: "row",
    gap: 5,
    marginVertical: 8,
    padding: 4
  },
  tab: { borderRadius: 11, flex: 1, minHeight: 44, justifyContent: "center", paddingVertical: 9 },
  tabOn: { backgroundColor: color.white, ...shadows.card },
  tabText: { color: color.muted, fontSize: 14, fontWeight: "800", textAlign: "center" },
  tabTextOn: { color: color.ink },

  oppStack: { marginTop: 4 },

  searchRow: { marginTop: 6 },
  searchBox: {
    alignItems: "center",
    backgroundColor: color.white,
    borderColor: color.line,
    borderRadius: 13,
    borderWidth: 1,
    flexDirection: "row",
    overflow: "hidden"
  },
  searchInput: { flex: 1, fontSize: 14, minHeight: 44, paddingHorizontal: 12, paddingVertical: 10 },
  searchIcon: { color: color.ink, fontSize: 15, paddingHorizontal: 10 },

  // 基线 .r158Lens：横向胶囊，on = ink 底白字。
  lensRow: { flexDirection: "row", flexWrap: "wrap", gap: 5, marginVertical: 7 },
  lens: {
    alignItems: "center",
    backgroundColor: color.white,
    borderColor: color.line,
    borderRadius: 999,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 44,
    paddingHorizontal: 13,
    paddingVertical: 8
  },
  lensOn: { backgroundColor: color.ink, borderColor: color.ink },
  lensText: { color: color.ink, fontSize: 12, fontWeight: "800" },
  lensTextOn: { color: color.white },

  localScope: {
    alignItems: "center",
    flexDirection: "row",
    gap: 5,
    marginVertical: 2,
    paddingHorizontal: 1
  },
  localScopeGlyph: { color: color.violet, fontSize: 11 },
  localScopeText: { color: color.muted, fontSize: 11 },

  sectionHead: { alignItems: "flex-end", flexDirection: "row", justifyContent: "space-between", marginVertical: 8 },
  sectionTitle: { color: color.ink, fontSize: 16, fontWeight: "800" },
  sectionHint: { color: color.muted, fontSize: 11 },

  // 体验卡：.r162ExperienceCard radius 18 overflow hidden。
  experienceCard: {
    backgroundColor: color.white,
    borderColor: color.line,
    borderRadius: 18,
    borderWidth: 1,
    marginVertical: 9,
    overflow: "hidden",
    ...shadows.card
  },
  experienceHero: { height: 118, position: "relative" },
  experienceHeroImage: { height: "100%", width: "100%" },
  experienceHeroScrim: {
    backgroundColor: "rgba(18,15,24,0.32)",
    bottom: 0,
    left: 0,
    position: "absolute",
    right: 0,
    top: "40%"
  },
  experienceBadge: {
    backgroundColor: "rgba(255,255,255,0.92)",
    borderRadius: 999,
    left: 10,
    paddingHorizontal: 7,
    paddingVertical: 5,
    position: "absolute",
    top: 9
  },
  experienceBadgeText: { color: color.ink, fontSize: 11, fontWeight: "900" },
  hostLine: {
    alignItems: "center",
    bottom: 9,
    flexDirection: "row",
    gap: 7,
    left: 10,
    position: "absolute",
    right: 10
  },
  hostMiniAva: {
    borderColor: color.white,
    borderRadius: 999,
    borderWidth: 2,
    height: 24,
    overflow: "hidden",
    width: 24
  },
  hostMiniAvaImage: { height: "100%", width: "100%" },
  hostMiniCopy: { flex: 1 },
  hostMiniName: { color: color.white, fontSize: 11, fontWeight: "700" },
  hostMiniSub: { color: "rgba(255,255,255,0.9)", fontSize: 11, marginTop: 1 },
  experienceBody: { padding: 11 },
  experienceTitle: { color: color.ink, fontSize: 13, fontWeight: "700" },
  experienceMeta: { color: color.muted, fontSize: 11, marginTop: 3 },
  experienceMetaRow: { flexDirection: "row", flexWrap: "wrap", gap: 5, marginTop: 8 },
  experienceMetaChip: {
    backgroundColor: color.surface,
    borderRadius: 999,
    color: "#5E5665",
    fontSize: 11,
    overflow: "hidden",
    paddingHorizontal: 7,
    paddingVertical: 4
  },
  experienceFoot: { alignItems: "flex-end", borderTopColor: "#F1EDF3", borderTopWidth: 1, flexDirection: "row", justifyContent: "space-between", marginTop: 10, paddingTop: 8 },
  experienceScopeHint: { color: color.muted, fontSize: 11, flex: 1 },
  experiencePriceBlock: { flexDirection: "row", alignItems: "flex-end" },
  experiencePrice: { color: color.ink, fontSize: 15, fontWeight: "900" },
  experiencePriceUnit: { color: color.muted, fontSize: 11, marginBottom: 1 },

  // R15.12.10 .r165*：Creator Availability 的体验发现入口。
  creatorUtilityBar: {
    alignItems: "center",
    backgroundColor: "#F7F3FA",
    borderRadius: 13,
    flexDirection: "row",
    gap: 9,
    marginTop: 2,
    paddingHorizontal: 10,
    paddingVertical: 9
  },
  creatorUtilityCopy: { flex: 1 },
  creatorUtilityTitle: { color: color.ink, fontSize: 11, fontWeight: "900" },
  creatorUtilitySub: { color: color.muted, fontSize: 11, marginTop: 2 },
  creatorUtilityCount: { color: "#604D72", fontSize: 11, fontWeight: "800", textAlign: "right" },
  externalNote: {
    alignItems: "flex-start",
    backgroundColor: "#FBF8FF",
    borderColor: "#E7DCF4",
    borderRadius: 13,
    borderWidth: 1,
    flexDirection: "row",
    gap: 7,
    marginVertical: 8,
    padding: 9
  },
  externalNoteBadge: { alignItems: "center", backgroundColor: "#18151D", borderRadius: 7, height: 22, justifyContent: "center", width: 22 },
  externalNoteBadgeText: { color: color.white, fontSize: 11, fontWeight: "900" },
  externalNoteCopy: { flex: 1 },
  externalNoteTitle: { color: color.ink, fontSize: 11, fontWeight: "800" },
  externalNoteText: { color: color.muted, fontSize: 11, lineHeight: 15, marginTop: 2 },
  creatorCard: {
    backgroundColor: color.white,
    borderColor: color.line,
    borderRadius: 18,
    borderWidth: 1,
    marginVertical: 5,
    padding: 10,
    ...shadows.card
  },
  creatorTop: { flexDirection: "row", gap: 10 },
  creatorPortraitWrap: { borderRadius: 14, height: 86, overflow: "hidden", position: "relative", width: 72 },
  creatorPortrait: { height: "100%", width: "100%" },
  creatorAvailability: { backgroundColor: "rgba(20,18,31,0.78)", borderRadius: 999, bottom: 7, left: 7, paddingHorizontal: 6, paddingVertical: 4, position: "absolute" },
  creatorAvailabilityText: { color: color.white, fontSize: 11, fontWeight: "800" },
  creatorInfo: { flex: 1, minWidth: 0 },
  creatorNameRow: { alignItems: "center", flexDirection: "row", flexWrap: "wrap", gap: 5 },
  creatorName: { color: color.ink, fontSize: 12, fontWeight: "800" },
  creatorVerified: { backgroundColor: "#F0E9F8", borderRadius: 999, color: "#6334A3", fontSize: 11, fontWeight: "900", overflow: "hidden", paddingHorizontal: 4, paddingVertical: 3 },
  creatorMeta: { color: color.muted, fontSize: 11, lineHeight: 15, marginTop: 3 },
  creatorChannelRow: { alignItems: "center", flexDirection: "row", flexWrap: "wrap", gap: 5, marginTop: 7 },
  creatorChannel: { alignItems: "center", backgroundColor: "#17131F", borderRadius: 999, flexDirection: "row", gap: 4, paddingHorizontal: 7, paddingVertical: 5 },
  creatorChannelMark: { backgroundColor: color.white, borderRadius: 4, color: "#17131F", fontSize: 11, fontWeight: "900", overflow: "hidden", paddingHorizontal: 3, paddingVertical: 1 },
  creatorChannelText: { color: color.white, fontSize: 11, fontWeight: "800" },
  creatorRelation: { backgroundColor: "#F5F1F7", borderRadius: 999, color: "#6A616E", fontSize: 11, overflow: "hidden", paddingHorizontal: 7, paddingVertical: 5 },
  creatorActions: { flexDirection: "row", gap: 6, marginTop: "auto", paddingTop: 7 },
  creatorAction: { backgroundColor: color.white, borderColor: "#E4DDE8", borderRadius: 9, borderWidth: 1, paddingHorizontal: 8, paddingVertical: 6 },
  creatorActionPrimary: { backgroundColor: color.ink, borderColor: color.ink },
  creatorActionText: { color: "#5F5663", fontSize: 11, fontWeight: "800" },
  creatorActionPrimaryText: { color: color.white },
  creatorOpenHead: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", marginHorizontal: 1, marginTop: 9, marginBottom: 5 },
  creatorOpenTitle: { color: color.ink, fontSize: 11, fontWeight: "800" },
  creatorOpenCount: { color: color.muted, fontSize: 11 },
  creatorOpenList: { gap: 5 },
  creatorOpenItem: { alignItems: "center", backgroundColor: "#FAF8FB", borderColor: "#ECE6EF", borderRadius: 11, borderWidth: 1, flexDirection: "row", gap: 7, paddingHorizontal: 8, paddingVertical: 7 },
  creatorOpenIcon: { alignItems: "center", backgroundColor: "#F0E8F8", borderRadius: 8, height: 25, justifyContent: "center", width: 25 },
  creatorOpenCopy: { flex: 1, minWidth: 0 },
  creatorOpenItemTitle: { color: color.ink, fontSize: 11, fontWeight: "800" },
  creatorOpenItemSub: { color: color.muted, fontSize: 11, marginTop: 2 },
  creatorOpenArrow: { color: "#A79EAA", fontSize: 15 },
  creatorEmpty: { color: color.muted, fontSize: 11, paddingVertical: 18, textAlign: "center" },
  creatorMarketHint: { color: "#958C99", fontSize: 11, lineHeight: 15, paddingHorizontal: 8, paddingTop: 8, textAlign: "center" },

  // 机会卡：.r158Opportunity。
  opportunity: {
    backgroundColor: color.white,
    borderColor: color.line,
    borderRadius: 16,
    borderWidth: 1,
    marginVertical: 4,
    padding: 11,
    ...shadows.card
  },
  oppTop: { alignItems: "flex-start", flexDirection: "row", gap: 9 },
  oppCatMark: {
    alignItems: "center",
    backgroundColor: "#F1EAFE",
    borderRadius: 12,
    height: 40,
    justifyContent: "center",
    width: 40
  },
  oppCatMarkText: { color: "#5B2CB5", fontSize: 14, fontWeight: "900" },
  oppCopy: { flex: 1, minWidth: 0 },
  oppTitle: { color: color.ink, fontSize: 11, fontWeight: "700" },
  oppLine: { color: color.muted, fontSize: 11, lineHeight: 15, marginTop: 2 },
  oppVerify: { backgroundColor: "#EAF8F4", borderRadius: 999, paddingHorizontal: 6, paddingVertical: 4 },
  oppVerifyText: { color: "#137C6C", fontSize: 11, fontWeight: "900" },
  oppFoot: { alignItems: "center", borderTopColor: "#F1EDF3", borderTopWidth: 1, flexDirection: "row", gap: 8, marginTop: 9, paddingTop: 8 },
  oppSignal: {
    backgroundColor: "#F3EEFA",
    borderRadius: 999,
    color: "#5B2CB5",
    fontSize: 11,
    fontWeight: "900",
    paddingHorizontal: 6,
    paddingVertical: 4
  },
  oppSignalHot: { backgroundColor: "#FFF0F6", color: "#B91451" },
  oppFootText: { color: color.muted, fontSize: 11 },
  oppCount: { color: color.ink, fontSize: 11, fontWeight: "900", marginLeft: "auto" },

  // 活动空态 / 加载态。
  emptyBox: { alignItems: "center", borderColor: "#D9D0DE", borderRadius: 17, borderStyle: "dashed", borderWidth: 1, gap: 8, marginTop: 12, padding: 22 },
  emptyText: { color: color.muted, fontSize: 11, lineHeight: 15, textAlign: "center" },
  retryBtn: { backgroundColor: color.ink, borderRadius: 999, paddingHorizontal: 16, paddingVertical: 7 },
  retryText: { color: color.white, fontSize: 11, fontWeight: "700" },

  // Host / Creator 可参与 flag：.r162ActivityFlag。
  hostFlag: { marginHorizontal: 12, marginTop: -4, marginBottom: 7 },
  hostFlagText: {
    backgroundColor: "#F3EEFA",
    borderRadius: 999,
    color: "#633B99",
    fontSize: 11,
    fontWeight: "900",
    overflow: "hidden",
    paddingHorizontal: 6,
    paddingVertical: 4
  },

  // MAP：.geoMap / .geoPin / .geoPrivacy。
  mapWrap: { marginVertical: 9 },
  mapLegend: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", marginBottom: 6 },
  mapLegendTitle: { color: color.ink, fontSize: 11, fontWeight: "700" },
  mapLegendSub: { color: color.muted, fontSize: 11, textAlign: "right" },
  geoMap: {
    backgroundColor: "#F7F5F8",
    borderColor: color.line,
    borderRadius: 19,
    borderWidth: 1,
    height: 330,
    marginVertical: 8,
    overflow: "hidden",
    position: "relative"
  },
  geoDistrict: {
    backgroundColor: "rgba(255,255,255,0.78)",
    borderRadius: 8,
    color: "#8E8595",
    fontSize: 11,
    fontWeight: "900",
    paddingHorizontal: 6,
    paddingVertical: 4,
    position: "absolute"
  },
  geoPin: {
    alignItems: "center",
    backgroundColor: "#0B7A73",
    borderColor: color.white,
    borderRadius: 999,
    borderWidth: 2,
    height: 31,
    justifyContent: "center",
    minWidth: 31,
    paddingHorizontal: 7,
    position: "absolute",
    transform: [{ translateX: -15.5 }, { translateY: -15.5 }]
  },
  geoPinText: { color: color.white, fontSize: 11, fontWeight: "900" },
  geoPrivacy: {
    alignItems: "flex-start",
    backgroundColor: "#FFF8DF",
    borderColor: "#F0DA85",
    borderRadius: 13,
    borderWidth: 1,
    flexDirection: "row",
    gap: 7,
    marginVertical: 7,
    padding: 9
  },
  geoPrivacyGlyph: { color: color.ink, fontSize: 12 },
  geoPrivacyCopy: { flex: 1 },
  geoPrivacyTitle: { color: color.ink, fontSize: 11, fontWeight: "700" },
  geoPrivacyText: { color: "#78672F", fontSize: 11, lineHeight: 15, marginTop: 2 },
  mapRemote: {
    backgroundColor: "#F7F4FA",
    borderColor: "#D8CFDE",
    borderRadius: 13,
    borderStyle: "dashed",
    borderWidth: 1,
    marginTop: 8,
    padding: 10
  },
  mapRemoteText: { color: color.muted, fontSize: 11, lineHeight: 15 },
  mapResult: {
    backgroundColor: color.white,
    borderColor: color.line,
    borderRadius: 15,
    borderWidth: 1,
    marginTop: 8,
    padding: 10
  },
  mapResultTitle: { color: color.ink, fontSize: 11, fontWeight: "700" },
  mapResultMeta: { color: color.muted, fontSize: 11, lineHeight: 15, marginTop: 3 },
  mapResultBtn: {
    alignSelf: "flex-start",
    backgroundColor: color.ink,
    borderRadius: 10,
    marginTop: 8,
    paddingHorizontal: 10,
    paddingVertical: 7
  },
  mapResultBtnText: { color: color.white, fontSize: 11, fontWeight: "800" }
});

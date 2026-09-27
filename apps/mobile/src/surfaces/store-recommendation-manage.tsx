import { useCallback, useEffect, useState } from "react";
import { Linking, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { color } from "../theme";
import { styles } from "./me-styles";
import { localApiBaseUrl, nativeSecureSessionStore, sessionAuthClient } from "../native-clients";
import {
  StoreOnboardingClient,
  StoreRecommendationAiUnavailableError,
  type StoreRecommendation
} from "../storeonboarding-client";
import { ProxyBackGlyph, ProxyLoading } from "../components/proxy-foundation";
import { StoreAddressSheet, type PickedStoreAddress } from "../components/store-address-sheet";
import { MyStoreRecommendations } from "./my-store-recommendations";
import {
  REC_CITIES,
  REC_STATUS_TEXT,
  REC_STORE_TYPES,
  REC_TIP,
  REC_UNCOLLECTED_NOTE,
  recAddressLine,
  recCityIsPreset,
  recMapsUrl,
  recMoment,
  recStages,
  recStatus,
  type RecStageState
} from "./store-recommendation-manage-model";

// STORE-REC-MANAGE-001: 「推荐管理」—— 推荐这件事的完整界面。
//
// 它把原来平铺的 3 条入口收成两个页签 + 一个运营入口：
//   · 我推荐的店   → 列表屏（my-store-recommendations.tsx）+ 这一层拿数据
//   · 推荐新店     → 表单（就是 STORE-REC-001 那条 recommendStore 命令）
//   · 推荐评估队列 → 页脚一行，受众是运营，跟推荐人不是同一批人
//
// 设计稿（deepseek_html_20260925_38b4e5.html）里有、系统里**没有**的东西，
// 这里一律不画。清单在 store-recommendation-manage-model.ts 的注释里：
// 奖励金额、4 段进度里的「线下洽谈 / 签约完成」、撤回推荐、对接人电话/照片。
// 少画一块用户看不出来；画一块假的，他会照着它做决定。
// （详细地址原本也在这个清单里，STORE-REC-ADDRESS-001 起服务端真的存了，
//   所以它已经不是「系统里没有的东西」。）

export interface StoreRecManageTab {
  id: "mine" | "new";
  label: string;
}

export interface StoreRecommendationManageProps {
  tabs: readonly StoreRecManageTab[];
  initialTab?: "mine" | "new" | undefined;
  onOpenQueue?: (() => void) | undefined;
  onOpenStore?: (() => void) | undefined;
  // STORE-HUB-MOVE-001（用户：建店/二维码归推荐管理）：体系接入区把去建店
  // （= onOpenStore，建店流程）和店铺资料与二维码摆在一起。缺省不画。
  onOpenStoreProfile?: (() => void) | undefined;
}

const STAGE_BG: Record<RecStageState, string> = {
  done: color.proxyGreen,
  active: "#E8A23C",
  fail: color.error,
  todo: color.line
};

const STAGE_GLYPH: Record<RecStageState, string> = {
  done: "✓",
  active: "•",
  fail: "!",
  todo: "•"
};

function newClient(): StoreOnboardingClient {
  return new StoreOnboardingClient({
    authClient: sessionAuthClient,
    secureSessionStore: nativeSecureSessionStore
  });
}

export function StoreRecommendationManage({
  tabs,
  initialTab,
  onOpenQueue,
  onOpenStore,
  onOpenStoreProfile,
}: StoreRecommendationManageProps): React.JSX.Element {
  const [tab, setTab] = useState<"mine" | "new">(initialTab ?? "mine");
  const [detail, setDetail] = useState<StoreRecommendation | undefined>(undefined);
  const [rows, setRows] = useState<StoreRecommendation[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  const [draft, setDraft] = useState({ storeName: "", city: "", category: "", reason: "", address: "" });
  // STORE-REC-ADDRESS-001：地址与落点分开存。地址是文本 —— 谁都能填，
  // Android 上没有地图，手打是那条路上唯一能用的入口；落点只有地图能给。
  const [pin, setPin] = useState<{ lat: number; lng: number } | undefined>(undefined);
  const [mapOpen, setMapOpen] = useState(false);
  const [formBusy, setFormBusy] = useState(false);
  const [formError, setFormError] = useState<string | undefined>(undefined);
  const [formDone, setFormDone] = useState<string | undefined>(undefined);
  const [origin, setOrigin] = useState<"USER" | "AI">("USER");
  const [note, setNote] = useState("");
  const [aiBusy, setAiBusy] = useState(false);
  const [aiAvailable, setAiAvailable] = useState(true);
  const [aiNote, setAiNote] = useState<string | undefined>(undefined);

  const load = useCallback(async () => {
    setBusy(true);
    setError(undefined);
    try {
      setRows(await newClient().listMyRecommendations({ limit: 50 }));
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

  async function submit(): Promise<void> {
    setFormBusy(true);
    setFormError(undefined);
    setFormDone(undefined);
    try {
      await newClient().recommendStore({
        ...draft,
        origin,
        // 只有真的落了点才发坐标。半个坐标服务端会拒；而拿 0 当「没选」
        // 会把河内的店画到几内亚湾 —— 所以缺省是「不发这两个键」。
        ...(pin ? { latitude: pin.lat, longitude: pin.lng } : {})
      });
      setFormDone("推荐已提交。运营出结论后会写进这条记录，在「我推荐的店」里能看到。");
      setDraft({ storeName: "", city: "", category: "", reason: "", address: "" });
      setPin(undefined);
      setNote("");
      setAiNote(undefined);
      setOrigin("USER");
      await load();
      setTab("mine");
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "提交失败");
    } finally {
      setFormBusy(false);
    }
  }

  async function suggest(): Promise<void> {
    setAiBusy(true);
    setAiNote(undefined);
    try {
      const next = await newClient().suggestRecommendation(note);
      // 小美只整理，不落库；空字段留空让用户自己补 —— 替用户编一个城市
      // 或品类，等于把「用户没说」写成「用户说了」。
      setDraft((cur) => ({
        // 展开在前：地址与落点不归小美管 —— 它没法知道门牌号，更给不出坐标，
        // 所以这里既不覆盖也不清空用户已经填好的位置。
        ...cur,
        storeName: next.storeName || cur.storeName,
        city: next.city || cur.city,
        category: next.category || cur.category,
        reason: next.reason || cur.reason
      }));
      setOrigin("AI");
      setAiNote("已整理成草稿（提交后会记为「小美推荐」）。空着的字段它没替你编，请自己补。");
    } catch (err) {
      if (err instanceof StoreRecommendationAiUnavailableError) {
        // 这不是「这次失败」，是**这个能力当前不存在** —— 藏起来，别弹红字。
        setAiAvailable(false);
      } else {
        setAiNote(err instanceof Error ? err.message : "小美整理失败");
      }
    } finally {
      setAiBusy(false);
    }
  }

  if (detail) {
    const status = recStatus(detail);
    const stages = recStages(detail);
    // STORE-REC-ADDRESS-001：只有真的落了点才有地图链接 ——
    // 拿城市名猜一个坐标是编，点了会落到一个和这家店无关的地方。
    const mapsUrl = recMapsUrl(detail);
    return (
      <View>
        <Pressable accessibilityLabel="返回我推荐的店" onPress={() => setDetail(undefined)} style={styles.subPageBack}>
          <ProxyBackGlyph />
        </Pressable>

        <View style={[s.hero, status === "ACCEPTED" && s.heroOk, status === "REJECTED" && s.heroBad]}>
          <Text selectable style={s.heroTag}>{REC_STATUS_TEXT[status]}</Text>
          <Text selectable style={s.heroName}>{detail.storeName}</Text>
          <Text selectable style={s.heroMeta}>
            {[detail.city, detail.category].filter(Boolean).join(" · ")}
            {detail.origin === "AI" ? " · 小美推荐" : ""}
          </Text>
        </View>

        <Text selectable style={s.sectionTitle}>推荐进度</Text>
        <View style={s.timeline}>
          {stages.map((stage, index) => (
            <View key={stage.id} style={s.tlItem}>
              <View style={s.tlRail}>
                <View style={[s.tlDot, { backgroundColor: STAGE_BG[stage.state] }]}>
                  <Text selectable style={s.tlDotText}>{STAGE_GLYPH[stage.state]}</Text>
                </View>
                {index < stages.length - 1 ? (
                  <View style={[s.tlLine, { backgroundColor: STAGE_BG[stage.state] }]} />
                ) : null}
              </View>
              <View style={s.tlBody}>
                <Text selectable style={[s.tlTitle, stage.state === "todo" && s.tlTitleTodo]}>
                  {stage.label}
                </Text>
                <Text selectable style={[s.tlDesc, stage.state === "todo" && s.tlDescTodo]}>
                  {stage.desc}
                </Text>
                {stage.at ? <Text selectable style={s.tlTime}>{recMoment(stage.at)}</Text> : null}
              </View>
            </View>
          ))}
        </View>

        <Text selectable style={s.sectionTitle}>推荐信息</Text>
        <View style={s.infoList}>
          {[
            { label: "店名", value: detail.storeName },
            { label: "城市", value: detail.city || "—" },
            // STORE-REC-ADDRESS-001：没有地址但有落点时，recAddressLine 给的是
            // 坐标 —— 那时候坐标就是我们知道的最具体的东西，显示「—」等于把
            // 已经拿到的信息藏起来。
            { label: "地址", value: recAddressLine(detail) || "—" },
            { label: "品类", value: detail.category || "—" },
            { label: "推荐理由", value: detail.reason || "—" },
            { label: "提交时间", value: recMoment(detail.createdAt) },
            { label: "来源", value: detail.origin === "AI" ? "小美推荐" : "我推荐" }
          ].map((row) => (
            <View key={row.label} style={s.infoRow}>
              <Text selectable style={s.infoLabel}>{row.label}</Text>
              <Text selectable style={s.infoValue}>{row.value}</Text>
            </View>
          ))}
        </View>

        {mapsUrl ? (
          <Pressable
            onPress={() => void Linking.openURL(mapsUrl).catch(() => undefined)}
            style={[styles.appBehaviorReturn, { marginTop: 8 }]}
          >
            <Text selectable style={styles.appBehaviorReturnText}>在地图上打开这家店</Text>
          </Pressable>
        ) : null}

        {/* 结论态才有的按钮。设计稿的「撤回推荐」没有对应命令 —— 推荐记录是
            append-only，撤回等于删掉举证链，服务端不提供。所以这里不画那个按钮，
            画了就是点不动的死键。 */}
        {status === "PENDING" ? (
          <Pressable disabled={busy} onPress={() => void load()} style={[styles.appBehaviorReturn, busy && { opacity: 0.5 }]}>
            <Text selectable style={styles.appBehaviorReturnText}>{busy ? "读取中…" : "刷新进度"}</Text>
          </Pressable>
        ) : null}

        {status === "ACCEPTED" && onOpenStore ? (
          <Pressable onPress={onOpenStore} style={[styles.lightCta, { marginTop: 8 }]}>
            <Text selectable style={styles.lightCtaText}>去建店</Text>
          </Pressable>
        ) : null}

        {status === "REJECTED" ? (
          <View style={s.btnRow}>
            <Pressable
              onPress={() => {
                setDraft((cur) => ({
                  ...cur,
                  storeName: detail.storeName,
                  city: detail.city,
                  category: detail.category,
                  reason: detail.reason,
                  address: detail.address ?? ""
                }));
                // 落点一起带过去：重新推荐的是同一家店，位置没变，
                // 让用户再在地图上点一次是白费力气。
                setPin(
                  typeof detail.latitude === "number" && typeof detail.longitude === "number"
                    ? { lat: detail.latitude, lng: detail.longitude }
                    : undefined
                );
                setDetail(undefined);
                setTab("new");
                setFormDone(undefined);
                setFormError(undefined);
              }}
              style={[styles.appBehaviorReturn, s.btnHalf]}
            >
              <Text selectable style={styles.appBehaviorReturnText}>改了重新推荐</Text>
            </Pressable>
            <Pressable
              onPress={() => {
                setDraft({ storeName: "", city: "", category: "", reason: "", address: "" });
                setPin(undefined);
                setDetail(undefined);
                setTab("new");
                setFormDone(undefined);
                setFormError(undefined);
              }}
              style={[styles.lightCta, s.btnHalf]}
            >
              <Text selectable style={styles.lightCtaText}>推荐其他店</Text>
            </Pressable>
          </View>
        ) : null}
      </View>
    );
  }

  return (
    <View>
      {/* STORE-HUB-MOVE-001：体系接入行原来在「我的店铺」hub 里 —— 建店/二维码
          是把店弄进体系的动作，不是已有店铺的数据，归推荐管理。 */}
      {onOpenStore || onOpenStoreProfile ? (
        <View style={s.accessSection}>
          {onOpenStore ? (
            <Pressable accessibilityLabel="建店或添加门店" onPress={onOpenStore} style={s.accessRow}>
              <Text selectable style={s.accessText}>建店 / 添加门店</Text>
              <Text selectable style={s.accessArrow}>›</Text>
            </Pressable>
          ) : null}
          {onOpenStoreProfile ? (
            <Pressable accessibilityLabel="店铺资料与二维码" onPress={onOpenStoreProfile} style={s.accessRow}>
              <Text selectable style={s.accessText}>店铺资料与二维码</Text>
              <Text selectable style={s.accessArrow}>›</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
      <View style={s.tabBar}>
        {tabs.map((entry) => {
          const active = tab === entry.id;
          return (
            <Pressable key={entry.id} onPress={() => setTab(entry.id)} style={[s.tab, active && s.tabOn]}>
              <Text selectable style={[s.tabText, active && s.tabTextOn]}>
                {entry.label}
                {entry.id === "mine" && rows ? ` ${rows.length}` : ""}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {tab === "mine" ? (
        <MyStoreRecommendations
          busy={busy}
          error={error}
          onOpenDetail={(row) => setDetail(row)}
          onRetry={() => void load()}
          rows={rows}
        />
      ) : (
        <View>
          <View style={s.tipBox}>
            <Text selectable style={s.tipText}>{REC_TIP}</Text>
          </View>

          {aiAvailable ? (
            <View style={styles.infoNote}>
              <Text selectable style={styles.socialEditorLabel}>让小美帮你整理</Text>
              <Text selectable style={styles.appBehaviorCardDesc}>
                用一句话说说这家店（在哪儿、为什么值得进体系），小美整理成草稿，你确认后提交。
                你没提到的字段它不会瞎填。
              </Text>
              <TextInput
                multiline
                onChangeText={setNote}
                placeholder="例如：Cầu Giấy 那家 Three Beans 咖啡，适合 afterwork，老板愿意合作活动"
                style={[styles.socialEditorInput, { minHeight: 64 }]}
                value={note}
              />
              <Pressable
                disabled={aiBusy || note.trim() === ""}
                onPress={() => void suggest()}
                style={[styles.lightCta, (aiBusy || note.trim() === "") && { opacity: 0.5 }]}
              >
                <Text selectable style={styles.lightCtaText}>{aiBusy ? "小美整理中…" : "让小美整理"}</Text>
              </Pressable>
            </View>
          ) : null}
          {aiNote ? <Text selectable style={s.aiNote}>{aiNote}</Text> : null}

          <Text selectable style={styles.socialEditorLabel}>店铺名称（必填）</Text>
          <TextInput
            onChangeText={(value) => setDraft((cur) => ({ ...cur, storeName: value }))}
            placeholder="例如：Three Beans · Cầu Giấy"
            style={styles.socialEditorInput}
            value={draft.storeName}
          />

          <Text selectable style={styles.socialEditorLabel}>店铺类型</Text>
          <View style={s.typeGrid}>
            {REC_STORE_TYPES.map((type) => {
              const active = draft.category === type;
              return (
                <Pressable
                  key={type}
                  onPress={() => setDraft((cur) => ({ ...cur, category: active ? "" : type }))}
                  style={[s.typeItem, active && s.typeItemOn]}
                >
                  <Text selectable style={[s.typeText, active && s.typeTextOn]}>{type}</Text>
                </Pressable>
              );
            })}
          </View>
          <TextInput
            onChangeText={(value) => setDraft((cur) => ({ ...cur, category: value }))}
            placeholder="也可以直接写（品类是自由文本，没有枚举）"
            style={styles.socialEditorInput}
            value={draft.category}
          />

          <Text selectable style={styles.socialEditorLabel}>城市（必填）</Text>
          {/* STORE-REC-CITY-001：先给预设。手打的「河内」和「Hanoi」在服务端是两个
              城市（筛选是精确字符串相等），运营按城市一筛就静默 0 条。 */}
          <View style={s.typeGrid}>
            {REC_CITIES.map((city) => {
              const active = draft.city === city;
              return (
                <Pressable
                  key={city}
                  onPress={() => setDraft((cur) => ({ ...cur, city: active ? "" : city }))}
                  style={[s.typeItem, active && s.typeItemOn]}
                >
                  <Text selectable style={[s.typeText, active && s.typeTextOn]}>{city}</Text>
                </Pressable>
              );
            })}
          </View>
          <TextInput
            onChangeText={(value) => setDraft((cur) => ({ ...cur, city: value }))}
            placeholder="预设外的城市写在这里"
            style={styles.socialEditorInput}
            value={draft.city}
          />
          {draft.city.trim() !== "" && !recCityIsPreset(draft.city) ? (
            <View style={styles.infoNote}>
              <Text selectable style={styles.infoNoteText}>
                预设外的城市：队列按城市精确筛选，它只会出现在「全部城市」里。
              </Text>
            </View>
          ) : null}

          <Text selectable style={styles.socialEditorLabel}>地址（可选）</Text>
          {/* STORE-REC-ADDRESS-001：地址是**文本** —— Android 上没有地图
              （MapCanvas 在那边只会渲染一张静态卡片），手打是那条路上唯一能用的
              入口，所以这里不把它做成「只能选点」。地图是 iOS 上的省事路径。 */}
          <TextInput
            onChangeText={(value) => setDraft((cur) => ({ ...cur, address: value }))}
            placeholder="门牌地址，例如：12 Trần Duy Hưng, Cầu Giấy"
            style={styles.socialEditorInput}
            value={draft.address}
          />
          <Pressable onPress={() => setMapOpen(true)} style={styles.appBehaviorReturn}>
            <Text selectable style={styles.appBehaviorReturnText}>
              {pin ? "重新在地图上选点" : "在地图上选点"}
            </Text>
          </Pressable>
          {pin ? (
            <View style={styles.infoNote}>
              <Text selectable style={styles.infoNoteText}>
                已落点 {pin.lat.toFixed(5)}, {pin.lng.toFixed(5)} —— 提交后运营能直接在地图上打开这家店。
              </Text>
            </View>
          ) : null}

          <Text selectable style={styles.socialEditorLabel}>为什么推荐它进体系（必填）</Text>
          <TextInput
            multiline
            onChangeText={(value) => setDraft((cur) => ({ ...cur, reason: value }))}
            placeholder="例如：适合聊天与 Afterwork 场景，老板愿意合作活动"
            style={[styles.socialEditorInput, { minHeight: 88 }]}
            value={draft.reason}
          />

          <View style={styles.infoNote}>
            <Text selectable style={styles.infoNoteText}>{REC_UNCOLLECTED_NOTE}</Text>
          </View>

          {formError ? <Text selectable style={s.error}>{formError}</Text> : null}
          {formDone ? <Text selectable style={s.done}>{formDone}</Text> : null}

          <Pressable
            disabled={formBusy}
            onPress={() => void submit()}
            style={[styles.lightCta, formBusy && { opacity: 0.5 }]}
          >
            <Text selectable style={styles.lightCtaText}>
              {formBusy ? "提交中…" : origin === "AI" ? "以小美推荐提交" : "提交推荐"}
            </Text>
          </Pressable>

          {/* STORE-REC-ADDRESS-001：地图选点。cityHint 只用来定初始视野 ——
              还没选城市时它是空串，地图给全国视野，比硬套一个「河内」诚实。 */}
          <StoreAddressSheet
            baseUrl={localApiBaseUrl}
            cityHint={draft.city}
            initial={pin}
            onClose={() => setMapOpen(false)}
            onConfirm={(next: PickedStoreAddress) => {
              setPin({ lat: next.lat, lng: next.lng });
              // 解析出来的地址填进输入框，但用户可以改 —— 逆编码给的可能是
              // 附近的 POI 名，不是门牌号。
              if (next.address.trim()) {
                setDraft((cur) => ({ ...cur, address: next.address.trim() }));
              }
              setMapOpen(false);
            }}
            open={mapOpen}
          />
        </View>
      )}

      {onOpenQueue ? (
        <Pressable onPress={onOpenQueue} style={[styles.appBehaviorReturn, { marginTop: 14 }]}>
          <Text selectable style={styles.appBehaviorReturnText}>推荐评估队列（需运营权限）</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  accessSection: { gap: 8, marginBottom: 4 },
  accessRow: { alignItems: "center", backgroundColor: color.white, borderColor: color.line, borderRadius: 14, borderWidth: 1, flexDirection: "row", justifyContent: "space-between", paddingHorizontal: 14, paddingVertical: 13 },
  accessText: { color: color.ink, fontSize: 13, fontWeight: "800" },
  accessArrow: { color: color.muted, fontSize: 18, fontWeight: "800" },
  tabBar: {
    backgroundColor: color.surface,
    borderRadius: 14,
    flexDirection: "row",
    gap: 4,
    marginTop: 12,
    padding: 4
  },
  tab: { alignItems: "center", borderRadius: 11, flex: 1, paddingVertical: 10 },
  tabOn: { backgroundColor: color.white },
  tabText: { color: color.muted, fontSize: 12, fontWeight: "900" },
  tabTextOn: { color: color.ink },

  hero: {
    backgroundColor: color.ink,
    borderRadius: 20,
    marginTop: 8,
    padding: 20
  },
  heroOk: { backgroundColor: "#14351F" },
  heroBad: { backgroundColor: "#3A1E1E" },
  heroTag: {
    alignSelf: "flex-start",
    backgroundColor: color.lime,
    borderRadius: 7,
    color: color.ink,
    fontSize: 11,
    fontWeight: "900",
    overflow: "hidden",
    paddingHorizontal: 9,
    paddingVertical: 4
  },
  heroName: { color: color.white, fontSize: 22, fontWeight: "900", lineHeight: 28, marginTop: 12 },
  heroMeta: { color: color.darkCardText, fontSize: 12, fontWeight: "600", marginTop: 6 },

  sectionTitle: { color: color.ink, fontSize: 13, fontWeight: "900", marginTop: 18, marginBottom: 8 },
  timeline: {
    backgroundColor: color.white,
    borderColor: color.line,
    borderRadius: 18,
    borderWidth: 1,
    padding: 16
  },
  tlItem: { flexDirection: "row", gap: 12 },
  tlRail: { alignItems: "center", width: 26 },
  tlDot: { alignItems: "center", borderRadius: 999, height: 24, justifyContent: "center", width: 24 },
  tlDotText: { color: color.white, fontSize: 12, fontWeight: "900" },
  tlLine: { borderRadius: 1, flex: 1, marginVertical: 4, width: 2 },
  tlBody: { flex: 1, paddingBottom: 18 },
  tlTitle: { color: color.ink, fontSize: 13, fontWeight: "900", lineHeight: 17 },
  tlTitleTodo: { color: color.muted },
  tlDesc: { color: color.muted, fontSize: 11, fontWeight: "600", lineHeight: 16, marginTop: 3 },
  tlDescTodo: { color: color.brandSmall },
  tlTime: { color: color.brandSmall, fontSize: 11, fontWeight: "700", marginTop: 4 },

  infoList: {
    backgroundColor: color.white,
    borderColor: color.line,
    borderRadius: 18,
    borderWidth: 1,
    overflow: "hidden"
  },
  infoRow: {
    borderBottomColor: color.line,
    borderBottomWidth: 1,
    flexDirection: "row",
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 12
  },
  infoLabel: { color: color.muted, fontSize: 11, fontWeight: "800", width: 64 },
  infoValue: { color: color.ink, flex: 1, fontSize: 12, fontWeight: "700", lineHeight: 18 },

  btnRow: { flexDirection: "row", gap: 10, marginTop: 10 },
  btnHalf: { flex: 1 },

  tipBox: {
    backgroundColor: "#F6FBE4",
    borderColor: "#DCE9AE",
    borderRadius: 14,
    borderWidth: 1,
    marginTop: 12,
    padding: 13
  },
  tipText: { color: "#4A5C00", fontSize: 11, fontWeight: "700", lineHeight: 17 },

  typeGrid: { flexDirection: "row", flexWrap: "wrap", gap: 9, marginBottom: 9 },
  typeItem: {
    alignItems: "center",
    backgroundColor: color.white,
    borderColor: color.line,
    borderRadius: 13,
    borderWidth: 1.5,
    paddingVertical: 12,
    width: "31%"
  },
  typeItemOn: { backgroundColor: "#F6FBE4", borderColor: color.ink },
  typeText: { color: color.ink, fontSize: 11, fontWeight: "800" },
  typeTextOn: { fontWeight: "900" },

  aiNote: { color: "#0F7A3D", fontSize: 12, marginTop: 8 },
  error: { color: color.error, fontSize: 12, marginTop: 8 },
  done: { color: "#0F7A3D", fontSize: 12, marginTop: 8 }
});

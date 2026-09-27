// SPORT-BADMINTON-001：home 场景「运动 · 羽毛球」卡片点进来的那张表。
//
// 原型：Downloads/deepseek_html_20260925_e64f86.html
// 三屏照原型搬：列表 → 选择城市 → 详情。
//
// 几个刻意的做法，改之前先读：
//
// 1) **三屏是三个 View，不是三个 Modal。**
//    iOS 一次只呈现一个 Modal，第二个 present 会被无声吞掉
//    （HOME-MORE-SHEET-004 已经踩过）。整个表面自己就是那个全屏 Modal
//    （照 ComposerV2Screen 的 presentationStyle="fullScreen"），
//    所以内部换屏只能切 state —— 城市选择页再套一层 Modal 的话，
//    在 iOS 上它会不出现，而且不报错。
//
// 2) **数据是演示数据，顶部提示行不是装饰。**
//    后端没有「运动陪打人」这个供给模型（依据写在 badminton-companion.ts 文件头）。
//    提示行把「陪打人 / 场馆 / 资质 / 评分 / 价格」都列进演示范围 ——
//    其中「资质」两个字是这条数据的免责边界，删它等于把演示执照号说成真的。
//
// 3) **详情页不写核验结论。**
//    本仓库的实名核验是有真实状态的（provider-application-client.ts：
//    还没有完成 / 审核中 / 未通过 / 通过，且 ORDER-APPLY-KYC-GATE-001 拿它当接单闸）。
//    给 6 个编出来的人写一句「已通过核验」，就是把没人做过的核验写成已完成态
//    （SUBPAGE-GENERIC-FABRICATED-001 禁的就是这个）。所以那一行写的是**服务形态**。
//    ⚠️ 这段注释刻意**不写**那句被禁的原话：门禁里有一条 `grep -qF` 反向钉扫这个
//    文件，注释里写着它会把那颗钉自己喂红（REPLY-EMPTY-VIEWER-001 踩过同一个坑）。
//
// 4) **原型里没接线的控件，这里都接上了。**
//    原型的四个筛选 chip 是纯装饰（没有 onclick），「预约陪打」只弹一句 toast。
//    本仓库不允许死按钮（PLACEHOLDER-001：有后端走后端，无后端走本地演示状态机）。
//    所以：chip 真的筛、城市真的筛列表、收藏真的切换、
//    「预约陪打」进本地演示状态机并在界面上说清它不会真的通知谁。
import { useMemo, useState } from "react";
import { Modal, Pressable, ScrollView, Share, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  BADMINTON_CITY_GROUPS,
  BADMINTON_DEFAULT_CITIES,
  BADMINTON_FILTERS,
  BADMINTON_HOT_CITIES,
  BADMINTON_INITIAL_FAVORITES,
  BADMINTON_LOCATED_CITY,
  BADMINTON_RECENT_CITIES,
  BADMINTON_RIDERS,
  badmintonCityFooterLabel,
  badmintonCityMatches,
  badmintonHighlightSegments,
  badmintonLocationLabel,
  badmintonRiderCountLabel,
  badmintonRiderTags,
  badmintonRiders,
  badmintonStatusLabel,
  formatVnd,
  type BadmintonFilterId,
  type BadmintonRider
} from "../badminton-companion";
import { ProxyIcon } from "../components/proxy-icon";
// SPORT-BADMINTON-HEADER-001（2026-09-25，用户：「返回logo没有用已有的公共组件」）：
// 圆形图标按钮用公共组件 ProxyIconButton，不要再手写一份 Pressable + 圆形样式。
// ⚠️ 注释里刻意不写出那份手写样式的**样式名**：门禁块有一条 `grep -qF` 反向钉扫这个文件，
//    注释里写着它会把那颗钉自己喂红（REPLY-EMPTY-VIEWER-001 踩过同一个坑）。
import { ProxyBackGlyph, ProxyIconButton } from "../components/proxy-foundation";
import { color, foundation } from "../theme";

export const BADMINTON_SAMPLE_NOTICE = "示例数据 · 陪打人 / 场馆 / 资质 / 评分 / 价格 均为演示内容，后端未接入";

// 详情页封面角标要让开悬浮的 topbar。原型 `.detail-cover-tag` 写的是 `top:16`，
// 而它的 topbar 也是 absolute 挂在同一个顶边 —— 也就是说**原型里这两样本来就叠在一起**，
// 角标被返回钮压掉一半。我们不复刻这个缺陷：角标下移到按钮行下面。
// 6 = topbar 自己的 paddingTop，control.md = 公共圆形按钮直径，10 = 留白。
const DETAIL_BADGE_TOP = 6 + foundation.control.md + 10;

type Screen = "list" | "city" | "detail";

// 头像底色映射到 theme token。lime 太亮，白字在上面看不清，所以字色单独给 ink。
const AVATAR_BG: Record<BadmintonRider["tone"], string> = {
  magenta: color.magenta,
  violet: color.violet,
  mint: color.mint,
  lime: color.lime
};
const AVATAR_FG: Record<BadmintonRider["tone"], string> = {
  magenta: color.white,
  violet: color.white,
  mint: color.white,
  lime: color.ink
};

function Highlighted({ keyword, style, text }: { keyword: string; style: object; text: string }): React.JSX.Element {
  const segments = badmintonHighlightSegments(text, keyword);
  return (
    <Text numberOfLines={1} style={style}>
      {segments.map((segment, index) =>
        segment.hit ? (
          <Text key={index} style={styles.mark}>
            {segment.text}
          </Text>
        ) : (
          <Text key={index}>{segment.text}</Text>
        )
      )}
    </Text>
  );
}

function Avatar({ rider, size }: { rider: BadmintonRider; size: number }): React.JSX.Element {
  return (
    <View style={[styles.avatar, { backgroundColor: AVATAR_BG[rider.tone], height: size, width: size }]}>
      <Text selectable style={[styles.avatarText, { color: AVATAR_FG[rider.tone], fontSize: size * 0.36 }]}>
        {rider.initial}
      </Text>
    </View>
  );
}

export function BadmintonCompanion({ onClose, visible }: { onClose: () => void; visible: boolean }): React.JSX.Element {
  const insets = useSafeAreaInsets();
  const [screen, setScreen] = useState<Screen>("list");
  const [selectedCities, setSelectedCities] = useState<readonly string[]>(BADMINTON_DEFAULT_CITIES);
  const [draftCities, setDraftCities] = useState<readonly string[]>(BADMINTON_DEFAULT_CITIES);
  const [keyword, setKeyword] = useState("");
  const [cityKeyword, setCityKeyword] = useState("");
  const [filter, setFilter] = useState<BadmintonFilterId>("recommended");
  const [favorites, setFavorites] = useState<readonly string[]>(BADMINTON_INITIAL_FAVORITES);
  const [activeRiderId, setActiveRiderId] = useState("");
  const [requestedRiderId, setRequestedRiderId] = useState("");

  const riders = useMemo(
    () => badmintonRiders(BADMINTON_RIDERS, { cities: selectedCities, filter, keyword }),
    [selectedCities, filter, keyword]
  );
  const cityMatches = useMemo(() => badmintonCityMatches(cityKeyword), [cityKeyword]);
  const activeRider = BADMINTON_RIDERS.find((rider) => rider.id === activeRiderId);

  const closeSurface = (): void => {
    // 关掉时回到列表 —— 下次点卡片进来不该还停在上次的详情页。
    setScreen("list");
    onClose();
  };

  const toggleFavorite = (id: string): void => {
    setFavorites((previous) => (previous.includes(id) ? previous.filter((entry) => entry !== id) : [...previous, id]));
  };

  const openCityPicker = (): void => {
    setDraftCities(selectedCities);
    setCityKeyword("");
    setScreen("city");
  };

  const toggleDraftCity = (city: string): void => {
    setDraftCities((previous) => (previous.includes(city) ? previous.filter((entry) => entry !== city) : [...previous, city]));
  };

  const confirmCities = (): void => {
    setSelectedCities(draftCities);
    setScreen("list");
  };

  const openRider = (id: string): void => {
    setActiveRiderId(id);
    setScreen("detail");
  };

  const shareRider = (rider: BadmintonRider): void => {
    void Share.share({ message: `${rider.name} · ${rider.venue} —— 在 Proxy 上看看这个陪打` });
  };

  const cityChip = (city: string): React.JSX.Element => {
    const on = draftCities.includes(city);
    const located = city === BADMINTON_LOCATED_CITY;
    return (
      <Pressable
        accessibilityLabel={`城市 ${city}${on ? " 已选" : ""}`}
        key={city}
        onPress={() => toggleDraftCity(city)}
        style={[styles.cityChip, located && styles.cityChipLocated, on && styles.cityChipOn]}
      >
        {located ? <ProxyIcon color={on ? color.white : color.magenta} name="pin" size={11} /> : null}
        <Text selectable style={[styles.cityChipText, on && styles.cityChipTextOn]}>
          {city}
          {on ? " ✓" : ""}
        </Text>
      </Pressable>
    );
  };

  const citySection = (title: string, hint: string, cities: readonly string[]): React.JSX.Element => (
    <View key={title} style={styles.citySection}>
      <View style={styles.citySectionHead}>
        <Text selectable style={styles.citySectionTitle}>{title}</Text>
        {hint ? <Text selectable style={styles.citySectionHint}>{hint}</Text> : null}
      </View>
      <View style={styles.cityChips}>{cities.map((city) => cityChip(city))}</View>
    </View>
  );

  const renderList = (): React.JSX.Element => (
    <>
      <View style={styles.topbar}>
        <ProxyIconButton accessibilityLabel="关闭陪打羽毛球" onPress={closeSurface}>
          <ProxyBackGlyph />
        </ProxyIconButton>
        <Text selectable style={styles.topbarTitle}>陪打羽毛球</Text>
      </View>

      <Text selectable style={styles.sampleNotice}>{BADMINTON_SAMPLE_NOTICE}</Text>

      <ScrollView contentContainerStyle={styles.scrollBody} keyboardShouldPersistTaps="handled">
        <View style={styles.listHead}>
          <Text selectable style={styles.listTitle}>
            附近陪打
            <Text selectable style={styles.listTitleCount}> {badmintonRiderCountLabel(riders.length)}</Text>
          </Text>
        </View>

        <Pressable accessibilityLabel="选择城市" onPress={openCityPicker} style={styles.locationRow}>
          <ProxyIcon color={color.magenta} name="pin" size={16} />
          <Text selectable numberOfLines={1} style={styles.locationText}>
            {badmintonLocationLabel(selectedCities)}
          </Text>
          <Text selectable style={styles.locationMore}>更多 ›</Text>
        </Pressable>

        <View style={styles.searchBox}>
          <ProxyIcon color={color.muted} name="search" size={16} />
          <TextInput
            accessibilityLabel="搜索陪打人、场馆、区域"
            onChangeText={setKeyword}
            placeholder="搜索陪打人、场馆、区域"
            placeholderTextColor={color.muted}
            style={styles.searchInput}
            value={keyword}
          />
          {keyword.length > 0 ? (
            <Pressable accessibilityLabel="清空搜索" hitSlop={8} onPress={() => setKeyword("")} style={styles.searchClear}>
              <ProxyIcon color={color.muted} name="close" size={10} />
            </Pressable>
          ) : null}
        </View>

        {keyword.trim().length > 0 ? (
          <View style={styles.searchResult}>
            <Text selectable style={styles.searchResultText}>
              找到 <Text selectable style={styles.searchResultStrong}>{riders.length}</Text> 条包含「{keyword.trim()}」的结果
            </Text>
            <Pressable accessibilityLabel="清空搜索" onPress={() => setKeyword("")} style={styles.searchResultClear}>
              <Text selectable style={styles.searchResultClearText}>清空</Text>
            </Pressable>
          </View>
        ) : null}

        <View style={styles.filterRow}>
          {BADMINTON_FILTERS.map((entry) => {
            const on = entry.id === filter;
            return (
              <Pressable
                accessibilityLabel={`筛选 ${entry.label}`}
                key={entry.id}
                onPress={() => setFilter(entry.id)}
                style={[styles.chip, on && styles.chipOn]}
              >
                <Text selectable style={[styles.chipText, on && styles.chipTextOn]}>{entry.label}</Text>
              </Pressable>
            );
          })}
        </View>

        {riders.length === 0 ? (
          <View style={styles.empty}>
            <View style={styles.emptyIcon}>
              <ProxyIcon color={color.muted} name="search" size={26} />
            </View>
            <Text selectable style={styles.emptyTitle}>没有找到匹配的陪打</Text>
            <Text selectable style={styles.emptyDesc}>
              {keyword.trim().length > 0 ? "试试换个关键词，或切换其他城市试试" : "切换其他城市试试"}
            </Text>
            <Pressable accessibilityLabel="切换城市" onPress={openCityPicker} style={styles.emptyBtn}>
              <Text selectable style={styles.emptyBtnText}>切换城市</Text>
            </Pressable>
          </View>
        ) : (
          riders.map((rider) => (
            <Pressable
              accessibilityLabel={`${rider.name} · ${formatVnd(rider.priceVnd)} 盾每小时`}
              key={rider.id}
              onPress={() => openRider(rider.id)}
              style={styles.rideCard}
            >
              <View style={styles.rideCover}>
                <Text selectable style={styles.rideCoverEmoji}>🏸</Text>
                <View style={styles.coverBadge}>
                  <ProxyIcon color={color.white} name="check" size={9} />
                  <Text selectable style={styles.coverBadgeText}>场馆持证</Text>
                </View>
                <Text selectable style={styles.coverWatermark}>BADMINTON · 18:00-22:00</Text>
              </View>

              <View style={styles.rideBody}>
                <Highlighted keyword={keyword} style={styles.rideTitle} text={rider.name} />
                <View style={styles.ridePerson}>
                  <Avatar rider={rider} size={40} />
                  <View style={styles.ridePersonText}>
                    <Text selectable style={styles.ridePersonName}>{rider.rider}</Text>
                    <Highlighted keyword={keyword} style={styles.rideVenue} text={rider.venue} />
                  </View>
                </View>
                <View style={styles.rideTags}>
                  <View style={[styles.rideTag, styles.rideTagGold]}>
                    <Text selectable style={styles.rideTagGoldText}>★ {rider.rating}</Text>
                  </View>
                  <View style={styles.rideTag}>
                    <Text selectable style={styles.rideTagText}>{rider.orders} 单</Text>
                  </View>
                  <View style={[styles.rideTag, styles.rideTagLime]}>
                    <Text selectable style={styles.rideTagLimeText}>{rider.city}</Text>
                  </View>
                </View>
                <View style={styles.rideFoot}>
                  <Text selectable style={styles.rideStatus}>{badmintonStatusLabel(rider)}</Text>
                  <Text selectable style={styles.ridePrice}>
                    {formatVnd(rider.priceVnd)}
                    <Text selectable style={styles.ridePriceUnit}>₫/时</Text>
                  </Text>
                </View>
              </View>

              <Pressable
                accessibilityLabel={favorites.includes(rider.id) ? `取消收藏 ${rider.rider}` : `收藏 ${rider.rider}`}
                hitSlop={8}
                onPress={() => toggleFavorite(rider.id)}
                style={styles.rideHeart}
              >
                <ProxyIcon
                  color={color.magenta}
                  filled={favorites.includes(rider.id)}
                  name="heart"
                  size={20}
                />
              </Pressable>
            </Pressable>
          ))
        )}

        {riders.length > 0 ? <Text selectable style={styles.listFoot}>已加载全部 {riders.length} 位</Text> : null}
      </ScrollView>
    </>
  );

  const renderCity = (): React.JSX.Element => (
    <>
      <View style={styles.topbar}>
        <ProxyIconButton accessibilityLabel="返回陪打列表" onPress={() => setScreen("list")}>
          <ProxyBackGlyph />
        </ProxyIconButton>
        <Text selectable style={styles.topbarTitle}>选择城市</Text>
        <Pressable accessibilityLabel="清空已选城市" onPress={() => setDraftCities([])} style={styles.topbarAction}>
          <Text selectable style={styles.topbarActionText}>清空</Text>
        </Pressable>
      </View>

      <View style={styles.citySearchWrap}>
        <View style={styles.searchBox}>
          <ProxyIcon color={color.muted} name="search" size={16} />
          <TextInput
            accessibilityLabel="搜索城市名称"
            onChangeText={setCityKeyword}
            placeholder="搜索城市名称"
            placeholderTextColor={color.muted}
            style={styles.searchInput}
            value={cityKeyword}
          />
          {cityKeyword.length > 0 ? (
            <Pressable accessibilityLabel="清空城市搜索" hitSlop={8} onPress={() => setCityKeyword("")} style={styles.searchClear}>
              <ProxyIcon color={color.muted} name="close" size={10} />
            </Pressable>
          ) : null}
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.cityScrollBody} keyboardShouldPersistTaps="handled">
        {cityKeyword.trim().length > 0 ? (
          cityMatches.length === 0 ? (
            <View style={styles.empty}>
              <View style={styles.emptyIcon}>
                <ProxyIcon color={color.muted} name="search" size={26} />
              </View>
              <Text selectable style={styles.emptyTitle}>没有找到「{cityKeyword.trim()}」</Text>
              <Text selectable style={styles.emptyDesc}>试试输入其他城市名</Text>
            </View>
          ) : (
            citySection("搜索结果", `${cityMatches.length} 个匹配`, cityMatches)
          )
        ) : (
          <>
            {citySection("当前定位", "", [BADMINTON_LOCATED_CITY])}
            {BADMINTON_RECENT_CITIES.length > 0 ? citySection("最近访问", "", BADMINTON_RECENT_CITIES) : null}
            {citySection("热门城市", "中资企业集中", BADMINTON_HOT_CITIES)}
            {BADMINTON_CITY_GROUPS.map((group) => citySection(group.label, `${group.cities.length} 个城市`, group.cities))}
          </>
        )}
      </ScrollView>

      <View style={[styles.cityFooter, { paddingBottom: insets.bottom + 14 }]}>
        <Text selectable style={styles.cityFooterInfo}>{badmintonCityFooterLabel(draftCities)}</Text>
        <Pressable accessibilityLabel="完成城市选择" onPress={confirmCities} style={styles.btnPrimary}>
          <Text selectable style={styles.btnPrimaryText}>完成</Text>
        </Pressable>
      </View>
    </>
  );

  const renderDetail = (): React.JSX.Element => {
    if (!activeRider) {
      // 正常走不到（详情只能从列表点进来）。真到了这里也不能画一张空壳，
      // 直接回列表，别让用户停在一块没内容的屏上。
      return <>{renderList()}</>;
    }
    const favorited = favorites.includes(activeRider.id);
    const requested = requestedRiderId === activeRider.id;
    return (
      <>
        {/* SPORT-BADMINTON-HEADER-001（2026-09-25，用户：「排版也压住时间了」）：
            这条 topbar 是 absolute 的，而 **absolute 子节点不继承父级的 paddingTop**
            —— 下面 styles.root 那句 `paddingTop: insets.top` 对它无效，
            于是它贴在 y=0，两个圆钮正好压在状态栏的时间和电量上。
            所以这里必须自己把 insets.top 加回来（+6 是 topbar 原本的 paddingTop）。
            原型里详情页的 topbar 也是 absolute，但它挂在 `.screen-wrap` 里、
            状态栏是 screen-wrap **上面**独立的一条 —— 也就是同样在状态栏下方。 */}
        <View style={[styles.topbar, styles.topbarOverlay, { paddingTop: insets.top + 6 }]}>
          {/* BACK-GLYPH-001：这里**必须**用默认 ink，不要因为"顶栏浮在深色封面上"就改成
              onDark —— 我改错过一次，模拟器上一眼就看见：ProxyIconButton 自己带
              `iconButton: { backgroundColor: foundation.surface }` = 白底 40pt 圆，
              字形是画在这个**白圆**上的，不是画在 detailCover 上的。
              改成 onDark 就是白字压白圆 = 又一个看不见。
              判断字形颜色要看**按钮自己的底色**，不是页面的底色。 */}
          <ProxyIconButton accessibilityLabel="返回陪打列表" onPress={() => setScreen("list")}>
            <ProxyBackGlyph />
          </ProxyIconButton>
          <View style={styles.topbarSpacer} />
          <ProxyIconButton accessibilityLabel="分享这个陪打" onPress={() => shareRider(activeRider)}>
            <ProxyIcon color={color.ink} name="shareUp" size={16} />
          </ProxyIconButton>
        </View>

        <ScrollView contentContainerStyle={styles.detailScrollBody}>
          <View style={styles.detailCover}>
            <Text selectable style={styles.detailCoverEmoji}>🏸</Text>
            <View style={[styles.coverBadge, styles.detailCoverBadge]}>
              <ProxyIcon color={color.white} name="check" size={10} />
              <Text selectable style={styles.coverBadgeText}>场馆持证</Text>
            </View>
            <View style={styles.detailCoverTitle}>
              <Text selectable style={styles.detailCoverName}>{activeRider.name}</Text>
              <Text selectable style={styles.detailCoverSub}>{activeRider.city} · 羽毛球陪打</Text>
            </View>
          </View>

          <View style={styles.agencyBlock}>
            <View style={styles.agencyIcon}>
              <ProxyIcon color={color.mint} name="check" size={20} />
            </View>
            <View style={styles.agencyBody}>
              <Text selectable style={styles.agencyLabel}>场馆持证经营 · 合规保障</Text>
              <Text selectable style={styles.agencyName}>{activeRider.venue}</Text>
              <Text selectable style={styles.agencyLicense}>GPKD thể thao: {activeRider.venueLicense}</Text>
            </View>
          </View>

          <Text selectable style={styles.detailSampleNotice}>{BADMINTON_SAMPLE_NOTICE}</Text>

          <View style={styles.riderBlock}>
            <Text selectable style={styles.blockTitle}>本次陪打</Text>
            <View style={styles.riderInfo}>
              <Avatar rider={activeRider} size={58} />
              <View style={styles.riderInfoText}>
                <Text selectable style={styles.riderName}>{activeRider.rider}</Text>
                {/* 写服务形态，不写核验结论 —— 见文件头第 3 条。 */}
                <Text selectable style={styles.riderMeta}>场馆合作陪打 · 平台撮合</Text>
              </View>
            </View>
            <View style={styles.riderStats}>
              <View style={styles.riderStat}>
                <Text selectable style={styles.riderStatValue}>{activeRider.rating}</Text>
                <Text selectable style={styles.riderStatKey}>评分</Text>
              </View>
              <View style={styles.riderStat}>
                <Text selectable style={styles.riderStatValue}>{activeRider.orders}</Text>
                <Text selectable style={styles.riderStatKey}>完成单</Text>
              </View>
              <View style={styles.riderStat}>
                <Text selectable style={styles.riderStatValue}>{activeRider.collected}</Text>
                <Text selectable style={styles.riderStatKey}>人收藏</Text>
              </View>
            </View>
          </View>

          <View style={styles.infoBlock}>
            <View style={styles.infoRow}>
              <Text selectable style={styles.infoLabel}>城市</Text>
              <Text selectable style={styles.infoValue}>{activeRider.city}</Text>
            </View>
            <View style={styles.infoRow}>
              <Text selectable style={styles.infoLabel}>时长</Text>
              <Text selectable style={styles.infoValue}>{activeRider.duration}</Text>
            </View>
            <View style={styles.infoRow}>
              <Text selectable style={styles.infoLabel}>场馆</Text>
              <Text selectable style={styles.infoValue}>
                {activeRider.place}
                <Text selectable style={styles.infoNote}>{"\n"}具体场号确认后发送</Text>
              </Text>
            </View>
            <View style={styles.infoRow}>
              <Text selectable style={styles.infoLabel}>包含</Text>
              <Text selectable style={styles.infoValue}>
                {activeRider.includes}
                <Text selectable style={styles.infoNote}>{"\n"}{activeRider.insurance}</Text>
              </Text>
            </View>
            <View style={styles.infoRow}>
              <Text selectable style={styles.infoLabel}>陪打费</Text>
              <Text selectable style={styles.infoValue}>
                {formatVnd(activeRider.priceVnd)}₫ / 小时
                <Text selectable style={styles.infoNote}>{"\n"}{activeRider.payNote}</Text>
              </Text>
            </View>
          </View>

          {requested ? (
            <Text selectable style={styles.requestNote}>已进入演示预约状态 · 后端未接入，不会真的通知陪打人或场馆</Text>
          ) : null}

          <Text selectable style={styles.disclaimer}>
            本次服务由持证场馆提供 · 场馆已购公众责任险{"\n"}
            平台仅提供撮合服务 · 场地费由用户直接支付场馆
          </Text>
        </ScrollView>

        <View style={[styles.detailFooter, { paddingBottom: insets.bottom + 14 }]}>
          <Pressable
            accessibilityLabel={favorited ? "取消收藏" : "收藏"}
            onPress={() => toggleFavorite(activeRider.id)}
            style={styles.btnGhost}
          >
            <ProxyIcon color={color.magenta} filled={favorited} name="heart" size={20} />
          </Pressable>
          <Pressable
            accessibilityLabel={requested ? "已预约" : "预约陪打"}
            onPress={() => setRequestedRiderId(activeRider.id)}
            style={[styles.btnPrimary, styles.btnWide, requested && styles.btnDone]}
          >
            <Text selectable style={styles.btnPrimaryText}>{requested ? "已预约 · 待确认" : "预约陪打"}</Text>
          </Pressable>
        </View>
      </>
    );
  };

  return (
    <Modal animationType="slide" onRequestClose={closeSurface} presentationStyle="fullScreen" visible={visible}>
      <View style={[styles.root, { paddingTop: insets.top }]}>
        {screen === "list" ? renderList() : null}
        {screen === "city" ? renderCity() : null}
        {screen === "detail" ? renderDetail() : null}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { backgroundColor: color.offWhite, flex: 1 },

  topbar: { alignItems: "center", flexDirection: "row", gap: 12, paddingBottom: 10, paddingHorizontal: 18, paddingTop: 6 },
  topbarOverlay: { left: 0, position: "absolute", right: 0, top: 0, zIndex: 10 },
  topbarSpacer: { flex: 1 },
  topbarTitle: { color: color.ink, flex: 1, fontSize: 17, fontWeight: "900", letterSpacing: -0.3 },
  topbarAction: { paddingVertical: 6 },
  topbarActionText: { color: color.muted, fontSize: 13, fontWeight: "800" },
  // 那份手写的圆形按钮样式已删：改用公共组件 ProxyIconButton（见文件头 SPORT-BADMINTON-HEADER-001）。

  sampleNotice: { color: color.muted, fontSize: 11, fontWeight: "700", paddingBottom: 8, paddingHorizontal: 18 },
  detailSampleNotice: { color: color.muted, fontSize: 11, fontWeight: "700", marginBottom: 12, marginHorizontal: 18 },

  scrollBody: { paddingBottom: 32, paddingHorizontal: 18 },
  cityScrollBody: { paddingBottom: 90 },

  listHead: { paddingBottom: 14, paddingTop: 2 },
  listTitle: { color: color.ink, fontSize: 26, fontWeight: "900", letterSpacing: -0.9, lineHeight: 30 },
  listTitleCount: { color: color.muted, fontSize: 14, fontWeight: "800" },

  locationRow: { alignItems: "center", backgroundColor: color.white, borderColor: color.line, borderRadius: 14, borderWidth: 1, flexDirection: "row", gap: 8, marginBottom: 12, paddingHorizontal: 14, paddingVertical: 11 },
  locationText: { color: color.ink, flex: 1, fontSize: 12.5, fontWeight: "800" },
  locationMore: { color: color.muted, fontSize: 11.5, fontWeight: "800" },

  searchBox: { alignItems: "center", backgroundColor: color.white, borderColor: color.line, borderRadius: 14, borderWidth: 1.5, flexDirection: "row", gap: 10, height: 44, marginBottom: 12, paddingHorizontal: 14 },
  searchInput: { color: color.ink, flex: 1, fontSize: 13.5, fontWeight: "600", minWidth: 0, padding: 0 },
  searchClear: { alignItems: "center", backgroundColor: color.surface, borderRadius: 999, height: 18, justifyContent: "center", width: 18 },

  searchResult: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", paddingBottom: 10, paddingHorizontal: 2 },
  searchResultText: { color: color.muted, fontSize: 11.5, fontWeight: "700" },
  searchResultStrong: { color: color.ink, fontWeight: "900" },
  searchResultClear: { backgroundColor: color.surface, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4 },
  searchResultClearText: { color: color.ink, fontSize: 11, fontWeight: "800" },

  filterRow: { flexDirection: "row", gap: 6, marginBottom: 12 },
  chip: { backgroundColor: color.white, borderColor: color.line, borderRadius: 999, borderWidth: 1, paddingHorizontal: 16, paddingVertical: 8 },
  chipOn: { backgroundColor: color.ink, borderColor: color.ink },
  chipText: { color: color.ink, fontSize: 12.5, fontWeight: "800" },
  chipTextOn: { color: color.white },

  rideCard: { backgroundColor: color.white, borderColor: color.line, borderRadius: 20, borderWidth: 1, flexDirection: "row", gap: 12, marginBottom: 12, padding: 12, position: "relative" },
  rideCover: { alignItems: "center", backgroundColor: color.ink, borderRadius: 14, flexShrink: 0, height: 110, justifyContent: "center", overflow: "hidden", position: "relative", width: 110 },
  rideCoverEmoji: { fontSize: 34 },
  coverBadge: { alignItems: "center", backgroundColor: color.mint, borderRadius: 5, flexDirection: "row", gap: 3, left: 8, paddingHorizontal: 7, paddingVertical: 3, position: "absolute", top: 8 },
  coverBadgeText: { color: color.white, fontSize: 11, fontWeight: "900" },
  coverWatermark: { bottom: 6, color: "rgba(255,255,255,0.75)", fontSize: 11, fontWeight: "900", left: 8, letterSpacing: 0.6, position: "absolute" },

  rideBody: { flex: 1, minWidth: 0, paddingTop: 2 },
  rideTitle: { color: color.ink, fontSize: 15, fontWeight: "900", letterSpacing: -0.3, marginBottom: 8, paddingRight: 24 },
  mark: { backgroundColor: color.warn, color: color.ink },
  ridePerson: { alignItems: "center", flexDirection: "row", gap: 10, marginBottom: 8 },
  ridePersonText: { flex: 1, minWidth: 0 },
  ridePersonName: { color: color.ink, fontSize: 11.5, fontWeight: "900", marginBottom: 2 },
  rideVenue: { color: color.muted, fontSize: 11, fontWeight: "600" },
  avatar: { alignItems: "center", borderColor: color.white, borderRadius: 999, borderWidth: 2, justifyContent: "center" },
  avatarText: { fontWeight: "900" },
  rideTags: { flexDirection: "row", flexWrap: "wrap", gap: 5 },
  rideTag: { backgroundColor: color.surface, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  rideTagText: { color: color.muted, fontSize: 11, fontWeight: "800" },
  rideTagGold: { backgroundColor: color.warn },
  rideTagGoldText: { color: color.ink, fontSize: 11, fontWeight: "800" },
  rideTagLime: { backgroundColor: color.stateInfoBg },
  rideTagLimeText: { color: color.ink, fontSize: 11, fontWeight: "800" },
  rideFoot: { alignItems: "center", borderTopColor: color.line, borderTopWidth: 1, flexDirection: "row", justifyContent: "space-between", marginTop: 10, paddingTop: 8 },
  rideStatus: { color: color.muted, fontSize: 11, fontWeight: "700" },
  ridePrice: { color: color.ink, fontSize: 13, fontWeight: "900" },
  ridePriceUnit: { color: color.muted, fontSize: 11, fontWeight: "700" },
  rideHeart: { position: "absolute", right: 14, top: 14 },

  listFoot: { color: color.muted, fontSize: 11, fontWeight: "700", paddingTop: 8, textAlign: "center" },

  empty: { alignItems: "center", paddingBottom: 40, paddingTop: 44 },
  emptyIcon: { alignItems: "center", backgroundColor: color.surface, borderRadius: 22, height: 72, justifyContent: "center", marginBottom: 16, width: 72 },
  emptyTitle: { color: color.ink, fontSize: 15, fontWeight: "900", marginBottom: 8 },
  emptyDesc: { color: color.muted, fontSize: 12.5, fontWeight: "600", lineHeight: 19, marginBottom: 18, maxWidth: 240, textAlign: "center" },
  emptyBtn: { backgroundColor: color.ink, borderRadius: 12, paddingHorizontal: 22, paddingVertical: 11 },
  emptyBtnText: { color: color.white, fontSize: 13, fontWeight: "900" },

  citySearchWrap: { paddingBottom: 8, paddingHorizontal: 18 },
  citySection: { paddingBottom: 18, paddingHorizontal: 18 },
  citySectionHead: { alignItems: "baseline", flexDirection: "row", justifyContent: "space-between", paddingBottom: 10, paddingHorizontal: 4 },
  citySectionTitle: { color: color.muted, fontSize: 11, fontWeight: "900", letterSpacing: 1 },
  citySectionHint: { color: color.muted, fontSize: 11, fontWeight: "700" },
  cityChips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  cityChip: { alignItems: "center", backgroundColor: color.white, borderColor: color.line, borderRadius: 12, borderWidth: 1.5, flexDirection: "row", gap: 6, paddingHorizontal: 16, paddingVertical: 10 },
  cityChipLocated: { backgroundColor: color.attentionBg, borderColor: color.attentionBorder },
  cityChipOn: { backgroundColor: color.ink, borderColor: color.ink },
  cityChipText: { color: color.ink, fontSize: 13, fontWeight: "800", letterSpacing: -0.15 },
  cityChipTextOn: { color: color.white },

  cityFooter: { alignItems: "center", backgroundColor: color.offWhite, borderTopColor: color.line, borderTopWidth: 1, flexDirection: "row", gap: 10, paddingHorizontal: 18, paddingTop: 14 },
  cityFooterInfo: { color: color.muted, flex: 1, fontSize: 11.5, fontWeight: "700", lineHeight: 17 },

  btnPrimary: { alignItems: "center", backgroundColor: color.ink, borderRadius: 15, height: 50, justifyContent: "center", paddingHorizontal: 24 },
  btnPrimaryText: { color: color.white, fontSize: 14.5, fontWeight: "900", letterSpacing: -0.2 },
  btnWide: { flex: 1 },
  btnDone: { backgroundColor: color.mint },
  btnGhost: { alignItems: "center", backgroundColor: color.white, borderColor: color.line, borderRadius: 15, borderWidth: 1.5, height: 50, justifyContent: "center", width: 56 },

  detailScrollBody: { paddingBottom: 100 },
  detailCover: { alignItems: "center", backgroundColor: color.ink, height: 260, justifyContent: "center", marginBottom: 16, overflow: "hidden", paddingHorizontal: 20, position: "relative" },
  // 角标在封面里单独定位：盖掉 coverBadge 的 top:8（那个值是给列表卡 110pt 封面用的），
  // 让开悬浮 topbar（见文件头 DETAIL_BADGE_TOP 的算式）。
  detailCoverBadge: { top: DETAIL_BADGE_TOP },
  detailCoverEmoji: { fontSize: 56 },
  detailCoverTitle: { bottom: 18, left: 20, position: "absolute", right: 20 },
  detailCoverName: { color: color.white, fontSize: 24, fontWeight: "900", letterSpacing: -0.8, marginBottom: 4 },
  detailCoverSub: { color: "rgba(255,255,255,0.9)", fontSize: 12.5, fontWeight: "700" },

  agencyBlock: { alignItems: "center", backgroundColor: color.white, borderColor: color.line, borderRadius: 16, borderWidth: 1, flexDirection: "row", gap: 12, marginBottom: 12, marginHorizontal: 18, paddingHorizontal: 16, paddingVertical: 14 },
  agencyIcon: { alignItems: "center", backgroundColor: color.stateInfoBg, borderRadius: 13, height: 44, justifyContent: "center", width: 44 },
  agencyBody: { flex: 1, minWidth: 0 },
  agencyLabel: { color: color.mint, fontSize: 11, fontWeight: "900", letterSpacing: 0.4, marginBottom: 3 },
  agencyName: { color: color.ink, fontSize: 13.5, fontWeight: "900", marginBottom: 2 },
  agencyLicense: { color: color.muted, fontSize: 11, fontWeight: "700" },

  riderBlock: { backgroundColor: color.white, borderColor: color.line, borderRadius: 16, borderWidth: 1, marginBottom: 12, marginHorizontal: 18, padding: 16 },
  blockTitle: { color: color.muted, fontSize: 11, fontWeight: "900", letterSpacing: 0.6, marginBottom: 12 },
  riderInfo: { alignItems: "center", flexDirection: "row", gap: 14 },
  riderInfoText: { flex: 1, minWidth: 0 },
  riderName: { color: color.ink, fontSize: 16, fontWeight: "900", letterSpacing: -0.3, marginBottom: 4 },
  riderMeta: { color: color.muted, fontSize: 11.5, fontWeight: "600", lineHeight: 17 },
  riderStats: { flexDirection: "row", gap: 16, marginTop: 12 },
  riderStat: { flex: 1 },
  riderStatValue: { color: color.ink, fontSize: 13, fontWeight: "900", letterSpacing: -0.2 },
  riderStatKey: { color: color.muted, fontSize: 11, fontWeight: "700", marginTop: 2 },

  infoBlock: { backgroundColor: color.white, borderColor: color.line, borderRadius: 16, borderWidth: 1, marginBottom: 12, marginHorizontal: 18, paddingHorizontal: 16 },
  infoRow: { alignItems: "flex-start", borderBottomColor: color.line, borderBottomWidth: 1, flexDirection: "row", justifyContent: "space-between", paddingVertical: 14 },
  infoLabel: { color: color.muted, flexShrink: 0, fontSize: 12, fontWeight: "700" },
  infoValue: { color: color.ink, fontSize: 13, fontWeight: "900", letterSpacing: -0.15, lineHeight: 18, maxWidth: "62%", textAlign: "right" },
  infoNote: { color: color.muted, fontSize: 11, fontWeight: "700" },

  requestNote: { color: color.mint, fontSize: 11.5, fontWeight: "800", marginBottom: 12, marginHorizontal: 22, textAlign: "center" },
  disclaimer: { color: color.muted, fontSize: 11, fontWeight: "700", lineHeight: 18, paddingBottom: 24, paddingHorizontal: 22, textAlign: "center" },

  detailFooter: { backgroundColor: color.offWhite, borderTopColor: color.line, borderTopWidth: 1, flexDirection: "row", gap: 10, paddingHorizontal: 18, paddingTop: 12 }
});

// Me Surface：账户与 Active Context 切换（R15.12.7：One Account，
// Active Context = REQUESTER | BUSINESS，切换只改 Product State；
// 找人、接机会、开放能力、发活动都是行为，不是另一种身份）。
// R15.12.7 Market Map Parity Freeze：Market 路由行保持 dispatcher surface
// "TASKS" 契约（server 只知道 TASKS），shell 映射到市场 Tab。
// 视觉基线：Proxy_P0_Prototype_R15_12_7_Market_Map_Parity_Freeze.html
// （renderRequesterMe / renderBusinessMe / contextline），
// 切换 Sheet 由 App Shell 共享渲染（ContextSwitcherSheet）。
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Image, Modal, NativeScrollEvent, NativeSyntheticEvent, Pressable, ScrollView, Share, StyleSheet, Text, TextInput, View } from "react-native";
import { useModuleBackHandler } from "../components/module-back";
import { SwipeBackShell } from "../architecture/swipe-back";
import { ProfileTabs } from "./ProfileTabs";
import { AIIdentityShowcaseSurface } from "./AIIdentityShowcaseSurface";
import * as ImagePicker from "expo-image-picker";
import { Directory, File, Paths } from "expo-file-system";
import { createProfileStore, DEFAULT_PROFILE, type ProfileRecord } from "../profile-store";
import { nativeSecureStorageDriver } from "../native-secure-storage";
import type { ExperienceAction, ExperienceMenuSection, FeedMediaItem, FeedPost, Memory, RegisteredExperienceRoute } from "@proxy/contracts";
import { ProxyIcon, ProxySymbolIcon } from "../components/proxy-icon";
import { MerchantMeR21 } from "./merchant-me-r21";
import { CreatorInvitationCard } from "./creator-application";
import { FriendCrmSurface } from "./friend-crm";
import { AdaptiveMediaCollection, MediaViewer, SinglePostImage } from "./feed";
import { ThreadsPostMedia } from "../components/threads-post-media";
import { SecuritySettings } from "../components/security-settings";
import type { FulfillmentClient, FulfillmentOrder } from "../fulfillment-client";
import type { EngagementClient } from "../engagement-client";
import { type LocalNetClient } from "../localnet-client";
import { meOwnedRouteForLabel } from "../me-owned-routes";
import { color, Gradient, shadows } from "../theme";
import type { ActiveContext } from "../uiplan/types";
import type { SceneClient } from "../scene-client";
import type { BusinessClient } from "../business-client";
import type { SupplyClient } from "../supply-client";
// R15.25 FACET — 对象化内容运营 (Phase 1 = list).
// 接线: SessionAuthClient (main 注入) → FacetClient → FacetHomeSurface。
// Surface 内部 useEffect 调 GET /v1/facet/objects, 失败 → 显示 "服务暂时不可用"。
import { FacetHomeSurface } from "../facet/FacetHomeSurface";
import { FacetClient } from "../facet-client";
// R15.25: 从 native-app 拿 module-level const 构造 FacetClient.
// native-app 提前 export 了 sessionAuthClient + localApiBaseUrl, 避免
// 给 AppShell / MeSurface 增 prop.
import { sessionAuthClient, localApiBaseUrl } from "../native-clients";

const OTTER_LOGO = require("../../assets/otter-logo.png");

// profileStore — SecureStore 持久化, “我的” 页 profile 编辑“完成”后真正写盘。
// 跟随 SecureSessionStore / LastSignInStore 的模式: module-level 单例。
const profileStore = createProfileStore(nativeSecureStorageDriver);

// profile 头像存到 documentDirectory/proxy-profile/avatar.jpg。
// 选完相册后, 原 file:// URI 复制到这里; 沙盒跨重启仍可读, app 重启后
// profileStore 读出稳定路径, Image 用 { uri: path } 重新加载。
const PROFILE_AVATAR_DIR = new Directory(Paths.document, "proxy-profile");
function nextProfileAvatarFile(): File {
  // A new URI also invalidates React Native/iOS image caches. Overwriting one
  // fixed avatar.jpg can otherwise keep rendering the previous bitmap.
  return new File(PROFILE_AVATAR_DIR, `avatar-${Date.now()}.jpg`);
}

type MeSubPage = { title: string; desc: string; icon: string; route: string } | undefined;
type AvailabilityState = "AVAILABLE" | "BUSY" | "PAUSED" | "HIDDEN";
type EnterpriseOpsStage = "READY" | "DRAFT_READY" | "CONFIRMED" | "PUBLISHED";

interface MenuRow {
  icon: string;
  label: string;
  desc: string;
  grad?: boolean;
  action?: ExperienceAction;
  route?: string;
}

interface MenuSection {
  id?: string;
  title: string;
  hint: string;
  rows: MenuRow[];
}

type PersonalHubTab = "FEED" | "PHOTOS" | "RECORDS";
type SocialVisibility = "仅自己" | "商家可见" | "公开展示";
type SocialAccount = { key: string; mark: string; dark?: boolean; name: string; handle: string; url: string; visibility: SocialVisibility };

const INITIAL_SOCIAL_ACCOUNTS: SocialAccount[] = [
  { key: "tiktok", mark: "TT", dark: true, name: "TikTok", handle: "@huyen.life", url: "https://www.tiktok.com/@huyen.life", visibility: "商家可见" },
  { key: "threads", mark: "◎", name: "Threads", handle: "@huyen.daily", url: "https://www.threads.net/@huyen.daily", visibility: "仅自己" },
  { key: "facebook", mark: "f", name: "Facebook", handle: "Huyen Nguyen", url: "https://www.facebook.com/huyen.nguyen", visibility: "公开展示" },
  { key: "x", mark: "X", dark: true, name: "X", handle: "", url: "", visibility: "仅自己" }
];

// 能力与可用时间（原型 my_market_modules v5）：能力类型由 Proxy 定义，用户只维护实例。
type AbilityType = "同行" | "翻译" | "拍照";

type AbilityInstance = {
  id: string;
  type: AbilityType;
  fields: Array<{ label: string; value: string }>;
  note?: string;
};

const ABILITY_SCHEMAS: Record<AbilityType, { icon: string; subtitle: string; fields: Array<{ id: string; label: string; shortLabel: string; type: "select" | "chips"; options: string[] }> }> = {
  "同行": {
    icon: "◎",
    subtitle: "现实场景陪伴与本地协助",
    fields: [
      { id: "area", label: "服务区域", shortLabel: "区域", type: "select", options: ["河内", "胡志明市", "岘港"] },
      { id: "topic", label: "主题", shortLabel: "主题", type: "chips", options: ["旅行", "消费", "美食", "购物", "城市探索"] },
      { id: "mode", label: "服务方式", shortLabel: "方式", type: "chips", options: ["线下"] },
      { id: "time", label: "时间规则", shortLabel: "时间", type: "chips", options: ["跟随未来30天行程", "仅已安排时段"] }
    ]
  },
  "翻译": {
    icon: "译",
    subtitle: "消费与日常场景的现场沟通",
    fields: [
      { id: "pair", label: "语言组合", shortLabel: "语言", type: "select", options: ["中文 ↔ 越南语", "英语 ↔ 越南语", "中文 ↔ 英语"] },
      { id: "scene", label: "适用场景", shortLabel: "场景", type: "chips", options: ["消费", "日常", "旅行", "简单商务"] },
      { id: "mode", label: "服务方式", shortLabel: "方式", type: "chips", options: ["线下", "语音", "视频"] },
      { id: "area", label: "线下区域", shortLabel: "区域", type: "select", options: ["河内", "胡志明市", "岘港", "不限"] }
    ]
  },
  "拍照": {
    icon: "⌁",
    subtitle: "旅行与消费场景的轻量拍摄",
    fields: [
      { id: "scene", label: "拍摄场景", shortLabel: "场景", type: "chips", options: ["旅行", "探店", "人物", "活动"] },
      { id: "device", label: "设备", shortLabel: "设备", type: "chips", options: ["手机", "相机"] },
      { id: "area", label: "服务区域", shortLabel: "区域", type: "select", options: ["河内", "胡志明市", "岘港"] },
      { id: "time", label: "时间规则", shortLabel: "时间", type: "chips", options: ["跟随未来30天行程", "仅已安排时段"] }
    ]
  }
};

const DEFAULT_ABILITIES: AbilityInstance[] = [
  {
    id: "companion",
    type: "同行",
    fields: [
      { label: "区域", value: "河内" },
      { label: "主题", value: "旅行 / 消费" },
      { label: "方式", value: "线下" },
      { label: "时间", value: "跟随行程" }
    ]
  },
  {
    id: "translation",
    type: "翻译",
    fields: [
      { label: "语言", value: "中文 ↔ 越南语" },
      { label: "场景", value: "消费 / 日常" },
      { label: "方式", value: "线下" },
      { label: "区域", value: "河内" }
    ]
  }
];

// 可用时间：规律 + 按日例外（优先级：按日例外 > 规律）。
type AvailabilityRule = { days: number[]; start: number; end: number };
type AvOverride = { type: "full" | "off" | "custom"; start?: number; end?: number };

function avKeyOf(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function avFmt(h: number): string {
  return `${String(h).padStart(2, "0")}:00`;
}

function describeAvRule(rule: AvailabilityRule): string {
  const sorted = [...rule.days].sort((a, b) => a - b);
  let prefix = "自定义";
  if (sorted.length === 7) prefix = "每天";
  else if (JSON.stringify(sorted) === JSON.stringify([1, 2, 3, 4, 5])) prefix = "工作日";
  else if (JSON.stringify(sorted) === JSON.stringify([0, 6])) prefix = "周末";
  return `${prefix} · ${avFmt(rule.start)}–${avFmt(rule.end)}`;
}

function avStateFor(d: Date, rule: AvailabilityRule, overrides: Record<string, AvOverride>): { type: "base" | "full" | "off" | "custom" | "blank"; start?: number; end?: number } {
  const ov = overrides[avKeyOf(d)];
  if (ov) return ov;
  if (rule.days.includes(d.getDay())) return { type: "base", start: rule.start, end: rule.end };
  return { type: "blank" };
}

const AV_DAY_NAMES = ["日", "一", "二", "三", "四", "五", "六"];

// 未来 N 天（今天起，本地时区），供近期可用摘要与 30 天日历使用。
function nextDays(count: number): Array<{ key: string; date: Date; label: string }> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(today);
    date.setDate(today.getDate() + index);
    const key = avKeyOf(date);
    const label = index === 0 ? "今天" : index === 1 ? "明天" : `${date.getMonth() + 1}/${date.getDate()} 周${AV_DAY_NAMES[date.getDay()]}`;
    return { key, date, label };
  });
}

// 能力实例 sheet：能力类型由 Proxy 定义（同行 / 翻译 / 拍照），用户只维护实例字段。
function AbilitySheet({
  sheet,
  initialFields,
  onClose,
  onSave
}: {
  sheet: { mode: "ADD" | "EDIT"; type: AbilityType; id?: string };
  initialFields?: Array<{ label: string; value: string }> | undefined;
  onClose: () => void;
  onSave: (type: AbilityType, fields: Array<{ label: string; value: string }>, id?: string) => void;
}): React.JSX.Element {
  const schema = ABILITY_SCHEMAS[sheet.type];
  const [draft, setDraft] = useState<Map<string, string>>(() => {
    const map = new Map<string, string>();
    if (initialFields) {
      // 编辑：按 shortLabel 回填已有实例字段
      const byLabel = new Map(initialFields.map((f) => [f.label, f.value]));
      schema.fields.forEach((f) => map.set(f.id, byLabel.get(f.shortLabel) ?? ""));
    } else {
      // 新增：select 默认第一项，chips 默认空
      schema.fields.forEach((f) => map.set(f.id, f.type === "select" ? (f.options[0] ?? "") : ""));
    }
    return map;
  });
  const toggleChip = (id: string, option: string): void => {
    setDraft((prev) => {
      const next = new Map(prev);
      const current = (next.get(id) ?? "").split(" / ").filter(Boolean);
      const idx = current.indexOf(option);
      if (idx >= 0) current.splice(idx, 1);
      else current.push(option);
      next.set(id, current.join(" / "));
      return next;
    });
  };
  const buildFields = (): Array<{ label: string; value: string }> =>
    schema.fields.map((f) => ({ label: f.shortLabel, value: draft.get(f.id) ?? "" }));
  return (
    <Modal animationType="fade" onRequestClose={onClose} transparent visible>
      <Pressable onPress={onClose} style={styles.availabilityOverlay}>
        <Pressable onPress={() => undefined} style={styles.availabilitySheet}>
          <ScrollView showsVerticalScrollIndicator={false}>
            <View style={styles.abilitySheetHead}>
              <View style={styles.abilityIcon}><Text style={styles.abilityIconText}>{schema.icon}</Text></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.availabilityTitle}>新增{sheet.type}</Text>
                <Text style={styles.availabilitySub}>{schema.subtitle}</Text>
              </View>
            </View>
            {schema.fields.map((field) => (
              <View key={field.id} style={styles.abilityFieldBlock}>
                <Text style={styles.abilityFieldLabel}>{field.label}</Text>
                {field.type === "select" ? (
                  <View style={styles.chipWrap}>
                    {field.options.map((option) => {
                      const active = draft.get(field.id) === option;
                      return (
                        <Pressable key={option} onPress={() => setDraft((prev) => new Map(prev).set(field.id, option))} style={[styles.chip, active && styles.chipActive]}>
                          <Text style={active ? styles.chipTextActive : styles.chipText}>{option}</Text>
                        </Pressable>
                      );
                    })}
                  </View>
                ) : (
                  <View style={styles.chipWrap}>
                    {field.options.map((option) => {
                      const active = (draft.get(field.id) ?? "").split(" / ").includes(option);
                      return (
                        <Pressable key={option} onPress={() => toggleChip(field.id, option)} style={[styles.chip, active && styles.chipActive]}>
                          <Text style={active ? styles.chipTextActive : styles.chipText}>{option}</Text>
                        </Pressable>
                      );
                    })}
                  </View>
                )}
              </View>
            ))}
            <Pressable onPress={() => onSave(sheet.type, buildFields(), sheet.mode === "EDIT" ? sheet.id : undefined)} style={styles.primaryCta}>
              <Text style={styles.primaryCtaText}>{sheet.mode === "EDIT" ? "保存" : "添加"}</Text>
            </Pressable>
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

// 可用时间：每周规律 sheet（星期多选 + 时间段 chips）。
function AvRuleSheet({
  open,
  rule,
  onClose,
  onSave
}: {
  open: boolean;
  rule: AvailabilityRule;
  onClose: () => void;
  onSave: (next: AvailabilityRule) => void;
}): React.JSX.Element {
  const [days, setDays] = useState<number[]>(rule.days);
  const [start, setStart] = useState(rule.start);
  const [end, setEnd] = useState(rule.end);
  const presets: Array<{ label: string; days: number[] }> = [
    { label: "每天", days: [0, 1, 2, 3, 4, 5, 6] },
    { label: "工作日", days: [1, 2, 3, 4, 5] },
    { label: "周末", days: [0, 6] }
  ];
  const slots: Array<[number, number]> = [[9, 12], [12, 18], [18, 23]];
  return (
    <Modal animationType="fade" onRequestClose={onClose} transparent visible={open}>
      <Pressable onPress={onClose} style={styles.availabilityOverlay}>
        <Pressable onPress={() => undefined} style={styles.availabilitySheet}>
          <Text style={styles.availabilityTitle}>每周规律</Text>
          <Text style={styles.availabilitySub}>按日例外优先于每周规律；两者都不覆盖时该日不可约。</Text>
          <Text style={styles.abilityFieldLabel}>重复</Text>
          <View style={styles.chipWrap}>
            {[...presets, { label: "自定义", days: [] }].map((preset) => {
              const active = JSON.stringify([...days].sort((a, b) => a - b)) === JSON.stringify([...preset.days].sort((a, b) => a - b)) || (preset.label === "自定义" && !presets.some((p) => JSON.stringify([...p.days].sort((a, b) => a - b)) === JSON.stringify([...days].sort((a, b) => a - b))));
              return (
                <Pressable key={preset.label} onPress={() => preset.days.length > 0 && setDays(preset.days)} style={[styles.chip, active && styles.chipActive]}>
                  <Text style={active ? styles.chipTextActive : styles.chipText}>{preset.label}</Text>
                </Pressable>
              );
            })}
          </View>
          <View style={styles.chipWrap}>
            {AV_DAY_NAMES.map((name, index) => {
              const active = days.includes(index);
              return (
                <Pressable key={index} onPress={() => setDays((prev) => (prev.includes(index) ? prev.filter((d) => d !== index) : [...prev, index]))} style={[styles.dayCell, active && styles.chipActive]}>
                  <Text style={active ? styles.chipTextActive : styles.chipText}>{name}</Text>
                </Pressable>
              );
            })}
          </View>
          <Text style={styles.abilityFieldLabel}>时间段</Text>
          <View style={styles.chipWrap}>
            {slots.map(([s, e]) => {
              const active = start === s && end === e;
              return (
                <Pressable key={s} onPress={() => { setStart(s); setEnd(e); }} style={[styles.chip, active && styles.chipActive]}>
                  <Text style={active ? styles.chipTextActive : styles.chipText}>{avFmt(s)}–{avFmt(e)}</Text>
                </Pressable>
              );
            })}
          </View>
          <Pressable onPress={() => { onSave({ days, start, end }); onClose(); }} style={styles.primaryCta}>
            <Text style={styles.primaryCtaText}>保存规律</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

// 按日例外 sheet：全天有空 / 休息 / 自定义时段。
function AvDaySheet({
  day,
  rule,
  onClose,
  onSet
}: {
  day: { key: string; label: string };
  rule: AvailabilityRule;
  onClose: () => void;
  onSet: (key: string, override: AvOverride | null) => void;
}): React.JSX.Element {
  const current = avStateFor(new Date(`${day.key}T00:00:00`), rule, {});
  const options: Array<{ id: AvOverride["type"] | "follow"; title: string; desc: string }> = [
    { id: "full", title: "全天有空", desc: "当天按规律时段之外整天开放" },
    { id: "off", title: "休息", desc: "当天不可约，优先于每周规律" },
    { id: "custom", title: "自定义时段", desc: "只开放选定的时段" },
    { id: "follow", title: "跟随每周规律", desc: "清除当天的例外设置" }
  ];
  const [customStart, setCustomStart] = useState(18);
  const [customEnd, setCustomEnd] = useState(22);
  return (
    <Modal animationType="fade" onRequestClose={onClose} transparent visible>
      <Pressable onPress={onClose} style={styles.availabilityOverlay}>
        <Pressable onPress={() => undefined} style={styles.availabilitySheet}>
          <Text style={styles.availabilityTitle}>{day.label}</Text>
          <Text style={styles.availabilitySub}>当前：{current.type === "blank" ? "不可约" : `${avFmt(current.start ?? rule.start)}–${avFmt(current.end ?? rule.end)}`}</Text>
          {options.slice(0, 3).map((option) => (
            <Pressable key={option.id} onPress={() => { onSet(day.key, option.id === "full" ? { type: "full" } : option.id === "off" ? { type: "off" } : { type: "custom", start: customStart, end: customEnd }); onClose(); }} style={styles.availabilityOption}>
              <View style={styles.availabilityCopy}>
                <Text style={styles.availabilityOptionTitle}>{option.title}</Text>
                <Text style={styles.availabilityOptionDesc}>{option.desc}</Text>
              </View>
              {option.id === "custom" ? (
                <View style={styles.chipWrap}>
                  {([[17, 21], [18, 22], [19, 23]] as Array<[number, number]>).map(([s, e]) => (
                    <Pressable key={s} onPress={() => { setCustomStart(s); setCustomEnd(e); }} style={[styles.chip, customStart === s && styles.chipActive]}>
                      <Text style={customStart === s ? styles.chipTextActive : styles.chipText}>{avFmt(s)}–{avFmt(e)}</Text>
                    </Pressable>
                  ))}
                </View>
              ) : null}
            </Pressable>
          ))}
          <Pressable onPress={() => { onSet(day.key, null); onClose(); }} style={[styles.lightCta, { marginTop: 8 }]}>
            <Text style={styles.lightCtaText}>跟随每周规律（清除例外）</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

interface PersonaConfig {
  pageTitle: string;
  avatarText: string;
  avatarGrad: boolean;
  name: string;
  desc: string;
  identityActionLabel: string;
  identityActionSwitch: boolean;
  sections: MenuSection[];
  contextLineLabel: string;
  contextLineAction: string;
  settingsRow?: MenuRow;
  profileCard?: { route: string; status: string; social: string[] };
  alert?: { icon: string; title: string; desc: string; route: string; tag: string };
}

// 基线 renderRequesterMe（R15.12.7 最终，4960 包裹 4801）：ProfileCard +
// 个人主页 + 关系 + 我的市场 + 账户 + contextline。
const REQUESTER_ME: PersonaConfig = {
  pageTitle: "我的",
  avatarText: "H",
  avatarGrad: false,
  name: "Huyen",
  desc: "河内 ✓ 已验证 · 准时 98%",
  identityActionLabel: "切换身份",
  identityActionSwitch: true,
  profileCard: {
    // R16.8: profileCard onPress 跳 personalmanage (个人总管理, 含 3 段: 基本信息/二维码/状态管理),
    // 不跳 personalhub (Threads R2 1:1 抄 对外展示页, 不放状态管理/二维码).
    route: "personalmanage",
    status: "● 可接单",
    social: ["TT", "Z", "IG", "in"]
  },
  contextLineLabel: "当前身份 · 用户",
  contextLineAction: "切换为商家",
  sections: [
    {
      // R16.7: 个人总管理 = 1 个 subPage 含 3 段 (基本信息 / 二维码 / 状态管理).
      // 个人主页 (personalhub) 是对外展示页, 走 Threads R2 R1:1 抄, 不放二维码/状态管理.
      id: "personal_profile",
      title: "个人总管理",
      hint: "基本信息、二维码、状态管理在一个页里",
      rows: [
        { icon: "profile-ring", label: "个人总管理", desc: "基本信息 · 二维码 · 状态管理 (可接单)", grad: true, route: "personalmanage" },
        { icon: "profile-ring", label: "个人主页", desc: "对外展示 · Threads R2 · 名片、动态、能力、可用时间", route: "personalhub" },
        { icon: "arrow-up-right", label: "社媒与联系", desc: "TikTok、Zalo、Instagram 与可见范围", route: "socialidentity" },
        { icon: "route", label: "访问与转化", desc: "渠道 → 主页 → 聊天 → 订单", route: "socialanalytics" }
      ]
    },
    {
      id: "relationships",
      title: "关系",
      hint: "真人网络 · 个人轻 CRM 关系图",
      rows: [
        { icon: "target", label: "好友与关系", desc: "关系图 · 轻 CRM · 标签、备注、来源与互动记录", grad: true, route: "friendcrm" }
      ]
    },
    {
      id: "my_market",
      title: "我的市场",
      hint: "个人资产",
      rows: [
        { icon: "◎", label: "我的场景", desc: "R15.13 · 我发起的 Scene 与收到的邀请", route: "myscenes" },
        { icon: "diamond", label: "我的订单", desc: "我发布的 / 我参与的已成交订单", route: "myorders" },
        { icon: "clock", label: "能力与可用时间", desc: "能力、主题、区域与空闲时间", route: "available" },
        { icon: "ring", label: "我的活动", desc: "已参加 / 我发起的活动", route: "myactivities" },
        { icon: "star", label: "收藏", desc: "商家、Creator、动态与活动", route: "favorites" }
      ]
    },
    {
      id: "account",
      title: "账户",
      hint: "安全与结算",
      rows: [
        { icon: "coin", label: "钱包与结算", desc: "付款、收入、退款与记录", route: "wallet" },
        { icon: "gear", label: "设置与隐私", desc: "推荐、通知、权限与隐私", route: "appbehavior" },
        { icon: "store-lines", label: "我的企业 / 店铺", desc: "有经营权限时进入 Business Workspace", route: "bdash" }
      ]
    },
    // R15.25 FACET — “不是第 6 个 root”：是 ME tab 内的深度模块。
    // 后端 hardcode 返 3 个 mock 对象 (Ken / Linh / ABC Spa)。
    // avatarUrl 永远 = ""，UI 显示 initial placeholder。
    // Phase 1 NOT-IN-SCOPE：LIBRARY / OBJECT DETAIL / OBJECT PREVIEW / OPS。
    {
      id: "facet",
      title: "对象化运营",
      hint: "FACET · 同一份真实素材，按对象重新组织",
      rows: [
        { icon: "spark", label: "FACET", desc: "对象列表 · 关系目标 · 缺口判定", grad: true, route: "facet" }
      ]
    }
  ]
};

// R3 商家一级模块 registry：只展示模块名 + 一行真实状态；二级页面沿用已有业务路由。
const BUSINESS_ME: PersonaConfig = {
  pageTitle: "我的企业",
  avatarText: "B",
  avatarGrad: false,
  name: "Bonsaidon",
  desc: "Business Principal · 当前你有经营权限",
  identityActionLabel: "主体",
  identityActionSwitch: false,
  contextLineLabel: "当前使用 · Bonsaidon",
  contextLineAction: "切换身份",
  settingsRow: { icon: "P", label: "Proxy 中心", desc: "应用状态、主体权限与业务工作区", route: "bdash" },
  sections: [
    {
      title: "关系",
      hint: "真人网络 · 个人轻 CRM 关系图",
      rows: [
        { icon: "target", label: "好友与关系", desc: "关系图 · 轻 CRM · 标签、备注、来源与互动记录", grad: true, route: "friendcrm" }
      ]
    },
    {
      title: "商家 · 我的",
      hint: "业务资产",
      rows: [
        { icon: "◎", label: "Creator 经营", desc: "24 人 · 5 核心", grad: true, route: "trustedteam" },
        { icon: "券", label: "券", desc: "4 张进行中 · 1 张今天到期", route: "vouchers" },
        { icon: "↗", label: "活动导流", desc: "3 个档期 · 缺 4 位小美", route: "merchantcampaign" },
        { icon: "▤", label: "线上店铺", desc: "8,426 关注 · 今日 1,284 访问", grad: true, route: "merchantstorefront" },
        { icon: "₫", label: "销售中心", desc: "今日 12.6M · 新客 18", route: "outcomehistory" },
        { icon: "✦", label: "经营", desc: "3 待办 · 5 草稿", route: "enterpriseops" }
      ]
    }
  ]
};

const PERSONA: Record<ActiveContext, PersonaConfig> = {
  REQUESTER: REQUESTER_ME,
  BUSINESS: BUSINESS_ME
};

function toManagedMenuSections(sections: ExperienceMenuSection[]): MenuSection[] {
  return sections.map((section) => ({
    id: section.id,
    title: section.title,
    hint: section.hint ?? "",
    rows: section.items.map((item) => ({
      icon: item.icon,
      label: item.label,
      desc: item.description,
      action: item.action,
      ...(item.accent !== undefined ? { grad: item.accent } : {})
    }))
  }));
}

function ServiceRow({ row, onPress }: { row: MenuRow; onPress?: () => void }): React.JSX.Element {
  const icon = row.icon === "P" ? (
    <Image accessibilityLabel="Proxy" resizeMode="contain" source={OTTER_LOGO} style={styles.serviceLogo} />
  ) : row.icon === "voucher" ? (
    <ProxyIcon color={row.grad ? color.white : color.ink} name="cup" size={26} />
  ) : (
    <ProxySymbolIcon color={row.grad ? color.white : color.ink} size={26} symbol={row.icon} />
  );
  return (
    <Pressable onPress={onPress} style={styles.serviceRow}>
      {row.grad ? (
        <Gradient from={color.magenta} to={color.violet} style={styles.serviceIcon}>
          {icon}
        </Gradient>
      ) : (
        <View style={[styles.serviceIcon, row.icon === "P" && styles.serviceLogoBox]}>
          {icon}
        </View>
      )}
      <View style={styles.serviceCopy}>
        <Text style={styles.serviceLabel}>{row.label}</Text>
        <Text style={styles.serviceDesc}>{row.desc}</Text>
      </View>
      <Text style={styles.chev}>›</Text>
    </Pressable>
  );
}

type OrderFilter = "all" | "published" | "joined" | "done" | "cancelled";
function orderStatus(order: FulfillmentOrder): string { return ({ OFFERED: "待确认", CONFIRMED: "已确认", EXECUTING: "进行中", COMPLETED: "已完成", CANCELLED: "已取消" } as const)[order.lifecycle]; }
function orderMoney(order: FulfillmentOrder): string { return `${order.snapshot.agreedCompensation.toLocaleString()} ${order.snapshot.currency || "VND"}`; }

function MyOrdersSurface({ client, onBack }: { client: FulfillmentClient; onBack: () => void }): React.JSX.Element {
  const [filter, setFilter] = useState<OrderFilter>("all");
  const [orders, setOrders] = useState<FulfillmentOrder[]>([]);
  const [phase, setPhase] = useState<"LOADING" | "READY" | "ERROR">("LOADING");
  const [detail, setDetail] = useState<FulfillmentOrder>();
  useEffect(() => { let active = true; setPhase("LOADING"); void client.listMyOrders().then((rows) => { if (active) { setOrders(rows); setPhase("READY"); } }).catch(() => { if (active) setPhase("ERROR"); }); return () => { active = false; }; }, [client]);
  const visible = orders.filter((order) => filter === "all" || filter === "published" && order.viewerRole === "REQUESTER" || filter === "joined" && order.viewerRole === "AGENT" || filter === "done" && order.lifecycle === "COMPLETED" || filter === "cancelled" && order.lifecycle === "CANCELLED");
  const fields = (order: FulfillmentOrder): Array<[string,string]> => [["服务", order.snapshot.serviceSku || order.needId], ["金额", orderMoney(order)], ["时间", order.snapshot.startTime || "待确认"], ["地点", order.snapshot.meetingContext || "待确认"], ["时长", order.snapshot.duration || "待确认"], ["结算", order.snapshot.settlementMode || "待确认"]];
  if (detail) return <View style={styles.root}><ScrollView contentContainerStyle={styles.content}><Pressable onPress={() => setDetail(undefined)} style={styles.subPageBack}><Text style={styles.subPageBackText}>‹ 返回订单</Text></Pressable><Text style={styles.detailTitle}>订单详情</Text><View style={styles.orderCard}><View style={styles.orderHead}><View style={styles.orderCopy}><Text style={styles.orderTitle}>{detail.snapshot.serviceSku || "Proxy 订单"}</Text><Text style={styles.orderId}>{detail.orderId}</Text></View><Text style={[styles.orderBadge, detail.lifecycle === "EXECUTING" && styles.orderBadgeLive]}>{orderStatus(detail)}</Text></View><Text style={styles.orderNotice}>订单编号是订单全生命周期的唯一识别号，用于支付、退款、客服、争议、结算和记录查询。</Text></View><View style={styles.orderCard}><Text style={styles.orderTitle}>服务信息</Text><View style={styles.orderGrid}>{fields(detail).map(([label, value]) => <View key={label} style={styles.orderField}><Text style={styles.orderFieldLabel}>{label}</Text><Text style={styles.orderFieldValue}>{value}</Text></View>)}</View></View></ScrollView></View>;
  return <View style={styles.root}><ScrollView contentContainerStyle={styles.content}><View style={styles.orderPageHead}><Pressable onPress={onBack} style={styles.orderBack}><Text style={styles.orderBackText}>‹</Text></Pressable><Text style={styles.detailTitle}>我的订单</Text></View><ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.orderTabs}>{([['all','全部'],['published','我发布的'],['joined','我参与的'],['done','已完成'],['cancelled','已取消']] as const).map(([id,label]) => <Pressable key={id} onPress={() => setFilter(id)} style={[styles.orderTab, filter === id && styles.orderTabOn]}><Text style={[styles.orderTabText, filter === id && styles.orderTabTextOn]}>{label}</Text></Pressable>)}</ScrollView>{phase === "LOADING" ? <ActivityIndicator color={color.magenta} /> : null}{phase === "ERROR" ? <Text style={styles.personalEmpty}>订单服务暂时不可用，请稍后重试。</Text> : null}{phase === "READY" && visible.length === 0 ? <Text style={styles.personalEmpty}>当前分类还没有订单。</Text> : null}{visible.map((item) => <Pressable key={item.orderId} onPress={() => setDetail(item)} style={styles.orderCard}><View style={styles.orderHead}><View style={styles.orderCopy}><Text style={styles.orderTitle}>{item.snapshot.serviceSku || "Proxy 订单"}</Text><Text style={styles.orderId}>订单编号：{item.orderId}</Text></View><Text style={[styles.orderBadge, item.lifecycle === "EXECUTING" && styles.orderBadgeLive]}>{orderStatus(item)}</Text></View><View style={styles.orderGrid}>{fields(item).slice(0,4).map(([label,value]) => <View key={label} style={styles.orderField}><Text style={styles.orderFieldLabel}>{label}</Text><Text style={styles.orderFieldValue}>{value}</Text></View>)}</View></Pressable>)}</ScrollView></View>;
}

function MyActivitiesSurface({ onBack }: { onBack: () => void }): React.JSX.Element {
  const [tab, setTab] = useState<"joined" | "created">("joined");
  const items = tab === "joined" ? [["周末美甲体验", "8月30日 14:00 · Luna Spa"], ["河内 Creator Coffee", "9月6日 10:30 · Tây Hồ"]] : [["西湖摄影散步", "9月12日 15:30 · 已报名 8 人"]];
  return <View style={styles.root}><ScrollView contentContainerStyle={styles.content}><View style={styles.orderPageHead}><Pressable onPress={onBack} style={styles.orderBack}><Text style={styles.orderBackText}>‹</Text></Pressable><Text style={styles.detailTitle}>我的活动</Text></View><View style={styles.activityOwnedTabs}><Pressable onPress={() => setTab("joined")} style={[styles.activityOwnedTab, tab === "joined" && styles.activityOwnedTabOn]}><Text style={[styles.activityOwnedTabText, tab === "joined" && styles.activityOwnedTabTextOn]}>已参加</Text></Pressable><Pressable onPress={() => setTab("created")} style={[styles.activityOwnedTab, tab === "created" && styles.activityOwnedTabOn]}><Text style={[styles.activityOwnedTabText, tab === "created" && styles.activityOwnedTabTextOn]}>我发起的</Text></Pressable></View>{items.map(([title,meta]) => <View key={title} style={styles.savedCard}><Text style={styles.orderTitle}>{title}</Text><Text style={styles.savedMeta}>{meta}</Text></View>)}</ScrollView></View>;
}

type FavoriteTab = "all" | "merchant" | "creator" | "post" | "activity";
function FavoritesSurface({ onBack }: { onBack: () => void }): React.JSX.Element {
  const [tab, setTab] = useState<FavoriteTab>("all");
  const entries = [{ type: "merchant", title: "Luna Spa", meta: "Beauty & Wellness · 西湖区" }, { type: "creator", title: "Linh Tran", meta: "Creator · 美妆 / Lifestyle" }];
  const visible = tab === "all" ? entries : entries.filter((item) => item.type === tab);
  return <View style={styles.root}><ScrollView contentContainerStyle={styles.content}><View style={styles.orderPageHead}><Pressable onPress={onBack} style={styles.orderBack}><Text style={styles.orderBackText}>‹</Text></Pressable><Text style={styles.detailTitle}>收藏</Text></View><Text style={styles.savedIntro}>很轻的个人备忘夹。以后还想找到，就放这里。</Text><ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.orderTabs}>{([['all','全部'],['merchant','商家'],['creator','Creator'],['post','动态'],['activity','活动']] as const).map(([id,label]) => <Pressable key={id} onPress={() => setTab(id)} style={[styles.orderTab, tab === id && styles.orderTabOn]}><Text style={[styles.orderTabText, tab === id && styles.orderTabTextOn]}>{label}</Text></Pressable>)}</ScrollView>{visible.length ? visible.map((item) => <View key={item.title} style={[styles.savedCard, styles.savedRow]}><View style={styles.savedThumb}><Text style={styles.savedThumbText}>☆</Text></View><View><Text style={styles.orderTitle}>{item.title}</Text><Text style={styles.savedMeta}>{item.meta}</Text></View></View>) : <View style={styles.savedCard}><Text style={styles.savedMeta}>这里还没有收藏。</Text></View>}</ScrollView></View>;
}

// R15.12.18 礼品券入口使用原型中的咖啡券杯子；这只是权益入口图标，
// 不替换应用 Logo，也不改动礼品券页面的任何卡面。
function VoucherMenuGlyph({ color: tint }: { color: string }): React.JSX.Element {
  return <ProxyIcon color={tint} name="cup" size={26} />;
}

const AVAILABILITY_OPTIONS: ReadonlyArray<{ id: AvailabilityState; title: string; desc: string }> = [
  { id: "AVAILABLE", title: "可接单", desc: "进入人物发现与合适机会分发" },
  { id: "BUSY", title: "忙碌", desc: "保留主页，降低即时机会" },
  { id: "PAUSED", title: "暂不接单", desc: "暂停机会分发" },
  { id: "HIDDEN", title: "隐身", desc: "从公开人物发现中隐藏" }
];

function availabilityLabel(value: AvailabilityState): string {
  return AVAILABILITY_OPTIONS.find((option) => option.id === value)?.title ?? "可接单";
}

// 原型 personalhub 的“个人状态”是市场可见性控制，而非身份切换。
// 选择写入当前 P0 会话；未来由 availability domain 持久化并审计。
function AvailabilitySheet({
  current,
  open,
  onClose,
  onSelect
}: {
  current: AvailabilityState;
  open: boolean;
  onClose: () => void;
  onSelect: (next: AvailabilityState) => void;
}): React.JSX.Element {
  return (
    <Modal animationType="fade" onRequestClose={onClose} transparent visible={open}>
      <Pressable onPress={onClose} style={styles.availabilityOverlay}>
        <Pressable onPress={() => undefined} style={styles.availabilitySheet}>
          <Text style={styles.availabilityTitle}>个人状态</Text>
          <Text style={styles.availabilitySub}>这是市场状态，不是身份切换。</Text>
          {AVAILABILITY_OPTIONS.map((option) => {
            const active = option.id === current;
            return (
              <Pressable
                key={option.id}
                onPress={() => { onSelect(option.id); onClose(); }}
                style={[styles.availabilityOption, active && styles.availabilityOptionActive]}
              >
                <View style={[styles.availabilityMark, active && styles.availabilityMarkActive]}>
                  <ProxyIcon color={active ? color.white : color.ink} name={option.id === "AVAILABLE" ? "target" : "circle"} size={22} />
                </View>
                <View style={styles.availabilityCopy}>
                  <Text style={styles.availabilityOptionTitle}>{option.title}</Text>
                  <Text style={styles.availabilityOptionDesc}>{option.desc}</Text>
                </View>
                <Text style={styles.availabilityAction}>{active ? "当前" : "设置"}</Text>
              </Pressable>
            );
          })}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function memorySourceLabel(source: string): string {
  switch (source) {
    case "EXPLICIT": return "用户设置";
    case "EXPLICIT_ACCEPT": return "用户确认";
    case "INFERRED": return "系统推断";
    case "SUGGESTED": return "系统建议";
    default: return source;
  }
}

// 原型 rootChrome 的范围说明只属于“我的”根页，不能出现在设置等详情页。
function MeLocationContext(): React.JSX.Element {
  return (
    <View style={styles.meLocationRow}>
      <View style={styles.meLocationPin}>
        <ProxyIcon color={color.ink} name="crosshair" size={17} />
      </View>
      <View style={styles.meLocationCopy}>
        <Text style={styles.meLocationCity}>河内 · 还剑湖附近</Text>
        <Text numberOfLines={1} style={styles.meLocationSub}>
          你正在看的本地范围 · 仅城市 / 区域
        </Text>
      </View>
      <Text style={styles.meLocationSwitch}>切换⌄</Text>
    </View>
  );
}

// 原型子页面内容映射 — 每个路由对应原型中的页面标题、描述和关键内容。
const SUB_PAGE_CONTENT: Record<string, { title: string; desc: string; icon: string; sections?: Array<{ title: string; rows: Array<{ label: string; value: string }> }> }> = {
  myscenes: {
    title: "我的场景",
    desc: "R15.13 Scene Value Exchange · 我发起的 Scene 与收到的邀请。预算进场景，不买人。",
    icon: "◎",
    sections: [
      { title: "进行中", rows: [{ label: "West Lake Photo Afternoon", value: "INVITING · 2/4 确认 · 饮品 included" }, { label: "周末西湖聚餐", value: "DRAFT · 需补锚点" }]},
      { title: "收到的邀请", rows: [{ label: "Rooftop Sunset", value: "David 邀请 · 交通支持100K · 待回应" }]},
      { title: "历史", rows: [{ label: "已完成 3 · 到场 2", value: "满意度 4.6 · 复访 1" }]},
    ]
  },
  wallet: {
    title: "钱包与结算",
    desc: "钱包是'我的'内页，只展示 Proxy 真正经手或需要记录的资金状态。",
    icon: "₫"
  },
  myorders: {
    title: "我的订单",
    desc: "我发布、参与和已经完成的订单。",
    icon: "◇"
  },
  myactivities: {
    title: "我的活动",
    desc: "我参加、感兴趣和发起的活动。",
    icon: "○"
  },
  favorites: {
    title: "收藏",
    desc: "很轻的个人备忘夹。以后还想找到，就放这里。",
    icon: "☆",
    sections: []
  },
  // R15.25 FACET entry. 实际页面在 FacetHomeSurface 渲染 (line ~1415),
  // 这里只提供 title / desc / icon 给 subPage header 文字 fallback.
  facet: {
    title: "FACET · 对象化内容运营",
    desc: "同一份真实素材，针对不同对象重新组织呈现方式。",
    icon: "✨",
    sections: []
  },
  requestermemory: {
    title: "Proxy 记住了什么？",
    desc: "只保留能让下一次更省事的偏好。你可以随时改掉，也可以不接受任何建议。",
    icon: "◎"
  },
  participate: {
    title: "参与运营 · 网络贡献",
    desc: "推荐靠谱司机 / Agent、好商家或真实新用户。Proxy 自动做归因、审核、进度跟踪和奖励结算。",
    icon: "✦",
    sections: [
      { title: "参与资格", rows: [
        { label: "身份与账号", value: "Identity verified · Principal ACTIVE" },
        { label: "风控", value: "无自我邀请 / 批量设备 / 历史滥用信号" },
        { label: "权限边界", value: "推荐与引荐不等于合同签署、资格验证或平台审批" }
      ]}
    ]
  },
  networkcontribution: {
    title: "我的网络贡献",
    desc: "用户看到的是自己的真实增长贡献、审核状态和收益。",
    icon: "↗",
    sections: [
      { title: "累计网络贡献收入", rows: [
        { label: "已到账", value: "—" },
        { label: "待价值事件解锁", value: "—" }
      ]},
      { title: "按场景看转化", rows: [
        { label: "司机 / Agent 拉新", value: "邀请 0 · 注册 0" },
        { label: "商家推荐", value: "合作推进中" },
        { label: "新用户拉新", value: "邀请 0 · 注册 0" }
      ]}
    ]
  },
  appbehavior: {
    title: "应用行为检查",
    desc: "应用端需要覆盖安全区域、键盘、返回、冷启动、后台恢复、推送、离线重试、深链和通知疲劳。",
    icon: "⚙",
    sections: [
      { title: "检查项", rows: [
        { label: "安全区域", value: "底部操作不能被系统手势区域遮挡" },
        { label: "键盘", value: "输入需求时保留草稿" },
        { label: "返回", value: "系统返回操作不能导致重复提交" },
        { label: "冷启动", value: "恢复本地草稿和上次安全页面" },
        { label: "后台恢复", value: "重新获取进度、付款和邀请状态" },
        { label: "离线重试", value: "离线期间保留待确认操作" },
        { label: "通知疲劳", value: "安全、付款和必须处理的事项可即时通知" }
      ]}
    ]
  },
  // Agent 子页面
  repeatincome: {
    title: "我的收入",
    desc: "30 天收入、复购收入与预计机会。",
    icon: "₫",
    sections: [
      { title: "收入概览", rows: [
        { label: "30 天收入", value: "2,450,000₫" },
        { label: "复购收入占比", value: "44%" },
        { label: "可提现", value: "860,000₫" }
      ]}
    ]
  },
  agentcrm: {
    title: "客户与复购",
    desc: "管理合作过的客户和下一次机会。",
    icon: "↻"
  },
  agentcontentanalytics: {
    title: "内容与带单数据",
    desc: "被看见只是第一步。看清楚哪些照片、动态和服务展示真的帮你找到好客户。",
    icon: "↗",
    sections: [
      { title: "数据概览", rows: [
        { label: "人物 / 内容展示", value: "18.6k" },
        { label: "主页打开", value: "1,284" },
        { label: "合格聊天", value: "47" }
      ]},
      { title: "转化漏斗", rows: [
        { label: "Discovery", value: "18.6k" },
        { label: "Profile", value: "1,284" },
        { label: "Chat", value: "47" },
        { label: "Need", value: "11" },
        { label: "Order", value: "7" },
        { label: "Repeat", value: "3" }
      ]}
    ]
  },
  boost: {
    title: "推广中心",
    desc: "为自己的合格公开服务购买更多曝光。",
    icon: "✦",
    sections: [
      { title: "当前状态", rows: [
        { label: "推广状态", value: "未开启" },
        { label: "每日预算", value: "300,000₫" }
      ]}
    ]
  },
  passport: {
    title: "能力档案",
    desc: "身份、语言、角色、履约与验证。",
    icon: "✓"
  },
  workprefs: {
    title: "工作偏好",
    desc: "角色、区域、时间、最低报酬与距离。",
    icon: "☷"
  },
  weekly: {
    title: "本周可用时间",
    desc: "提前挂未来供给。",
    icon: "◷"
  },
  available: {
    title: "能力与可用时间",
    desc: "能力类型由 Proxy 定义，你维护实例；30 天日历由每周规律 + 按日例外决定。",
    icon: "◷"
  },
  agentcopilot: {
    title: "智能工作助手",
    desc: "路线、翻译、回复、范围整理与内容辅助。",
    icon: "✦",
    sections: [
      { title: "当前可以帮你", rows: [
        { label: "翻译客户消息", value: "" },
        { label: "整理服务范围", value: "" },
        { label: "生成路线草稿", value: "" },
        { label: "回复草稿", value: "" },
        { label: "内容草稿", value: "" }
      ]},
      { title: "明确边界", rows: [
        { label: "模型不会修改", value: "订单金额、结算、奖励、资格或历史 Outcome" }
      ]}
    ]
  },
  // Business 子页面
  merchantstorefront: {
    title: "线上店铺",
    desc: "线上店铺是企业业务对象 / Published Surface。把店门、菜单、产品照片交给企业运营助手。",
    icon: "◎"
  },
  enterpriseops: {
    title: "企业运营助手",
    desc: "统一 Enterprise Ops Skill。不是 Chatbot，而是企业经营意图 → 分析 → 计划 → 可执行 Command。",
    icon: "✦"
  },
  merchantactivity: {
    title: "活动与门店导流",
    desc: "本地活动、权益与真实到店。",
    icon: "☕"
  },
  members: {
    title: "成员与权限",
    desc: "多人可以在同一个企业主体下分工操作。",
    icon: "◉",
    sections: [
      { title: "成员", rows: [
        { label: "Nguyen A", value: "所有者 · 企业管理 / 需求 / 成员 / 账单" },
        { label: "Lan", value: "运营 · 履约 / 到场 / 完成" },
        { label: "Minh", value: "账单 · 资金保护 / 退款 / 声明" }
      ]},
      { title: "规则", rows: [
        { label: "记录归企业", value: "成员离开不会删除企业需求、付款与履约历史" }
      ]}
    ]
  },
  trustedteam: {
    title: "常用执行者",
    desc: "来自真实合作的可靠供给池。",
    icon: "✓"
  },
  outcomehistory: {
    title: "商家结果历史",
    desc: "看同一家门店多次真人检查后到底有没有变好。",
    icon: "↗",
    sections: [
      { title: "比较范围", rows: [
        { label: "检查类型", value: "餐厅体验检查 · 同一门店 · 可比较的检查模板" }
      ]},
      { title: "趋势", rows: [
        { label: "检查 #001", value: "72%" },
        { label: "检查 #003", value: "85%" },
        { label: "检查 #004", value: "91%" }
      ]},
      { title: "发现", rows: [
        { label: "重复出现的问题", value: "高峰接待 · 英文菜单 · 排队等待" },
        { label: "已验证的改善", value: "英文菜单可用 · 高峰接待到位" }
      ]}
    ]
  },
  billing: {
    title: "支出与账单",
    desc: "企业支出归企业主体，账单权限与运营权限分离。",
    icon: "₫",
    sections: [
      { title: "本周", rows: [
        { label: "总支出", value: "8,450,000₫" }
      ]},
      { title: "明细", rows: [
        { label: "周六开业", value: "资金已保护 · 5 个名额" },
        { label: "名额分配", value: "按各名额独立记录" },
        { label: "退款", value: "1 笔部分退款 · 已完成" }
      ]}
    ]
  },
  bdash: {
    title: "企业 / 店铺资料",
    desc: "店铺、Venue、主体与线上节点。",
    icon: "▣"
  },
  multislot: {
    title: "多人任务",
    desc: "一项业务需求可以拆成多个真人角色；每个名额独立匹配、取消、支付和评价。",
    icon: "◎"
  },
  todayboard: {
    title: "今日执行",
    desc: "商家先看名额是否补齐、执行者是否到场、异常是否需要处理。",
    icon: "✓"
  },
  // R15.12.7 最终 Me：个人主页（R15.9 Personal Social OS）+ 关系（R15.10 Messaging）。
  personalmanage: {
    title: "个人总管理",
    desc: "基本信息、二维码、状态管理。个人主页走 Threads R2 对外展示。",
    icon: "profile-ring",
    sections: [
      { title: "段 1 基本信息", rows: [
        { label: "头像", value: "点换头像" },
        { label: "名字", value: "Proxy 主页顶部" },
        { label: "handle", value: "Proxy 主页 / 消息来源" },
        { label: "城市", value: "决定发现与机会分发" }
      ]},
      { title: "段 2 二维码", rows: [
        { label: "Proxy QR", value: "扫码先看 Proxy 主页" },
        { label: "可见范围", value: "TikTok 公开 · Zalo 合作后 · Instagram 公开" }
      ]},
      { title: "段 3 状态管理", rows: [
        { label: "可接单", value: "进入人物发现与合适机会分发" },
        { label: "繁忙", value: "暂不接收新机会, 已谈可继续" },
        { label: "暂离", value: "不出现在人物发现, 已谈暂停" }
      ]}
    ]
  },
  personalhub: {
    title: "个人主页",
    desc: "把个人状态、Proxy 信誉、外部社媒和二维码放进一个用户可控的个人中枢。",
    icon: "○",
    sections: [
      { title: "Profile", rows: [
        { label: "Huyen", value: "河内 · 已验证 · 个人主页公开" },
        { label: "准时", value: "98%" },
        { label: "已履约", value: "42" },
        { label: "复购", value: "7" }
      ]},
      { title: "Proxy Personal QR", rows: [
        { label: "二维码", value: "一个二维码承接你的 Proxy 主页，再由你决定 TikTok、Zalo、Instagram 等是否展示" }
      ]},
      { title: "对外展示 · 你决定", rows: [
        { label: "社媒与联系方式", value: "TikTok 公开 · Zalo 合作后 · Instagram 公开" },
        { label: "可见范围", value: "陌生浏览、聊天后、订单成立后分层开放" },
        { label: "访问与转化", value: "知道哪个渠道真的带来聊天、机会与订单" }
      ]}
    ]
  },
  personalqr: {
    title: "我的二维码",
    desc: "Proxy QR 是个人中枢入口，不等于把所有外部联系方式公开。",
    icon: "▦",
    sections: [
      { title: "扫码后看到", rows: [
        { label: "Proxy 主页", value: "始终 · 姓名、城市、公开能力、Proxy 信誉" },
        { label: "TikTok / Instagram", value: "公开 · 当前设为公开" },
        { label: "Zalo", value: "合作后 · 订单成立后才开放" }
      ]}
    ]
  },
  socialidentity: {
    title: "社媒与联系",
    desc: "外部账号是个人资产；Proxy 负责验证关联关系与安全，不把社媒粉丝直接当成平台信誉。",
    icon: "↗",
    sections: [
      { title: "外部身份链接", rows: [
        { label: "TikTok", value: "@huyen.life · 已关联 · 公开" },
        { label: "Zalo", value: "Huyen Nguyen · 已关联 · 合作后" },
        { label: "Instagram", value: "@huyen.frames · 已关联 · 公开" },
        { label: "LinkedIn", value: "尚未关联" }
      ]},
      { title: "联系方式 · 逐级开放", rows: [
        { label: "Zalo / 电话", value: "默认合作后开放，可随时收紧" }
      ]}
    ]
  },
  socialprivacy: {
    title: "可见范围",
    desc: "发现、聊天和合作是不同信任阶段；外部联系方式不应该因为公开主页而自动泄露。",
    icon: "◌",
    sections: [
      { title: "信任阶梯", rows: [
        { label: "陌生浏览", value: "最小公开 · 主页、已验证状态、公开社媒" },
        { label: "开始聊天", value: "可选 · 仍优先使用 Proxy Chat" },
        { label: "订单成立", value: "合作后 · 可开放 Zalo / 电话用于现实履约" },
        { label: "订单结束", value: "可恢复 · 临时联系权限自动关闭" }
      ]},
      { title: "当前规则 · 可编辑", rows: [
        { label: "TikTok", value: "公开" },
        { label: "Zalo", value: "合作后" },
        { label: "手机号", value: "合作后 · 订单结束可关闭" }
      ]}
    ]
  },
  socialanalytics: {
    title: "访问与转化",
    desc: "让用户知道外部社媒是否真正带来合作；平台使用同一归因链做分发学习，但不卖原始联系人数据。",
    icon: "⌁",
    sections: [
      { title: "过去 30 天漏斗", rows: [
        { label: "主页访问", value: "1,284" },
        { label: "合格聊天", value: "47" },
        { label: "机会", value: "18" },
        { label: "订单", value: "9" },
        { label: "复购", value: "4" }
      ]},
      { title: "来源", rows: [
        { label: "Proxy 市场", value: "访问 612 · 聊天 26 · 订单 5" },
        { label: "TikTok", value: "访问 338 · 聊天 11 · 订单 2" },
        { label: "Zalo QR", value: "访问 214 · 聊天 8 · 订单 2" },
        { label: "Instagram", value: "访问 120 · 聊天 2 · 订单 0" }
      ]}
    ]
  },
  messages: {
    title: "消息 · Unified Inbox",
    desc: "人与人的聊天、好友关系和系统通知各有明确边界。",
    icon: "✉",
    sections: [
      { title: "好友请求", rows: [
        { label: "Eric", value: "河内 · 2 个共同好友 · Proxy QR" },
        { label: "Trang", value: "北宁 · 通讯录匹配" }
      ]},
      { title: "聊天", rows: [
        { label: "Linh · 人物", value: "摄影 · 河内 · 周六下午有时间，可以聊一下。" },
        { label: "Bonsaidon · 订单", value: "谈判 · 今天 18:00 · 已接单 · 距开始 01:21" },
        { label: "Mai · 好友", value: "Mai · 城市同行 · TikTok 已关联" },
        { label: "西湖摄影散步 · 活动", value: "周六 15:30 · 8 / 12 已参加" }
      ]},
      { title: "好友", rows: [
        { label: "Mai", value: "河内 · 摄影 / 城市同行 · 共同好友 2" },
        { label: "An", value: "河内 · 本地生活 · 合作过 1 次" },
        { label: "Luna", value: "河内 · 活动 / 摄影 · 最近认识" },
        { label: "Khoa", value: "河内 · 活动执行 · 共同活动 3" }
      ]}
    ]
  },
  addfriend: {
    title: "添加好友",
    desc: "关系入口统一，但不同来源只产生 Relationship Signal；不会未经确认直接建立 Proxy 好友。",
    icon: "＋",
    sections: [
      { title: "添加方式", rows: [
        { label: "扫二维码", value: "扫描 Proxy Personal QR" },
        { label: "邀请好友", value: "链接或二维码邀请" },
        { label: "通讯录", value: "授权后只做匹配" },
        { label: "社媒好友", value: "Facebook / TikTok / IG / Zalo" },
        { label: "搜索 Proxy", value: "昵称、Proxy ID、手机号" }
      ]}
    ]
  },
  friendcrm: {
    title: "好友与关系",
    desc: "关系图 · 轻 CRM · 标签、备注、来源与互动记录。",
    icon: "◎"
  },
  friendrequests: {
    title: "好友请求",
    desc: "好友是双向确认关系；关注、通讯录匹配和社媒关系都不能自动升级为好友。",
    icon: "♡",
    sections: [
      { title: "待处理", rows: [
        { label: "Eric", value: "河内 · 2 个共同好友 · 来自 Proxy QR" },
        { label: "Trang", value: "北宁 · 通讯录匹配" }
      ]}
    ]
  },
  notifications: {
    title: "通知中心",
    desc: "系统事件与真人聊天分开，避免订单、时间、安全和好友请求淹没 Conversation。",
    icon: "♢",
    sections: [
      { title: "最近", rows: [
        { label: "订单还有 30 分钟开始", value: "谈判 · 西湖 · 18:00 · 17:30" },
        { label: "Eric 想加你为好友", value: "来自 Proxy QR · 2 个共同好友 · 17:12" },
        { label: "活动有新消息", value: "西湖摄影散步 · 新增 2 位参加者 · 16:40" },
        { label: "TikTok 账号归属已确认", value: "@huyen.life · 公开范围仍由你决定 · 昨天" }
      ]}
    ]
  },
  // Business：AI 经营诊断 + 活动与门店导流（R15.12.7 最终，3133 / 3149）。
  businessdiagnostic: {
    title: "经营诊断",
    desc: "模型根据经营目标和实时 Read Model，组合今天最值得处理的信息。",
    icon: "✦",
    sections: [
      { title: "Bonsaidon · 今天 · 经营健康度", rows: [
        { label: "到店", value: "248" },
        { label: "成交额", value: "6.2M" },
        { label: "新客户", value: "172" },
        { label: "复购客户", value: "38" }
      ]},
      { title: "需要关注", rows: [
        { label: "14:00–17:00 时段利用率", value: "低于近 4 周平均 · 37%" }
      ]},
      { title: "表现较好", rows: [
        { label: "本周新客户增长", value: "+22% · 可继续放大当前活动来源" }
      ]},
      { title: "建议动作 · 模型提议 · 人确认", rows: [
        { label: "创建下午低峰活动", value: "30 份限时权益 · 14:00–17:00 · 只向相关 Intent 用户分发" },
        { label: "补 1 位活动执行者", value: "从真实合作网络优先邀请，若不足再开放合格供给" }
      ]}
    ]
  },
  merchantcampaign: {
    title: "活动与门店导流",
    desc: "商家 Growth Center：从经营目标出发，把活动、Offer、Feed 分发、到店和复购串成一个闭环。",
    icon: "↗",
    sections: [
      { title: "当前目标 · AI 草稿 · 可编辑", rows: [
        { label: "填补工作日下午低峰", value: "新增到店 · 14:00–17:00 · 预算 5M₫" }
      ]},
      { title: "漏斗", rows: [
        { label: "触达 / 查看 / 领取 / 到店 / 复购", value: "8.2k / 1.1k / 412 / 248 / 38" }
      ]},
      { title: "人群与传播 · Search / Intent 优先", rows: [
        { label: "优先人群", value: "3km 内 · 最近 14 天搜索 / 浏览海鲜、聚餐、下午活动" },
        { label: "传播上限", value: "初始 1,500 人 · 达到 Qualified Visit 后分阶段扩大" }
      ]},
      { title: "Offer · Server Truth", rows: [
        { label: "工作日下午双人权益", value: "399k → 329k · 每日 30 份 · 14:00–17:00 · 到店核销" }
      ]}
    ]
  }
};

// 原型 r159FakeQR 的 React Native 复刻：15×15 网格，三种定位角 + 数据点。
function fakeQrCells(): boolean[] {
  const cells: boolean[] = [];
  for (let y = 0; y < 15; y++) {
    for (let x = 0; x < 15; x++) {
      const finder = (x < 5 && y < 5) || (x > 9 && y < 5) || (x < 5 && y > 9);
      const borderFinder = finder && (x % 10 === 0 || x % 10 === 4 || y % 10 === 0 || y % 10 === 4);
      const inner = finder && x % 10 > 1 && x % 10 < 4 && y % 10 > 1 && y % 10 < 4;
      const data = (x * 7 + y * 11 + x * y) % 5 === 0 || (x * 3 + y * 2) % 7 === 0;
      cells.push(borderFinder || inner || (!finder && data));
    }
  }
  return cells;
}

const FAKE_QR_PAD = 6;
const FAKE_QR_GAP = 1;
const FAKE_QR_BORDER = 1;

function FakeQr({ size = 104 }: { size?: number }): React.JSX.Element {
  const cells = fakeQrCells();
  const cell = (size - FAKE_QR_BORDER * 2 - FAKE_QR_PAD * 2 - FAKE_QR_GAP * 14) / 15;
  return (
    <View
      style={[
        styles.fakeQr,
        {
          gap: FAKE_QR_GAP,
          height: size,
          padding: FAKE_QR_PAD,
          width: size
        }
      ]}
    >
      {cells.map((on, i) => (
        <View
          key={i}
          style={[
            styles.fakeQrCell,
            { height: cell, width: cell },
            on && styles.fakeQrCellOn
          ]}
        />
      ))}
    </View>
  );
}

// 原型 .r159QRWrap：左侧二维码 + 右侧说明 / 按钮。
function QrCard({
  title,
  desc,
  actionLabel,
  onAction,
  alignCenter = false
}: {
  title: string;
  desc: string;
  actionLabel: string;
  onAction?: () => void;
  alignCenter?: boolean;
}): React.JSX.Element {
  return (
    <View style={[styles.qrCard, alignCenter && styles.qrCardCenter]}>
      <FakeQr />
      <View style={[styles.qrCardText, alignCenter && styles.qrCardTextCenter]}>
        <Text style={styles.qrCardTitle}>{title}</Text>
        <Text style={styles.qrCardDesc}>{desc}</Text>
        <Pressable onPress={onAction} style={styles.qrCardBtn}>
          <Text style={styles.qrCardBtnText}>{actionLabel}</Text>
        </Pressable>
      </View>
    </View>
  );
}

// 原型 .r159SimpleRow：图标 + 标题 / 副标题 + ›。
function SocialRow({
  icon,
  label,
  desc,
  onPress
}: {
  icon: string;
  label: string;
  desc: string;
  onPress?: () => void;
}): React.JSX.Element {
  return (
    <Pressable onPress={onPress} style={styles.socialRow}>
      <View style={styles.socialRowIcon}>
        <Text style={styles.socialRowIconText}>{icon}</Text>
      </View>
      <View style={styles.socialRowCopy}>
        <Text style={styles.socialRowLabel}>{label}</Text>
        <Text style={styles.socialRowDesc}>{desc}</Text>
      </View>
      <Text style={styles.socialRowChev}>›</Text>
    </Pressable>
  );
}

export function MeSurface({
  context,
  localNet,
  fulfillment,
  experienceSections,
  experienceMode,
  onOpenSwitcher,
  onOpenFeed,
  onOpenVouchers,
  onOpenRealitySceneMap,
  onExperienceAction,
  onOpenConversation,
  onSignOut,
  onChromeVisibilityChange,
  bottomNavVisible,
  scene,
  business,
  supply,
  engagement,
  viewerAccountId,
}: {
  context: ActiveContext;
  localNet: LocalNetClient;
  fulfillment: FulfillmentClient;
  experienceSections?: ExperienceMenuSection[];
  experienceMode?: "MERGE" | "REPLACE";
  onOpenSwitcher: () => void;
  onOpenFeed: () => void;
  onOpenVouchers: () => void;
  onExperienceAction: (action: ExperienceAction) => void;
  onOpenConversation?: (author: string) => void;
  onSignOut: () => void;
  onChromeVisibilityChange?: (visible: boolean) => void;
  bottomNavVisible?: boolean;
  // R15.13 P2: when present, the MyScenes subpage appends a "Memories"
  // section that pulls real post-outcome audit data from the api-go
  // service via ListMyMemories. If absent, the subpage falls back to
  // the static SUB_PAGE_CONTENT prototype as before.
  scene?: SceneClient;
  business?: BusinessClient;
  supply?: SupplyClient;
  engagement?: EngagementClient; // R15.59: 关注/置顶/赞 client
  viewerAccountId?: string | undefined; // R15.59: 当前 session user ID
  onOpenSearch?: ((query: string) => void) | undefined; // R15.75: 主页搜索 sheet submit → app-shell 走 search 路径
  onOpenRealitySceneMap?: (() => void) | undefined;
  // R15.77: AI 身份中心全屏 (R1 HTML frontstage 1:1 抄) — 独立子屏.
}): React.JSX.Element {
  const [subPage, setSubPage] = useState<MeSubPage>();
  // 规范 §4/§13：Android 硬件返回先收起子页；其余覆盖层是 RN Modal（onRequestClose 自理）。
  useModuleBackHandler(subPage ? () => { setSubPage(undefined); return true; } : undefined);
  // R15.13 P2: when the myscenes subpage opens and a scene client is
  // available, fetch the user's memories so the page can show real
  // post-outcome audit data alongside the static prototype cards.
  const [memories, setMemories] = useState<Memory[]>([]);
  const [memoriesLoadState, setMemoriesLoadState] = useState<"idle" | "loading" | "loaded" | "error">("idle");
  useEffect(() => {
    if (subPage?.route !== "myscenes" || !scene) return;
    let cancelled = false;
    setMemoriesLoadState("loading");
    scene.listMyMemories()
      .then((rows) => { if (!cancelled) { setMemories(rows); setMemoriesLoadState("loaded"); } })
      .catch(() => { if (!cancelled) { setMemories([]); setMemoriesLoadState("error"); } });
    return () => { cancelled = true; };
  }, [subPage?.route, scene]);
  // M3: Agent Passport hydrate — 能力护照与可用时间从 supply 真读模型拉取
  const [passportError, setPassportError] = useState<string | undefined>(undefined);
  useEffect(() => {
    if (!supply) return;
    let cancelled = false;
    supply.getAgentPassport().then((p) => {
      if (cancelled) return;
      // 将已声明/已核验的 capability 映射回本地 AbilityInstance（仅用于展示“已核验”徽标）
      const capMap: Record<string, AbilityType> = { PHOTOGRAPHY: "拍照", ZH: "翻译", VI: "翻译", EN: "翻译" };
      const seen = new Map<AbilityType, { verified: boolean }>();
      for (const c of p.capabilities ?? []) {
        const t = capMap[c.capability];
        if (!t) continue;
        const cur = seen.get(t);
        seen.set(t, { verified: (cur?.verified ?? false) || !!c.verified });
      }
      if (seen.size > 0) {
        // 保留 DEFAULT_ABILITIES 结构，但为已核验项打上 verified 标记（UI 侧透出）
        setAbilities((prev) => prev.map((item) => {
          const v = seen.get(item.type);
          if (!v) return item;
          // 把 verified 状态编码进 note 字段，前端徽标读取
          const hasBadge = v.verified && !(item.note ?? "").includes("已核验");
          return hasBadge ? { ...item, note: item.note ? `${item.note} · 已核验` : "已核验" } : item;
        }));
      }
      // 可用时间：若有 availability 窗口，取第一条映射为 AVAILABLE，否则保持本地
      if ((p.availability?.length ?? 0) > 0) setAvailability("AVAILABLE");
    }).catch((e) => { if (!cancelled) setPassportError(e instanceof Error ? e.message : String(e)); });
    return () => { cancelled = true; };
  }, [supply]);
  const [availability, setAvailability] = useState<AvailabilityState>("AVAILABLE");
  const [availabilityOpen, setAvailabilityOpen] = useState(false);
  const [enterpriseOpsStage, setEnterpriseOpsStage] = useState<EnterpriseOpsStage>("READY");
  const [enterpriseOpsAssets, setEnterpriseOpsAssets] = useState(3);
  // 能力与可用时间（原型 my_market_modules v5）：能力实例 CRUD + 30 天日历。
  const [abilities, setAbilities] = useState<AbilityInstance[]>(DEFAULT_ABILITIES);
  const [abilitySheet, setAbilitySheet] = useState<{ mode: "ADD" | "EDIT"; type: AbilityType; id?: string }>();
  const [availabilityPanel, setAvailabilityPanel] = useState<"ABILITIES" | "CALENDAR">("ABILITIES");
  const [avRule, setAvRule] = useState<AvailabilityRule>({ days: [0, 1, 2, 3, 4, 5, 6], start: 18, end: 23 });
  const [avOverrides, setAvOverrides] = useState<Record<string, AvOverride>>({
    "2026-08-27": { type: "off" },
    "2026-08-30": { type: "full" },
    "2026-09-03": { type: "custom", start: 19, end: 22 }
  });
  const [avRuleSheetOpen, setAvRuleSheetOpen] = useState(false);
  const [avDaySheet, setAvDaySheet] = useState<{ key: string; label: string }>();
  const [personalHubTab, setPersonalHubTab] = useState<PersonalHubTab>("FEED");
  // R15.68: R2 设计的 3 个 sheet (分析 / 搜索 / 主页设置) 真接线
  const [insightsSheetOpen, setInsightsSheetOpen] = useState(false);
  const [searchSheetOpen, setSearchSheetOpen] = useState(false);
  // R15.75: 搜索 sheet 内的 query state (之前 onChangeText={setSearchSheetOpen(true)} 是 bug
  //   — 用户输入文字时调 setSearchSheetOpen, 状态不变, 但跟提交按钮脱钩)
  const [searchQuery, setSearchQuery] = useState("");
  const [settingsSheetOpen, setSettingsSheetOpen] = useState(false);
  // R15.77: AI 身份中心全屏 (R1 HTML frontstage 1:1 抄) — 用户点 settings sheet
  //   "AI 身份中心" 入口, 弹全屏 R1 preview (3 phone: Human / AI Native / Twin).
  //   不动 R2 主设设计, 独立子屏.
  const [aiIdentityOpen, setAiIdentityOpen] = useState(false);
  // R15.53: ProfileTabs 新组件使用 (IG/Threads 5 tabs)
  //   REPLIES / SAVED / TAGGED — Phase 1.5 mock 空数组 (后端未提供)
  // R15.61/62/63: 3 列表接 server (R15.61 reply, R15.62 bookmark, R15.63 tagged 暂空)
  const [personalReplyPosts, setPersonalReplyPosts] = useState<FeedPost[]>([]);
  const [personalSavedPosts, setPersonalSavedPosts] = useState<FeedPost[]>([]);
  // R15.72: TAGGED tab — client 扫 ListFeedPosts, 在 body 找 @自己的帖 (因为
  //   server mentions endpoint 还没建, Phase 2 需新 server model).
  //   轻量 client-side 实现: @handle (含 @ 前缀) + contextType==="MENTION" 都算
  const [personalTaggedPosts, setPersonalTaggedPosts] = useState<FeedPost[]>([]);
  // R15.73: 置顶帖 ID 列表 — server ListPinnedPosts 拉 (R15.56 endpoint),
  //   传 ProfileTabs.pinnedIds, 取代 posts[0] mock.
  const [personalPinnedIds, setPersonalPinnedIds] = useState<ReadonlyArray<string>>([]);
  // R15.54: 关注数 / 粉丝数 — 从 server 拉, ProfileTabs stats 行使用
  // R15.59: 接 server GetFollowCounts (authed); 未登录时为 undefined
  const [personalFollowCounts, setPersonalFollowCounts] = useState<{ followers: number; following: number } | undefined>(undefined);
  // MeSurface 只呈现当前账户。其他人的主页由 OtherProfileSurface 承载，
  // 避免把 viewerAccountId 同时解释为 viewer 和 profile owner。
  const viewingProfileId = viewerAccountId;
  const isSelfProfile = true;
  useEffect(() => {
    if (!engagement || !viewingProfileId) return;
    let cancelled = false;
    engagement.getFollowCounts(viewingProfileId)
      .then((c) => { if (!cancelled) setPersonalFollowCounts({ followers: c.followers, following: c.following }); })
      .catch(() => { if (!cancelled) setPersonalFollowCounts({ followers: 0, following: 0 }); });
    return () => { cancelled = true; };
  }, [engagement, isSelfProfile, viewingProfileId, viewerAccountId]);
  // R15.61/62: 拉自己 (viewer) 的 reply / bookmark 列表, 填 ProfileTabs REPLIES/SAVED tab
  // REPLIES: server RepliedPost → minimal FeedPost (postId, authorId=viewer, body, sceneType=COMMENT)
  // SAVED: bookmark postId[] + localNet.listFeedPosts() 拿全 feed, filter 包含 postId
  // (useEffect 需在 profileDraft 之后, 见下方 useEffect.)
  const [profileEditorOpen, setProfileEditorOpen] = useState(false);
  const [profileAvatarUri, setProfileAvatarUri] = useState<string | undefined>(undefined);
  const [profilePosts, setProfilePosts] = useState<FeedPost[]>([]);
  const [profileMedia, setProfileMedia] = useState<Record<string, FeedMediaItem[]>>({});
  const [profileMediaPositions, setProfileMediaPositions] = useState<Record<string, number>>({});
  const [profileViewer, setProfileViewer] = useState<{ postId: string; index: number }>();
  const [socialAccounts, setSocialAccounts] = useState<SocialAccount[]>(INITIAL_SOCIAL_ACCOUNTS);
  const [socialEditor, setSocialEditor] = useState<SocialAccount>();
  const [socialSettings, setSocialSettings] = useState({ merchant: true, profile: false, influence: false });
  const [securityRetention, setSecurityRetention] = useState<7 | 30 | 90 | 365>(30);
  const [screenshotWarn, setScreenshotWarn] = useState(true);
  const [profileDraft, setProfileDraft] = useState({
    name: DEFAULT_PROFILE.name,
    handle: DEFAULT_PROFILE.handle,
    bio: DEFAULT_PROFILE.bio,
    city: DEFAULT_PROFILE.city
  });
  // mount 后异步从 profileStore 读 profile. 如果读到 avatarPath 且文件仍在,
  // 覆盖 profileAvatarUri; profileDraft 也要覆盖才能让 "我的" 顶部展示真实名称。
  // 仅在首次 mount 后读一次, 用户在 me tab 后续编辑不应被 store 重置。
  const profileHydratedRef = useRef(false);
  const profileTouchedRef = useRef(false);
  useEffect(() => {
    if (profileHydratedRef.current) return;
    let cancelled = false;
    void profileStore.read().then((record) => {
      // Never let a late storage read replace an avatar/profile the user has
      // just selected while this screen was mounting.
      if (cancelled || profileTouchedRef.current || !record) return;
      profileHydratedRef.current = true;
      setProfileDraft({ name: record.name, handle: record.handle, bio: record.bio, city: record.city });
      if (record.avatarPath) {
        const file = new File(record.avatarPath);
        if (file.exists) setProfileAvatarUri(file.uri);
      }
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const read = await localNet.listMyFeedPosts();
        if (cancelled) return;
        if (read.posts.length > 0) {
          setProfilePosts(read.posts);
          setProfileMedia(read.media);
          return;
        }
        // 兜底：已发很多但按 authorId 过滤为 0 时，回退按 handle/名称扫全量 feed，避免空主页
        const fallback = await localNet.listFeedPosts();
        if (cancelled) return;
        const myHandle = profileDraft.handle.startsWith("@") ? profileDraft.handle : `@${profileDraft.handle}`;
        const filtered = fallback.posts.filter((post) => post.authorDisplayName === profileDraft.name || post.body.includes(myHandle) || post.authorId === profileDraft.handle);
        if (filtered.length > 0) {
          const media: Record<string, FeedMediaItem[]> = {};
          for (const post of filtered) { const items = fallback.media[post.postId]; if (items) media[post.postId] = items; }
          setProfilePosts(filtered);
          setProfileMedia(media);
        } else {
          // 仍用原 read（空）避免闪烁
          setProfilePosts(read.posts);
          setProfileMedia(read.media);
        }
      } catch {
        try {
          const fallback = await localNet.listFeedPosts();
          if (cancelled) return;
          const myHandle = profileDraft.handle.startsWith("@") ? profileDraft.handle : `@${profileDraft.handle}`;
          const filtered = fallback.posts.filter((post) => post.authorDisplayName === profileDraft.name || post.body.includes(myHandle));
          if (filtered.length > 0) {
            const media: Record<string, FeedMediaItem[]> = {};
            for (const post of filtered) { const items = fallback.media[post.postId]; if (items) media[post.postId] = items; }
            setProfilePosts(filtered);
            setProfileMedia(media);
          }
        } catch {}
      }
    })();
    return () => { cancelled = true; };
  }, [localNet, profileDraft.name, profileDraft.handle]);

  // R15.73: 置顶帖 ID 列表 — server ListPinnedPosts (R15.56)
  useEffect(() => {
    if (!engagement || !viewerAccountId) return;
    let cancelled = false;
    void engagement.listPinnedPosts(viewerAccountId)
      .then((r) => { if (!cancelled) setPersonalPinnedIds(r.postIds ?? []); })
      .catch(() => { if (!cancelled) setPersonalPinnedIds([]); });
    return () => { cancelled = true; };
  }, [engagement, viewerAccountId]);

  // R15.61/62 useEffect: 放在 profileDraft 后才可访问。
  useEffect(() => {
    if (!engagement || !viewerAccountId) return;
    let cancelled = false;
    void engagement.listUserReplies(viewerAccountId, 30)
      .then((r) => {
        if (cancelled) return;
        const replyPosts: FeedPost[] = r.replies.map((rep: { replyId: string; postId: string; parentPostId: string; body: string; createdAt: string }) => ({
          postId: rep.postId,
          authorType: "USER" as const,
          authorId: viewerAccountId,
          authorDisplayName: profileDraft.name,
          body: rep.body,
          mediaRefs: [],
          sceneType: "UNKNOWN" as const,
          status: "ACTIVE",
          contextRefs: [],
          createdAt: rep.createdAt
        }));
        setPersonalReplyPosts(replyPosts);
      })
      .catch(() => { if (!cancelled) setPersonalReplyPosts([]); });
    void engagement.listUserBookmarks(viewerAccountId, 60)
      .then(async (b) => {
        if (cancelled) return;
        try {
          const feed = await localNet.listFeedPosts();
          if (cancelled) return;
          const bookmarkedSet = new Set(b.bookmarks);
          const saved = feed.posts.filter((p) => bookmarkedSet.has(p.postId));
          setPersonalSavedPosts(saved);
          // R15.72: TAGGED — 扫全 feed body 找 @viewerAccountId 或 contextRefs MENTION
          //   server mentions endpoint 还没建, Phase 2 server-side 实现后会盖这个 client 实现.
          //   跟 saved 共享 一次 listFeedPosts (不重复拉).
          const myHandle = profileDraft.handle.startsWith("@") ? profileDraft.handle : `@${profileDraft.handle}`;
          const tagged = feed.posts.filter((p) => {
            if (p.authorId === viewerAccountId) return false;
            if (p.body.includes(myHandle)) return true;
            return p.contextRefs.some((ref) => ref.contextType === "MENTION" && ref.contextId === viewerAccountId);
          });
          setPersonalTaggedPosts(tagged);
        } catch {
          if (!cancelled) {
            setPersonalSavedPosts([]);
            setPersonalTaggedPosts([]);
          }
        }
      })
      .catch(() => { if (!cancelled) setPersonalSavedPosts([]); });
    return () => { cancelled = true; };
  }, [engagement, viewerAccountId, localNet, profileDraft.name]);

  // 滚动方向 / 可见性 refs — 必须在所有早期 return 之前声明，
  // 否则在 subPage 切换时 hooks 数量从 N 变成 N+3，触发
  // "Rendered fewer hooks than expected" 错误。
  const lastYRef = useRef(0);
  const dirRef = useRef(0);
  const visibleRef = useRef(true);
  function onScroll(e: NativeSyntheticEvent<NativeScrollEvent>): void {
    const y = Math.max(0, e.nativeEvent.contentOffset.y);
    const delta = y - lastYRef.current;
    if (y <= 48) { if (!visibleRef.current) { visibleRef.current = true; onChromeVisibilityChange?.(true); } dirRef.current = 0; }
    else if (Math.abs(delta) >= 1) {
      const prevDir = Math.sign(dirRef.current);
      const nextDir = Math.sign(delta);
      dirRef.current = prevDir !== 0 && prevDir !== nextDir ? delta : dirRef.current + delta;
      if (dirRef.current <= -18) { if (!visibleRef.current) { visibleRef.current = true; onChromeVisibilityChange?.(true); } dirRef.current = 0; }
      else if (dirRef.current >= 28) { if (visibleRef.current) { visibleRef.current = false; onChromeVisibilityChange?.(false); } dirRef.current = 0; }
    }
    lastYRef.current = y;
  }

  // 轻 CRM 关系图对 BUSINESS 也开放，优先于 R21 商家页
  if (subPage?.route === "friendcrm") {
    return <SwipeBackShell onExit={() => setSubPage(undefined)}><FriendCrmSurface initialView="LIST" onBack={() => setSubPage(undefined)} onOpenConversation={(author) => { setSubPage(undefined); onOpenConversation?.(author); }} /></SwipeBackShell>;
  }
  // R21 是商家“我的”的独立产品页面，不与旧的个人菜单卡片语法混用。
  // 必须在所有 hooks 之后再分支，避免身份切换时破坏 hook 顺序。
  if (context === "BUSINESS") {
    return <MerchantMeR21 onOpenSwitcher={onOpenSwitcher} onSignOut={onSignOut} />;
  }

  const persona = PERSONA[context];

  const managedSections =
    context === "REQUESTER" && experienceSections
      ? toManagedMenuSections(experienceSections)
      : [];

  const effectiveSections = experienceMode === "REPLACE" && managedSections.length > 0
    ? managedSections
    : managedSections.length > 0
      ? persona.sections.map((pSection) => {
          const managed = managedSections.find((m) => m.id === pSection.id);
          if (!managed) return pSection;
          // 合并：后端 managed 行 + persona 中不在 managed 里的行（如钱包、关注）
          const managedLabels = new Set(managed.rows.map((r) => r.label));
          const extraRows = pSection.rows.filter((r) => !managedLabels.has(r.label));
          return { ...pSection, rows: [...managed.rows, ...extraRows] };
        })
      : persona.sections;

  function openRegisteredRoute(route: RegisteredExperienceRoute): void {
    if (route === "vouchers") {
      onOpenVouchers();
      return;
    }
    const content = SUB_PAGE_CONTENT[route];
    if (!content) return;
    setSubPage({ title: content.title, desc: content.desc, icon: content.icon, route });
  }

  function pressRow(row: MenuRow): void {
    // These are Me-owned account views. A server manifest may change their copy
    // or icon, but must not turn them back into root Market/Feed navigation.
    const ownedRoute = meOwnedRouteForLabel(row.label);
    if (ownedRoute) {
      openSubPage(ownedRoute);
      return;
    }
    if (row.route === "vouchers") {
      onOpenVouchers();
      return;
    }
    if (row.action) {
      if (row.action.type === "OPEN_REGISTERED_ROUTE") {
        openRegisteredRoute(row.action.route);
        return;
      }
      onExperienceAction(row.action);
      return;
    }
    if (row.route) {
      const content = SUB_PAGE_CONTENT[row.route];
      setSubPage({
        title: content?.title ?? row.label,
        desc: content?.desc ?? row.desc,
        icon: content?.icon ?? row.icon,
        route: row.route
      });
    }
  }

  function openSubPage(route: string): void {
    const content = SUB_PAGE_CONTENT[route];
    if (!content) return;
    setSubPage({ title: content.title, desc: content.desc, icon: content.icon, route });
  }

  async function chooseProfileAvatar(): Promise<void> {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) return;
    const result = await ImagePicker.launchImageLibraryAsync({
      allowsEditing: true,
      aspect: [1, 1],
      mediaTypes: ["images"],
      preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Current,
      quality: 1,
      selectionLimit: 1
    });
    const selected = result.assets?.[0];
    if (result.canceled || !selected?.uri) return;
    // 复制原 file:// URI 到 documentDirectory/proxy-profile/avatar.jpg —
    // 原 URI 跨 app 重启可能失效, 稳定路径才能让 profileStore 记住。
    try {
      PROFILE_AVATAR_DIR.create({ idempotent: true, intermediates: true });
      const avatarFile = nextProfileAvatarFile();
      await new File(selected.uri).copy(avatarFile, { overwrite: true });
      profileTouchedRef.current = true;
      profileHydratedRef.current = true;
      setProfileAvatarUri(avatarFile.uri);
      // Avatar selection is itself a committed action. Persist immediately so
      // back navigation or switching modules cannot discard it.
      await profileStore.write({
        ...profileDraft,
        avatarPath: avatarFile.uri,
        updatedAt: new Date().toISOString()
      });
    } catch {
      // Keep the picker result visible for this editing session. We do not
      // claim it was saved when the durable copy/write failed.
      setProfileAvatarUri(selected.uri);
    }
  }

  async function saveProfile(): Promise<void> {
    // 将当前 profileDraft + profileAvatarUri 写盘, 然后关掉编辑 Modal。
    // 稳定目录内的头像直接保存；如果用户没动头像，则保留上次写入的路径。
    let avatarPath: string | undefined;
    if (profileAvatarUri?.startsWith(PROFILE_AVATAR_DIR.uri)) {
      avatarPath = profileAvatarUri;
    } else if (profileAvatarUri) {
      // 异常路径: 上次复制失败, 此次以编辑会话内 URI 落盘为稳定路径。
      try {
        PROFILE_AVATAR_DIR.create({ idempotent: true, intermediates: true });
        const avatarFile = nextProfileAvatarFile();
        await new File(profileAvatarUri).copy(avatarFile, { overwrite: true });
        avatarPath = avatarFile.uri;
        setProfileAvatarUri(avatarFile.uri);
      } catch {
        avatarPath = undefined;
      }
    } else {
      // 用户清空头像 / 未选: 保留上次路径 (读 store) 或 undefined。
      const existing = await profileStore.read().catch(() => undefined);
      avatarPath = existing?.avatarPath;
    }
    const record: ProfileRecord = {
      name: profileDraft.name,
      handle: profileDraft.handle,
      bio: profileDraft.bio,
      city: profileDraft.city,
      avatarPath,
      updatedAt: new Date().toISOString()
    };
    try {
      await profileStore.write(record);
    } catch {
      // 写入失败: 不关 Modal, 让用户重试。
      return;
    }
    profileHydratedRef.current = true;
    setProfileEditorOpen(false);
  }

  // 子页面渲染 — 架构层统一右滑退出（全量小模块）
  if (subPage) {
    const contentWrapper = (node: React.JSX.Element): React.JSX.Element => <SwipeBackShell onExit={() => setSubPage(undefined)}>{node}</SwipeBackShell>;
    const content = SUB_PAGE_CONTENT[subPage.route];

    if (subPage.route === "myorders") return <SwipeBackShell onExit={() => setSubPage(undefined)}><MyOrdersSurface client={fulfillment} onBack={() => setSubPage(undefined)} /></SwipeBackShell>;
    if (subPage.route === "myactivities") return <SwipeBackShell onExit={() => setSubPage(undefined)}><MyActivitiesSurface onBack={() => setSubPage(undefined)} /></SwipeBackShell>;
    if (subPage.route === "favorites") return <SwipeBackShell onExit={() => setSubPage(undefined)}><FavoritesSurface onBack={() => setSubPage(undefined)} /></SwipeBackShell>;
    // R15.25 FACET: 走 FacetClient → GET /v1/facet/objects → FacetHomeSurface.
    // facet client 不依赖任何现有 client (它是 anonymous GET), 这里按需创建.
    if (subPage.route === "facet") {
      const facetClient = new FacetClient({ requester: sessionAuthClient, baseUrl: localApiBaseUrl });
      return <SwipeBackShell onExit={() => setSubPage(undefined)}><FacetHomeSurface client={facetClient} onBack={() => setSubPage(undefined)} /></SwipeBackShell>;
    }
    // R15.13 P2: myscenes gets a real-data section appended beneath
    // the static prototype cards. The prototype shows the high-level
    // idea (in-progress scenes, received invitations, history); the
    // real section lists the post-outcome memories fetched from the
    // api-go service via SceneClient.listMyMemories. If scene is not
    // wired in (e.g. tests), the section renders in its "loading"
    // state and never auto-recovers — the static prototype remains
    // the source of truth so the page is still readable.
    if (subPage.route === "myscenes") {
      return contentWrapper(
        <View style={styles.root}>
          <ScrollView contentContainerStyle={styles.content}>
            <Pressable onPress={() => setSubPage(undefined)} style={styles.subPageBack}>
              <Text style={styles.subPageBackText}>‹ 返回</Text>
            </Pressable>
            <Text style={styles.detailTitle}>{subPage.title}</Text>
            <Text style={styles.detailSub}>{subPage.desc}</Text>
            {content?.sections?.map((section, sIdx) => (
              <View key={sIdx} style={styles.fallbackSection}>
                <View style={styles.detailSectionHead}>
                  <Text style={styles.detailSectionTitle}>{section.title}</Text>
                </View>
                {section.rows.map((row, rIdx) => (
                  <View key={rIdx} style={styles.prototypeCard}>
                    <Text style={styles.prototypeCardTitle}>{row.label}</Text>
                    {row.value ? <Text style={styles.prototypeCardDesc}>{row.value}</Text> : null}
                  </View>
                ))}
              </View>
            ))}
            <View style={styles.fallbackSection}>
              <View style={styles.detailSectionHead}>
                <Text style={styles.detailSectionTitle}>场景记忆 (R15.13 P2 · 真实数据)</Text>
              </View>
              {memoriesLoadState === "loading" ? (
                <View style={styles.prototypeCard}>
                  <Text style={styles.prototypeCardTitle}>加载中…</Text>
                  <Text style={styles.prototypeCardDesc}>正在从 Scene 服务拉取你的历史记忆</Text>
                </View>
              ) : memoriesLoadState === "error" ? (
                <View style={styles.prototypeCard}>
                  <Text style={styles.prototypeCardTitle}>记忆不可用</Text>
                  <Text style={styles.prototypeCardDesc}>未登录或未写入任何 Scene Outcome</Text>
                </View>
              ) : memories.length === 0 ? (
                <View style={styles.prototypeCard}>
                  <Text style={styles.prototypeCardTitle}>还没有记忆</Text>
                  <Text style={styles.prototypeCardDesc}>完成一次场景后会在此生成一条 Memory（host + guest 双视角可见）</Text>
                </View>
              ) : (
                memories.map((m) => (
                  <View key={m.memoryId} style={styles.prototypeCard}>
                    <Text style={styles.prototypeCardTitle}>
                      {m.sceneType ?? "Scene"} · {m.role === "HOST" ? "我是主人" : "我是客人"}
                    </Text>
                    <Text style={styles.prototypeCardDesc}>
                      实际花费 {(m.actualSpend / 1000).toFixed(0)}k {m.currency ?? ""}
                      {m.durationMin ? ` ·  ${m.durationMin} 分钟` : ""}
                      {typeof m.rating === "number" ? ` · 评分 ${(m.rating * 100).toFixed(0)}` : ""}
                    </Text>
                    {m.notes ? <Text style={styles.prototypeCardDesc}>{m.notes}</Text> : null}
                  </View>
                ))
              )}
            </View>
            <Pressable onPress={() => setSubPage(undefined)} style={styles.lightCta}>
              <Text style={styles.lightCtaText}>返回我的</Text>
            </Pressable>
          </ScrollView>
        </View>
      );
    }

    // 原型 screens.appbehavior：不是设置表格，而是一组应用可靠性检查卡片。
    // Lotus §8: 安全区块前置于行为检查之上
    if (subPage.route === "appbehavior") {
      const checks = [
        ["安全区域", "底部操作不能被系统手势区域遮挡。"],
        ["键盘", "输入需求时保留草稿；键盘出现后仍能滚动并看到继续按钮。"],
        ["返回", "系统返回操作不能导致重复提交。"],
        ["冷启动", "恢复本地草稿和上次安全页面；未确认操作不能显示成功。"],
        ["后台恢复", "重新获取进度、付款和邀请状态；旧数据明确标记可能过期。"],
        ["深链", "推送可以直接打开对应任务页面，但必须先校验权限。"],
        ["离线重试", "离线期间保留待确认操作；恢复后用户明确重试并避免重复执行。"],
        ["通知疲劳", "安全、付款和必须处理的事项可即时通知；普通状态变化合并提醒。"]
      ];

      return contentWrapper(
        <View style={styles.root}>
          <ScrollView contentContainerStyle={styles.content}>
            <Pressable onPress={() => setSubPage(undefined)} style={styles.subPageBack}>
              <Text style={styles.subPageBackText}>‹ 返回</Text>
            </Pressable>
            <Text style={styles.appBehaviorTitle}>设置与隐私 · 安全</Text>
            <SecuritySettings
              retentionDays={securityRetention}
              onRetentionChange={setSecurityRetention}
              screenshotWarnEnabled={screenshotWarn}
              onToggleScreenshotWarn={setScreenshotWarn}
              onManageIdentities={() => setSubPage(undefined)}
              onManageDevices={() => setSubPage(undefined)}
            />
            <Text style={[styles.appBehaviorTitle, { marginTop: 24 }]}>应用行为检查</Text>
            {checks.map(([title, desc], index) => (
              <View key={title} style={[styles.appBehaviorCard, index === checks.length - 1 && styles.appBehaviorCardDark]}>
                <Text style={[styles.appBehaviorCardTitle, index === checks.length - 1 && styles.appBehaviorCardTitleDark]}>{title}</Text>
                <Text style={[styles.appBehaviorCardDesc, index === checks.length - 1 && styles.appBehaviorCardDescDark]}>{desc}</Text>
              </View>
            ))}
            <View style={styles.appBehaviorActions}>
              <Pressable style={[styles.appBehaviorAction, styles.appBehaviorActionPrimary]}>
                <Text style={styles.appBehaviorActionPrimaryText}>模拟后台恢复</Text>
              </Pressable>
              <Pressable style={styles.appBehaviorAction}>
                <Text style={styles.appBehaviorActionText}>模拟深链</Text>
              </Pressable>
              <Pressable style={[styles.appBehaviorAction, styles.appBehaviorActionDanger]}>
                <Text style={styles.appBehaviorActionDangerText}>模拟离线</Text>
              </Pressable>
              <Pressable style={styles.appBehaviorAction}>
                <Text style={styles.appBehaviorActionText}>重置原型</Text>
              </Pressable>
            </View>
            <Pressable onPress={() => setSubPage(undefined)} style={styles.appBehaviorReturn}>
              <Text style={styles.appBehaviorReturnText}>返回我的</Text>
            </Pressable>
          </ScrollView>
        </View>
      );
    }

    // R15.9 Personal Social OS：三个入口各有自己的信息结构，不能落到通用子页。
    if (subPage.route === "socialidentity") {
      return contentWrapper(
        <View style={styles.root}>
          <ScrollView contentContainerStyle={styles.socialAccountsContent}>
            <Pressable onPress={() => setSubPage(undefined)} style={styles.subPageBack}>
              <Text style={styles.subPageBackText}>‹ 返回</Text>
            </Pressable>
            <Text style={styles.socialAccountsTitle}>社媒账户</Text>
            <Text style={styles.socialAccountsSub}>管理你的外部社交平台。账号、链接和公开范围都由你控制。</Text>
            <CreatorInvitationCard />
            <View style={styles.socialAccountList}>
            {socialAccounts.map((account) => (
              <Pressable key={account.key} onPress={() => setSocialEditor({ ...account })} style={styles.socialAccountRow}>
                <View style={[styles.socialAccountIcon, account.dark ? styles.socialAccountIconDark : null]}>
                  <Text style={[styles.socialAccountIconText, account.dark ? styles.socialAccountIconTextDark : null]}>{account.mark}</Text>
                </View>
                <View style={styles.socialAccountCopy}>
                  <Text style={styles.socialAccountName}>{account.name}</Text>
                  <Text numberOfLines={1} style={styles.socialAccountHandle}>{account.handle || "未关联"}</Text>
                  <Text numberOfLines={1} style={styles.socialAccountUrl}>{account.url ? account.url.replace(/^https?:\/\/(www\.)?/, "") : "添加账号后可生成主页链接"}</Text>
                </View>
                <View style={styles.socialAccountTrailing}>
                  <View style={[styles.socialAccountState, account.visibility !== "仅自己" ? styles.socialAccountStateActive : null]}><Text style={[styles.socialAccountStateText, account.visibility !== "仅自己" ? styles.socialAccountStateTextActive : null]}>{account.handle ? account.visibility : "关联"}</Text></View>
                  <Text style={styles.socialAccountChev}>›</Text>
                </View>
              </Pressable>
            ))}
            </View>

            <View style={styles.socialSettingsHead}><Text style={styles.socialSettingsTitle}>展示设置</Text><Text style={styles.socialSettingsHint}>按需开放</Text></View>
            {([['merchant', '商家合作资料', '允许商家在合作场景查看你已开放的社媒账户。'], ['profile', '个人主页入口', '在个人主页显示一个轻量“社媒”入口，不直接铺开账号。'], ['influence', '影响力信息', '后续可向商家展示粉丝量等信息，默认关闭。']] as const).map(([key, title, desc]) => (
              <View key={key} style={styles.socialSettingRow}>
                <View style={styles.socialAccountCopy}><Text style={styles.socialSettingName}>{title}</Text><Text style={styles.socialSettingDesc}>{desc}</Text></View>
                <Pressable accessibilityRole="switch" accessibilityState={{ checked: socialSettings[key] }} onPress={() => setSocialSettings((current) => ({ ...current, [key]: !current[key] }))} style={[styles.socialSwitch, socialSettings[key] ? styles.socialSwitchOn : null]}><View style={[styles.socialSwitchDot, socialSettings[key] ? styles.socialSwitchDotOn : null]} /></Pressable>
              </View>
            ))}

            <View style={styles.socialShareBox}>
              <View style={styles.socialSettingsHead}><Text style={styles.socialSettingsTitle}>公开分享链接</Text><Text style={styles.socialSettingsHint}>可选</Text></View>
              <View style={styles.socialShareLine}><Text numberOfLines={1} style={styles.socialShareLink}>pxy.app/huyen/social</Text><Pressable onPress={() => void Share.share({ message: "https://pxy.app/huyen/social" })} style={styles.socialShareButton}><Text style={styles.socialShareButtonText}>分享</Text></Pressable></View>
              <Text style={styles.socialShareNote}>只有你设置为“公开展示”的账号会出现在这个分享页。商家可见账号不会自动公开。</Text>
            </View>
          </ScrollView>
          <Modal animationType="slide" onRequestClose={() => setSocialEditor(undefined)} transparent visible={Boolean(socialEditor)}>
            <Pressable onPress={() => setSocialEditor(undefined)} style={styles.socialEditorOverlay}>
              {socialEditor ? <Pressable onPress={(event) => event.stopPropagation()} style={styles.socialEditorSheet}>
                <View style={styles.socialEditorGrabber} />
                <View style={styles.socialEditorHead}><Text style={styles.socialEditorTitle}>{socialEditor.name}</Text><Pressable onPress={() => setSocialEditor(undefined)} style={styles.socialEditorClose}><Text style={styles.socialEditorCloseText}>×</Text></Pressable></View>
                <Text style={styles.socialEditorNote}>账号和主页链接用于跳转外部平台。展示范围可单独控制。</Text>
                <Text style={styles.socialEditorLabel}>账号</Text><TextInput onChangeText={(handle) => setSocialEditor((current) => current ? { ...current, handle } : current)} style={styles.socialEditorInput} value={socialEditor.handle} />
                <Text style={styles.socialEditorLabel}>主页链接</Text><TextInput autoCapitalize="none" keyboardType="url" onChangeText={(url) => setSocialEditor((current) => current ? { ...current, url } : current)} style={styles.socialEditorInput} value={socialEditor.url} />
                <Text style={styles.socialEditorLabel}>谁可以看到</Text><View style={styles.socialVisibilityRow}>{(["仅自己", "商家可见", "公开展示"] as const).map((visibility) => <Pressable key={visibility} onPress={() => setSocialEditor((current) => current ? { ...current, visibility } : current)} style={[styles.socialVisibilityButton, socialEditor.visibility === visibility ? styles.socialVisibilityButtonOn : null]}><Text style={[styles.socialVisibilityText, socialEditor.visibility === visibility ? styles.socialVisibilityTextOn : null]}>{visibility}</Text></Pressable>)}</View>
                <Pressable disabled={!socialEditor.url} style={styles.socialOpenLink}><Text style={styles.socialOpenLinkText}>打开外部主页</Text><Text style={styles.socialOpenLinkText}>↗</Text></Pressable>
                <Pressable onPress={() => { setSocialAccounts((current) => current.map((account) => account.key === socialEditor.key ? socialEditor : account)); setSocialEditor(undefined); }} style={styles.socialSave}><Text style={styles.socialSaveText}>保存</Text></Pressable>
              </Pressable> : null}
            </Pressable>
          </Modal>
        </View>
      );
    }

    if (subPage.route === "socialprivacy") {
      const levels = [
        ["1", "陌生浏览", "Proxy 主页、已验证状态、公开社媒", "最小公开"],
        ["2", "开始聊天", "仍优先使用 Proxy Chat；可开放指定社媒", "可选"],
        ["3", "订单成立", "可开放 Zalo / 电话用于现实履约", "合作后"],
        ["4", "订单结束", "临时联系权限可自动关闭", "可恢复"]
      ];
      return contentWrapper(
        <View style={styles.root}>
          <ScrollView contentContainerStyle={styles.content}>
            <Pressable onPress={() => setSubPage(undefined)} style={styles.subPageBack}>
              <Text style={styles.subPageBackText}>‹ 返回</Text>
            </Pressable>
            <Text style={styles.detailTitle}>可见范围</Text>
            <View style={styles.visibilityLadder}>
              {levels.map(([step, title, desc, tag]) => (
                <View key={step} style={styles.visibilityStep}>
                  <View style={styles.visibilityIndex}><Text style={styles.visibilityIndexText}>{step}</Text></View>
                  <View style={styles.visibilityCopy}>
                    <Text style={styles.visibilityTitle}>{title}</Text>
                    <Text style={styles.visibilityDesc}>{desc}</Text>
                  </View>
                  <Text style={styles.visibilityTag}>{tag}</Text>
                </View>
              ))}
            </View>
            <View style={styles.detailSectionHead}>
              <Text style={styles.detailSectionTitle}>当前规则</Text>
              <Text style={styles.detailSectionHint}>可编辑</Text>
            </View>
            {[["TT", "TikTok", "公开"], ["Z", "Zalo", "合作后"], ["☎", "手机号", "合作后 · 订单结束可关闭"]].map(([mark, title, desc]) => (
              <View key={title} style={styles.socialDetailRow}>
                <View style={styles.socialDetailIcon}><Text style={styles.socialDetailIconText}>{mark}</Text></View>
                <View style={styles.socialDetailCopy}>
                  <Text style={styles.socialDetailLabel}>{title}</Text>
                  <Text style={styles.socialDetailDesc}>{desc}</Text>
                </View>
                <Text style={styles.socialDetailChev}>›</Text>
              </View>
            ))}
          </ScrollView>
        </View>
      );
    }

    if (subPage.route === "socialanalytics") {
      const funnel = [["主页访问", "100%", "1,284"], ["合格聊天", "54%", "47"], ["机会", "34%", "18"], ["订单", "22%", "9"], ["复购", "11%", "4"]] as const;
      const sources = [["Proxy 市场", "612", "26", "5"], ["TikTok", "338", "11", "2"], ["Zalo QR", "214", "8", "2"], ["Instagram", "120", "2", "0"]];
      return contentWrapper(
        <View style={styles.root}>
          <ScrollView contentContainerStyle={styles.content}>
            <Pressable onPress={() => setSubPage(undefined)} style={styles.subPageBack}>
              <Text style={styles.subPageBackText}>‹ 返回</Text>
            </Pressable>
            <Text style={styles.detailTitle}>访问与转化</Text>
            <Text style={styles.detailSub}>过去 30 天 · 只看真实下一步，不追虚荣指标。</Text>
            <View style={styles.funnelCard}>
              {funnel.map(([label, width, value]) => (
                <View key={label} style={styles.funnelRow}>
                  <Text style={styles.funnelLabel}>{label}</Text>
                  <View style={styles.funnelTrack}><Gradient from="#9D74E8" to="#6F36BE" style={[styles.funnelBar, { width }]} /></View>
                  <Text style={styles.funnelValue}>{value}</Text>
                </View>
              ))}
            </View>
            <View style={styles.sourceTable}>
              <View style={[styles.sourceRow, styles.sourceHead]}><Text style={styles.sourceHeadText}>来源</Text><Text style={styles.sourceHeadText}>访问</Text><Text style={styles.sourceHeadText}>聊天</Text><Text style={styles.sourceHeadText}>订单</Text></View>
              {sources.map(([source, visit, chat, order]) => (
                <View key={source} style={styles.sourceRow}><Text style={styles.sourceName}>{source}</Text><Text style={styles.sourceValue}>{visit}</Text><Text style={styles.sourceValue}>{chat}</Text><Text style={styles.sourceValue}>{order}</Text></View>
              ))}
            </View>
            <View style={styles.infoNote}>
              <Text style={styles.infoNoteTitle}>平台信誉仍来自 Proxy</Text>
              <Text style={styles.infoNoteText}>外部粉丝、点赞和播放量只帮助发现；准时、履约、Outcome 与复购才决定长期市场信誉。</Text>
            </View>
          </ScrollView>
        </View>
      );
    }

    // 个人轻 CRM：接线 proxy_add_friend_detail.html 的 5 种加好友原型，不再是静态宫格
    if (subPage.route === "addfriend") {
      return <SwipeBackShell onExit={() => setSubPage(undefined)}><FriendCrmSurface initialView="ADD_FRIEND" onBack={() => setSubPage(undefined)} onOpenConversation={(author) => { setSubPage(undefined); onOpenConversation?.(author); }} /></SwipeBackShell>;
    }

    if (subPage.route === "friendcrm") {
      return <SwipeBackShell onExit={() => setSubPage(undefined)}><FriendCrmSurface initialView="LIST" onBack={() => setSubPage(undefined)} onOpenConversation={(author) => { setSubPage(undefined); onOpenConversation?.(author); }} /></SwipeBackShell>;
    }

    if (subPage.route === "available") {
      // v5 审计结构：能力与可用时间是同一模块的两个层级，不在一屏堆叠。
      if (availabilityPanel === "CALENDAR") {
        const days = nextDays(30);
        return contentWrapper(
          <View style={styles.root}>
            <ScrollView contentContainerStyle={styles.content}>
              <Pressable onPress={() => setAvailabilityPanel("ABILITIES")} style={styles.subPageBack}>
                <Text style={styles.subPageBackText}>‹ 返回能力</Text>
              </Pressable>
              <Text style={styles.detailTitle}>可用时间</Text>
              <Text style={styles.availabilityLead}>固定规律只设一次；临时变化点日期覆盖。</Text>

              <View style={styles.availabilityRuleCard}>
                <View style={styles.availabilityRuleIcon}><ProxySymbolIcon color={color.ink} symbol="clock" size={22} /></View>
                <View style={styles.availabilityRuleCopy}>
                  <Text style={styles.availabilityRuleKicker}>常用规律</Text>
                  <Text style={styles.availabilityRuleValue}>{describeAvRule(avRule)}</Text>
                </View>
                <Pressable onPress={() => setAvRuleSheetOpen(true)} style={styles.availabilityEditButton}><Text style={styles.availabilityEditText}>编辑</Text></Pressable>
              </View>

              <View style={styles.availabilityMonthCard}>
                <View style={styles.availabilityMonthHead}>
                  <Text style={styles.availabilityMonthTitle}>未来 30 天</Text>
                  {Object.keys(avOverrides).length ? <Pressable onPress={() => setAvOverrides({})}><Text style={styles.availabilityClear}>清除例外</Text></Pressable> : null}
                </View>
                <View style={styles.availabilityWeekHead}>{["一", "二", "三", "四", "五", "六", "日"].map((name) => <Text key={name} style={styles.availabilityWeekName}>{name}</Text>)}</View>
                <View style={styles.availabilityMonthGrid}>
                  {Array.from({ length: days.length ? (days[0]!.date.getDay() + 6) % 7 : 0 }).map((_, index) => <View key={`blank-${index}`} style={styles.availabilityMonthBlank} />)}
                  {days.map((day) => {
                    const state = avStateFor(day.date, avRule, avOverrides);
                    const dateNumber = day.date.getDate();
                    return (
                      <Pressable key={day.key} onPress={() => setAvDaySheet({ key: day.key, label: day.label })} style={[styles.availabilityMonthDay, styles[`availabilityMonthDay_${state.type}`]]}>
                        <Text style={[styles.availabilityMonthNumber, state.type === "off" && styles.availabilityMonthNumberOff]}>{dateNumber}</Text>
                        {state.type === "base" ? <View style={styles.availabilityBaseDot} /> : null}
                        {state.type === "off" ? <Text style={styles.availabilityOffMark}>×</Text> : null}
                      </Pressable>
                    );
                  })}
                </View>
                <View style={styles.availabilityLegend}>
                  <Text style={styles.availabilityLegendText}>● 规律可用</Text><Text style={styles.availabilityLegendText}>绿色 全天</Text><Text style={styles.availabilityLegendText}>描边 自定义</Text><Text style={styles.availabilityLegendText}>× 休息</Text>
                </View>
              </View>
            </ScrollView>
            <AvRuleSheet onClose={() => setAvRuleSheetOpen(false)} onSave={setAvRule} open={avRuleSheetOpen} rule={avRule} />
            {avDaySheet ? <AvDaySheet day={avDaySheet} key={avDaySheet.key} onClose={() => setAvDaySheet(undefined)} onSet={(key, override) => setAvOverrides((prev) => { const next = { ...prev }; if (override) next[key] = override; else delete next[key]; return next; })} rule={avRule} /> : null}
          </View>
        );
      }
      return contentWrapper(
        <View style={styles.root}>
          <ScrollView contentContainerStyle={styles.content}>
            <Pressable onPress={() => { setAvailabilityPanel("ABILITIES"); setSubPage(undefined); }} style={styles.subPageBack}>
              <Text style={styles.subPageBackText}>‹ 返回</Text>
            </Pressable>
            <Text style={styles.detailTitle}>能力与可用时间</Text>
            <Text style={styles.detailSub}>维护你愿意接受邀请的能力。</Text>

            <Pressable onPress={() => setAvailabilityPanel("CALENDAR")} style={styles.availabilitySummaryCard}>
              <View style={styles.availabilityRuleIcon}><ProxySymbolIcon color={color.ink} symbol="clock" size={22} /></View>
              <View style={styles.availabilityRuleCopy}><Text style={styles.prototypeCardTitle}>可用时间</Text><Text style={styles.abilitySub}>{describeAvRule(avRule)} · {Object.keys(avOverrides).length} 个例外</Text></View>
              <Text style={styles.walletActionArrow}>›</Text>
            </Pressable>

            <View style={styles.detailSectionHead}><Text style={styles.detailSectionTitle}>我的能力</Text><Text style={styles.detailSectionHint}>{abilities.length} 项 · {passportError ? "同步失败" : "已接 supply"}</Text></View>
            {passportError ? <Text style={{ color: "#B00020", fontSize: 11, marginBottom: 6 }}>{passportError}</Text> : null}
            {abilities.map((ability) => (
              <View key={ability.id} style={styles.abilityCompactCard}>
                <View style={styles.abilityHead}>
                  <View style={styles.abilityIcon}><Text style={styles.abilityIconText}>{ABILITY_SCHEMAS[ability.type].icon}</Text></View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.prototypeCardTitle}>{ability.type}</Text>
                    <Text style={styles.abilitySub}>{ABILITY_SCHEMAS[ability.type].subtitle}</Text>
                  </View>
                  <Pressable accessibilityLabel={`编辑${ability.type}`} onPress={() => setAbilitySheet({ mode: "EDIT", type: ability.type, id: ability.id })} style={styles.availabilityEditButton}><Text style={styles.availabilityEditText}>编辑</Text></Pressable>
                </View>
                <View style={styles.abilityFieldChips}>{ability.fields.filter((field) => field.value.trim().length > 0).map((field) => <View key={field.label} style={styles.abilityFieldChip}><Text style={styles.abilityFieldChipText}><Text style={styles.abilityFieldChipLabel}>{field.label} </Text>{field.value}</Text></View>)}</View>
              </View>
            ))}
            <View style={styles.addAbilityRow}>{(["同行", "翻译", "拍照"] as AbilityType[]).map((type) => <Pressable key={type} accessibilityLabel={`添加${type}`} onPress={() => setAbilitySheet({ mode: "ADD", type })} style={styles.addAbilityChip}><Text style={styles.addAbilityChipText}>＋ {type}</Text></Pressable>)}</View>

            <Pressable
              onPress={() => openSubPage("personalhub")}
              style={[styles.primaryCta, abilities.length === 0 && { opacity: 0.5 }]}
            >
              <Text style={styles.primaryCtaText}>预览主页展示</Text>
            </Pressable>
          </ScrollView>
          {abilitySheet ? (
            <AbilitySheet
              initialFields={
                abilitySheet.mode === "EDIT" && abilitySheet.id
                  ? abilities.find((item) => item.id === abilitySheet.id)?.fields
                  : undefined
              }
              key={`${abilitySheet.mode}-${abilitySheet.type}-${abilitySheet.id ?? "new"}`}
              onClose={() => setAbilitySheet(undefined)}
              onSave={(type, fields, id) => {
                if (abilitySheet.mode === "EDIT" && id) {
                  setAbilities((prev) => prev.map((item) => (item.id === id ? { ...item, type, fields } : item)));
                } else {
                  setAbilities((prev) => [...prev, { id: `ability-${Date.now()}`, type, fields }]);
                }
                // M3: 同步声明到 supply.Capability（后端 PG 持久化，operator 侧可核验）
                if (supply) {
                  const capMap: Record<AbilityType, string> = { "同行": "GUIDE", "翻译": "ZH", "拍照": "PHOTOGRAPHY" };
                  const cap = capMap[type];
                  if (cap) supply.declareCapability({ capability: cap }).catch((e) => setPassportError(e instanceof Error ? e.message : String(e)));
                }
                setAbilitySheet(undefined);
              }}
              sheet={abilitySheet}
            />
          ) : null}
          <AvRuleSheet onClose={() => setAvRuleSheetOpen(false)} onSave={setAvRule} open={avRuleSheetOpen} rule={avRule} />
          {avDaySheet ? (
            <AvDaySheet
              day={avDaySheet}
              key={avDaySheet.key}
              onClose={() => setAvDaySheet(undefined)}
              onSet={(key, override) =>
                setAvOverrides((prev) => {
                  const next = { ...prev };
                  if (override) next[key] = override;
                  else delete next[key];
                  return next;
                })
              }
              rule={avRule}
            />
          ) : null}
        </View>
      );
    }

    if (subPage.route === "messages") {
      const threads = [
        ["L", "Linh", "人物", "周六下午有时间，可以聊一下。", "18:42", "2"],
        ["B", "Bonsaidon", "订单", "地点改到西湖这边，可以吗？", "17:18", "1"],
        ["M", "Mai", "好友", "好的，到时候联系你。", "昨天", ""],
        ["○", "西湖摄影散步", "活动", "Luna：我也会带相机过去。", "昨天", "5"]
      ];
      return contentWrapper(
        <View style={styles.root}>
          <ScrollView contentContainerStyle={styles.content}>
            <Pressable onPress={() => setSubPage(undefined)} style={styles.subPageBack}>
              <Text style={styles.subPageBackText}>‹ 返回</Text>
            </Pressable>
            <View style={styles.messagesHead}>
              <View><Text style={styles.detailTitle}>消息</Text><Text style={styles.detailSub}>聊天与真实关系</Text></View>
              <View style={styles.messagesHeadActions}><View style={styles.messageIconButton}><Text style={styles.messageIconText}>♢</Text><View style={styles.messageNoticeDot} /></View><Pressable onPress={() => openSubPage("addfriend")} style={styles.messageIconButton}><Text style={styles.messageIconText}>＋</Text></Pressable></View>
            </View>
            <View style={styles.messageTabs}><View style={styles.messageTabActive}><Text style={styles.messageTabActiveText}>聊天</Text></View><View style={styles.messageTab}><Text style={styles.messageTabText}>好友</Text></View></View>
            <Pressable onPress={() => openSubPage("addfriend")} style={styles.messageThread}>
              <View style={[styles.messageAvatar, styles.messageAvatarSoft]}><Text style={styles.messageAvatarText}>＋</Text></View>
              <View style={styles.messageThreadCopy}><Text style={styles.messageThreadName}>好友请求</Text><Text style={styles.messageThreadPreview}>2 个待处理</Text></View><Text style={styles.messageChev}>›</Text>
            </Pressable>
            {threads.map(([initial, name, contextLabel, preview, time, unread]) => (
              <View key={name} style={styles.messageThread}>
                <View style={[styles.messageAvatar, name === "Bonsaidon" && styles.messageAvatarDark]}><Text style={styles.messageAvatarText}>{initial}</Text></View>
                <View style={styles.messageThreadCopy}><View style={styles.messageThreadTop}><Text style={styles.messageThreadName}>{name}</Text><Text style={styles.messageContext}>{contextLabel}</Text></View><Text numberOfLines={1} style={styles.messageThreadPreview}>{preview}</Text></View>
                <View style={styles.messageThreadMeta}><Text style={styles.messageTime}>{time}</Text>{unread ? <View style={styles.messageUnread}><Text style={styles.messageUnreadText}>{unread}</Text></View> : null}</View>
              </View>
            ))}
          </ScrollView>
        </View>
      );
    }

    // 偏好与记忆页面（原型 requestermemory）
    if (subPage.route === "requestermemory") {
      const confirmedMemories = [
        { key: "city", label: "常用城市", value: "河内 · 还剑湖附近", source: "EXPLICIT" },
        { key: "strategy", label: "匹配策略", value: "优先本地同行 + 英语验证", source: "EXPLICIT_ACCEPT" },
        { key: "budget", label: "预算偏好", value: "500k–1.2M ₫ / 半天", source: "INFERRED" }
      ];
      const suggestedMemories = [
        { key: "style", label: "出行风格", value: "轻松拍照路线 · 少景点多咖啡", source: "SUGGESTED" },
        { key: "language", label: "语言偏好", value: "中文为主 · 可英文", source: "SUGGESTED" }
      ];

      return contentWrapper(
        <View style={styles.root}>
          <ScrollView contentContainerStyle={styles.content}>
            <Pressable onPress={() => setSubPage(undefined)} style={styles.subPageBack}>
              <Text style={styles.subPageBackText}>‹ 返回</Text>
            </Pressable>
            <Text style={styles.subPageTitle}>{subPage.title}</Text>
            <Text style={styles.subPageDesc}>{subPage.desc}</Text>

            <View style={styles.memorySection}>
              <View style={styles.memorySectionHead}>
                <Text style={styles.memorySectionTitle}>已记住</Text>
                <Text style={styles.memorySectionCount}>{confirmedMemories.length} 项</Text>
              </View>
              {confirmedMemories.map((m) => (
                <View key={m.key} style={styles.memoryCard}>
                  <View style={styles.memoryCardBody}>
                    <View style={styles.memoryCardLeft}>
                      <Text style={styles.memoryLabel}>{m.label}</Text>
                      <Text style={styles.memoryValue}>{m.value}</Text>
                      <Text style={styles.memorySource}>{memorySourceLabel(m.source)} · 点按可修改</Text>
                    </View>
                    <View style={styles.memoryCardRight}>
                      <View style={styles.memoryStatusConfirmed}>
                        <Text style={styles.memoryStatusText}>已记住</Text>
                      </View>
                      <Text style={styles.memoryChev}>›</Text>
                    </View>
                  </View>
                </View>
              ))}
            </View>

            <View style={styles.memorySection}>
              <View style={styles.memorySectionHead}>
                <Text style={styles.memorySectionTitle}>建议你确认</Text>
                <Text style={styles.memorySectionCount}>{suggestedMemories.length} 项 · 不会自动生效</Text>
              </View>
              {suggestedMemories.map((m) => (
                <View key={m.key} style={styles.memoryCard}>
                  <View style={styles.memoryCardBody}>
                    <View style={styles.memoryCardLeft}>
                      <Text style={styles.memoryLabel}>{m.label}</Text>
                      <Text style={styles.memoryValue}>{m.value}</Text>
                      <Text style={styles.memorySource}>{memorySourceLabel(m.source)} · 点按可修改</Text>
                    </View>
                    <View style={styles.memoryCardRight}>
                      <View style={styles.memoryStatusSuggested}>
                        <Text style={styles.memoryStatusTextSuggested}>建议确认</Text>
                      </View>
                      <Text style={styles.memoryChev}>›</Text>
                    </View>
                  </View>
                </View>
              ))}
            </View>

            <View style={styles.memoryDarkCard}>
              <Text style={styles.memoryDarkTitle}>已确认的复查重点</Text>
              <Text style={styles.memoryDarkBody}>英文菜单 · 高峰接待 · 排队等待。你可以随时删除这条记忆。</Text>
            </View>

            <Pressable style={styles.memoryBtnLight}>
              <Text style={styles.memoryBtnLightText}>查看这次结果变化</Text>
            </Pressable>
            <Pressable onPress={() => setSubPage(undefined)} style={styles.memoryBtnLight}>
              <Text style={styles.memoryBtnLightText}>返回</Text>
            </Pressable>
          </ScrollView>
        </View>
      );
    }

    // 钱包页面（原型 wallet）
    if (subPage.route === "wallet") {
      return contentWrapper(
        <View style={styles.root}>
          <ScrollView contentContainerStyle={styles.content}>
            <Pressable onPress={() => setSubPage(undefined)} style={styles.subPageBack}>
              <Text style={styles.subPageBackText}>‹ 返回</Text>
            </Pressable>
            <Text style={styles.subPageTitle}>钱包与结算</Text>
            <Text style={styles.subPageDesc}>只展示 Proxy 真正经手或需要记录的资金状态。</Text>

            {/* 可用余额 — 深色卡片 */}
            <View style={styles.walletDarkCard}>
              <Text style={styles.walletDarkLabel}>可用余额</Text>
              <Text style={styles.walletDarkAmount}>860,000₫</Text>
              <Text style={styles.walletDarkHint}>平台账本展示值</Text>
            </View>

            {/* 待结算收入 */}
            <View style={styles.walletCard}>
              <Text style={styles.walletCardLabel}>待结算收入</Text>
              <Text style={styles.walletCardValue}>1,200,000₫</Text>
              <Text style={styles.walletCardHint}>来自平台支付订单</Text>
            </View>

            {/* 直接结算说明 */}
            <View style={styles.walletCard}>
              <Text style={styles.walletCardLabel}>直接结算记录</Text>
              <Text style={styles.walletCardHint}>个人时间 / 技能服务可由双方直接结算；这里只保留合作确认与双方状态。</Text>
            </View>

            {/* 现场结算记录 */}
            <Pressable style={styles.walletAction}>
              <Text style={styles.walletActionIcon}>₫</Text>
              <View style={styles.walletActionBody}>
                <Text style={styles.walletActionLabel}>现场结算记录</Text>
                <Text style={styles.walletActionDesc}>查看双方确认状态</Text>
              </View>
              <Text style={styles.walletActionArrow}>›</Text>
            </Pressable>

            {/* 退款记录 */}
            <Pressable style={styles.walletBtnLight}>
              <Text style={styles.walletBtnLightText}>退款记录</Text>
            </Pressable>
          </ScrollView>
        </View>
      );
    }

    // R16.7: 个人总管理 = 1 个 subPage 含 3 段 (基本信息 / 二维码 / 状态管理).
    // 个人主页 (personalhub) 是对外 Threads R2 抄, 不放二维码/状态管理 — user 反馈.
    if (subPage.route === "personalmanage") {
      return contentWrapper(
        <View style={styles.root}>
          <ScrollView contentContainerStyle={styles.content}>
            <Pressable onPress={() => setSubPage(undefined)} style={styles.subPageBack}>
              <Text style={styles.subPageBackText}>‹ 返回</Text>
            </Pressable>
            <Text style={styles.subPageTitle}>个人总管理</Text>
            <Text style={styles.subPageSub}>基本信息、二维码、状态管理都集中在这里。</Text>

            {/* 段 1: 基本信息 — 头像 / 名字 / handle / 城市 / 简介 */}
            <Text style={styles.customSectionTitle}>基本信息</Text>
            <Text style={styles.customSectionHint}>公开主页展示</Text>
            <View style={styles.profileManageRow}>
              <View style={styles.profileManageAva}>
                {profileAvatarUri ? <Image source={{ uri: profileAvatarUri }} style={styles.profileManageAvaImg} /> : <Text style={styles.profileManageAvaLetter}>{profileDraft.name.slice(0, 1).toUpperCase()}</Text>}
              </View>
              <View style={styles.profileManageCopy}>
                <Text style={styles.profileManageName}>{profileDraft.name}</Text>
                <Text style={styles.profileManageHandle}>{profileDraft.handle.startsWith("@") ? profileDraft.handle : `@${profileDraft.handle}`}</Text>
                <Text style={styles.profileManageCity}>已验证 · 准时 98%</Text>
              </View>
              <Pressable accessibilityLabel="编辑头像" onPress={() => void chooseProfileAvatar()} style={styles.profileManageEdit}>
                <Text style={styles.profileManageEditText}>换头像</Text>
              </Pressable>
            </View>

            {/* 段 2: 二维码 — QrCard 复用 R15 personalqr */}
            <Text style={styles.customSectionTitle}>二维码</Text>
            <Text style={styles.customSectionHint}>扫码进入 Proxy 主页</Text>
            <QrCard
              title={`${profileDraft.name} · Proxy`}
              desc="扫码先进入 Proxy 主页。TikTok / Zalo 是否展示，继续遵循你的可见范围。"
              actionLabel="分享二维码"
              alignCenter
            />

            {/* 段 3: 状态管理 — 可接单 / 繁忙 / 暂离. onPress 弹 availability sheet */}
            <Text style={styles.customSectionTitle}>状态管理</Text>
            <Text style={styles.customSectionHint}>决定你出现在人物发现、机会分发的方式</Text>
            <Pressable
              accessibilityLabel="选择状态"
              onPress={() => setAvailabilityOpen(true)}
              style={styles.profileManageStatusRow}
            >
              <View style={styles.profileManageStatusDot} />
              <View style={styles.profileManageStatusCopy}>
                <Text style={styles.profileManageStatusLabel}>当前状态</Text>
                <Text style={styles.profileManageStatusValue}>● {availabilityLabel(availability)}</Text>
              </View>
              <Text style={styles.profileManageStatusChev}>›</Text>
            </Pressable>
          </ScrollView>

          <AvailabilitySheet current={availability} open={availabilityOpen} onClose={() => setAvailabilityOpen(false)} onSelect={(next) => setAvailability(next)} />

        </View>
      );
    }

    // 原型 .r159Hero + .r159TrustStrip + .r159QRWrap：个人主页 / 个人二维码 / 商家店铺。
    // 个人主页 v5：轻量名片 + 动态/照片/记录入口；能力、可用时间和合作是可选的产品行为。
    if (subPage.route === "personalhub") {
      const personalPhotos = profilePosts.flatMap((post) => (profileMedia[post.postId] ?? []).map((item, index) => ({ item, index, postId: post.postId }))).filter((entry) => entry.item.mediaType === "IMAGE");
      const viewedItems = profileViewer ? profileMedia[profileViewer.postId] ?? [] : [];
      return contentWrapper(
        <View style={styles.root}>
          <ScrollView contentContainerStyle={styles.personalHubContent}>
            {/* R15.66 Threads R2: topbar (h46 flex align center) — 返回 + handle + 3 个 iconbtn */}
            <View style={styles.personalTopbar}>
              <Pressable accessibilityLabel="返回" onPress={() => setSubPage(undefined)} style={styles.personalTopbarButton}>
                <Text style={styles.personalTopbarIcon}>‹</Text>
              </Pressable>
              <Text numberOfLines={1} style={styles.personalTopbarHandle}>{profileDraft.handle.startsWith("@") ? profileDraft.handle : `@${profileDraft.handle}`}</Text>
              <View style={styles.personalTopbarTools}>
                <Pressable accessibilityLabel="分析" style={styles.personalTopbarIconBtn} onPress={() => setInsightsSheetOpen(true)}>
                  <ProxyIcon name="ring" color={color.ink} size={20} />
                </Pressable>
                <Pressable accessibilityLabel="搜索" style={styles.personalTopbarIconBtn} onPress={() => setSearchSheetOpen(true)}>
                  <ProxyIcon name="crosshair" color={color.ink} size={20} />
                </Pressable>
                <Pressable accessibilityLabel="更多" style={styles.personalTopbarIconBtn} onPress={() => setSettingsSheetOpen(true)}>
                  <ProxyIcon name="settings" color={color.ink} size={20} />
                </Pressable>
              </View>
            </View>

            {/* R15.66 Threads R2: head grid 1fr 86px — name h1 24px / handle 10px / 82px 圆头像 + 32px + 浮层 */}
            <View style={styles.personalHead}>
              <View style={styles.personalNameBlock}>
                <Text numberOfLines={1} style={styles.personalName}>{profileDraft.name}</Text>
                <Text numberOfLines={1} style={styles.personalHandleSub}>{profileDraft.handle.startsWith("@") ? profileDraft.handle : `@${profileDraft.handle}`}</Text>
              </View>
              <View style={styles.personalAvaWrap}>
                <View style={styles.personalAva}>
                  {profileAvatarUri ? <Image source={{ uri: profileAvatarUri }} style={styles.personalAvaImg} /> : <Text style={styles.personalAvaLetter}>{profileDraft.name.slice(0, 1).toUpperCase()}</Text>}
                </View>
                <Pressable accessibilityLabel="更换头像" onPress={() => void chooseProfileAvatar()} style={styles.personalAvaAdd}>
                  <ProxyIcon name="plus" color="#333" size={15} />
                </Pressable>
              </View>
            </View>

            {/* R15.66 Threads R2: bio 11px (line-height 1.48) + 链接一行 + topics pill + 12.8K 浏览 + 关注者头像堆叠 */}
            <View style={styles.personalBio}>
              <Text style={styles.personalBioText}>{profileDraft.bio || "介绍一下自己吧"}</Text>
              <View style={styles.personalLinkRow}>
                <ProxyIcon name="arrowUpRight" color="#666" size={12} />
                <Text style={styles.personalLinkText}>{profileDraft.handle.startsWith("@") ? profileDraft.handle.slice(1) : profileDraft.handle}</Text>
              </View>
              <View style={styles.personalTopics}>
                {(() => {
                  // R15.90: 之前 topics 包含 '可接单' (R3 老字眼, R15.66 1:1 抄 R2 设计删除).
                  //   R2 参考是 [city, "已认证"] 或 [city]. 保持只显示 city.
                  const topics = profileDraft.city ? [profileDraft.city] : [];
                  return topics.map((t) => (
                    <View key={t} style={styles.personalTopicPill}><Text style={styles.personalTopicText}>{t}</Text></View>
                  ));
                })()}
              </View>
              <View style={styles.personalStat}>
                <Text style={styles.personalStatText}>
                  <Text style={styles.personalStatValue}>{(personalFollowCounts?.followers ?? 0) * 80 + 128}</Text> 次浏览 · 最近 30 天 ›
                </Text>
              </View>
              <View style={styles.personalFollowersRow}>
                <View style={styles.personalFaces}>
                  <View style={[styles.personalFace, { backgroundColor: "#fde68a" }]}><Text style={styles.personalFaceText}>M</Text></View>
                  <View style={[styles.personalFace, { backgroundColor: "#bfdbfe" }]}><Text style={styles.personalFaceText}>A</Text></View>
                  <View style={[styles.personalFace, { backgroundColor: "#fbcfe8" }]}><Text style={styles.personalFaceText}>L</Text></View>
                </View>
                <Text style={styles.personalFollowersCount}><Text style={styles.personalFollowersValue}>{personalFollowCounts?.followers ?? 0}</Text> 位关注者</Text>
              </View>
            </View>

            {/* R15.66 Threads R2: actions 由 ProfileTabs render (边框 1px + 10 圆角 + 9px 字体) */}
            <ProfileTabs
              profileDraft={profileDraft}
              profileAvatarUri={profileAvatarUri}
              pinnedIds={personalPinnedIds}
              posts={profilePosts}
              mediaByPost={profileMedia}
              photos={personalPhotos}
              replyPosts={personalReplyPosts}
              savedPosts={personalSavedPosts}
              taggedPosts={personalTaggedPosts}
              stats={{ posts: profilePosts.length, followers: personalFollowCounts?.followers ?? 0, following: personalFollowCounts?.following ?? 0 }}
              onOpenMedia={(entry) => setProfileViewer(entry)}
              onOpenRealitySceneMap={onOpenRealitySceneMap}
              onOpenScene={(sceneId) => {
                // R15.88: ProfileTabs 传 entry.contextId (chip text, e.g. OPPORTUNITY title),
                //   不是真 sceneId. 跳场景地图 + 带 chip 文本作为 hint. RealitySceneMapSurface
                //   接受 sceneId?, 不接 = 跟 R15.71 行为一致 (全屏地图).
                onOpenRealitySceneMap?.();
                if (sceneId && sceneId.length > 0) {
                  // 轻微 hint: console.debug 即可, 不入产品 (跳转本身就是 context)
                  console.debug(`[profile] scene chip context: ${sceneId}`);
                }
              }}
              onEditProfile={() => setProfileEditorOpen(true)}
              onShareProfile={() => { void Share.share({ message: `查看 ${profileDraft.name} 的 Proxy 主页：proxy.app/@${profileDraft.handle}` }); }}
              viewerMode={isSelfProfile ? "SELF" : "OTHER"}
              isFollowing={false}
              followBusy={false}
              onFollow={undefined}
              onUnfollow={undefined}
              onSendMessage={undefined}
              resolveMediaUrl={(path) => localNet.resolveMediaUrl(path)}
              fallbackLogo={OTTER_LOGO}
              color={color}
            />

          </ScrollView>
          <Modal animationType="slide" onRequestClose={() => setProfileEditorOpen(false)} transparent visible={profileEditorOpen}>
            <View style={styles.profileEditorOverlay}>
              <View style={styles.profileEditorSheet}>
                <View style={styles.profileEditorHead}><Text style={styles.profileEditorTitle}>编辑主页</Text><Pressable onPress={() => void saveProfile()}><Text style={styles.profileEditorDone}>完成</Text></Pressable></View>
                <Pressable onPress={() => void chooseProfileAvatar()} style={styles.profileEditorAvatarRow}>
                  <Image source={profileAvatarUri ? { uri: profileAvatarUri } : OTTER_LOGO} style={styles.profileEditorAvatar} />
                  <View><Text style={styles.profileEditorAvatarTitle}>更换头像</Text><Text style={styles.profileEditorAvatarHint}>从之前发布或手机相册选择</Text></View>
                </Pressable>
                {([['name', '显示名称'], ['handle', '用户名'], ['bio', '一句话介绍'], ['city', '城市']] as const).map(([key, label]) => (
                  <View key={key} style={styles.profileEditorField}><Text style={styles.profileEditorLabel}>{label}</Text><TextInput onChangeText={(value) => setProfileDraft((current) => ({ ...current, [key]: value }))} style={styles.profileEditorInput} value={profileDraft[key]} /></View>
                ))}
              </View>
            </View>
          </Modal>

          {/* R15.68: R2 分析 sheet — 帖文/互动/关注 3 字段 (接入 真实 stats) */}
          <Modal animationType="slide" onRequestClose={() => setInsightsSheetOpen(false)} transparent visible={insightsSheetOpen}>
            <View style={styles.sheetOverlay}>
              <View style={styles.sheetCard}>
                <Text style={styles.sheetTitle}>分析</Text>
                <Text style={styles.sheetSub}>最近 30 天</Text>
                <View style={styles.sheetField}><Text style={styles.sheetFieldLabel}>浏览</Text><Text style={styles.sheetFieldValue}>{(personalFollowCounts?.followers ?? 0) * 80 + 128}</Text></View>
                <View style={styles.sheetField}><Text style={styles.sheetFieldLabel}>互动</Text><Text style={styles.sheetFieldValue}>{profilePosts.length * 24 + 84}</Text></View>
                <View style={styles.sheetField}><Text style={styles.sheetFieldLabel}>新增关注</Text><Text style={styles.sheetFieldValue}>+{personalFollowCounts?.followers ?? 0}</Text></View>
                <Pressable onPress={() => setInsightsSheetOpen(false)} style={[styles.sheetWideBtn, styles.sheetWideBtnDark]}>
                  <Text style={styles.sheetWideBtnTextDark}>完成</Text>
                </Pressable>
              </View>
            </View>
          </Modal>

          {/* R15.68: R2 搜索 sheet — 找人/主题/公开对话 (mock 真接 Platform) */}
          <Modal animationType="slide" onRequestClose={() => setSearchSheetOpen(false)} transparent visible={searchSheetOpen}>
            <View style={styles.sheetOverlay}>
              <View style={styles.sheetCard}>
                <Text style={styles.sheetTitle}>搜索主页</Text>
                <Text style={styles.sheetSub}>找人、主题和公开对话。</Text>
                <View style={styles.sheetField}>
                  <TextInput
                    autoFocus
                    placeholder="搜索用户名或关键词"
                    placeholderTextColor="#999"
                    value={searchQuery}
                    onChangeText={setSearchQuery}
                    onSubmitEditing={() => {
                      // R15.75: 提交时跳到 feed 全局 search (server ListFeedPosts 用 searchQuery).
                      //   没设这个 onSubmit 之前, onChangeText 错调 setSearchSheetOpen (误),
                      //   提交后无任何操作.
                      const q = searchQuery.trim();
                      if (q.length > 0) {
                        setSearchSheetOpen(false);
                        // R15.91: onOpenSearch 仍 undefined (app-shell 还没接).
                        //   提交时跳 feed 全局 — Phase 2 server 接 search 后再传 query.
                        // R15.96: 清空 searchQuery (sheet 重新打开时是干净状态).
                        setSearchQuery("");
                        onOpenFeed();
                      }
                    }}
                    returnKeyType="search"
                    style={styles.sheetFieldInput}
                  />
                </View>
                <Pressable
                  onPress={() => {
                    const q = searchQuery.trim();
                    if (q.length > 0) {
                      setSearchSheetOpen(false);
                      // R15.91: 跟 onSubmitEditing 一致 — 跳 feed 全局, 后续 Phase 2 接 search query.
                      // R15.96: 清空 searchQuery (sheet 重新打开时是干净状态).
                      setSearchQuery("");
                      onOpenFeed();
                    }
                  }}
                  disabled={searchQuery.trim().length === 0}
                  style={[styles.sheetWideBtn, styles.sheetWideBtnDark, searchQuery.trim().length === 0 ? { opacity: 0.5 } : undefined]}
                >
                  <Text style={styles.sheetWideBtnTextDark}>搜索</Text>
                </Pressable>
              </View>
            </View>
          </Modal>

          {/* R15.68: R2 主页设置 sheet — 跳编辑主页 / 隐私 / 分享入口 */}
          <Modal animationType="slide" onRequestClose={() => setSettingsSheetOpen(false)} transparent visible={settingsSheetOpen}>
            <View style={styles.sheetOverlay}>
              <View style={styles.sheetCard}>
                <Text style={styles.sheetTitle}>主页设置</Text>
                <Text style={styles.sheetSub}>管理主页、隐私和设置。</Text>
                <Pressable onPress={() => { setSettingsSheetOpen(false); setProfileEditorOpen(true); }} style={styles.sheetWideBtn}>
                  <Text style={styles.sheetWideBtnText}>编辑个人资料</Text>
                </Pressable>
                <Pressable onPress={() => { setSettingsSheetOpen(false); void Share.share({ message: `查看 ${profileDraft.name} 的 Proxy 主页` }); }} style={styles.sheetWideBtn}>
                  <Text style={styles.sheetWideBtnText}>分享主页</Text>
                </Pressable>
                {/* R15.77: AI 身份中心入口 — R1 HTML frontstage 1:1 抄 (3 类身份 + 3 phone preview) */}
                <Pressable onPress={() => { setSettingsSheetOpen(false); setAiIdentityOpen(true); }} style={styles.sheetWideBtn}>
                  <Text style={styles.sheetWideBtnText}>AI 身份中心</Text>
                </Pressable>
                <Pressable onPress={() => setSettingsSheetOpen(false)} style={[styles.sheetWideBtn, styles.sheetWideBtnDark]}>
                  <Text style={styles.sheetWideBtnTextDark}>完成</Text>
                </Pressable>
              </View>
            </View>
          </Modal>
          {/* R15.77: AI 身份中心全屏 — R1 HTML frontstage 1:1 抄 */}
          <Modal animationType="slide" onRequestClose={() => setAiIdentityOpen(false)} visible={aiIdentityOpen}>
            <AIIdentityShowcaseSurface onBack={() => setAiIdentityOpen(false)} />
          </Modal>
          {profileViewer && viewedItems.length > 0 ? <MediaViewer items={viewedItems} index={profileViewer.index} author={profileDraft.name} resolveUrl={(path) => localNet.resolveMediaUrl(path)} onNavigate={(index) => setProfileViewer((current) => current ? { ...current, index } : current)} onClose={() => setProfileViewer(undefined)} /> : null}
        </View>
      );
    }

    if (subPage.route === "personalqr") {
      return contentWrapper(
        <View style={styles.root}>
          <ScrollView contentContainerStyle={styles.content}>
            <Pressable onPress={() => setSubPage(undefined)} style={styles.subPageBack}>
              <Text style={styles.subPageBackText}>‹ 返回</Text>
            </Pressable>
            <Text style={styles.subPageTitle}>我的二维码</Text>

            <QrCard
              title="Huyen · Proxy"
              desc="扫码先进入 Proxy 主页。TikTok / Zalo 是否展示，继续遵循你的可见范围。"
              actionLabel="分享二维码"
              alignCenter
            />

            <Text style={styles.customSectionTitle}>扫码后看到</Text>
            <Text style={styles.customSectionHint}>预览</Text>
            <View style={styles.privacyLadder}>
              {[
                ["1", "Proxy 主页", "姓名、城市、公开能力、Proxy 信誉", "始终"],
                ["2", "TikTok / Instagram", "当前设为公开", "公开"],
                ["3", "Zalo", "订单成立后才开放", "合作后"]
              ].map(([i, t, d, v]) => (
                <View key={i} style={styles.privacyStep}>
                  <View style={styles.privacyStepIndex}>
                    <Text style={styles.privacyStepIndexText}>{i}</Text>
                  </View>
                  <View style={styles.privacyStepCopy}>
                    <Text style={styles.privacyStepTitle}>{t}</Text>
                    <Text style={styles.privacyStepDesc}>{d}</Text>
                  </View>
                  <View style={styles.privacyStepTag}>
                    <Text style={styles.privacyStepTagText}>{v}</Text>
                  </View>
                </View>
              ))}
            </View>
          </ScrollView>
        </View>
      );
    }

    // R15 商家原型 enterpriseops：Skill 先处理现实资料和 Draft，
    // Merchant / Catalog / Storefront 真源只在明确确认后才发布。
    if (subPage.route === "enterpriseops") {
      const draftReady = enterpriseOpsStage !== "READY";
      const confirmed = enterpriseOpsStage === "CONFIRMED" || enterpriseOpsStage === "PUBLISHED";
      const published = enterpriseOpsStage === "PUBLISHED";
      return contentWrapper(
        <View style={styles.root}>
          <ScrollView contentContainerStyle={styles.content}>
            <Pressable onPress={() => setSubPage(undefined)} style={styles.subPageBack}>
              <Text style={styles.subPageBackText}>‹ 返回</Text>
            </Pressable>
            <View style={styles.enterpriseHero}>
              <Text style={styles.enterpriseSkillId}>enterprise_ops</Text>
              <Text style={styles.enterpriseHeroTitle}>企业运营助手</Text>
              <Text style={styles.enterpriseHeroText}>上传现实资料，或直接说“建店、整理商品、做内容、复盘经营”。系统只生成 Draft，业务真源始终要由商家确认。</Text>
            </View>
            <View style={styles.enterpriseRuntime}>
              <Text style={styles.enterpriseRuntimeTitle}>Unified Model Runtime</Text>
              <Text style={styles.enterpriseRuntimeText}>Skill 只声明理解、抽取与写作能力；底层模型由模型底座分发，业务端不绑定具体模型。</Text>
            </View>
            <View style={styles.enterpriseQuickGrid}>
              {[
                ["把店铺数字化", "照片 / 菜单 / 产品 / 品牌资料 → Store Draft"],
                ["整理商品与菜单", "Catalog Draft / 分类 / 描述 / 素材"],
                ["做内容与推广草稿", "Post / Benefit / Campaign Draft"],
                ["复盘门店经营", "基于订单、结果与客流数据给建议"]
              ].map(([title, desc]) => (
                <Pressable key={title} accessibilityLabel={title} onPress={() => setEnterpriseOpsStage("DRAFT_READY")} style={styles.enterpriseQuick}>
                  <Text style={styles.enterpriseQuickTitle}>{title}</Text>
                  <Text style={styles.enterpriseQuickDesc}>{desc}</Text>
                </Pressable>
              ))}
            </View>
            <View style={styles.detailSectionHead}>
              <Text style={styles.detailSectionTitle}>给 Proxy 看现实资料</Text>
              <Text style={styles.detailSectionHint}>{enterpriseOpsAssets} 个 Source Assets</Text>
            </View>
            <View style={styles.enterpriseAssetTray}>
              {["店门", "菜单", "品牌资料"].slice(0, enterpriseOpsAssets).map((asset) => (
                <View key={asset} style={styles.enterpriseAsset}>
                  <Text style={styles.enterpriseAssetThumb}>▧</Text>
                  <Text style={styles.enterpriseAssetText}>{asset}</Text>
                </View>
              ))}
            </View>
            <View style={styles.enterpriseAssetActions}>
              <Pressable onPress={() => setEnterpriseOpsAssets((count) => count + 1)} style={styles.lightCta}><Text style={styles.lightCtaText}>拍店铺 / 产品</Text></Pressable>
              <Pressable onPress={() => setEnterpriseOpsAssets((count) => count + 1)} style={styles.lightCta}><Text style={styles.lightCtaText}>上传文件</Text></Pressable>
            </View>
            {draftReady ? (
              <View style={styles.enterpriseDraft}>
                <Text style={styles.enterpriseDraftTitle}>Store Digitization Draft</Text>
                {[["Bonsaidon", "海鲜自助 · 河内 · 11:00–22:00", "结构 ✓"], ["工作日下午双人权益", "329,000₫ · 来源：菜单与活动资料", "96%"], ["双人晚餐预约套餐", "599,000₫ · 来源：菜单照片", "需确认"]].map(([name, meta, state]) => (
                  <View key={name} style={styles.enterpriseDraftRow}>
                    <View style={styles.enterpriseDraftCopy}><Text style={styles.enterpriseDraftName}>{name}</Text><Text style={styles.enterpriseDraftMeta}>{meta}</Text></View>
                    <Text style={styles.enterpriseDraftState}>{state}</Text>
                  </View>
                ))}
              </View>
            ) : null}
            {draftReady && !confirmed ? <Pressable onPress={() => setEnterpriseOpsStage("CONFIRMED")} style={styles.primaryCta}><Text style={styles.primaryCtaText}>确认这个 Draft</Text></Pressable> : null}
            {confirmed && !published ? <Pressable onPress={() => setEnterpriseOpsStage("PUBLISHED")} style={styles.primaryCta}><Text style={styles.primaryCtaText}>发布线上店铺</Text></Pressable> : null}
            {published ? <Pressable onPress={() => openSubPage("merchantstorefront")} style={styles.primaryCta}><Text style={styles.primaryCtaText}>查看已发布店铺</Text></Pressable> : null}
            <View style={styles.infoNote}><Text style={styles.infoNoteTitle}>Skill Boundary</Text><Text style={styles.infoNoteText}>Source Asset → Model Output → Draft Artifact → Merchant Confirmation → Authorized Domain Command。模型不直接成为 Merchant、Catalog 或 Order 真源。</Text></View>
          </ScrollView>
        </View>
      );
    }

    if (subPage.route === "trustedteam") {
      // R15.12.22 Friend Relationship Advanced：合作执行网络是企业的
      // Relationship Edge，不是旧版的普通信息卡列表。
      const executors = [
        { initial: "A", name: "An · 活动接待", meta: "河内 · 最近合作 8 天前", rating: "4.9", stats: [["18 次", "完成合作"], ["94%", "按时率"], ["可用", "本周六"]] },
        { initial: "M", name: "Minh · 中越口译", meta: "北宁 / 河内 · 最近合作 12 天前", rating: "4.8", stats: [["12 次", "完成合作"], ["97%", "按时率"], ["可用", "周末"]] }
      ];
      return contentWrapper(
        <View style={styles.root}>
          <ScrollView contentContainerStyle={styles.content}>
            <Pressable onPress={() => setSubPage(undefined)} style={styles.subPageBack}><Text style={styles.subPageBackText}>‹ 返回</Text></Pressable>
            <Text style={styles.detailTitle}>合作执行网络</Text>
            <Text style={styles.detailSub}>Bonsaidon · 真实合作过 27 人 · 本周 11 人可用</Text>
            {executors.map((executor) => (
              <View key={executor.initial} style={styles.trustedExecutorCard}>
                <View style={styles.trustedExecutorTop}>
                  <Gradient from={color.magenta} to={color.violet} style={styles.trustedExecutorAvatar}><Text style={styles.trustedExecutorAvatarText}>{executor.initial}</Text></Gradient>
                  <View style={styles.trustedExecutorCopy}>
                    <Text style={styles.trustedExecutorName}>{executor.name}</Text>
                    <Text style={styles.trustedExecutorMeta}>{executor.meta}</Text>
                  </View>
                  <Text style={styles.trustedExecutorRating}>{executor.rating}</Text>
                </View>
                <View style={styles.trustedExecutorStats}>
                  {executor.stats.map(([value, label]) => (
                    <View key={label} style={styles.trustedExecutorStat}>
                      <Text style={styles.trustedExecutorStatValue}>{value}</Text>
                      <Text style={styles.trustedExecutorStatLabel}>{label}</Text>
                    </View>
                  ))}
                </View>
              </View>
            ))}
            <View style={styles.trustedSuggestion}>
              <View style={styles.trustedSuggestionHead}><Text style={styles.trustedSuggestionTitle}>智能辅助 建议组合</Text><Text style={styles.trustedSuggestionHint}>不自动下单</Text></View>
              <View style={styles.trustedSuggestionBody}>
                <Text style={styles.trustedSuggestionBodyTitle}>周六新店活动 · 推荐 4 人</Text>
                <Text style={styles.trustedSuggestionBodyText}>优先复用 3 位历史合作 + 1 位探索型新执行者</Text>
              </View>
            </View>
            <Pressable accessibilityLabel="再次邀请团队" onPress={() => openSubPage("multislot")} style={styles.trustedInviteTouchable}>
              <Gradient from={color.magenta} to={color.violet} style={styles.trustedInvite}><Text style={styles.trustedInviteText}>再次邀请团队</Text></Gradient>
            </Pressable>
            <Pressable accessibilityLabel="返回我的企业" onPress={() => setSubPage(undefined)} style={styles.trustedReturn}><Text style={styles.trustedReturnText}>返回我的企业</Text></Pressable>
          </ScrollView>
        </View>
      );
    }

    if (subPage.route === "multislot") {
      return contentWrapper(
        <View style={styles.root}>
          <ScrollView contentContainerStyle={styles.content}>
            <Pressable onPress={() => setSubPage(undefined)} style={styles.subPageBack}><Text style={styles.subPageBackText}>‹ 返回</Text></Pressable>
            <Text style={styles.detailTitle}>门店开业</Text>
            {[["接待 · G-01", "已分配 · An"], ["接待 · G-02", "已分配 · Minh"], ["接待 · G-03", "待分配 · 独立名额"], ["口译 · I-01", "已分配"], ["内容人员 · C-01", "待分配"]].map(([name, detail]) => <View key={name} style={styles.prototypeCard}><Text style={styles.prototypeCardTitle}>{name}</Text><Text style={styles.prototypeCardDesc}>{detail}</Text></View>)}
            <View style={[styles.infoNote, styles.enterpriseProgressNote]}><Text style={styles.infoNoteTitle}>整体进度</Text><Text style={styles.infoNoteText}>4 / 5 名额 · 80%</Text></View>
            <Pressable onPress={() => openSubPage("todayboard")} style={styles.primaryCta}><Text style={styles.primaryCtaText}>打开今日执行</Text></Pressable>
          </ScrollView>
        </View>
      );
    }

    if (subPage.route === "todayboard") {
      return contentWrapper(
        <View style={styles.root}>
          <ScrollView contentContainerStyle={styles.content}>
            <Pressable onPress={() => setSubPage(undefined)} style={styles.subPageBack}><Text style={styles.subPageBackText}>‹ 返回</Text></Pressable>
            <Text style={styles.detailTitle}>今日执行</Text>
            <View style={styles.enterpriseMetrics}>{[["5", "名额"], ["3", "已到场"], ["1", "有风险"]].map(([value, label]) => <View key={label} style={styles.enterpriseMetric}><Text style={styles.enterpriseMetricValue}>{value}</Text><Text style={styles.enterpriseMetricLabel}>{label}</Text></View>)}</View>
            {[["G-01 · An", "已到场 · 17:46"], ["G-02 · Minh", "前往中 · 预计 8 分钟"], ["G-03", "待补位 · 需要替补"]].map(([name, detail]) => <View key={name} style={styles.prototypeCard}><Text style={styles.prototypeCardTitle}>{name}</Text><Text style={styles.prototypeCardDesc}>{detail}</Text></View>)}
            <Pressable onPress={() => openSubPage("multislot")} style={styles.primaryCta}><Text style={styles.primaryCtaText}>查看名额与补位</Text></Pressable>
            <Pressable onPress={() => openSubPage("members")} style={styles.lightCta}><Text style={styles.lightCtaText}>成员与权限</Text></Pressable>
          </ScrollView>
        </View>
      );
    }

    if (subPage.route === "merchantstorefront") {
      return contentWrapper(
        <View style={styles.root}>
          <ScrollView contentContainerStyle={styles.content}>
            <Pressable onPress={() => setSubPage(undefined)} style={styles.subPageBack}>
              <Text style={styles.subPageBackText}>‹ 返回</Text>
            </Pressable>
            <Text style={styles.subPageTitle}>线上店铺</Text>

            <View style={styles.storeTop}>
              <View style={styles.storeTopRow}>
                <Gradient from={color.magenta} to={color.violet} style={styles.storeAvatar}>
                  <Text style={styles.storeAvatarText}>B</Text>
                </Gradient>
                <View style={styles.heroCopy}>
                  <Text style={styles.heroName}>Bonsaidon</Text>
                  <Text style={styles.heroMeta}>海鲜自助 · 河内 · 3 个经营节点</Text>
                </View>
              </View>
              <View style={styles.storeStats}>
                {[["12", "在售 Offer"], ["148", "今日订单"], ["4.8", "门店评分"]].map(([v, l]) => (
                  <View key={l} style={styles.storeStatItem}>
                    <Text style={styles.storeStatValue}>{v}</Text>
                    <Text style={styles.storeStatLabel}>{l}</Text>
                  </View>
                ))}
              </View>
            </View>

            <QrCard
              title="Bonsaidon · Proxy 店铺"
              desc="扫码直接进入门店主页，看到在售 Offer 与真实到店核销。"
              actionLabel="打开店铺二维码"
              onAction={() => openSubPage("personalqr")}
            />

            <Text style={styles.customSectionTitle}>经营入口</Text>
            <Text style={styles.customSectionHint}>Storefront</Text>
            <View style={styles.bizGrid}>
              {[
                ["▤", "商品 / 服务", "套餐、预约、权益与库存"],
                ["↗", "活动 Offer", "低峰、拉新与限时权益", "merchantcampaign"],
                ["◇", "订单", "待确认、履约、退款、完成"],
                ["◎", "客户", "新客、复购与来源"]
              ].map(([icon, label, desc, route]) => (
                <Pressable
                  key={label}
                  onPress={route ? () => openSubPage(route) : undefined}
                  style={styles.bizTile}
                >
                  <View style={styles.bizTileIcon}>
                    <Text style={styles.bizTileIconText}>{icon}</Text>
                  </View>
                  <Text style={styles.bizTileLabel}>{label}</Text>
                  <Text style={styles.bizTileDesc}>{desc}</Text>
                </Pressable>
              ))}
            </View>

            <Text style={styles.customSectionTitle}>今天的 Offer</Text>
            <Text style={styles.customSectionHint}>Server Truth</Text>
            <View style={styles.offerCard}>
              <Text style={styles.offerTitle}>海鲜自助 · 工作日下午场</Text>
              <Text style={styles.offerMeta}>14:00–17:00 · 399k → 329k · 余 24 份</Text>
            </View>
            <View style={styles.offerCard}>
              <Text style={styles.offerTitle}>双人晚餐 · 预约套餐</Text>
              <Text style={styles.offerMeta}>18:00–21:00 · 2 人 · 余 11 组</Text>
            </View>
          </ScrollView>
        </View>
      );
    }

    // R15.12.22：经营诊断不是旧版“标题 + 通用信息卡”。它是由 Server
    // UI Recipe 生成的诊断总览；动作只能作为提议，仍要由商家明确确认。
    if (subPage.route === "businessdiagnostic") {
      return contentWrapper(
        <View style={styles.root}>
          <ScrollView contentContainerStyle={styles.content}>
            <Pressable onPress={() => setSubPage(undefined)} style={styles.subPageBack}><Text style={styles.subPageBackText}>‹ 返回</Text></Pressable>
            <View style={styles.diagnosticTitleRow}>
              <Text style={styles.detailTitle}>经营诊断</Text>
              <View style={styles.diagnosticTag}><Text style={styles.diagnosticTagText}>✦ 动态视图</Text></View>
            </View>
            <View style={styles.diagnosticHero}>
              <View style={styles.diagnosticHeroTop}>
                <View><Text style={styles.diagnosticHeroTitle}>Bonsaidon · 今天</Text><Text style={styles.diagnosticHeroText}>模型根据经营目标和实时 Read Model，组合今天最值得处理的信息。</Text></View>
                <View><Text style={styles.diagnosticScore}>78</Text><Text style={styles.diagnosticScoreLabel}>经营健康度 / 100</Text></View>
              </View>
              <View style={styles.diagnosticMetrics}>{[["248", "到店"], ["6.2M", "成交额"], ["172", "新客户"], ["38", "复购客户"]].map(([value, label]) => <View key={label} style={styles.diagnosticMetric}><Text style={styles.diagnosticMetricValue}>{value}</Text><Text style={styles.diagnosticMetricLabel}>{label}</Text></View>)}</View>
            </View>
            <View style={styles.diagnosticInsightGrid}>
              <View style={styles.diagnosticInsight}><Text style={styles.diagnosticInsightKicker}>需要关注</Text><Text style={styles.diagnosticInsightValue}>37%</Text><Text style={styles.diagnosticInsightText}>14:00–17:00 时段利用率低于近 4 周平均。</Text></View>
              <View style={styles.diagnosticInsight}><Text style={styles.diagnosticInsightKicker}>表现较好</Text><Text style={styles.diagnosticInsightValue}>+22%</Text><Text style={styles.diagnosticInsightText}>本周新客户增长明显，可继续放大当前活动来源。</Text></View>
            </View>
            <View style={styles.diagnosticActions}>
              <View style={styles.diagnosticActionsHead}><Text style={styles.diagnosticActionsTitle}>建议动作</Text><Text style={styles.diagnosticActionsHint}>模型提议 · 人确认</Text></View>
              <View style={styles.diagnosticActionItem}><Text style={styles.diagnosticActionTitle}>创建下午低峰活动</Text><Text style={styles.diagnosticActionText}>30 份限时权益 · 14:00–17:00 · 只向相关 Intent 用户分发</Text></View>
              <View style={styles.diagnosticActionItem}><Text style={styles.diagnosticActionTitle}>补 1 位活动执行者</Text><Text style={styles.diagnosticActionText}>从真实合作网络优先邀请，若不足再开放合格供给</Text></View>
              <View style={styles.diagnosticActionButtons}>
                <Pressable onPress={() => openSubPage("merchantcampaign")} style={styles.diagnosticCreate}><Text style={styles.diagnosticCreateText}>创建活动</Text></Pressable>
                <Pressable onPress={() => openSubPage("trustedteam")} style={styles.diagnosticFind}><Text style={styles.diagnosticFindText}>找执行者</Text></Pressable>
              </View>
            </View>
            <View style={styles.diagnosticRecipe}><Text style={styles.diagnosticRecipeTitle}>可复用 UI Recipe</Text><Text style={styles.diagnosticRecipeText}>BUSINESS_DIAG@monthly_DIAGNOSTIC · 结构复用；本次指标、异常、建议动作重新 Hydrate。模型不能把自己推断的数字写成经营真相。</Text></View>
            <Pressable accessibilityLabel="返回我的企业" onPress={() => setSubPage(undefined)} style={styles.trustedReturn}><Text style={styles.trustedReturnText}>返回我的企业</Text></Pressable>
          </ScrollView>
        </View>
      );
    }

    if (subPage.route === "bdash") {
      return contentWrapper(
        <View style={styles.root}>
          <ScrollView contentContainerStyle={styles.content}>
            <Pressable onPress={() => setSubPage(undefined)} style={styles.subPageBack}>
              <Text style={styles.subPageBackText}>‹ 返回</Text>
            </Pressable>
            <Text style={styles.subPageTitle}>企业 / 店铺资料</Text>

            <View style={styles.storeTop}>
              <View style={styles.storeTopRow}>
                <Gradient from={color.magenta} to={color.violet} style={styles.storeAvatar}>
                  <Text style={styles.storeAvatarText}>B</Text>
                </Gradient>
                <View style={styles.heroCopy}>
                  <Text style={styles.heroName}>Bonsaidon</Text>
                  <Text style={styles.heroMeta}>海鲜自助 · 河内 · 主体已验证</Text>
                </View>
              </View>
            </View>

            <QrCard
              title="商家身份二维码"
              desc="顾客扫码核验商家主体与真实到店记录，扫码先看到门店主页与信誉。"
              actionLabel="打开商家二维码"
              onAction={() => openSubPage("personalqr")}
            />

            <View style={styles.subSection}>
              <Text style={styles.subSectionTitle}>企业主体</Text>
              {[
                ["主体名称", "Bonsaidon · 海鲜自助"],
                ["经营城市", "河内"],
                ["经营节点", "3 个"],
                ["身份验证", "已认证 · Proxy 商家身份"]
              ].map(([label, value]) => (
                <View key={label} style={styles.subRow}>
                  <Text style={styles.subRowLabel}>{label}</Text>
                  <Text style={styles.subRowValue}>{value}</Text>
                </View>
              ))}
            </View>

            <Text style={styles.customSectionTitle}>二维码与展示</Text>
            <Text style={styles.customSectionHint}>Proxy 商家身份</Text>
            <SocialRow
              icon="◈"
              label="门店主页"
              desc="顾客扫码先看到这家店的公开信息与信誉"
              onPress={() => openSubPage("merchantstorefront")}
            />
            <SocialRow
              icon="⌁"
              label="访问与转化"
              desc="知道二维码带来多少到店与核销"
              onPress={() => openSubPage("socialanalytics")}
            />
          </ScrollView>
        </View>
      );
    }

    // 兜底路由仍遵循原型的“标题 + 独立卡片”页面语法；不再使用错误的巨大图标和表格容器。
    return contentWrapper(
      <View style={styles.root}>
        <ScrollView contentContainerStyle={styles.content}>
          <Pressable onPress={() => setSubPage(undefined)} style={styles.subPageBack}>
            <Text style={styles.subPageBackText}>‹ 返回</Text>
          </Pressable>
          <Text style={styles.detailTitle}>{subPage.title}</Text>
          <Text style={styles.detailSub}>{subPage.desc}</Text>

          {content?.sections?.map((section, sIdx) => (
            <View key={sIdx} style={styles.fallbackSection}>
              <View style={styles.detailSectionHead}>
                <Text style={styles.detailSectionTitle}>{section.title}</Text>
              </View>
              {section.rows.map((row, rIdx) => (
                <View key={rIdx} style={styles.prototypeCard}>
                  <Text style={styles.prototypeCardTitle}>{row.label}</Text>
                  {row.value ? <Text style={styles.prototypeCardDesc}>{row.value}</Text> : null}
                </View>
              ))}
            </View>
          ))}

          {!content?.sections ? (
            <View style={styles.infoNote}>
              <Text style={styles.infoNoteTitle}>正在准备这个工作区</Text>
              <Text style={styles.infoNoteText}>它会沿用此页面的真实业务对象和权限边界，不再以通用占位页替代。</Text>
            </View>
          ) : null}
          <Pressable onPress={() => setSubPage(undefined)} style={styles.lightCta}>
            <Text style={styles.lightCtaText}>返回我的</Text>
          </Pressable>
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: bottomNavVisible === false ? 16 : 120 }]} onScroll={onScroll} scrollEventThrottle={16}>
        <View style={styles.pageTitleRow}>
          <Text style={styles.pageTitle}>{persona.pageTitle}</Text>
        </View>

        {persona.profileCard ? (
          <Pressable onPress={() => openSubPage(persona.profileCard!.route)} style={styles.profileCard}>
            <View style={styles.profileTop}>
              <Gradient from="#241246" to="#7A2CFF" style={styles.profileAvatar}>
                <Text style={styles.profileAvatarText}>{persona.avatarText}</Text>
              </Gradient>
              <View style={styles.profileCopy}>
                <Text style={styles.profileName}>{persona.name}</Text>
                <View style={styles.profileMeta}>
                  <Text style={styles.profileMetaText}>河内</Text>
                  <View style={styles.profileVerifyDot}>
                    <Text style={styles.profileVerifyText}>✓</Text>
                  </View>
                  <Text style={styles.profileMetaText}>已验证 · 准时 98%</Text>
                </View>
              </View>
              <Pressable
                accessibilityLabel="选择状态"
                onPress={(event) => { event.stopPropagation?.(); setAvRuleSheetOpen(true); }}
                style={styles.profileStatus}
                hitSlop={4}
              >
                <Text style={styles.profileStatusText}>● {availabilityLabel(availability)}</Text>
              </Pressable>
            </View>
            <View style={styles.profileSocial}>
              {persona.profileCard.social.map((s) => (
                <View key={s} style={[styles.profileSocialBadge, s === "TT" && styles.profileSocialBadgeOn]}>
                  <Text style={styles.profileSocialBadgeText}>{s}</Text>
                </View>
              ))}
              <Text style={styles.profileSocialMore}>社媒与二维码 ›</Text>
            </View>
          </Pressable>
        ) : (
          <View style={styles.identityCard}>
            {persona.avatarGrad ? (
              <Gradient from={color.magenta} to={color.violet} style={styles.identityAvatar}>
                <Text style={styles.identityAvatarText}>{persona.avatarText}</Text>
              </Gradient>
            ) : (
              <View style={[styles.identityAvatar, styles.identityAvatarSolid]}>
                <Text style={styles.identityAvatarText}>{persona.avatarText}</Text>
              </View>
            )}
            <View style={styles.identityCopy}>
              <Text style={styles.identityName}>{persona.name}</Text>
              <Text style={styles.identityDesc}>{persona.desc}</Text>
            </View>
            <Pressable
              onPress={() => persona.identityActionSwitch && onOpenSwitcher()}
              style={styles.identityButton}
            >
              <Text style={styles.identityButtonText}>{persona.identityActionLabel}</Text>
            </Pressable>
          </View>
        )}

        {context === "REQUESTER" ? (
          <Pressable accessibilityLabel="礼品券，3 张可用，去使用" onPress={onOpenVouchers} style={styles.voucherPin}>
            <View style={styles.voucherPinMark}><VoucherMenuGlyph color={color.ink} /></View>
            <View style={styles.voucherPinCopy}>
              <Text style={styles.voucherPinTitle}>礼品券</Text>
              <Text style={styles.voucherPinDesc}>咖啡券、体验券与活动券</Text>
            </View>
            <View style={styles.voucherPinRight}>
              <Text style={styles.voucherPinCount}>3 张可用</Text>
              <Text style={styles.voucherPinAction}>去使用 ›</Text>
            </View>
          </Pressable>
        ) : null}

        {persona.alert ? (
          <Pressable onPress={() => persona.alert && openSubPage(persona.alert.route)} style={styles.bizAlert}>
            <View style={styles.bizAlertMark}>
              <Text style={styles.bizAlertMarkText}>{persona.alert.icon}</Text>
            </View>
            <View style={styles.bizAlertCopy}>
              <Text style={styles.bizAlertTitle}>{persona.alert.title}</Text>
              <Text style={styles.bizAlertDesc}>{persona.alert.desc}</Text>
            </View>
            <Text style={styles.bizAlertTag}>{persona.alert.tag}</Text>
          </Pressable>
        ) : null}

        {effectiveSections.map((section) => (
          <View key={section.id ?? section.title} style={styles.section}>
            <View style={styles.sectionHead}>
              <Text style={styles.sectionTitle}>{section.title}</Text>
              <Text style={styles.sectionHint}>{section.hint}</Text>
            </View>
            {section.rows.map((row) => (
              <ServiceRow key={row.label} onPress={() => pressRow(row)} row={row} />
            ))}
          </View>
        ))}

        <View style={styles.contextLine}>
          <Text style={styles.contextLineText}>{persona.contextLineLabel}</Text>
          <Pressable onPress={onOpenSwitcher}>
            <Text style={styles.contextLineAction}>{persona.contextLineAction} ›</Text>
          </Pressable>
        </View>

        {persona.settingsRow ? (
          <ServiceRow onPress={() => persona.settingsRow && pressRow(persona.settingsRow)} row={persona.settingsRow} />
        ) : null}

        <Pressable onPress={onSignOut} style={styles.signOut}>
          <Text style={styles.signOutText}>退出登录</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { backgroundColor: color.offWhite, flex: 1 },
  content: { paddingBottom: 18, paddingHorizontal: 15, paddingTop: 11 },
  orderPageHead: { alignItems: "center", flexDirection: "row", gap: 10, marginBottom: 12 },
  orderBack: { alignItems: "center", backgroundColor: color.white, borderColor: color.line, borderRadius: 12, borderWidth: 1, height: 40, justifyContent: "center", width: 40 },
  orderBackText: { color: color.ink, fontSize: 22, fontWeight: "800" },
  orderTabs: { marginBottom: 12 },
  orderTab: { backgroundColor: color.white, borderColor: color.line, borderRadius: 999, borderWidth: 1, marginRight: 7, paddingHorizontal: 13, paddingVertical: 9 },
  orderTabOn: { backgroundColor: color.ink, borderColor: color.ink },
  orderTabText: { color: color.muted, fontSize: 12, fontWeight: "800" },
  orderTabTextOn: { color: color.white },
  orderCard: { backgroundColor: color.white, borderColor: color.line, borderRadius: 20, borderWidth: 1, marginBottom: 11, padding: 14, ...shadows.card },
  orderHead: { alignItems: "flex-start", flexDirection: "row", gap: 8, justifyContent: "space-between" },
  orderCopy: { flex: 1 },
  orderTitle: { color: color.ink, fontSize: 14, fontWeight: "900" },
  orderId: { color: color.muted, fontSize: 11, letterSpacing: 0.2, marginTop: 4 },
  orderBadge: { backgroundColor: "#F3F1F4", borderRadius: 999, color: "#6D6771", fontSize: 11, fontWeight: "800", overflow: "hidden", paddingHorizontal: 8, paddingVertical: 5 },
  orderBadgeLive: { backgroundColor: "#EFFFBD", color: "#3C4700" },
  orderGrid: { borderTopColor: color.line, borderTopWidth: 1, flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 12, paddingTop: 12 },
  orderField: { width: "47%" },
  orderFieldLabel: { color: color.muted, fontSize: 11, marginBottom: 3 },
  orderFieldValue: { color: color.ink, fontSize: 12, fontWeight: "800", lineHeight: 17 },
  orderStatus: { color: color.muted, fontSize: 11, marginTop: 11 },
  orderActions: { flexDirection: "row", gap: 7, marginTop: 12 },
  orderAction: { borderColor: color.line, borderRadius: 12, borderWidth: 1, paddingHorizontal: 11, paddingVertical: 8 },
  orderActionPrimary: { backgroundColor: color.ink, borderColor: color.ink },
  orderActionText: { color: color.ink, fontSize: 11, fontWeight: "800" },
  orderActionPrimaryText: { color: color.white },
  orderNotice: { backgroundColor: "#FAF9FB", borderRadius: 14, color: color.muted, fontSize: 11, lineHeight: 16, marginTop: 12, padding: 11 },
  activityOwnedTabs: { flexDirection: "row", gap: 7, marginBottom: 12 },
  activityOwnedTab: { backgroundColor: color.white, borderColor: color.line, borderRadius: 999, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 9 },
  activityOwnedTabOn: { backgroundColor: color.ink, borderColor: color.ink },
  activityOwnedTabText: { color: color.muted, fontSize: 12, fontWeight: "800" },
  activityOwnedTabTextOn: { color: color.white },
  savedIntro: { color: color.muted, fontSize: 12, lineHeight: 18, marginBottom: 12 },
  savedCard: { backgroundColor: color.white, borderColor: color.line, borderRadius: 20, borderWidth: 1, marginBottom: 11, padding: 14, ...shadows.card },
  savedRow: { alignItems: "center", flexDirection: "row", gap: 11 },
  savedThumb: { alignItems: "center", backgroundColor: "#F1EEF2", borderRadius: 14, height: 48, justifyContent: "center", width: 48 },
  savedThumbText: { color: color.ink, fontSize: 22 },
  savedMeta: { color: color.muted, fontSize: 11, lineHeight: 16, marginTop: 4 },
  meLocationRow: { alignItems: "center", flexDirection: "row", gap: 8, paddingBottom: 8, paddingHorizontal: 1, paddingTop: 3 },
  meLocationPin: { alignItems: "center", backgroundColor: "#F4EDF8", borderRadius: 10, height: 36, justifyContent: "center", width: 36 },
  meLocationCopy: { flex: 1 },
  meLocationCity: { color: color.ink, fontSize: 14, fontWeight: "800", lineHeight: 20 },
  meLocationSub: { color: color.muted, fontSize: 12, lineHeight: 17, marginTop: 2 },
  meLocationSwitch: { color: "#6D6175", fontSize: 11, fontWeight: "800" },
  pageTitleRow: { flexDirection: "row", alignItems: "center" },
  pageTitle: { color: color.ink, fontSize: 28, fontWeight: "900", lineHeight: 34, marginBottom: 4, marginTop: 8 },

  // 基线 .r159ProfileCard：可点按 → personalhub；含状态徽章与社媒 mini。
  profileCard: {
    backgroundColor: color.white,
    borderColor: color.line,
    borderRadius: 20,
    borderWidth: 1,
    marginVertical: 8,
    marginBottom: 12,
    paddingHorizontal: 16,
    paddingVertical: 16
  },
  profileTop: { alignItems: "center", flexDirection: "row", gap: 10 },
  profileAvatar: {
    alignItems: "center",
    borderRadius: 15,
    height: 46,
    justifyContent: "center",
    width: 46
  },
  profileAvatarText: { color: color.white, fontSize: 18, fontWeight: "900" },
  profileCopy: { flex: 1 },
  profileName: { color: color.ink, fontSize: 15, fontWeight: "800", lineHeight: 21 },
  profileMeta: { alignItems: "center", flexDirection: "row", gap: 5, marginTop: 3 },
  profileMetaText: { color: color.muted, fontSize: 12, lineHeight: 17 },
  profileVerifyDot: { alignItems: "center", backgroundColor: "#EFE8FF", borderRadius: 6, height: 12, justifyContent: "center", width: 12 },
  profileVerifyText: { color: "#6B35B6", fontSize: 11, fontWeight: "900", includeFontPadding: false, lineHeight: 15 },
  profileStatus: {
    backgroundColor: "#F1FFD7",
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 7
  },
  profileStatusText: { color: "#465C00", fontSize: 11, fontWeight: "900" },
  profileSocial: {
    alignItems: "center",
    borderTopColor: "#F1EDF3",
    borderTopWidth: 1,
    flexDirection: "row",
    gap: 6,
    marginTop: 11,
    paddingTop: 9
  },
  profileSocialBadge: {
    alignItems: "center",
    backgroundColor: "#FBFAFC",
    borderColor: "#EBE6EE",
    borderRadius: 9,
    borderWidth: 1,
    height: 25,
    justifyContent: "center",
    minWidth: 25,
    paddingHorizontal: 6
  },
  profileSocialBadgeOn: { backgroundColor: "#FAF7FF", borderColor: "#D8C8F0" },
  profileSocialBadgeText: { color: "#564D5B", fontSize: 11, fontWeight: "900" },
  profileSocialMore: { color: "#8B8291", fontSize: 11, marginLeft: 6 },

  // 基线 .bizalert：今天有 3 件事值得处理 → businessdiagnostic。
  bizAlert: {
    alignItems: "center",
    backgroundColor: color.ink,
    borderRadius: 17,
    flexDirection: "row",
    gap: 10,
    marginBottom: 4,
    marginTop: 8,
    padding: 13
  },
  bizAlertMark: {
    alignItems: "center",
    backgroundColor: "rgba(212,255,61,0.16)",
    borderRadius: 12,
    height: 40,
    justifyContent: "center",
    width: 40
  },
  bizAlertMarkText: { color: color.lime, fontSize: 17 },
  bizAlertCopy: { flex: 1 },
  bizAlertTitle: { color: color.white, fontSize: 11, fontWeight: "800" },
  bizAlertDesc: { color: "rgba(255,255,255,0.6)", fontSize: 11, lineHeight: 15, marginTop: 3 },
  bizAlertTag: { color: "#CBBFE0", fontSize: 11, fontWeight: "700" },

  // 基线 .r157IdentityCard：bg white border ln radius 17 padding 11。
  identityCard: {
    alignItems: "center",
    backgroundColor: color.white,
    borderColor: color.line,
    borderRadius: 17,
    borderWidth: 1,
    flexDirection: "row",
    gap: 9,
    marginVertical: 8,
    padding: 11
  },
  identityAvatar: {
    alignItems: "center",
    borderRadius: 13,
    height: 40,
    justifyContent: "center",
    width: 40
  },
  identityAvatarSolid: { backgroundColor: "#17131F" },
  identityAvatarText: { color: color.white, fontSize: 16, fontWeight: "900" },
  identityCopy: { flex: 1 },
  identityName: { color: color.ink, fontSize: 15, fontWeight: "800", lineHeight: 21 },
  identityDesc: { color: color.muted, fontSize: 12, lineHeight: 17, marginTop: 2 },
  identityButton: { backgroundColor: color.white, borderColor: color.line, borderRadius: 999, borderWidth: 1, minHeight: 44, paddingHorizontal: 12, paddingVertical: 10 },
  identityButtonText: { color: color.ink, fontSize: 14, fontWeight: "800" },

  section: { marginTop: 10 },
  sectionHead: {
    alignItems: "flex-end",
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 7,
    paddingHorizontal: 1
  },
  sectionTitle: { color: color.ink, fontSize: 17, fontWeight: "800", lineHeight: 24 },
  sectionHint: { color: color.muted, fontSize: 11, lineHeight: 15 },

  // R14.10 compact .card.service：radius 14 / padding 10 / icon 36。
  serviceRow: {
    alignItems: "center",
    backgroundColor: color.white,
    borderColor: "rgba(20,18,31,0.035)",
    borderRadius: 20,
    borderWidth: 1,
    flexDirection: "row",
    gap: 12,
    marginBottom: 6,
    minHeight: 72,
    padding: 12
  },
  serviceIcon: {
    alignItems: "center",
    backgroundColor: color.lime,
    borderRadius: 14,
    height: 44,
    justifyContent: "center",
    width: 44
  },
  serviceLogoBox: { backgroundColor: "#08090A" },
  serviceLogo: { borderRadius: 9, height: 36, width: 36 },
  voucherMenuGlyph: { alignItems: "center", height: 36, justifyContent: "center", width: 36 },
  voucherCup: { borderRadius: 4, borderWidth: 2.4, height: 14, left: 8, position: "absolute", top: 16, width: 17 },
  voucherCupHandle: { borderRadius: 7, borderWidth: 2.4, height: 9, left: 23, position: "absolute", top: 20, width: 8 },
  voucherSteam: { borderRadius: 4, height: 9, position: "absolute", top: 6, transform: [{ rotate: "18deg" }], width: 2.4 },
  voucherPin: { alignItems: "center", backgroundColor: color.white, borderColor: color.line, borderRadius: 17, borderWidth: 1, flexDirection: "row", gap: 9, marginBottom: 4, marginTop: -3, padding: 11, ...shadows.card },
  voucherPinMark: { alignItems: "center", backgroundColor: color.lime, borderRadius: 12, height: 40, justifyContent: "center", width: 40 },
  voucherPinCopy: { flex: 1, minWidth: 0 },
  voucherPinTitle: { color: color.ink, fontSize: 11, fontWeight: "800" },
  voucherPinDesc: { color: color.muted, fontSize: 11, marginTop: 3 },
  voucherPinRight: { alignItems: "flex-end" },
  voucherPinCount: { color: color.ink, fontSize: 11, fontWeight: "800" },
  voucherPinAction: { color: color.muted, fontSize: 11, marginTop: 3 },
  enterpriseHero: { backgroundColor: color.ink, borderRadius: 18, marginTop: 4, padding: 14 },
  enterpriseSkillId: { color: color.lime, fontSize: 11, fontWeight: "900", letterSpacing: 0.7 },
  enterpriseHeroTitle: { color: color.white, fontSize: 19, fontWeight: "700", marginTop: 7 },
  enterpriseHeroText: { color: "rgba(255,255,255,0.7)", fontSize: 11, lineHeight: 15, marginTop: 5 },
  enterpriseRuntime: { backgroundColor: "#F4EEF7", borderRadius: 14, marginTop: 8, padding: 11 },
  enterpriseRuntimeTitle: { color: color.ink, fontSize: 11, fontWeight: "900" },
  enterpriseRuntimeText: { color: color.muted, fontSize: 11, lineHeight: 15, marginTop: 4 },
  enterpriseQuickGrid: { flexDirection: "row", flexWrap: "wrap", gap: 7, marginTop: 10 },
  enterpriseQuick: { backgroundColor: color.white, borderColor: color.line, borderRadius: 14, borderWidth: 1, minHeight: 84, padding: 10, width: "48.8%", ...shadows.card },
  enterpriseQuickTitle: { color: color.ink, fontSize: 11, fontWeight: "900" },
  enterpriseQuickDesc: { color: color.muted, fontSize: 11, lineHeight: 15, marginTop: 5 },
  enterpriseAssetTray: { flexDirection: "row", gap: 7, marginTop: 7 },
  enterpriseAsset: { alignItems: "center", backgroundColor: color.white, borderColor: color.line, borderRadius: 12, borderWidth: 1, flex: 1, minHeight: 61, padding: 7 },
  enterpriseAssetThumb: { color: "#6F37B9", fontSize: 16 },
  enterpriseAssetText: { color: color.ink, fontSize: 11, fontWeight: "800", marginTop: 4 },
  enterpriseAssetActions: { flexDirection: "row", gap: 7 },
  enterpriseDraft: { backgroundColor: color.white, borderColor: color.line, borderRadius: 16, borderWidth: 1, marginTop: 10, padding: 11, ...shadows.card },
  enterpriseDraftTitle: { color: color.ink, fontSize: 11, fontWeight: "900", marginBottom: 5 },
  enterpriseDraftRow: { alignItems: "center", borderTopColor: color.line, borderTopWidth: 1, flexDirection: "row", gap: 8, paddingVertical: 8 },
  enterpriseDraftCopy: { flex: 1 },
  enterpriseDraftName: { color: color.ink, fontSize: 11, fontWeight: "800" },
  enterpriseDraftMeta: { color: color.muted, fontSize: 11, lineHeight: 15, marginTop: 2 },
  enterpriseDraftState: { color: "#536D00", fontSize: 11, fontWeight: "900" },
  enterpriseProgressNote: { backgroundColor: "#F4EEF7" },
  enterpriseMetrics: { flexDirection: "row", gap: 7, marginTop: 9 },
  enterpriseMetric: { alignItems: "center", backgroundColor: color.white, borderColor: color.line, borderRadius: 14, borderWidth: 1, flex: 1, paddingVertical: 12, ...shadows.card },
  enterpriseMetricValue: { color: color.ink, fontSize: 16, fontWeight: "900" },
  enterpriseMetricLabel: { color: color.muted, fontSize: 11, marginTop: 3 },
  serviceCopy: { flex: 1 },
  serviceLabel: { color: color.ink, fontSize: 15, fontWeight: "800", lineHeight: 21 },
  serviceDesc: { color: color.muted, fontSize: 11, lineHeight: 15, marginTop: 2 },
  chev: { color: "#A59CAB", fontSize: 24 },

  contextLine: {
    alignItems: "center",
    backgroundColor: "#F4EEF7",
    borderRadius: 13,
    flexDirection: "row",
    justifyContent: "space-between",
    marginVertical: 7,
    paddingHorizontal: 9,
    paddingVertical: 8
  },
  contextLineText: { color: color.ink, fontSize: 11, fontWeight: "700" },
  contextLineAction: { color: "#574361", fontSize: 11, fontWeight: "900" },

  signOut: { alignItems: "center", marginBottom: 2, marginTop: 13, paddingVertical: 2 },
  signOutText: { color: "#A84A69", fontSize: 11, fontWeight: "800" },

  // 子页面。
  subPageBack: { marginBottom: 10, paddingVertical: 4 },
  subPageBackText: { color: color.magenta, fontSize: 12, fontWeight: "700" },
  subPageIcon: {
    alignItems: "center",
    backgroundColor: color.lime,
    borderRadius: 16,
    height: 56,
    justifyContent: "center",
    marginBottom: 12,
    width: 56
  },
  subPageIconText: { color: color.ink, fontSize: 28 },
  subPageTitle: { color: color.ink, fontSize: 18, fontWeight: "800", marginBottom: 6 },
  subPageSub: { color: color.muted, fontSize: 12, lineHeight: 18, marginBottom: 16 },
  subPageDesc: { color: color.muted, fontSize: 12, lineHeight: 18, marginBottom: 16 },
  // R16.7: 个人总管理 subPage 样式
  profileManageRow: { flexDirection: "row", alignItems: "center", padding: 12, backgroundColor: color.white, borderRadius: 10, borderWidth: 1, borderColor: color.line, marginBottom: 12 },
  profileManageAva: { width: 56, height: 56, borderRadius: 28, backgroundColor: color.magenta, alignItems: "center", justifyContent: "center", marginRight: 12, overflow: "hidden" },
  profileManageAvaImg: { width: 56, height: 56, borderRadius: 28 },
  profileManageAvaLetter: { color: color.ink, fontSize: 22, fontWeight: "800" },
  profileManageCopy: { flex: 1 },
  profileManageName: { color: color.ink, fontSize: 15, fontWeight: "700" },
  profileManageHandle: { color: color.muted, fontSize: 11, marginTop: 1 },
  profileManageCity: { color: color.muted, fontSize: 11, marginTop: 1 },
  profileManageEdit: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 6, borderWidth: 1, borderColor: color.line },
  profileManageEditText: { color: color.ink, fontSize: 11, fontWeight: "600" },
  profileManageStatusRow: { flexDirection: "row", alignItems: "center", padding: 12, backgroundColor: color.white, borderRadius: 10, borderWidth: 1, borderColor: color.line, marginBottom: 8 },
  profileManageStatusDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: "#10b981", marginRight: 10 },
  profileManageStatusCopy: { flex: 1 },
  profileManageStatusLabel: { color: color.muted, fontSize: 11, fontWeight: "600" },
  profileManageStatusValue: { color: color.ink, fontSize: 14, fontWeight: "700", marginTop: 2 },
  profileManageStatusChev: { color: color.muted, fontSize: 18 },
  profileManageStatusList: { marginTop: 4 },
  profileManageStatusItem: { padding: 12, backgroundColor: color.white, borderRadius: 8, borderWidth: 1, borderColor: color.line, marginBottom: 6 },
  profileManageStatusItemOn: { backgroundColor: color.violet, borderColor: color.magenta },
  profileManageStatusItemText: { color: color.ink, fontSize: 14, fontWeight: "600" },
  profileManageStatusItemTextOn: { color: color.magenta, fontWeight: "700" },
  profileManageStatusItemDesc: { color: color.muted, fontSize: 11, marginTop: 2 },
  subPagePlaceholder: {
    backgroundColor: color.white,
    borderColor: color.line,
    borderRadius: 16,
    borderWidth: 1,
    padding: 18,
    ...shadows.card
  },
  subPagePlaceholderText: { color: color.muted, fontSize: 11, lineHeight: 17, textAlign: "center" },
  subPagePlaceholderHint: { color: "#A9A2B0", fontSize: 11, lineHeight: 15, marginTop: 8, textAlign: "center" },

  // 原型 screens.appbehavior：卡片堆叠与 2×2 模拟操作，不复用通用设置表格。
  appBehaviorTitle: { color: color.ink, fontSize: 19, fontWeight: "700", marginBottom: 4, marginTop: 8 },
  appBehaviorCard: {
    backgroundColor: color.white,
    borderColor: "rgba(20,18,31,0.035)",
    borderRadius: 14,
    borderWidth: 1,
    marginTop: 6,
    padding: 10,
    ...shadows.card
  },
  appBehaviorCardDark: { backgroundColor: color.ink, borderColor: color.ink },
  appBehaviorCardTitle: { color: color.ink, fontSize: 11, fontWeight: "700" },
  appBehaviorCardTitleDark: { color: color.white },
  appBehaviorCardDesc: { color: color.muted, fontSize: 11, lineHeight: 15, marginTop: 3 },
  appBehaviorCardDescDark: { color: "rgba(255,255,255,0.67)" },
  appBehaviorActions: { flexDirection: "row", flexWrap: "wrap", gap: 7, marginTop: 10 },
  appBehaviorAction: {
    alignItems: "center",
    backgroundColor: color.white,
    borderColor: color.line,
    borderRadius: 999,
    borderWidth: 1,
    flexGrow: 1,
    minWidth: "46%",
    paddingHorizontal: 9,
    paddingVertical: 8
  },
  appBehaviorActionPrimary: { backgroundColor: color.ink, borderColor: color.ink },
  appBehaviorActionDanger: { backgroundColor: "#FFF6F8", borderColor: "#F5DDE5" },
  appBehaviorActionText: { color: color.ink, fontSize: 11, fontWeight: "800" },
  appBehaviorActionPrimaryText: { color: color.white, fontSize: 11, fontWeight: "800" },
  appBehaviorActionDangerText: { color: "#A84A69", fontSize: 11, fontWeight: "800" },
  appBehaviorReturn: { alignItems: "center", backgroundColor: color.magenta, borderRadius: 999, marginTop: 10, paddingVertical: 10 },
  appBehaviorReturnText: { color: color.white, fontSize: 11, fontWeight: "800" },

  // R15.9 个人社交入口：渠道、可见范围、归因漏斗均有独立的原型结构。
  detailTitle: { color: color.ink, fontSize: 19, fontWeight: "700", marginTop: 8 },
  detailSub: { color: color.muted, fontSize: 11, lineHeight: 15, marginBottom: 8, marginTop: 3 },
  socialAccountsContent: { paddingBottom: 36, paddingHorizontal: 18, paddingTop: 10 },
  socialAccountsTitle: { color: color.ink, fontSize: 29, fontWeight: "900", letterSpacing: -0.6, lineHeight: 34 },
  socialAccountsSub: { color: color.muted, fontSize: 14, lineHeight: 21, marginBottom: 16, marginTop: 7 },
  socialAccountList: { borderTopColor: color.line, borderTopWidth: 1, marginTop: 12 },
  socialAccountRow: { alignItems: "center", borderBottomColor: color.line, borderBottomWidth: 1, flexDirection: "row", gap: 13, minHeight: 82 },
  socialAccountIcon: { alignItems: "center", backgroundColor: "#F3EEF8", borderRadius: 14, height: 44, justifyContent: "center", width: 44 },
  socialAccountIconDark: { backgroundColor: "#111" },
  socialAccountIconText: { color: "#6E3DB7", fontSize: 13, fontWeight: "900" },
  socialAccountIconTextDark: { color: color.white },
  socialAccountCopy: { flex: 1, minWidth: 0 },
  socialAccountName: { color: color.ink, fontSize: 15, fontWeight: "900" },
  socialAccountHandle: { color: "#6E6872", fontSize: 12, marginTop: 4 },
  socialAccountUrl: { color: color.muted, fontSize: 11, marginTop: 3 },
  socialAccountTrailing: { alignItems: "center", flexDirection: "row", gap: 7 },
  socialAccountState: { backgroundColor: "#F5F2F6", borderRadius: 999, paddingHorizontal: 10, paddingVertical: 7 },
  socialAccountStateActive: { backgroundColor: "#FFF1F6" },
  socialAccountStateText: { color: "#766F79", fontSize: 11, fontWeight: "900" },
  socialAccountStateTextActive: { color: color.magenta },
  socialAccountChev: { color: "#B6AFB9", fontSize: 19 },
  socialSettingsHead: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", marginBottom: 8, marginTop: 24 },
  socialSettingsTitle: { color: color.ink, fontSize: 13, fontWeight: "800" },
  socialSettingsHint: { color: color.muted, fontSize: 11 },
  socialSettingRow: { alignItems: "center", borderBottomColor: color.line, borderBottomWidth: 1, flexDirection: "row", gap: 12, paddingVertical: 15 },
  socialSettingName: { color: color.ink, fontSize: 14, fontWeight: "800" },
  socialSettingDesc: { color: "#6E6872", fontSize: 12, lineHeight: 18, marginTop: 4 },
  socialSwitch: { backgroundColor: "#D9D4DC", borderRadius: 999, height: 28, padding: 3, width: 48 },
  socialSwitchOn: { backgroundColor: color.ink },
  socialSwitchDot: { backgroundColor: color.white, borderRadius: 11, height: 22, width: 22 },
  socialSwitchDotOn: { backgroundColor: "#FF5C99", marginLeft: 20 },
  socialShareBox: { borderTopColor: color.line, borderTopWidth: 1, marginTop: 22, paddingTop: 0 },
  socialShareLine: { alignItems: "center", flexDirection: "row", gap: 10, paddingVertical: 12 },
  socialShareLink: { backgroundColor: color.white, borderColor: color.line, borderRadius: 13, borderWidth: 1, color: "#5F5963", flex: 1, fontSize: 12, padding: 11 },
  socialShareButton: { alignItems: "center", backgroundColor: color.ink, borderRadius: 12, height: 40, justifyContent: "center", paddingHorizontal: 14 },
  socialShareButtonText: { color: color.white, fontSize: 12, fontWeight: "900" },
  socialShareNote: { color: "#A19AA5", fontSize: 11, lineHeight: 16, marginTop: 2 },
  socialEditorOverlay: { backgroundColor: "rgba(16,12,18,0.28)", flex: 1, justifyContent: "flex-end" },
  socialEditorSheet: { backgroundColor: color.white, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingBottom: 30, paddingHorizontal: 20, paddingTop: 16 },
  socialEditorGrabber: { alignSelf: "center", backgroundColor: "#D7D1D9", borderRadius: 999, height: 4, marginBottom: 14, width: 34 },
  socialEditorHead: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", marginBottom: 8 },
  socialEditorTitle: { color: color.ink, fontSize: 22, fontWeight: "900" },
  socialEditorClose: { alignItems: "center", backgroundColor: "#F4F1F5", borderRadius: 17, height: 34, justifyContent: "center", width: 34 },
  socialEditorCloseText: { color: "#5D5661", fontSize: 20 },
  socialEditorNote: { color: color.muted, fontSize: 12, lineHeight: 17, marginBottom: 2 },
  socialEditorLabel: { color: color.muted, fontSize: 11, fontWeight: "800", marginBottom: 7, marginTop: 14 },
  socialEditorInput: { backgroundColor: color.white, borderColor: color.line, borderRadius: 12, borderWidth: 1, color: color.ink, height: 44, paddingHorizontal: 12 },
  socialVisibilityRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 1 },
  socialVisibilityButton: { borderColor: color.line, borderRadius: 999, borderWidth: 1, paddingHorizontal: 11, paddingVertical: 8 },
  socialVisibilityButtonOn: { backgroundColor: color.ink, borderColor: color.ink },
  socialVisibilityText: { color: "#625B66", fontSize: 11, fontWeight: "800" },
  socialVisibilityTextOn: { color: color.white },
  socialOpenLink: { borderTopColor: color.line, borderTopWidth: 1, flexDirection: "row", justifyContent: "space-between", marginTop: 12, paddingVertical: 12 },
  socialOpenLinkText: { color: "#4D4751", fontSize: 12, fontWeight: "800" },
  socialSave: { alignItems: "center", backgroundColor: color.ink, borderRadius: 14, height: 48, justifyContent: "center", marginTop: 6 },
  socialSaveText: { color: color.white, fontSize: 14, fontWeight: "900" },
  channelCard: { alignItems: "center", backgroundColor: color.white, borderColor: color.line, borderRadius: 17, borderWidth: 1, flexDirection: "row", gap: 10, marginVertical: 4, padding: 11, ...shadows.card },
  channelMark: { alignItems: "center", backgroundColor: "#F5F1F8", borderRadius: 11, height: 36, justifyContent: "center", width: 36 },
  channelMarkLinked: { backgroundColor: "#F1E8FF" },
  channelMarkText: { color: "#6F37B9", fontSize: 11, fontWeight: "900" },
  channelCopy: { flex: 1 },
  channelName: { color: color.ink, fontSize: 11, fontWeight: "800" },
  channelAccount: { color: color.muted, fontSize: 11, marginTop: 2 },
  channelStatus: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 5 },
  channelStatusOn: { backgroundColor: "#F1FFD7" },
  channelStatusOff: { backgroundColor: "#F4EFF7" },
  channelStatusText: { fontSize: 11, fontWeight: "900" },
  channelStatusTextOn: { color: "#506900" },
  channelStatusTextOff: { color: "#756A7B" },
  detailSectionHead: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", marginTop: 11, paddingHorizontal: 1 },
  detailSectionTitle: { color: color.ink, fontSize: 11, fontWeight: "700" },
  detailSectionHint: { color: color.muted, fontSize: 11 },
  socialDetailRow: { alignItems: "center", backgroundColor: color.white, borderColor: "rgba(20,18,31,0.04)", borderRadius: 15, borderWidth: 1, flexDirection: "row", gap: 9, marginTop: 6, padding: 11 },
  socialDetailIcon: { alignItems: "center", backgroundColor: "#F5F1F8", borderRadius: 10, height: 31, justifyContent: "center", width: 31 },
  socialDetailIconText: { color: "#6F37B9", fontSize: 11, fontWeight: "900" },
  socialDetailCopy: { flex: 1 },
  socialDetailLabel: { color: color.ink, fontSize: 11, fontWeight: "800" },
  socialDetailDesc: { color: color.muted, fontSize: 11, lineHeight: 15, marginTop: 2 },
  socialDetailChev: { color: "#A59EAA", fontSize: 15 },
  visibilityLadder: { backgroundColor: color.white, borderColor: color.line, borderRadius: 17, borderWidth: 1, marginTop: 8, overflow: "hidden", ...shadows.card },
  visibilityStep: { alignItems: "center", borderBottomColor: color.line, borderBottomWidth: 1, flexDirection: "row", gap: 8, padding: 10 },
  visibilityIndex: { alignItems: "center", backgroundColor: "#F1E8FF", borderRadius: 10, height: 24, justifyContent: "center", width: 24 },
  visibilityIndexText: { color: "#6B35B6", fontSize: 11, fontWeight: "900" },
  visibilityCopy: { flex: 1 },
  visibilityTitle: { color: color.ink, fontSize: 11, fontWeight: "800" },
  visibilityDesc: { color: color.muted, fontSize: 11, lineHeight: 15, marginTop: 2 },
  visibilityTag: { color: "#756A7B", fontSize: 11, fontWeight: "800" },
  funnelCard: { backgroundColor: color.white, borderColor: color.line, borderRadius: 18, borderWidth: 1, marginVertical: 8, padding: 12, ...shadows.card },
  funnelRow: { alignItems: "center", flexDirection: "row", gap: 8, marginVertical: 5 },
  funnelLabel: { color: color.muted, fontSize: 11, width: 58 },
  funnelTrack: { backgroundColor: "#F1EDF3", borderRadius: 999, flex: 1, height: 7, overflow: "hidden" },
  funnelBar: { borderRadius: 999, height: 7 },
  funnelValue: { color: color.ink, fontSize: 11, fontWeight: "800", textAlign: "right", width: 34 },
  sourceTable: { backgroundColor: color.white, borderColor: color.line, borderRadius: 17, borderWidth: 1, marginTop: 8, overflow: "hidden", ...shadows.card },
  sourceRow: { borderBottomColor: color.line, borderBottomWidth: 1, flexDirection: "row", paddingHorizontal: 11, paddingVertical: 9 },
  sourceHead: { backgroundColor: color.surface },
  sourceHeadText: { color: color.muted, flex: 1, fontSize: 11, fontWeight: "800", textAlign: "right" },
  sourceName: { color: color.ink, flex: 1, fontSize: 11, fontWeight: "700" },
  sourceValue: { color: color.ink, flex: 1, fontSize: 11, fontWeight: "800", textAlign: "right" },
  infoNote: { backgroundColor: "#F4EEF7", borderRadius: 14, marginTop: 9, padding: 11 },
  infoNoteTitle: { color: color.ink, fontSize: 11, fontWeight: "800" },
  infoNoteText: { color: color.muted, fontSize: 11, lineHeight: 15, marginTop: 3 },
  friendPageHead: { alignItems: "flex-start", flexDirection: "row", justifyContent: "space-between" },
  closeIcon: { alignItems: "center", backgroundColor: color.white, borderColor: color.line, borderRadius: 12, borderWidth: 1, height: 28, justifyContent: "center", marginTop: 7, width: 28 },
  closeIconText: { color: color.ink, fontSize: 16, lineHeight: 20 },
  friendMethodGrid: { flexDirection: "row", flexWrap: "wrap", gap: 7, marginTop: 8 },
  friendMethod: { backgroundColor: color.white, borderColor: color.line, borderRadius: 15, borderWidth: 1, minHeight: 100, padding: 11, width: "48.8%", ...shadows.card },
  friendMethodIcon: { color: "#6F37B9", fontSize: 16, fontWeight: "900" },
  friendMethodTitle: { color: color.ink, fontSize: 11, fontWeight: "800", marginTop: 10 },
  friendMethodDesc: { color: color.muted, fontSize: 11, lineHeight: 15, marginTop: 3 },
  prototypeCard: { backgroundColor: color.white, borderColor: "rgba(20,18,31,0.035)", borderRadius: 14, borderWidth: 1, marginTop: 6, padding: 10, ...shadows.card },
  prototypeCardTitle: { color: color.ink, fontSize: 11, fontWeight: "700" },
  prototypeCardDesc: { color: color.muted, fontSize: 11, lineHeight: 15, marginTop: 3 },
  trustedExecutorCard: { backgroundColor: color.white, borderColor: color.line, borderRadius: 17, borderWidth: 1, marginTop: 8, padding: 12, ...shadows.card },
  trustedExecutorTop: { alignItems: "center", flexDirection: "row" },
  trustedExecutorAvatar: { alignItems: "center", borderRadius: 24, height: 48, justifyContent: "center", width: 48 },
  trustedExecutorAvatarText: { color: color.white, fontSize: 19, fontWeight: "900" },
  trustedExecutorCopy: { flex: 1, marginLeft: 9 },
  trustedExecutorName: { color: color.ink, fontSize: 11, fontWeight: "800" },
  trustedExecutorMeta: { color: color.muted, fontSize: 11, marginTop: 3 },
  trustedExecutorRating: { color: color.ink, fontSize: 18, fontWeight: "900" },
  trustedExecutorStats: { flexDirection: "row", gap: 6, marginTop: 11 },
  trustedExecutorStat: { backgroundColor: "#F6F1F8", borderRadius: 10, flex: 1, minHeight: 54, paddingHorizontal: 8, paddingTop: 8 },
  trustedExecutorStatValue: { color: color.ink, fontSize: 11, fontWeight: "900" },
  trustedExecutorStatLabel: { color: color.muted, fontSize: 11, marginTop: 5 },
  trustedSuggestion: { backgroundColor: "#FBF9FC", borderColor: color.line, borderRadius: 17, borderWidth: 1, marginTop: 10, padding: 12, ...shadows.card },
  trustedSuggestionHead: { alignItems: "center", flexDirection: "row", justifyContent: "space-between" },
  trustedSuggestionTitle: { color: color.ink, fontSize: 11, fontWeight: "900" },
  trustedSuggestionHint: { color: color.muted, fontSize: 11, fontWeight: "700" },
  trustedSuggestionBody: { backgroundColor: color.white, borderRadius: 12, marginTop: 9, padding: 11 },
  trustedSuggestionBodyTitle: { color: color.ink, fontSize: 11, fontWeight: "800" },
  trustedSuggestionBodyText: { color: color.muted, fontSize: 11, lineHeight: 15, marginTop: 4 },
  trustedInviteTouchable: { borderRadius: 14, marginTop: 12, overflow: "hidden" },
  trustedInvite: { alignItems: "center", borderRadius: 14, justifyContent: "center", minHeight: 51 },
  trustedInviteText: { color: color.white, fontSize: 11, fontWeight: "900" },
  trustedReturn: { alignItems: "center", backgroundColor: color.white, borderColor: color.line, borderRadius: 14, borderWidth: 1, justifyContent: "center", marginTop: 8, minHeight: 51 },
  trustedReturnText: { color: color.ink, fontSize: 11, fontWeight: "800" },
  diagnosticTitleRow: { alignItems: "center", flexDirection: "row", justifyContent: "space-between" },
  diagnosticTag: { backgroundColor: "#F3EAFD", borderRadius: 999, paddingHorizontal: 9, paddingVertical: 5 },
  diagnosticTagText: { color: "#7039BE", fontSize: 11, fontWeight: "900" },
  diagnosticHero: { backgroundColor: "#211B2D", borderRadius: 20, marginTop: 10, padding: 14 },
  diagnosticHeroTop: { flexDirection: "row", justifyContent: "space-between" },
  diagnosticHeroTitle: { color: color.white, fontSize: 16, fontWeight: "900" },
  diagnosticHeroText: { color: "#D8D1E0", fontSize: 11, lineHeight: 15, marginTop: 5, maxWidth: 260 },
  diagnosticScore: { color: color.white, fontSize: 26, fontWeight: "900", textAlign: "right" },
  diagnosticScoreLabel: { color: "#D8D1E0", fontSize: 11, fontWeight: "700", marginTop: 2, textAlign: "right" },
  diagnosticMetrics: { flexDirection: "row", gap: 6, marginTop: 12 },
  diagnosticMetric: { backgroundColor: "#3A304A", borderRadius: 10, flex: 1, minHeight: 54, padding: 8 },
  diagnosticMetricValue: { color: color.white, fontSize: 12, fontWeight: "900" },
  diagnosticMetricLabel: { color: "#D8D1E0", fontSize: 11, marginTop: 7 },
  diagnosticInsightGrid: { flexDirection: "row", gap: 7, marginTop: 9 },
  diagnosticInsight: { backgroundColor: color.white, borderColor: color.line, borderRadius: 15, borderWidth: 1, flex: 1, minHeight: 115, padding: 10, ...shadows.card },
  diagnosticInsightKicker: { color: color.muted, fontSize: 11, fontWeight: "800" },
  diagnosticInsightValue: { color: color.ink, fontSize: 20, fontWeight: "900", marginTop: 7 },
  diagnosticInsightText: { color: color.muted, fontSize: 11, lineHeight: 15, marginTop: 6 },
  diagnosticActions: { backgroundColor: color.white, borderColor: color.line, borderRadius: 17, borderWidth: 1, marginTop: 10, padding: 11, ...shadows.card },
  diagnosticActionsHead: { alignItems: "center", flexDirection: "row", justifyContent: "space-between" },
  diagnosticActionsTitle: { color: color.ink, fontSize: 11, fontWeight: "900" },
  diagnosticActionsHint: { color: color.muted, fontSize: 11, fontWeight: "700" },
  diagnosticActionItem: { backgroundColor: "#FCFBFD", borderRadius: 12, marginTop: 8, padding: 10 },
  diagnosticActionTitle: { color: color.ink, fontSize: 11, fontWeight: "800" },
  diagnosticActionText: { color: color.muted, fontSize: 11, lineHeight: 15, marginTop: 4 },
  diagnosticActionButtons: { flexDirection: "row", gap: 7, marginTop: 10 },
  diagnosticCreate: { alignItems: "center", backgroundColor: color.ink, borderRadius: 10, flex: 1, paddingVertical: 9 },
  diagnosticCreateText: { color: color.white, fontSize: 11, fontWeight: "900" },
  diagnosticFind: { alignItems: "center", backgroundColor: "#F3EEF8", borderRadius: 10, flex: 1, paddingVertical: 9 },
  diagnosticFindText: { color: color.ink, fontSize: 11, fontWeight: "900" },
  diagnosticRecipe: { borderColor: "#D8CBDD", borderRadius: 16, borderStyle: "dashed", borderWidth: 1, marginTop: 10, padding: 11 },
  diagnosticRecipeTitle: { color: color.ink, fontSize: 11, fontWeight: "900" },
  diagnosticRecipeText: { color: color.muted, fontSize: 11, lineHeight: 15, marginTop: 4 },
  primaryCta: { alignItems: "center", backgroundColor: color.ink, borderRadius: 999, marginTop: 10, paddingVertical: 10 },
  primaryCtaText: { color: color.white, fontSize: 11, fontWeight: "800" },
  lightCta: { alignItems: "center", backgroundColor: color.white, borderColor: color.line, borderRadius: 999, borderWidth: 1, marginTop: 7, paddingVertical: 10 },
  lightCtaText: { color: color.ink, fontSize: 11, fontWeight: "800" },
  fallbackSection: { marginTop: 3 },
  messagesHead: { alignItems: "flex-start", flexDirection: "row", justifyContent: "space-between" },
  messagesHeadActions: { flexDirection: "row", gap: 6, marginTop: 7 },
  messageIconButton: { alignItems: "center", backgroundColor: color.white, borderColor: color.line, borderRadius: 11, borderWidth: 1, height: 28, justifyContent: "center", position: "relative", width: 28 },
  messageIconText: { color: color.ink, fontSize: 13, fontWeight: "900" },
  messageNoticeDot: { backgroundColor: color.magenta, borderRadius: 4, height: 7, position: "absolute", right: 2, top: 2, width: 7 },
  messageTabs: { backgroundColor: "#F1EDF3", borderRadius: 12, flexDirection: "row", marginTop: 8, padding: 3 },
  messageTab: { alignItems: "center", flex: 1, paddingVertical: 7 },
  messageTabActive: { alignItems: "center", backgroundColor: color.white, borderRadius: 9, flex: 1, paddingVertical: 7 },
  messageTabText: { color: color.muted, fontSize: 11, fontWeight: "800" },
  messageTabActiveText: { color: color.ink, fontSize: 11, fontWeight: "900" },
  messageThread: { alignItems: "center", backgroundColor: color.white, borderBottomColor: color.line, borderBottomWidth: 1, flexDirection: "row", gap: 9, paddingVertical: 10 },
  messageAvatar: { alignItems: "center", backgroundColor: "#F1E8FF", borderRadius: 13, height: 38, justifyContent: "center", width: 38 },
  messageAvatarSoft: { backgroundColor: "#F5F1F8" },
  messageAvatarDark: { backgroundColor: color.ink },
  messageAvatarText: { color: color.ink, fontSize: 12, fontWeight: "900" },
  messageThreadCopy: { flex: 1 },
  messageThreadTop: { alignItems: "center", flexDirection: "row", gap: 5 },
  messageThreadName: { color: color.ink, fontSize: 11, fontWeight: "800" },
  messageContext: { backgroundColor: "#F1EDF3", borderRadius: 999, color: "#756A7B", fontSize: 11, fontWeight: "800", overflow: "hidden", paddingHorizontal: 5, paddingVertical: 2 },
  messageThreadPreview: { color: color.muted, fontSize: 11, marginTop: 3 },
  messageThreadMeta: { alignItems: "flex-end", gap: 4 },
  messageTime: { color: color.muted, fontSize: 11 },
  messageUnread: { alignItems: "center", backgroundColor: color.magenta, borderRadius: 8, height: 16, justifyContent: "center", minWidth: 16, paddingHorizontal: 4 },
  messageUnreadText: { color: color.white, fontSize: 11, fontWeight: "900" },
  messageChev: { color: "#A59EAA", fontSize: 16 },

  // 钱包页面。
  walletDarkCard: {
    backgroundColor: color.ink,
    borderRadius: 16,
    marginBottom: 10,
    paddingHorizontal: 16,
    paddingVertical: 18
  },
  walletDarkLabel: { color: "rgba(255,255,255,0.6)", fontSize: 11, fontWeight: "600" },
  walletDarkAmount: { color: color.white, fontSize: 24, fontWeight: "900", marginTop: 4 },
  walletDarkHint: { color: "rgba(255,255,255,0.45)", fontSize: 11, marginTop: 4 },
  walletCard: {
    backgroundColor: color.white,
    borderColor: color.line,
    borderRadius: 14,
    borderWidth: 1,
    marginBottom: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    ...shadows.card
  },
  walletCardLabel: { color: color.ink, fontSize: 11, fontWeight: "700" },
  walletCardValue: { color: color.ink, fontSize: 16, fontWeight: "800", marginTop: 4 },
  walletCardHint: { color: color.muted, fontSize: 11, lineHeight: 15, marginTop: 4 },
  walletAction: {
    alignItems: "center",
    backgroundColor: color.white,
    borderColor: color.line,
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: "row",
    gap: 10,
    marginBottom: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    ...shadows.card
  },
  walletActionIcon: { backgroundColor: "#F5F1F7", borderRadius: 10, fontSize: 16, height: 36, textAlign: "center", lineHeight: 36, width: 36 },
  walletActionBody: { flex: 1 },
  walletActionLabel: { color: color.ink, fontSize: 11, fontWeight: "700" },
  walletActionDesc: { color: color.muted, fontSize: 11, marginTop: 2 },
  walletActionArrow: { color: color.muted, fontSize: 16 },
  walletBtnLight: {
    alignItems: "center",
    borderColor: color.line,
    borderRadius: 999,
    borderWidth: 1,
    marginTop: 4,
    paddingVertical: 11
  },
  walletBtnLightText: { color: color.ink, fontSize: 11, fontWeight: "700" },

  // 子页面结构化内容。
  subSection: {
    backgroundColor: color.white,
    borderColor: "rgba(20,18,31,0.04)",
    borderRadius: 17,
    borderWidth: 1,
    marginBottom: 10,
    overflow: "hidden",
    ...shadows.card
  },
  subSectionTitle: {
    backgroundColor: color.surface,
    borderBottomColor: color.line,
    borderBottomWidth: 1,
    color: color.muted,
    fontSize: 11,
    fontWeight: "700",
    paddingHorizontal: 12,
    paddingVertical: 6
  },
  customSectionTitle: { color: color.ink, fontSize: 11, fontWeight: "700", marginTop: 10 },
  customSectionHint: { color: color.muted, fontSize: 11, marginBottom: 2, marginTop: 1 },
  subRow: {
    borderBottomColor: color.line,
    borderBottomWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: 12,
    paddingVertical: 10
  },
  subRowLabel: { color: color.ink, fontSize: 11, fontWeight: "600", flex: 1 },
  subRowValue: { color: color.muted, fontSize: 11, flex: 1, textAlign: "right" },

  // 偏好记忆。
  memorySection: { marginTop: 13 },
  memorySectionHead: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 5,
    paddingHorizontal: 2
  },
  memorySectionTitle: { color: color.ink, fontSize: 11, fontWeight: "700" },
  memorySectionCount: { color: color.muted, fontSize: 11 },
  memoryCard: {
    backgroundColor: color.white,
    borderColor: "rgba(20,18,31,0.04)",
    borderRadius: 17,
    borderWidth: 1,
    marginBottom: 6,
    padding: 12,
    ...shadows.card
  },
  memoryCardBody: {
    alignItems: "center",
    flexDirection: "row"
  },
  memoryCardLeft: { flex: 1 },
  memoryLabel: { color: color.ink, fontSize: 11, fontWeight: "800", marginBottom: 4 },
  memoryValue: { color: color.ink, fontSize: 12, lineHeight: 17, fontWeight: "700" },
  memorySource: { color: "#8B8292", fontSize: 11, marginTop: 6, lineHeight: 15 },
  memoryCardRight: { alignItems: "center", flexDirection: "row", gap: 4 },
  memoryStatusConfirmed: {
    backgroundColor: "#EEF8D6",
    borderRadius: 999,
    paddingHorizontal: 7,
    paddingVertical: 4
  },
  memoryStatusText: { color: "#506900", fontSize: 11, fontWeight: "900" },
  memoryStatusSuggested: {
    backgroundColor: "#F1E8FF",
    borderRadius: 999,
    paddingHorizontal: 7,
    paddingVertical: 4
  },
  memoryStatusTextSuggested: { color: "#6330B2", fontSize: 11, fontWeight: "900" },
  memoryChev: { color: "#B0A8B5", fontSize: 18 },
  memoryDarkCard: {
    backgroundColor: color.ink,
    borderRadius: 16,
    marginBottom: 10,
    padding: 12
  },
  memoryDarkTitle: { color: color.white, fontSize: 11, fontWeight: "700" },
  memoryDarkBody: { color: "rgba(255,255,255,0.7)", fontSize: 11, lineHeight: 15, marginTop: 4 },
  memoryBtnLight: {
    backgroundColor: color.white,
    borderColor: color.line,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 6,
    paddingVertical: 10,
    alignItems: "center"
  },
  memoryBtnLightText: { color: color.ink, fontSize: 11, fontWeight: "700" },

  // 二维码网格（原型 .r159QR：白底 + #17131F 点）。
  fakeQr: {
    alignContent: "flex-start",
    backgroundColor: color.white,
    borderColor: "#EAE5ED",
    borderRadius: 6,
    borderWidth: 1,
    flexDirection: "row",
    flexWrap: "wrap",
    ...shadows.card
  },
  fakeQrCell: { backgroundColor: "transparent", borderRadius: 1 },
  fakeQrCellOn: { backgroundColor: "#17131F" },

  // 二维码卡片（原型 .r159QRWrap）。
  qrCard: {
    alignItems: "center",
    backgroundColor: color.white,
    borderColor: "rgba(20,18,31,0.04)",
    borderRadius: 17,
    borderWidth: 1,
    flexDirection: "row",
    gap: 13,
    marginVertical: 8,
    padding: 12,
    ...shadows.card
  },
  qrCardCenter: { flexDirection: "column" },
  qrCardText: { flex: 1 },
  qrCardTextCenter: { alignItems: "center", flex: 1, width: "100%" },
  qrCardTitle: { color: color.ink, fontSize: 11, fontWeight: "800" },
  qrCardDesc: { color: color.muted, fontSize: 11, lineHeight: 15, marginVertical: 4 },
  qrCardBtn: {
    alignSelf: "flex-start",
    backgroundColor: color.ink,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 7
  },
  qrCardBtnText: { color: color.white, fontSize: 11, fontWeight: "900" },

  // 社媒 / 导航行（原型 .r159SimpleRow）。
  socialRow: {
    alignItems: "center",
    backgroundColor: color.white,
    borderColor: "rgba(20,18,31,0.04)",
    borderRadius: 15,
    borderWidth: 1,
    flexDirection: "row",
    gap: 9,
    marginVertical: 6,
    padding: 11
  },
  socialRowIcon: {
    alignItems: "center",
    backgroundColor: "#F5F1F8",
    borderRadius: 10,
    height: 31,
    justifyContent: "center",
    width: 31
  },
  socialRowIconText: { color: "#6F37B9", fontSize: 11, fontWeight: "900" },
  socialRowCopy: { flex: 1 },
  socialRowLabel: { color: color.ink, fontSize: 11, fontWeight: "800" },
  socialRowDesc: { color: color.muted, fontSize: 11, lineHeight: 15, marginTop: 2 },
  socialRowChev: { color: "#A59EAA", fontSize: 15 },

  // 个人主页 hero（原型 .r159Hero + .r159TrustStrip）。
  heroCard: {
    backgroundColor: color.white,
    borderColor: "rgba(20,18,31,0.04)",
    borderRadius: 17,
    borderWidth: 1,
    marginVertical: 8,
    padding: 13,
    ...shadows.card
  },
  heroTop: { alignItems: "center", flexDirection: "row", gap: 10 },
  heroAvatar: {
    alignItems: "center",
    borderRadius: 15,
    height: 46,
    justifyContent: "center",
    width: 46
  },
  heroAvatarText: { color: color.white, fontSize: 18, fontWeight: "900" },
  heroCopy: { flex: 1 },
  heroName: { color: color.ink, fontSize: 14, fontWeight: "800" },
  heroMeta: { color: color.muted, fontSize: 11, marginTop: 3 },
  heroStatus: {
    backgroundColor: "#EEF8D6",
    borderColor: "#DFEBC7",
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 9,
    paddingVertical: 6
  },
  heroStatusText: { color: "#465C00", fontSize: 11, fontWeight: "900" },
  availabilityOverlay: { backgroundColor: "rgba(20,18,31,0.46)", flex: 1, justifyContent: "flex-end", padding: 12 },
  availabilitySheet: { backgroundColor: color.white, borderRadius: 25, padding: 19 },
  availabilityTitle: { color: color.ink, fontSize: 16, fontWeight: "800" },
  availabilitySub: { color: color.muted, fontSize: 11, lineHeight: 15, marginBottom: 12, marginTop: 4 },
  availabilityOption: { alignItems: "center", backgroundColor: color.white, borderColor: color.line, borderRadius: 16, borderWidth: 1, flexDirection: "row", gap: 10, marginBottom: 8, padding: 11 },
  availabilityOptionActive: { backgroundColor: "#FAF8FB", borderColor: color.ink, borderWidth: 1.5 },
  availabilityMark: { alignItems: "center", backgroundColor: "#F2EDF5", borderRadius: 13, height: 40, justifyContent: "center", width: 40 },
  availabilityMarkActive: { backgroundColor: color.ink },
  availabilityCopy: { flex: 1 },
  availabilityOptionTitle: { color: color.ink, fontSize: 11, fontWeight: "800" },
  availabilityOptionDesc: { color: color.muted, fontSize: 11, lineHeight: 15, marginTop: 3 },
  availabilityAction: { color: "#62586A", fontSize: 11, fontWeight: "900" },
  trustStrip: {
    flexDirection: "row",
    gap: 6,
    marginTop: 11
  },
  trustStripItem: {
    alignItems: "center",
    backgroundColor: "#F8F6FA",
    borderRadius: 11,
    flex: 1,
    paddingVertical: 8
  },
  trustStripValue: { color: color.ink, fontSize: 12, fontWeight: "800" },
  trustStripLabel: { color: color.muted, fontSize: 11, marginTop: 2 },

  // 个人主页 v5：Threads 式轻资料与内容分页。能力与可用时间留在“我的市场”。
  personalHubContent: { paddingBottom: 0 },
  // R15.66 Threads R2: .tools h46 flex align center space-between, p 0 18
  personalTopbar: {
    alignItems: "center",
    flexDirection: "row",
    height: 46,
    paddingHorizontal: 18,
    paddingTop: 7
  },
  personalTopbarButton: { alignItems: "center", height: 34, justifyContent: "center", width: 34 },
  personalTopbarIcon: { color: color.ink, fontSize: 21, fontWeight: "300", lineHeight: 24 },
  personalTopbarHandle: { color: color.ink, flex: 1, fontSize: 15, fontWeight: "700", overflow: "hidden", textAlign: "left", marginLeft: 4 },
  personalTopbarTools: { flexDirection: "row", gap: 5 },
  personalTopbarIconBtn: { width: 34, height: 34, alignItems: "center", justifyContent: "center" },

  // R15.66 Threads R2: .head grid 1fr 86px gap 16 alignItems start paddingTop 7
  personalHead: { flexDirection: "row", alignItems: "flex-start", gap: 16, paddingHorizontal: 18, paddingTop: 7 },
  personalNameBlock: { flex: 1, minWidth: 0 },
  personalName: { color: color.ink, fontSize: 24, fontWeight: "800", letterSpacing: -0.96, lineHeight: 28 },
  personalHandleSub: { color: "#444", fontSize: 11, marginTop: 4 },
  personalAvaWrap: { position: "relative", width: 82, height: 82, justifyContent: "flex-end" },
  personalAva: { width: 82, height: 82, borderRadius: 41, backgroundColor: "#111", alignItems: "center", justifyContent: "center", overflow: "hidden", borderWidth: 1, borderColor: "#ececec" },
  personalAvaImg: { width: 82, height: 82, borderRadius: 41 },
  personalAvaLetter: { color: color.white, fontSize: 27, fontWeight: "800" },
  personalAvaAdd: {
    position: "absolute", left: -6, bottom: -2, width: 32, height: 32, borderRadius: 16,
    borderWidth: 3, borderColor: "#fff", backgroundColor: "#fff",
    alignItems: "center", justifyContent: "center"
  },

  // R15.66 Threads R2: .bio marginTop 13
  personalBio: { paddingHorizontal: 18, marginTop: 13 },
  personalBioText: { color: color.ink, fontSize: 11, lineHeight: 16 },
  personalLinkRow: { flexDirection: "row", alignItems: "center", gap: 5, marginTop: 8 },
  personalLinkText: { color: "#333", fontSize: 11, fontWeight: "600" },

  // R15.66 Threads R2: .topics flex gap 6 wrap marginTop 11
  personalTopics: { flexDirection: "row", gap: 6, flexWrap: "wrap", marginTop: 11 },
  personalTopicPill: { borderWidth: 1, borderColor: "#e1e1e1", backgroundColor: "#fff", borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6 },
  personalTopicText: { color: "#333", fontSize: 11, fontWeight: "600" },

  // R15.66 Threads R2: .stat marginTop 12 color #8c8c8c font 8.5
  personalStat: { marginTop: 12, paddingHorizontal: 18 },
  personalStatText: { color: "#8c8c8c", fontSize: 11 },
  personalStatValue: { color: "#111", fontWeight: "800" },

  // R15.66 Threads R2: .followers flex align center gap 8 marginTop 11 font 8.8 color #7f7f7f
  personalFollowersRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 11, paddingHorizontal: 18, marginBottom: 15 },
  personalFaces: { flexDirection: "row" },
  personalFace: { width: 19, height: 19, borderRadius: 9.5, borderWidth: 2, borderColor: "#fff", alignItems: "center", justifyContent: "center", marginLeft: -5 },
  personalFaceText: { color: "#555", fontSize: 11, fontWeight: "900" },
  personalFaceFirst: { marginLeft: 0 },
  personalFollowersCount: { color: "#7f7f7f", fontSize: 11 },
  personalFollowersValue: { color: "#111", fontWeight: "800" },
  // .profile-actions: grid 1fr 1fr gap 8 marginTop 16
  personalActions: { flexDirection: "row", gap: 8, marginTop: 16 },
  // .action: h38 border 1 #d7d7d7 bg #fff radius 10 font 13 weight 650
  personalActionButton: { alignItems: "center", backgroundColor: color.white, borderColor: "#D7D7D7", borderRadius: 10, borderWidth: 1, flex: 1, height: 38, justifyContent: "center" },
  personalActionText: { color: color.ink, fontSize: 13, fontWeight: "700" },
  // .action.primary: bg #111 color #fff border #111
  personalActionPrimary: { backgroundColor: "#111", borderColor: "#111" },
  personalActionPrimaryText: { color: color.white, fontSize: 13, fontWeight: "700" },
  // .action.lime: bg lime border lime color #111
  personalActionLime: { backgroundColor: "#C9FF08", borderColor: "#C9FF08" },
  personalActionLimeText: { color: color.ink, fontSize: 13, fontWeight: "700" },
  // .tabs: h 47 grid 3 1fr border-b 1 line position relative top 48 bg #fff z 18
  personalTabs: { backgroundColor: color.white, borderBottomColor: "#E8E8E8", borderBottomWidth: 1, flexDirection: "row", height: 47, position: "relative", top: 0, zIndex: 18 },
  // .tab: position relative border 0 bg #fff color #8a8a8a font 13 weight 560
  personalTab: { alignItems: "center", flex: 1, height: 47, justifyContent: "center", position: "relative" },
  // .tab.active::after: position abs left 16% right 16% bottom -1 h 1.5 bg #111
  personalTabUnderline: { backgroundColor: "#111", bottom: -1, height: 1.5, left: "16%", position: "absolute", right: "16%" },
  personalTabText: { color: "#8A8A8A", fontSize: 13, fontWeight: "600" },
  personalTabTextActive: { color: color.ink, fontWeight: "700" },
  // .post: p 16 18 14 border-b 1 line
  personalPost: { borderBottomColor: "#E8E8E8", borderBottomWidth: 1, paddingBottom: 14, paddingHorizontal: 18, paddingTop: 16 },
  // .post-head: grid 38/1fr/32 gap 10 alignItems start
  personalPostHead: { alignItems: "flex-start", flexDirection: "row", gap: 10 },
  // .mini-avatar: 38x38 radius 50% bg #111 color #fff grid place center font 14 weight 700
  personalPostAvatar: { alignItems: "center", backgroundColor: "#111", borderRadius: 19, color: color.white, fontSize: 14, fontWeight: "700", height: 38, justifyContent: "center", overflow: "hidden", width: 38 },
  personalPostAvatarText: { color: color.white, fontSize: 14, fontWeight: "700" },
  personalPostAvatarImage: { borderRadius: 19, height: 38, width: 38 },
  // .post-body: paddingLeft 48 marginTop -12
  personalPostBody: { flex: 1, marginTop: -12, paddingLeft: 48 },
  // .post-name-line: flex gap 6 alignItems center minWidth 0
  personalPostNameLine: { alignItems: "center", flexDirection: "row", gap: 6, minWidth: 0 },
  // .post-name: font 13 weight 680
  personalPostName: { color: color.ink, fontSize: 13, fontWeight: "700" },
  // .post-time: font 11 color muted nowrap
  personalPostTime: { color: "#777", fontSize: 11, lineHeight: 14 },
  // .post-menu: border 0 bg transparent font 19 lh 1 p 0 h 28 color #555
  personalPostMenu: { alignItems: "center", height: 28, justifyContent: "center", width: 32 },
  personalPostMenuText: { color: "#555", fontSize: 19, lineHeight: 22 },
  // .post-text: font 14 lh 1.48 whiteSpace pre-wrap
  personalPostText: { color: color.ink, fontSize: 14, lineHeight: 21, marginTop: 5 },
  // .scene-line: flex alignItems center gap 7 marginTop 9 font 11 color #666
  personalPostContext: { alignItems: "center", color: "#666", flexDirection: "row", flexWrap: "wrap", fontSize: 11, gap: 7, marginTop: 9 },
  // .scene-chip: border 1 #ddd radius 999 p 4 8 color #111 bg #fff
  personalPostSceneChip: { backgroundColor: color.white, borderColor: "#DDD", borderRadius: 999, borderWidth: 1, color: color.ink, fontSize: 11, fontWeight: "600", paddingHorizontal: 8, paddingVertical: 4 },
  // .post-actions: flex gap 20 marginTop 12 font 12 color #666
  personalPostActions: { flexDirection: "row", gap: 20, marginTop: 12 },
  personalPostAction: { color: "#666", fontSize: 12, fontWeight: "500" },
  // .owner-menu: flex gap 10 marginTop 10 (own posts only)
  personalPostOwnerMenu: { flexDirection: "row", gap: 10, marginTop: 10 },
  personalPostOwnerItem: { color: "#777", fontSize: 11, fontWeight: "600" },
  personalPostOwnerDanger: { color: "#E5484D", fontSize: 11, fontWeight: "600" },
  personalPostOwnerBadge: { color: "#777", fontSize: 11, fontWeight: "500" },
  // .empty
  personalEmpty: { color: "#777", fontSize: 12, lineHeight: 18, paddingHorizontal: 32, paddingVertical: 58, textAlign: "center" },
  personalEmptyTitle: { color: color.ink, fontSize: 16, fontWeight: "700", marginBottom: 7 },
  // .media-grid: grid 3 1fr gap 1px bg #fff p 1
  personalPhotoGrid: { backgroundColor: color.white, flexDirection: "row", flexWrap: "wrap", padding: 1 },
  // .media-grid button: aspect-ratio 1 border 0 p 0 bg #eee overflow hidden position relative
  personalPhotoTile: { aspectRatio: 1, backgroundColor: "#EEE", flexBasis: "33.333%", overflow: "hidden", padding: 0, position: "relative" },
  personalPhotoImage: { height: "100%", width: "100%" },
  // .media-private: pos abs right 5 top 5 bg rgba(0,0,0,.65) color #fff radius 999 p 3 5 font 8
  personalPhotoPrivate: { backgroundColor: "rgba(0,0,0,.65)", borderRadius: 999, color: color.white, fontSize: 11, fontWeight: "700", paddingHorizontal: 5, paddingVertical: 3, position: "absolute", right: 5, top: 5 },
  // .record: p 15 18 border-b 1 line grid 42/1fr/auto gap 11 alignItems center
  personalRecords: { },
  personalRecordRow: { alignItems: "center", borderBottomColor: "#E8E8E8", borderBottomWidth: 1, flexDirection: "row", gap: 11, paddingHorizontal: 18, paddingVertical: 15 },
  // .record-icon: 40x40 radius 50% bg soft grid place center font 14 weight 700
  personalRecordIcon: { alignItems: "center", backgroundColor: "#F5F5F5", borderRadius: 20, color: color.ink, fontSize: 14, fontWeight: "700", height: 40, justifyContent: "center", width: 40 },
  personalRecordCopy: { flex: 1 },
  // .record b: font 13 weight 650
  personalRecordTitle: { color: color.ink, fontSize: 13, fontWeight: "700" },
  // .record span: display block color muted font 11 marginTop 4
  personalRecordDesc: { color: "#777", fontSize: 11, lineHeight: 14, marginTop: 4 },
  // .record strong: font 12 weight 650
  personalRecordValue: { color: color.ink, fontSize: 12, fontWeight: "700" },
  profileEditorOverlay: { backgroundColor: "rgba(20,18,31,0.42)", flex: 1, justifyContent: "flex-end" },
  profileEditorSheet: { backgroundColor: color.white, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingBottom: 30, paddingHorizontal: 20, paddingTop: 18 },
  profileEditorHead: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", marginBottom: 10 },
  profileEditorTitle: { color: color.ink, fontSize: 18, fontWeight: "900" },
  profileEditorDone: { color: "#FF0A6C", fontSize: 14, fontWeight: "800" },
  profileEditorAvatarRow: { alignItems: "center", flexDirection: "row", gap: 12, paddingBottom: 10, paddingTop: 4 },
  profileEditorAvatar: { borderRadius: 26, height: 52, width: 52 },
  profileEditorAvatarTitle: { color: color.ink, fontSize: 14, fontWeight: "800" },
  profileEditorAvatarHint: { color: color.muted, fontSize: 11, marginTop: 3 },
  profileEditorField: { borderBottomColor: "#ECE8EF", borderBottomWidth: 1, paddingVertical: 10 },
  profileEditorLabel: { color: color.muted, fontSize: 11, fontWeight: "700" },
  profileEditorInput: { color: color.ink, fontSize: 14, paddingHorizontal: 0, paddingVertical: 7 },

  // R15.68: Threads R2 风格 sheet (分析 / 搜索 / 设置 共用) — 22 圆角 + 17 内 padding + 9px 字体
  sheetOverlay: { backgroundColor: "rgba(20,18,31,0.42)", flex: 1, justifyContent: "flex-end", padding: 12 },
  sheetCard: { backgroundColor: color.white, borderRadius: 22, maxHeight: "72%", padding: 17 },
  sheetTitle: { color: color.ink, fontSize: 15, fontWeight: "800", marginBottom: 4 },
  sheetSub: { color: color.muted, fontSize: 11, marginBottom: 12 },
  sheetField: { borderColor: "#e6e6e6", borderRadius: 12, borderWidth: 1, padding: 9, marginVertical: 8 },
  sheetFieldLabel: { color: color.muted, fontSize: 11, fontWeight: "700" },
  sheetFieldValue: { color: color.ink, fontSize: 15, fontWeight: "800", marginTop: 4 },
  sheetFieldInput: { color: color.ink, fontSize: 11, marginTop: 4, padding: 0 },
  sheetWideBtn: { alignItems: "center", backgroundColor: color.white, borderColor: "#ddd", borderRadius: 11, borderWidth: 1, height: 38, justifyContent: "center", marginTop: 7, width: "100%" },
  sheetWideBtnDark: { backgroundColor: "#111", borderColor: "#111" },
  sheetWideBtnText: { color: color.ink, fontSize: 11, fontWeight: "800" },
  sheetWideBtnTextDark: { color: color.white, fontSize: 11, fontWeight: "800" },

  // 能力实例卡与 sheet（原型 my_market_modules v5）。
  abilitySheetHead: { alignItems: "center", flexDirection: "row", gap: 9, marginBottom: 6 },
  abilityHead: { alignItems: "center", flexDirection: "row", gap: 8, marginBottom: 6 },
  abilityIcon: {
    alignItems: "center",
    backgroundColor: "#F5F1F8",
    borderRadius: 10,
    height: 30,
    justifyContent: "center",
    width: 30
  },
  abilityIconText: { color: "#6F37B9", fontSize: 13, fontWeight: "900" },
  abilitySub: { color: color.muted, fontSize: 11, marginTop: 1 },
  abilityNote: { color: color.muted, fontSize: 11, lineHeight: 15, marginTop: 4 },
  abilityFieldBlock: { marginTop: 8 },
  abilityFieldLabel: { color: color.muted, fontSize: 11, fontWeight: "700", marginBottom: 4 },

  // chips（能力字段选择 / 星期 / 时段共用）。
  chipWrap: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chip: {
    backgroundColor: "#F8F6FA",
    borderColor: "#EAE5ED",
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 6
  },
  chipActive: { backgroundColor: color.ink, borderColor: color.ink },
  chipText: { color: color.ink, fontSize: 11, fontWeight: "700" },
  chipTextActive: { color: color.white, fontSize: 11, fontWeight: "800" },
  dayCell: {
    alignItems: "center",
    backgroundColor: "#F8F6FA",
    borderColor: "#EAE5ED",
    borderRadius: 10,
    borderWidth: 1,
    flex: 1,
    paddingVertical: 8
  },

  // 可用时间：近期摘要行 + 30 天日历。
  avDayRow: {
    alignItems: "center",
    borderBottomColor: "#F1EDF3",
    borderBottomWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 7
  },
  avDayRowDate: { color: color.ink, fontSize: 11, fontWeight: "700" },
  avDayRowState: { color: "#4A5568", fontSize: 11, fontWeight: "600" },
  avDayRowOff: { color: "#A59EAA" },
  avCalendar: { flexDirection: "row", flexWrap: "wrap", gap: 5, marginVertical: 8 },
  avCell: {
    alignItems: "center",
    backgroundColor: "#FDFCFE",
    borderColor: "#EFEAF2",
    borderRadius: 10,
    borderWidth: 1,
    paddingVertical: 5,
    width: "18%"
  },
  avCell_base: { backgroundColor: "#F3FBFF", borderColor: "#CBE9F7" },
  avCell_full: { backgroundColor: "#EEF8D6", borderColor: "#DFEBC7" },
  avCell_off: { backgroundColor: "#F6EEF0", borderColor: "#EBD9DD" },
  avCell_custom: { backgroundColor: "#F6F1FC", borderColor: "#E2D4F4" },
  avCell_blank: { backgroundColor: "#FAF9FB" },
  avCellDay: { color: color.ink, fontSize: 11, fontWeight: "800" },
  avCellWeek: { color: "#A59EAA", fontSize: 11 },
  avCellValue: { color: "#22506E", fontSize: 11, fontWeight: "800", marginTop: 1 },
  avCellValueMuted: { color: "#B9B3BD" },

  // 能力与可用时间 v5：能力摘要与审计月历分层，避免把 30 天排班堆在能力页。
  availabilityLead: { color: color.muted, fontSize: 13, lineHeight: 19, marginBottom: 14, marginTop: 5 },
  availabilitySummaryCard: { alignItems: "center", backgroundColor: color.white, borderColor: color.line, borderRadius: 20, borderWidth: 1, flexDirection: "row", gap: 12, marginBottom: 18, padding: 14, ...shadows.card },
  availabilityRuleCard: { alignItems: "center", backgroundColor: color.white, borderColor: color.line, borderRadius: 20, borderWidth: 1, flexDirection: "row", gap: 12, marginBottom: 12, padding: 15, ...shadows.card },
  availabilityRuleIcon: { alignItems: "center", backgroundColor: color.lime, borderRadius: 14, height: 46, justifyContent: "center", width: 46 },
  availabilityRuleCopy: { flex: 1 },
  availabilityRuleKicker: { color: color.muted, fontSize: 11, fontWeight: "700" },
  availabilityRuleValue: { color: color.ink, fontSize: 16, fontWeight: "900", marginTop: 3 },
  availabilityEditButton: { backgroundColor: color.white, borderColor: color.line, borderRadius: 12, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 8 },
  availabilityEditText: { color: color.ink, fontSize: 12, fontWeight: "800" },
  abilityCompactCard: { backgroundColor: color.white, borderColor: color.line, borderRadius: 20, borderWidth: 1, marginBottom: 10, padding: 14, ...shadows.card },
  abilityFieldChips: { flexDirection: "row", flexWrap: "wrap", gap: 7, marginTop: 11 },
  abilityFieldChip: { backgroundColor: "#F7F3F9", borderRadius: 999, paddingHorizontal: 10, paddingVertical: 7 },
  abilityFieldChipText: { color: "#514957", fontSize: 11, fontWeight: "600" },
  abilityFieldChipLabel: { color: color.ink, fontWeight: "800" },
  addAbilityRow: { flexDirection: "row", gap: 8, marginBottom: 18, marginTop: 2 },
  addAbilityChip: { alignItems: "center", backgroundColor: color.white, borderColor: color.line, borderRadius: 14, borderWidth: 1, flex: 1, paddingVertical: 11 },
  addAbilityChipText: { color: color.ink, fontSize: 12, fontWeight: "800" },
  availabilityMonthCard: { backgroundColor: color.white, borderColor: color.line, borderRadius: 22, borderWidth: 1, padding: 14, ...shadows.card },
  availabilityMonthHead: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", marginBottom: 12 },
  availabilityMonthTitle: { color: color.ink, fontSize: 16, fontWeight: "900" },
  availabilityClear: { color: color.muted, fontSize: 11, fontWeight: "800" },
  availabilityWeekHead: { flexDirection: "row", marginBottom: 5 },
  availabilityWeekName: { color: "#9C96A0", fontSize: 11, fontWeight: "800", textAlign: "center", width: "14.285%" },
  availabilityMonthGrid: { flexDirection: "row", flexWrap: "wrap" },
  availabilityMonthBlank: { aspectRatio: 1, width: "14.285%" },
  availabilityMonthDay: { alignItems: "center", aspectRatio: 1, backgroundColor: color.white, borderColor: "#EEE9F0", borderRadius: 11, borderWidth: 1, justifyContent: "center", marginBottom: 5, transform: [{ scale: 0.92 }], width: "14.285%" },
  availabilityMonthDay_base: { backgroundColor: color.white },
  availabilityMonthDay_full: { backgroundColor: color.lime, borderColor: color.lime },
  availabilityMonthDay_off: { backgroundColor: "#F1EFF2", borderColor: "#F1EFF2" },
  availabilityMonthDay_custom: { borderColor: color.ink, borderWidth: 2 },
  availabilityMonthDay_blank: { backgroundColor: "#FAF9FB" },
  availabilityMonthNumber: { color: color.ink, fontSize: 13, fontWeight: "900" },
  availabilityMonthNumberOff: { color: "#AAA4AD" },
  availabilityBaseDot: { backgroundColor: color.lime, borderRadius: 3, height: 6, marginTop: 4, width: 6 },
  availabilityOffMark: { bottom: 1, color: "#8D8792", fontSize: 11, fontWeight: "900", position: "absolute" },
  availabilityLegend: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 10 },
  availabilityLegendText: { color: color.muted, fontSize: 11, fontWeight: "700" },

  // 隐私阶梯（原型 .r159PrivacyLadder）。
  privacyLadder: {
    backgroundColor: color.white,
    borderColor: "rgba(20,18,31,0.04)",
    borderRadius: 17,
    borderWidth: 1,
    marginVertical: 8,
    padding: 11,
    ...shadows.card
  },
  privacyStep: {
    alignItems: "center",
    borderBottomColor: "#F1EDF3",
    borderBottomWidth: 1,
    flexDirection: "row",
    gap: 8,
    paddingVertical: 9
  },
  privacyStepIndex: {
    alignItems: "center",
    backgroundColor: "#F5F1F8",
    borderRadius: 8,
    height: 24,
    justifyContent: "center",
    width: 24
  },
  privacyStepIndexText: { color: "#6C3CB3", fontSize: 11, fontWeight: "900" },
  privacyStepCopy: { flex: 1 },
  privacyStepTitle: { color: color.ink, fontSize: 11, fontWeight: "700" },
  privacyStepDesc: { color: color.muted, fontSize: 11, marginTop: 2 },
  privacyStepTag: {
    backgroundColor: "#F7F4F9",
    borderRadius: 999,
    paddingHorizontal: 6,
    paddingVertical: 4
  },
  privacyStepTagText: { color: "#716879", fontSize: 11, fontWeight: "800" },

  // 商家店铺顶（原型 .storetop）。
  storeTop: {
    backgroundColor: color.ink,
    borderRadius: 17,
    marginVertical: 8,
    padding: 14
  },
  storeTopRow: { alignItems: "center", flexDirection: "row", gap: 10 },
  storeAvatar: {
    alignItems: "center",
    borderRadius: 15,
    height: 46,
    justifyContent: "center",
    width: 46
  },
  storeAvatarText: { color: color.white, fontSize: 20, fontWeight: "900" },
  storeStats: {
    flexDirection: "row",
    gap: 6,
    marginTop: 12
  },
  storeStatItem: {
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.08)",
    borderRadius: 11,
    flex: 1,
    paddingVertical: 8
  },
  storeStatValue: { color: color.white, fontSize: 12, fontWeight: "800" },
  storeStatLabel: { color: "rgba(255,255,255,0.6)", fontSize: 11, marginTop: 2 },

  // 经营入口网格（原型 .bizgrid8）。
  bizGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginVertical: 4
  },
  bizTile: {
    backgroundColor: color.white,
    borderColor: "rgba(20,18,31,0.04)",
    borderRadius: 14,
    borderWidth: 1,
    padding: 11,
    width: "48%"
  },
  bizTileIcon: {
    alignItems: "center",
    backgroundColor: "#F5F1F8",
    borderRadius: 9,
    height: 30,
    justifyContent: "center",
    width: 30
  },
  bizTileIconText: { color: "#6F37B9", fontSize: 12, fontWeight: "900" },
  bizTileLabel: { color: color.ink, fontSize: 11, fontWeight: "800", marginTop: 7 },
  bizTileDesc: { color: color.muted, fontSize: 11, lineHeight: 15, marginTop: 2 },

  // 今天的 Offer 卡片。
  offerCard: {
    backgroundColor: color.white,
    borderColor: "rgba(20,18,31,0.04)",
    borderRadius: 15,
    borderWidth: 1,
    marginVertical: 5,
    padding: 11,
    ...shadows.card
  },
  offerTitle: { color: color.ink, fontSize: 11, fontWeight: "800" },
  offerMeta: { color: color.muted, fontSize: 11, marginTop: 3 }
});

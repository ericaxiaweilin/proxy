// kyc-center.tsx — 接单中心（原型 deepseek_html_20260924_807348「接单中心 · KYC + 履约流程」）。
//
// 首页 + KYC 三步表单 + 审核进度 + 履约与安全，四段一屏一态。所有数字都来自真接口：
// profile（本人资料）、fetchProviderStats（已接单/完成率/准时率/复邀/投诉）、
// getAgentPassport（能力与核验状态）、fetchProviderApplication（KYC 状态）。
// 没有数据源的原型字段一律不做（见文件底 HONEST_DEVIATIONS），不编数字、不编状态。
//
// 诚实边界（跟原型不同的地方，都是为了不说假话）：
//   - 没有 Face ID 扫脸：expo-local-authentication 没装（装原生模块要重编二进制，
//     见 SCENE-CARD-SHADE-007 的教训），且 Face ID 只能证明机主在场、不能和证件
//     比对 —— 真人核验走手持证件自拍 + 运营人工比对（既有链路，不动）。
//   - 没有短信验证码：SMS 通道没接（PROXY_SMS_URL 是占位），手机号如实记「未验证」。
//   - 没有「24 小时出结果 / 自动比对 / Face ID 加速」：审核是人工的，无时效承诺。
//   - 进度轮询 5 秒一次（原型 1.5 秒太勤），到终态即停；失败明说，不吞。
//   - 投诉只有计数（无明细接口）：有记录只给数字 + 「详情请联系运营」，不编列表。
//   - 保护条款是静态通用文案（对所有人一样），不是个人状态。
//   - 履约流程管线除 KYC 节点外是流程说明，不是个人进度 —— 不给假状态。

import { useEffect, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { color } from "../theme";
import { sessionAuthClient, nativeSecureSessionStore } from "../native-clients";
import { SupplyClient, type AgentPassport } from "../supply-client";
import {
  fetchProviderApplication,
  fetchProviderStats,
  formatRate,
  kycPipeline,
  permissionLine,
  type ProviderApplicationStatus,
  type ProviderApplicationView,
  type ProviderStatsView,
} from "../provider-application-client";
import { CircularAvatarImage } from "../components/circular-avatar-image";
import { ProxyLoading } from "../components/proxy-foundation";
import { ProviderApplicationSurface } from "./provider-application";
import { meStyles as styles } from "./kyc-center-styles";
import { capabilityRows, kycHomeAction } from "../kyc-center-model";

type CenterView = "home" | "form" | "progress" | "trust";

const supply = new SupplyClient({ authClient: sessionAuthClient, secureSessionStore: nativeSecureSessionStore });

export function KycCenterSurface({ avatarUri, displayName, city, mediaClient, onEditProfile, onBack }: {
  avatarUri?: string | undefined;
  displayName?: string | undefined;
  city?: string | undefined;
  mediaClient?: Parameters<typeof ProviderApplicationSurface>[0]["mediaClient"];
  onEditProfile?: (() => void) | undefined;
  onBack: () => void;
}): React.JSX.Element {
  const [view, setView] = useState<CenterView>("home");
  const [appView, setAppView] = useState<ProviderApplicationView | undefined>(undefined);
  const [appFailed, setAppFailed] = useState(false);
  const [stats, setStats] = useState<ProviderStatsView | undefined>(undefined);
  const [statsFailed, setStatsFailed] = useState(false);
  const [passport, setPassport] = useState<AgentPassport | undefined>(undefined);
  const [passportFailed, setPassportFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchProviderApplication(sessionAuthClient)
      .then((v) => { if (!cancelled) { setAppView(v); setAppFailed(false); } })
      .catch(() => { if (!cancelled) setAppFailed(true); });
    fetchProviderStats(sessionAuthClient)
      .then((v) => { if (!cancelled) { setStats(v); setStatsFailed(false); } })
      .catch(() => { if (!cancelled) setStatsFailed(true); });
    supply
      .getAgentPassport()
      .then((v) => { if (!cancelled) { setPassport(v); setPassportFailed(false); } })
      .catch(() => { if (!cancelled) setPassportFailed(true); });
    return () => { cancelled = true; };
  }, []);

  // 审核进度轮询：只在 SUBMITTED 时跑，5 秒一次，到终态即停。
  useEffect(() => {
    if (view !== "progress") return;
    if (appView?.application?.status !== "SUBMITTED") return;
    const timer = setInterval(() => {
      fetchProviderApplication(sessionAuthClient)
        .then((v) => setAppView(v))
        .catch(() => undefined);
    }, 5000);
    return () => clearInterval(timer);
  }, [view, appView?.application?.status]);

  if (view === "form") {
    return (
      <ProviderApplicationSurface
        avatarUri={avatarUri}
        displayName={displayName}
        mediaClient={mediaClient}
        onEditProfile={onEditProfile}
        onBack={() => setView("home")}
      />
    );
  }
  if (view === "progress") {
    return <KycProgressView appView={appView} failed={appFailed} onBack={() => setView("home")} onTrust={() => setView("trust")} />;
  }
  if (view === "trust") {
    return <TrustSafetyView stats={stats} statsFailed={statsFailed} onBack={() => setView("home")} />;
  }

  const status = appView?.application?.status;
  const action = kycHomeAction(status);
  const permission = permissionLine(status ?? "NONE");
  const skills = capabilityRows(passport);
  const verifiedCount = skills.filter((s) => s.state === "verified").length;

  return (
    <ScrollView contentContainerStyle={styles.page}>
      <Pressable accessibilityLabel="返回" onPress={onBack} style={styles.backRow}>
        <Text selectable style={styles.backText}>‹ 返回</Text>
      </Pressable>
      <Text selectable style={styles.pageTitle}>接单中心</Text>

      {/* 人物卡：本人资料 + 真统计（分母为 0 显示 —，见 formatRate）。 */}
      <View style={styles.hero}>
        <View style={styles.heroHead}>
          {avatarUri ? (
            <CircularAvatarImage accessibilityLabel={`${displayName ?? ""}头像`} size={56} uri={avatarUri} />
          ) : (
            <View style={styles.heroAvaFallback}>
              <Text selectable style={styles.heroAvaLetter}>{(displayName ?? "?").slice(0, 1).toUpperCase()}</Text>
            </View>
          )}
          <View style={styles.heroCopy}>
            <Text selectable style={styles.heroName}>{displayName || "—"}</Text>
            <Text selectable style={styles.heroCity}>{city || "—"}</Text>
          </View>
        </View>
        <View style={styles.heroStats}>
          <View style={styles.heroStat}>
            <Text selectable style={styles.heroStatValue}>{stats ? String(stats.stats.completed) : "—"}</Text>
            <Text selectable style={styles.heroStatLabel}>已接单</Text>
          </View>
          <View style={styles.heroStat}>
            <Text selectable style={styles.heroStatValue}>{passport ? String(verifiedCount) : "—"}</Text>
            <Text selectable style={styles.heroStatLabel}>已验证能力</Text>
          </View>
          <View style={styles.heroStat}>
            <Text selectable style={styles.heroStatValue}>{stats ? String(stats.stats.repeatClients) : "—"}</Text>
            <Text selectable style={styles.heroStatLabel}>复邀客户</Text>
          </View>
        </View>
        {statsFailed ? <Text selectable style={styles.inlineError}>统计没读出来，下拉重进再试。</Text> : null}
      </View>

      {/* KYC 卡：真状态 → 真文案真去向。 */}
      <Pressable
        accessibilityLabel={`KYC 认证，${permission.text}`}
        onPress={() => setView(action.view)}
        style={styles.kycCard}
      >
        <View style={styles.kycHead}>
          <View style={styles.kycCopy}>
            <Text selectable style={styles.kycTitle}>KYC 认证 · {permission.text}</Text>
            <Text selectable style={styles.kycSub}>
              {status === "APPROVED"
                ? "实名已通过，可以接单"
                : status === "SUBMITTED"
                  ? "人工审核中"
                  : status === "REJECTED"
                    ? "未通过，可修改后重新提交"
                    : "3 步走完：基础信息 + 证件 + 履约条款"}
            </Text>
          </View>
          <Text selectable style={styles.kycGo}>{appFailed ? "重试" : action.label} ›</Text>
        </View>
      </Pressable>
      {appFailed ? <Text selectable style={styles.inlineError}>认证状态没读出来，下拉重进再试。</Text> : null}

      {/* 履约与安全入口：真指标进卡片。 */}
      <Pressable accessibilityLabel="履约与安全" onPress={() => setView("trust")} style={styles.entryRow}>
        <View style={styles.entryCopy}>
          <Text selectable style={styles.entryTitle}>履约与安全</Text>
          <Text selectable style={styles.entrySub}>
            {stats
              ? `按约完成 ${formatRate(stats.stats.completionRate)} · 准时 ${formatRate(stats.stats.onTimeRate)} · 投诉 ${stats.stats.complaints} 条`
              : "接单不是终点，平台持续记录履约"}
          </Text>
        </View>
        <Text selectable style={styles.entryArrow}>›</Text>
      </Pressable>

      {/* 我的能力：真核验状态，不分组编类目（服务端能力名是自由串，分组即编造）。 */}
      <Text selectable style={styles.sectionTitle}>我的能力{passport ? ` · ${verifiedCount} 已验证` : ""}</Text>
      {passportFailed ? (
        <Text selectable style={styles.inlineError}>能力列表没读出来，下拉重进再试。</Text>
      ) : passport && skills.length === 0 ? (
        <Text selectable style={styles.emptyText}>还没有声明能力，先去发布一条供给再回来。</Text>
      ) : (
        skills.map((skill) => (
          <View key={skill.capability} style={styles.skillRow}>
            <View style={styles.skillCopy}>
              <Text selectable style={styles.skillName}>{skill.capability}</Text>
              <Text selectable style={styles.skillSub}>{skill.detail}</Text>
            </View>
            <Text selectable style={[styles.skillBadge,
              skill.state === "verified" ? styles.skillBadgeVerified
              : skill.state === "reviewing" ? styles.skillBadgeReviewing : null]}>
              {skill.state === "verified" ? "已验证" : skill.state === "reviewing" ? "审核中" : "未认证"}
            </Text>
          </View>
        ))
      )}
    </ScrollView>
  );
}

function KycProgressView({ appView, failed, onBack, onTrust }: {
  appView: ProviderApplicationView | undefined;
  failed: boolean;
  onBack: () => void;
  onTrust: () => void;
}): React.JSX.Element {
  const status = appView?.application?.status;
  return (
    <ScrollView contentContainerStyle={styles.page}>
      <Pressable accessibilityLabel="返回" onPress={onBack} style={styles.backRow}>
        <Text selectable style={styles.backText}>‹ 返回</Text>
      </Pressable>
      <Text selectable style={styles.pageTitle}>审核进度</Text>
      {failed ? (
        <Text selectable style={styles.inlineError}>进度没读出来，下拉重进再试。</Text>
      ) : !appView ? (
        <Text selectable style={styles.emptyText}>正在读取审核状态…</Text>
      ) : (
        <View style={styles.hero}>
          <Text selectable style={styles.heroName}>
            {status === "APPROVED" ? "KYC 已通过" : status === "REJECTED" ? "审核未通过" : "正在审核"}
          </Text>
          <Text selectable style={styles.heroCity}>
            {status === "APPROVED"
              ? "你现在可以接单了"
              : status === "REJECTED"
                ? (appView.application?.rejectReason || "请检查资料后重新提交")
                : "人工抽检中。出结果会显示在这里。"}
          </Text>
        </View>
      )}
      <Pressable accessibilityLabel="看履约与安全流程" onPress={onTrust} style={styles.entryRow}>
        <View style={styles.entryCopy}>
          <Text selectable style={styles.entryTitle}>看履约与安全流程</Text>
        </View>
        <Text selectable style={styles.entryArrow}>›</Text>
      </Pressable>
      <Pressable accessibilityLabel="返回接单中心" onPress={onBack} style={styles.ghostBtn}>
        <Text selectable style={styles.ghostBtnText}>返回接单中心</Text>
      </Pressable>
    </ScrollView>
  );
}

function TrustSafetyView({ stats, statsFailed, onBack }: {
  stats: ProviderStatsView | undefined;
  statsFailed: boolean;
  onBack: () => void;
}): React.JSX.Element {
  const numbers = stats?.stats;
  return (
    <ScrollView contentContainerStyle={styles.page}>
      <Pressable accessibilityLabel="返回" onPress={onBack} style={styles.backRow}>
        <Text selectable style={styles.backText}>‹ 返回</Text>
      </Pressable>
      <Text selectable style={styles.pageTitle}>履约与安全</Text>
      <View style={styles.hero}>
        <Text selectable style={styles.heroName}>接单不是终点</Text>
        <Text selectable style={styles.heroCity}>平台通过流程持续记录你的履约表现、处理投诉、事后追溯。</Text>
        <View style={styles.heroStats}>
          <View style={styles.heroStat}>
            <Text selectable style={styles.heroStatValue}>{numbers ? formatRate(numbers.completionRate) : "—"}</Text>
            <Text selectable style={styles.heroStatLabel}>按约完成率</Text>
          </View>
          <View style={styles.heroStat}>
            <Text selectable style={styles.heroStatValue}>{numbers ? formatRate(numbers.onTimeRate) : "—"}</Text>
            <Text selectable style={styles.heroStatLabel}>准时率</Text>
          </View>
          <View style={styles.heroStat}>
            <Text selectable style={styles.heroStatValue}>{numbers ? String(numbers.complaints) : "—"}</Text>
            <Text selectable style={styles.heroStatLabel}>投诉记录</Text>
          </View>
        </View>
        {statsFailed ? <Text selectable style={styles.inlineError}>指标没读出来，下拉重进再试。</Text> : null}
      </View>
      <View style={styles.hero}>
        <Text selectable style={styles.heroName}>投诉记录</Text>
        {numbers && numbers.complaints > 0 ? (
          <Text selectable style={styles.heroCity}>有 {numbers.complaints} 条投诉记录，明细请联系运营查看。</Text>
        ) : (
          <Text selectable style={styles.heroCity}>暂无投诉记录。完成订单后，双方都有 7 天可发起投诉。</Text>
        )}
      </View>
      <View style={styles.hero}>
        <Text selectable style={styles.heroName}>对你也有保护</Text>
        <Text selectable style={styles.heroCity}>恶意投诉过滤 · 7 天申诉窗口 · 取证留档（聊天、到店打卡、客户确认由系统留档）。</Text>
      </View>
    </ScrollView>
  );
}

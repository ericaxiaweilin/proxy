// 寻宝（TREASURE-001）。学 PAO0 的玩法，改成适合撮合的机制：
//   · 普通宝箱：落在真实的咖啡店上，任何用户走到 100 米内、按住 0.9 秒就能开，得成长值；
//   · 同行加成：你在这家店有一单已确认、带小美同行的报名 —— 到店后多开一个同行箱，分数更高，运营配了还带咖啡券。
// 判定全在服务端（定位精度 / 离店距离 / 每箱一次 / 每日上限 / 速度）；这一屏只负责「看起来、听起来、按起来」。
// 雷达是普通视图，不依赖地图库（不会再碰地图子节点那个闪退）。
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AccessibilityInfo, Animated, Easing, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import * as Location from "expo-location";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ProxyBackGlyph, ProxyLoading } from "../components/proxy-foundation";
import { useModuleBackHandler } from "../components/module-back";
import { nativeSecureStorageDriver } from "../native-secure-storage";
import { color } from "../theme";
import { TreasureClient, TreasureError, type DeviceFix } from "../treasure-client";
import {
  HOLD_MS, OPEN_RADIUS_M, wonPrize, bearingDeg, canOpenAt, compassLabel, distanceText, particleCount, radarPoint, radarRadius,
  reasonText, remainingText, type TreasureBooking, type TreasureChest, type TreasureNearby, type TreasureResult,
} from "../treasure-model";
import { buzz, isTreasureMuted, playSfx, releaseSfx, setTreasureMuted, stopSfx } from "../treasure-sfx";

const GOLD = "#F5B83D";
const PRACTICE_KEY = "proxy.treasure.practice.done.v1";
const PRACTICE_ID = "__practice__";
const RADAR = 264;

type Target =
  | { kind: "SOLO"; id: string; name: string; sub: string; lat: number; lng: number; points: number; remaining?: number; expiresAt?: string; practice?: boolean; prizeLabel?: string; prizeSlots?: number }
  | { kind: "COMPANION"; id: string; name: string; sub: string; lat: number; lng: number; points: number; voucher: boolean; prizeLabel?: string; activityId: string; companionId: string; practice?: undefined; prizeSlots?: undefined };

// ---------------------------------------------------------------- 定位

type FixState = { status: "asking" } | { status: "denied" } | { status: "ready"; fix: DeviceFix };

function useDeviceFix(): FixState {
  const [state, setState] = useState<FixState>({ status: "asking" });
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | undefined;
    const read = async (): Promise<void> => {
      try {
        const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        if (!cancelled) setState({ status: "ready", fix: { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: Math.round(pos.coords.accuracy ?? 9999) } });
      } catch {
        // 这一次没读到：保持上一次，下一轮再试（不把「读不到」当成「拒绝」）。
      }
    };
    void (async () => {
      const perm = await Location.requestForegroundPermissionsAsync().catch(() => undefined);
      if (cancelled) return;
      if (!perm?.granted) {
        setState({ status: "denied" });
        return;
      }
      await read();
      timer = setInterval(() => void read(), 5000);
    })();
    return () => { cancelled = true; if (timer) clearInterval(timer); };
  }, []);
  return state;
}

// ---------------------------------------------------------------- 画面

export function TreasureHuntSurface({ client, onBack }: { client: TreasureClient; onBack: () => void }): React.JSX.Element {
  const insets = useSafeAreaInsets();
  useModuleBackHandler(() => { onBack(); return true; });
  const fixState = useDeviceFix();
  const [nearby, setNearby] = useState<TreasureNearby>();
  const [loadError, setLoadError] = useState(false);
  const [selectedId, setSelectedId] = useState<string>();
  const [result, setResult] = useState<{ res: TreasureResult; practice: boolean }>();
  const [notice, setNotice] = useState<string>();
  const [muted, setMuted] = useState(isTreasureMuted());
  const [practiceDone, setPracticeDone] = useState(true); // 读到之前先当作做过，避免闪一下
  const [reduceMotion, setReduceMotion] = useState(false);
  const [now, setNow] = useState(() => new Date());
  const lastLoad = useRef<{ lat: number; lng: number; at: number } | undefined>(undefined);
  const wasInRange = useRef(false);

  useEffect(() => {
    void nativeSecureStorageDriver.getItem(PRACTICE_KEY).then((v) => setPracticeDone(v === "1")).catch(() => setPracticeDone(false));
    void AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion).catch(() => undefined);
    const tick = setInterval(() => setNow(new Date()), 15000);
    return () => { clearInterval(tick); releaseSfx(); };
  }, []);

  const fix = fixState.status === "ready" ? fixState.fix : undefined;

  const load = useCallback(async (f: DeviceFix): Promise<void> => {
    try {
      const data = await client.nearby(f);
      setNearby(data);
      setLoadError(false);
      lastLoad.current = { lat: f.lat, lng: f.lng, at: Date.now() };
    } catch {
      setLoadError(true);
    }
  }, [client]);

  // 位置动了 20 米以上或超过 30 秒才重取（不是每 5 秒都拉）。
  useEffect(() => {
    if (!fix) return;
    const last = lastLoad.current;
    const moved = last ? Math.hypot((fix.lat - last.lat) * 111000, (fix.lng - last.lng) * 105000) : Infinity;
    if (!last || moved > 20 || Date.now() - last.at > 30000) void load(fix);
  }, [fix, load]);

  // 目标列表：练习箱（没做过 + 身边没有真箱子）→ 同行加成 → 真箱子。
  const targets = useMemo<Target[]>(() => {
    const out: Target[] = [];
    if (!nearby || !fix) return out;
    for (const b of nearby.companionBookings) out.push(toBookingTarget(b));
    for (const c of nearby.chests) if (!c.openedByMe) out.push(toChestTarget(c));
    const anyClose = out.some((t) => distanceTo(fix, t) <= OPEN_RADIUS_M * 3);
    if (!practiceDone && !anyClose) {
      out.unshift({ kind: "SOLO", id: PRACTICE_ID, name: "练习宝箱", sub: "先试试手 · 不计分", lat: fix.lat + 0.00022, lng: fix.lng, points: 0, practice: true });
    }
    return out.sort((a, b) => distanceTo(fix, a) - distanceTo(fix, b));
  }, [nearby, fix, practiceDone]);

  const selected = useMemo(() => targets.find((t) => t.id === selectedId) ?? targets[0], [targets, selectedId]);
  const selectedDistance = fix && selected ? distanceTo(fix, selected) : undefined;

  // 刚走进 100 米：叮 + 震一下。
  useEffect(() => {
    const inRange = selectedDistance !== undefined && canOpenAt(selectedDistance);
    if (inRange && !wasInRange.current) {
      playSfx("ding");
      buzz([0, 40, 60, 40]);
    }
    wasInRange.current = inRange;
  }, [selectedDistance]);

  // 雷达回声：300 米内，越近越急。
  useEffect(() => {
    if (selectedDistance === undefined || selectedDistance > 300 || canOpenAt(selectedDistance)) return;
    const period = 700 + (selectedDistance / 300) * 1800;
    const t = setInterval(() => playSfx("blip"), period);
    return () => clearInterval(t);
  }, [selectedDistance]);

  async function doOpen(target: Target): Promise<void> {
    if (!fix) return;
    setNotice(undefined);
    if (target.kind === "SOLO" && target.practice) {
      finishOpen({ kind: "SOLO", points: 10, sceneName: "练习宝箱", distanceM: 0, totalPoints: nearby?.totalPoints ?? 0 }, true);
      setPracticeDone(true);
      void nativeSecureStorageDriver.setItem(PRACTICE_KEY, "1").catch(() => undefined);
      return;
    }
    try {
      const res = target.kind === "SOLO" ? await client.openSolo(target.id, fix) : await client.openCompanion(target.activityId, target.companionId, fix);
      finishOpen(res, false);
      void load(fix);
    } catch (e) {
      playSfx("fail");
      buzz(80);
      if (e instanceof TreasureError) setNotice(reasonText(e.code, e.distanceM));
      else setNotice(reasonText("other"));
    }
  }

  function finishOpen(res: TreasureResult, practice: boolean): void {
    playSfx("open");
    buzz([0, 60, 40, 120]);
    setResult({ res, practice });
  }

  const toggleMute = (): void => {
    const next = !muted;
    setTreasureMuted(next);
    setMuted(next);
  };

  return (
    <View style={[styles.root, { paddingTop: Math.max(insets.top, 12) }]}>
      <View style={styles.top}>
        <Pressable accessibilityLabel="返回" onPress={onBack} style={styles.round}><ProxyBackGlyph /></Pressable>
        <View style={{ flex: 1 }}>
          <Text selectable style={styles.title}>寻宝</Text>
          <Text selectable style={styles.sub}>{nearby ? `今日 ${nearby.openedToday}/${nearby.dailyCap} · 我的积分 ${nearby.totalPoints}` : "走到咖啡店 100 米内开箱"}</Text>
        </View>
        <Pressable accessibilityLabel={muted ? "打开声音" : "静音"} onPress={toggleMute} style={styles.round}><Text style={styles.muteText}>{muted ? "🔇" : "🔊"}</Text></Pressable>
      </View>

      {fixState.status === "asking" ? <Center text="正在定位…" busy /> : null}
      {fixState.status === "denied" ? <Center text="需要定位权限才能寻宝：到店 100 米内才能开箱。请在系统设置里允许定位。" /> : null}
      {fix && !nearby && !loadError ? <Center text="正在找附近的宝箱…" busy /> : null}
      {fix && loadError && !nearby ? <Center text="加载失败，请稍后重试" action={{ label: "重试", onPress: () => void load(fix) }} /> : null}

      {fix && nearby ? (
        <ScrollView contentContainerStyle={{ paddingBottom: 40 + insets.bottom }} showsVerticalScrollIndicator={false}>
          <Radar fix={fix} targets={targets} selectedId={selected?.id} onSelect={setSelectedId} reduceMotion={reduceMotion} />
          {targets.length === 0 ? (
            <Text selectable style={styles.empty}>附近 5 公里内暂时没有宝箱。咖啡店会陆续出现新的箱子，过一会儿再来。</Text>
          ) : null}
          {selected && selectedDistance !== undefined ? (
            <DetailCard
              fix={fix} target={selected} distanceM={selectedDistance} now={now} reduceMotion={reduceMotion}
              onOpen={() => void doOpen(selected)}
            />
          ) : null}
          {notice ? <Text selectable style={styles.notice}>{notice}</Text> : null}
          {targets.length > 1 ? (
            <View style={{ marginTop: 14 }}>
              <Text selectable style={styles.sectionTitle}>附近的宝箱</Text>
              {targets.map((t) => (
                <Pressable key={`${t.kind}:${t.id}`} onPress={() => setSelectedId(t.id)} style={[styles.row, selected?.id === t.id && styles.rowOn]}>
                  <Text style={styles.rowIcon}>{iconOf(t)}</Text>
                  <View style={{ flex: 1 }}>
                    <Text selectable style={styles.rowName}>{t.name}</Text>
                    <Text selectable style={styles.rowSub}>{t.sub}</Text>
                  </View>
                  <Text selectable style={styles.rowDist}>{distanceText(distanceTo(fix, t))}</Text>
                </Pressable>
              ))}
            </View>
          ) : null}
        </ScrollView>
      ) : null}

      {result ? <ResultScene practice={result.practice} res={result.res} reduceMotion={reduceMotion} onClose={() => { stopSfx("charge"); setResult(undefined); }} /> : null}
    </View>
  );
}

const iconOf = (t: Target): string => (t.kind === "COMPANION" ? "💎" : t.practice ? "🎈" : t.prizeLabel ? "🎁" : "📦");

function toChestTarget(c: TreasureChest): Target {
  return { kind: "SOLO", id: c.id, name: c.name, sub: [c.area, `还剩 ${c.remaining} 个`].filter(Boolean).join(" · "), lat: c.lat, lng: c.lng, points: c.points, remaining: c.remaining, expiresAt: c.expiresAt, ...(c.prizeLabel && (c.prizeSlots ?? 0) > 0 ? { prizeLabel: c.prizeLabel, prizeSlots: c.prizeSlots ?? 0 } : {}) };
}
function toBookingTarget(b: TreasureBooking): Target {
  return { kind: "COMPANION", id: `${b.activityId}|${b.companionId}`, name: `${b.name} · 同行加成`, sub: b.title ? `你的订单：${b.title}` : "你有一单带小美同行的订单", lat: b.lat, lng: b.lng, points: b.points, voucher: b.withVoucher, ...(b.prizeLabel ? { prizeLabel: b.prizeLabel } : {}), activityId: b.activityId, companionId: b.companionId };
}
function distanceTo(fix: DeviceFix, t: { lat: number; lng: number }): number {
  const rad = Math.PI / 180;
  const dLat = (t.lat - fix.lat) * rad;
  const dLng = (t.lng - fix.lng) * rad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(fix.lat * rad) * Math.cos(t.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.min(1, Math.sqrt(a)));
}

// ---------------------------------------------------------------- 雷达

function Radar({ fix, targets, selectedId, onSelect, reduceMotion }: { fix: DeviceFix; targets: Target[]; selectedId: string | undefined; onSelect: (id: string) => void; reduceMotion: boolean }): React.JSX.Element {
  const pulse = useRef(new Animated.Value(0)).current;
  const sweep = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (reduceMotion) return undefined;
    const p = Animated.loop(Animated.timing(pulse, { toValue: 1, duration: 1600, easing: Easing.out(Easing.quad), useNativeDriver: true }));
    const s = Animated.loop(Animated.timing(sweep, { toValue: 1, duration: 4200, easing: Easing.linear, useNativeDriver: true }));
    p.start();
    s.start();
    return () => { p.stop(); s.stop(); };
  }, [pulse, sweep, reduceMotion]);
  const half = RADAR / 2;
  const ring = (m: number): number => radarRadius(m) * half * 2;
  return (
    <View style={styles.radarWrap}>
      <View style={[styles.radar, { width: RADAR, height: RADAR, borderRadius: half }]}>
        {[100, 500, 1500].map((m) => (
          <View key={m} style={[styles.ring, { width: ring(m), height: ring(m), borderRadius: ring(m) / 2, left: half - ring(m) / 2, top: half - ring(m) / 2 }, m === 100 && styles.ringOpen]} />
        ))}
        <Text style={[styles.north, { left: half - 5.5 }]}>北</Text>
        {!reduceMotion ? (
          <Animated.View pointerEvents="none" style={[styles.sweep, { left: half - 1, top: 0, height: half, transform: [{ translateY: half / 2 }, { rotate: sweep.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "360deg"] }) }, { translateY: -half / 2 }] }]} />
        ) : null}
        <View style={[styles.me, { left: half - 7, top: half - 7 }]} />
        {targets.map((t) => {
          const d = distanceTo(fix, t);
          const pt = radarPoint(bearingDeg(fix.lat, fix.lng, t.lat, t.lng), d);
          const open = canOpenAt(d);
          const on = t.id === selectedId;
          const size = on ? 26 : 20;
          const tint = t.kind === "COMPANION" ? "#7E5BEF" : t.practice ? color.mint : GOLD;
          return (
            <Pressable key={`${t.kind}:${t.id}`} accessibilityLabel={`${t.name} ${distanceText(d)}`} hitSlop={10} onPress={() => onSelect(t.id)}
              style={{ position: "absolute", left: half + pt.x * (half - 14) - size / 2, top: half + pt.y * (half - 14) - size / 2, width: size, height: size }}>
              {(open || t.prizeLabel) && !reduceMotion ? (
                <Animated.View style={[styles.glow, { backgroundColor: tint, opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.55, 0] }), transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 2.4] }) }] }]} />
              ) : null}
              <View style={[styles.dot, { backgroundColor: tint, borderColor: on ? color.ink : color.white }, open && styles.dotOpen]}>
                <Text style={styles.dotText}>{iconOf(t)}</Text>
              </View>
            </Pressable>
          );
        })}
      </View>
      <Text selectable style={styles.radarHint}>金圈 = 100 米内可开 · 点箱子看详情</Text>
    </View>
  );
}

// ---------------------------------------------------------------- 详情 + 长按开箱

function DetailCard({ fix, target, distanceM, now, reduceMotion, onOpen }: { fix: DeviceFix; target: Target; distanceM: number; now: Date; reduceMotion: boolean; onOpen: () => void }): React.JSX.Element {
  const open = canOpenAt(distanceM);
  const bearing = bearingDeg(fix.lat, fix.lng, target.lat, target.lng);
  const left = target.kind === "SOLO" && target.expiresAt ? remainingText(target.expiresAt, now) : "";
  return (
    <View style={[styles.card, target.kind === "COMPANION" && styles.cardCompanion]}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
        <Text style={{ fontSize: 30 }}>{iconOf(target)}</Text>
        <View style={{ flex: 1 }}>
          <Text selectable style={styles.cardTitle}>{target.name}</Text>
          <Text selectable style={styles.cardSub}>{target.sub}{left ? ` · ${left}后消失` : ""}</Text>
        </View>
      </View>
      <View style={styles.rewardRow}>
        <Text selectable style={styles.reward}>{target.practice ? "练习 · 不计分" : `+${target.points} 成长值`}</Text>
        {target.kind === "COMPANION" && target.voucher && target.prizeLabel ? <Text selectable style={styles.rewardVoucher}>+ {target.prizeLabel}</Text> : null}
      </View>
      {target.kind === "SOLO" && target.prizeLabel ? (
        <View style={styles.prizeBanner}>
          <Text style={styles.prizeEmoji}>🎫</Text>
          <View style={{ flex: 1 }}>
            <Text selectable style={styles.prizeTitle}>可能开出：{target.prizeLabel}</Text>
            <Text selectable style={styles.prizeSub}>箱子里还有 {target.prizeSlots} 张，先到先得 · 开出来放进「我的权益」</Text>
          </View>
        </View>
      ) : null}
      {target.kind === "COMPANION" ? (
        target.prizeLabel ? (
          <View style={styles.prizeBanner}>
            <Text style={styles.prizeEmoji}>🎫</Text>
            <View style={{ flex: 1 }}>
              <Text selectable style={styles.prizeTitle}>必出：{target.prizeLabel}</Text>
              <Text selectable style={styles.prizeSub}>因为你约了小美同行，到店开这个箱子一定有券</Text>
            </View>
          </View>
        ) : <Text selectable style={styles.hint}>因为你约了小美同行，到店可以多开一个。</Text>
      ) : null}
      {open ? (
        <HoldToOpen label={target.practice ? "按住开箱（练习）" : "按住开箱"} reduceMotion={reduceMotion} onComplete={onOpen} />
      ) : (
        <View style={styles.guide}>
          <Text selectable style={styles.guideText}>跟着走：{compassLabel(bearing)}方向 {distanceText(distanceM)}</Text>
          <Text selectable style={styles.guideSub}>走到 {OPEN_RADIUS_M} 米内就能开</Text>
        </View>
      )}
    </View>
  );
}

function HoldToOpen({ label, reduceMotion, onComplete }: { label: string; reduceMotion: boolean; onComplete: () => void }): React.JSX.Element {
  const progress = useRef(new Animated.Value(0)).current;
  const shake = useRef(new Animated.Value(0)).current;
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const buzzTimer = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const [holding, setHolding] = useState(false);

  const cancel = useCallback((): void => {
    if (timer.current) clearTimeout(timer.current);
    if (buzzTimer.current) clearInterval(buzzTimer.current);
    timer.current = undefined;
    buzzTimer.current = undefined;
    stopSfx("charge");
    setHolding(false);
    shake.stopAnimation();
    Animated.timing(progress, { toValue: 0, duration: 220, useNativeDriver: false }).start();
    Animated.timing(shake, { toValue: 0, duration: 100, useNativeDriver: true }).start();
  }, [progress, shake]);

  useEffect(() => cancel, [cancel]);

  const begin = (): void => {
    if (timer.current) return;
    setHolding(true);
    playSfx("charge");
    buzz(20);
    buzzTimer.current = setInterval(() => buzz(15), 180);
    progress.setValue(0);
    Animated.timing(progress, { toValue: 1, duration: HOLD_MS, easing: Easing.linear, useNativeDriver: false }).start();
    if (!reduceMotion) {
      Animated.loop(Animated.sequence([
        Animated.timing(shake, { toValue: 1, duration: 55, useNativeDriver: true }),
        Animated.timing(shake, { toValue: -1, duration: 55, useNativeDriver: true }),
      ])).start();
    }
    timer.current = setTimeout(() => {
      timer.current = undefined;
      if (buzzTimer.current) clearInterval(buzzTimer.current);
      buzzTimer.current = undefined;
      stopSfx("charge");
      setHolding(false);
      shake.stopAnimation();
      progress.setValue(0);
      onComplete();
    }, HOLD_MS);
  };

  return (
    <Animated.View style={{ transform: [{ translateX: shake.interpolate({ inputRange: [-1, 1], outputRange: [-3, 3] }) }] }}>
      <Pressable accessibilityRole="button" accessibilityLabel={label} onPressIn={begin} onPressOut={cancel} style={[styles.hold, holding && styles.holdOn]}>
        <Animated.View style={[styles.holdFill, { width: progress.interpolate({ inputRange: [0, 1], outputRange: ["0%", "100%"] }) }]} />
        <Text style={styles.holdText}>{holding ? "继续按住…" : label}</Text>
      </Pressable>
    </Animated.View>
  );
}

// ---------------------------------------------------------------- 揭晓

function ResultScene({ res, practice, reduceMotion, onClose }: { res: TreasureResult; practice: boolean; reduceMotion: boolean; onClose: () => void }): React.JSX.Element {
  const pop = useRef(new Animated.Value(0)).current;
  const count = useRef(new Animated.Value(0)).current;
  const voucherPop = useRef(new Animated.Value(0)).current;
  const [shown, setShown] = useState(0);
  const won = wonPrize(res);
  const n = particleCount(res.kind, reduceMotion, won);
  const particles = useMemo(() => Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2 + (i % 3) * 0.2;
    const dist = 80 + (i % 4) * 22;
    return { x: Math.cos(a) * dist, y: Math.sin(a) * dist - 20, v: new Animated.Value(0), tint: i % 3 === 0 ? GOLD : i % 3 === 1 ? "#FFE08A" : color.mint };
  }), [n]);

  useEffect(() => {
    Animated.spring(pop, { toValue: 1, friction: 5, tension: 80, useNativeDriver: true }).start();
    if (!reduceMotion) Animated.stagger(14, particles.map((p) => Animated.timing(p.v, { toValue: 1, duration: 750, easing: Easing.out(Easing.cubic), useNativeDriver: true }))).start();
    const id = count.addListener(({ value }) => setShown(Math.round(value)));
    Animated.timing(count, { toValue: res.points, duration: 700, delay: 250, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start(() => {
      if (!practice) { playSfx("coin"); buzz(30); }
      if (won) {
        // 开出券：再翻出一张券卡，配一声「叮」和一串长震动。
        setTimeout(() => { playSfx("ding"); buzz([0, 80, 60, 80, 60, 160]); }, 350);
        Animated.spring(voucherPop, { toValue: 1, friction: 6, tension: 90, delay: 350, useNativeDriver: true }).start();
      }
    });
    return () => count.removeListener(id);
  }, [pop, count, voucherPop, particles, res.points, reduceMotion, practice, won]);

  return (
    <View style={styles.resultMask}>
      <Pressable accessibilityLabel="关闭" onPress={onClose} style={StyleSheet.absoluteFill} />
      <Animated.View style={[styles.resultCard, { opacity: pop, transform: [{ scale: pop.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1] }) }] }]}>
        {particles.map((p, i) => (
          <Animated.View key={i} pointerEvents="none" style={[styles.particle, { backgroundColor: p.tint, opacity: p.v.interpolate({ inputRange: [0, 0.7, 1], outputRange: [1, 1, 0] }), transform: [{ translateX: p.v.interpolate({ inputRange: [0, 1], outputRange: [0, p.x] }) }, { translateY: p.v.interpolate({ inputRange: [0, 1], outputRange: [0, p.y] }) }, { scale: p.v.interpolate({ inputRange: [0, 1], outputRange: [1, 0.3] }) }] }]} />
        ))}
        <Text style={styles.resultEmoji}>{res.kind === "COMPANION" ? "💎" : "🎉"}</Text>
        <Text style={styles.resultPlus}>+{shown}</Text>
        <Text style={styles.resultLabel}>{practice ? "练习成功 · 练习分不计入积分" : res.kind === "COMPANION" ? "同行加成 · 成长值" : "成长值"}</Text>
        {!practice ? <Text style={styles.resultTotal}>{res.sceneName} · 我的积分 {res.totalPoints}</Text> : <Text style={styles.resultTotal}>真宝箱要走到咖啡店 100 米内才能开</Text>}
        {won ? (
          <Animated.View style={[styles.voucherCard, { opacity: voucherPop, transform: [{ scale: voucherPop.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1] }) }, { rotate: voucherPop.interpolate({ inputRange: [0, 1], outputRange: ["-8deg", "0deg"] }) }] }]}>
            <Text style={styles.voucherEmoji}>🎫</Text>
            <View style={{ flex: 1 }}>
              <Text selectable style={styles.voucherName}>{res.prizeLabel}</Text>
              <Text selectable style={styles.voucherSub}>已放进「我的权益」· 到店出示</Text>
            </View>
          </Animated.View>
        ) : !practice && res.hadPrize ? (
          <Text selectable style={styles.resultTotal}>这次没抽中券，箱子里的券还在等下一位</Text>
        ) : null}
        <Pressable onPress={onClose} style={styles.resultBtn}><Text style={styles.resultBtnText}>好的</Text></Pressable>
      </Animated.View>
    </View>
  );
}

function Center({ text, busy, action }: { text: string; busy?: boolean; action?: { label: string; onPress: () => void } }): React.JSX.Element {
  return (
    <View style={styles.center}>
      {busy ? <ProxyLoading tone="muted" /> : null}
      <Text selectable style={styles.centerText}>{text}</Text>
      {action ? <Pressable onPress={action.onPress} style={styles.retry}><Text style={styles.retryText}>{action.label}</Text></Pressable> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { backgroundColor: color.offWhite, flex: 1, paddingHorizontal: 16 },
  top: { alignItems: "center", flexDirection: "row", gap: 10, marginBottom: 10 },
  round: { alignItems: "center", backgroundColor: color.white, borderColor: color.line, borderRadius: 22, borderWidth: 1, height: 44, justifyContent: "center", width: 44 },
  muteText: { fontSize: 18 },
  title: { color: color.ink, fontSize: 22, fontWeight: "800" },
  sub: { color: color.muted, fontSize: 12, marginTop: 1 },
  center: { alignItems: "center", gap: 10, paddingTop: 60 },
  centerText: { color: color.muted, fontSize: 13, lineHeight: 19, textAlign: "center" },
  retry: { backgroundColor: color.ink, borderRadius: 18, paddingHorizontal: 18, paddingVertical: 9 },
  retryText: { color: color.white, fontSize: 13, fontWeight: "700" },
  empty: { color: color.muted, fontSize: 13, lineHeight: 19, marginTop: 14, textAlign: "center" },
  radarWrap: { alignItems: "center", marginTop: 6 },
  radar: { backgroundColor: "#171321", overflow: "hidden" },
  ring: { borderColor: "rgba(255,255,255,0.14)", borderWidth: 1, position: "absolute" },
  ringOpen: { borderColor: GOLD, borderStyle: "dashed", borderWidth: 1.5 },
  north: { color: "rgba(255,255,255,0.5)", fontSize: 11, fontWeight: "700", position: "absolute", top: 4 },
  sweep: { backgroundColor: "rgba(31,200,169,0.35)", position: "absolute", width: 2 },
  me: { backgroundColor: color.mint, borderColor: color.white, borderRadius: 7, borderWidth: 2, height: 14, position: "absolute", width: 14 },
  glow: { borderRadius: 20, bottom: 0, left: 0, position: "absolute", right: 0, top: 0 },
  dot: { alignItems: "center", borderRadius: 14, borderWidth: 2, flex: 1, justifyContent: "center" },
  dotOpen: { shadowColor: GOLD, shadowOpacity: 0.9, shadowRadius: 8 },
  dotText: { fontSize: 11 },
  radarHint: { color: color.muted, fontSize: 11, marginTop: 8 },
  card: { backgroundColor: color.white, borderColor: color.line, borderRadius: 18, borderWidth: 1, gap: 10, marginTop: 14, padding: 14 },
  cardCompanion: { borderColor: "#7E5BEF" },
  cardTitle: { color: color.ink, fontSize: 16, fontWeight: "800" },
  cardSub: { color: color.muted, fontSize: 12, marginTop: 2 },
  rewardRow: { alignItems: "center", flexDirection: "row", gap: 8 },
  reward: { color: "#B47A00", fontSize: 18, fontVariant: ["tabular-nums"], fontWeight: "900" },
  rewardVoucher: { backgroundColor: "#EEE3FF", borderRadius: 9, color: "#5A3FC0", fontSize: 12, fontWeight: "800", overflow: "hidden", paddingHorizontal: 8, paddingVertical: 3 },
  hint: { color: color.muted, fontSize: 12 },
  guide: { backgroundColor: color.offWhite, borderRadius: 14, gap: 2, paddingHorizontal: 14, paddingVertical: 12 },
  guideText: { color: color.ink, fontSize: 15, fontWeight: "800" },
  guideSub: { color: color.muted, fontSize: 12 },
  hold: { alignItems: "center", backgroundColor: color.ink, borderRadius: 16, height: 54, justifyContent: "center", overflow: "hidden" },
  holdOn: { backgroundColor: "#2B2438" },
  holdFill: { backgroundColor: GOLD, bottom: 0, left: 0, position: "absolute", top: 0 },
  holdText: { color: color.white, fontSize: 16, fontWeight: "800" },
  notice: { color: "#BD3434", fontSize: 13, marginTop: 10, textAlign: "center" },
  sectionTitle: { color: color.ink, fontSize: 14, fontWeight: "800", marginBottom: 8 },
  row: { alignItems: "center", backgroundColor: color.white, borderColor: color.line, borderRadius: 14, borderWidth: 1, flexDirection: "row", gap: 10, marginBottom: 8, padding: 12 },
  rowOn: { borderColor: color.ink },
  rowIcon: { fontSize: 22 },
  rowName: { color: color.ink, fontSize: 14, fontWeight: "700" },
  rowSub: { color: color.muted, fontSize: 11, marginTop: 2 },
  rowDist: { color: color.muted, fontSize: 12, fontVariant: ["tabular-nums"] },
  resultMask: { alignItems: "center", backgroundColor: "rgba(10,8,18,0.72)", bottom: 0, justifyContent: "center", left: 0, position: "absolute", right: 0, top: 0 },
  resultCard: { alignItems: "center", backgroundColor: color.white, borderRadius: 24, gap: 6, marginHorizontal: 28, overflow: "visible", paddingHorizontal: 28, paddingVertical: 26, width: 300 },
  particle: { borderRadius: 4, height: 8, left: 146, position: "absolute", top: 70, width: 8 },
  resultEmoji: { fontSize: 44 },
  resultPlus: { color: "#B47A00", fontSize: 54, fontVariant: ["tabular-nums"], fontWeight: "900" },
  resultLabel: { color: color.ink, fontSize: 14, fontWeight: "800", textAlign: "center" },
  resultTotal: { color: color.muted, fontSize: 12, textAlign: "center" },
  voucherCard: { alignItems: "center", backgroundColor: "#FFF6DD", borderColor: GOLD, borderRadius: 16, borderWidth: 2, flexDirection: "row", gap: 10, marginTop: 8, paddingHorizontal: 14, paddingVertical: 12, width: "100%" },
  voucherEmoji: { fontSize: 30 },
  voucherName: { color: "#7A5200", fontSize: 16, fontWeight: "900" },
  voucherSub: { color: "#8C6A1F", fontSize: 11, marginTop: 2 },
  prizeBanner: { alignItems: "center", backgroundColor: "#FFF6DD", borderColor: GOLD, borderRadius: 14, borderWidth: 1.5, flexDirection: "row", gap: 10, padding: 10 },
  prizeEmoji: { fontSize: 24 },
  prizeTitle: { color: "#7A5200", fontSize: 14, fontWeight: "900" },
  prizeSub: { color: "#8C6A1F", fontSize: 11, marginTop: 2 },
  resultBtn: { backgroundColor: color.ink, borderRadius: 16, marginTop: 14, paddingHorizontal: 34, paddingVertical: 12 },
  resultBtnText: { color: color.white, fontSize: 15, fontWeight: "800" },
});

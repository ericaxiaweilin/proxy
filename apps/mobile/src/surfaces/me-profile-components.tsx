import { useState } from "react";
import { Image, Modal, Pressable, ScrollView, Text, View } from "react-native";
import { ProxyIcon, ProxySymbolIcon } from "../components/proxy-icon";
import { ProxyQrCode } from "../components/proxy-qr-code";
import { color, Gradient } from "../theme";
import type { AbilityType, AvailabilityRule, AvailabilityState, AvOverride, MenuRow } from "./me-types";
import { ABILITY_SCHEMAS, AVAILABILITY_OPTIONS, avFmt, AV_DAY_NAMES, avStateFor } from "./me-types";
import { styles } from "./me-styles";
import { FACET_LOGO, OTTER_LOGO } from "../media/asset-sources";

export function availabilityLabel(value: AvailabilityState): string {
  return AVAILABILITY_OPTIONS.find((option) => option.id === value)?.title ?? "可接单";
}

// AGENT-CLAIM-NUMBER-001: 接单编号展示口径实现在无依赖模块（可单测），这里
// 转出口令编辑页的 import 路径保持不变。
export { formatClaimNumber } from "../claim-number";

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
      const byLabel = new Map(initialFields.map((f) => [f.label, f.value]));
      schema.fields.forEach((f) => map.set(f.id, byLabel.get(f.shortLabel) ?? ""));
    } else {
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

// PROFILE-QR-004：二维码卡片此前只有一个「分享链接」按钮 —— 复制、保存相册、
// 放大页全都藏在只有商家路径能到的 `personalqr` 子页里，普通用户等于没有。
// 卡片现在可以接一组动作；`shotRef` 是保存到相册的截图锚点（钩住 QR 本体，
// 不把按钮文字一起截进图里）。
export type QrCardAction = { label: string; onPress: () => void; primary?: boolean };

function QrCard({
  title,
  desc,
  actionLabel,
  onAction,
  alignCenter = false,
  qrValue,
  qrSize = 104,
  actions,
  shotRef,
  notice,
  onQrPress
}: {
  title: string;
  desc: string;
  actionLabel?: string | undefined;
  onAction?: (() => void) | undefined;
  alignCenter?: boolean | undefined;
  /** 传入则渲染真实可扫描二维码（PROFILE-QR-001）；缺省保持 FakeQr 兜底。 */
  qrValue?: string | undefined;
  qrSize?: number | undefined;
  actions?: QrCardAction[] | undefined;
  shotRef?: React.RefObject<View | null> | undefined;
  /** 复制/存图的结果必须出得来。没有这个出口时，成功失败一律静默 —— 用户看到的就是「按了没反应」。 */
  notice?: string | undefined;
  /** 点码放大。传了才可点 —— 没有放大层的页面不要给一个按下去没反应的码。 */
  onQrPress?: (() => void) | undefined;
}): React.JSX.Element {
  const buttons = actions && actions.length > 0 ? actions : undefined;
  const qr = qrValue ? <ProxyQrCode size={qrSize} value={qrValue} /> : <FakeQr />;
  return (
    <View style={[styles.qrCard, alignCenter && styles.qrCardCenter]}>
      <View ref={shotRef} collapsable={false}>
        {onQrPress ? (
          <Pressable accessibilityLabel="放大二维码" accessibilityRole="button" onPress={onQrPress}>
            {qr}
          </Pressable>
        ) : (
          qr
        )}
      </View>
      <View style={[styles.qrCardText, alignCenter && styles.qrCardTextCenter]}>
        <Text style={styles.qrCardTitle}>{title}</Text>
        <Text style={styles.qrCardDesc}>{desc}</Text>
        {buttons ? (
          <View style={styles.qrCardActions}>
            {buttons.map((action) => (
              <Pressable key={action.label} onPress={action.onPress} accessibilityLabel={action.label} style={action.primary ? styles.qrCardBtn : styles.qrCardBtnGhost}>
                <Text style={action.primary ? styles.qrCardBtnText : styles.qrCardBtnTextGhost}>{action.label}</Text>
              </Pressable>
            ))}
          </View>
        ) : (
          <Pressable onPress={onAction} style={styles.qrCardBtn}>
            <Text style={styles.qrCardBtnText}>{actionLabel}</Text>
          </Pressable>
        )}
        {notice ? <Text style={styles.qrCardNotice}>{notice}</Text> : null}
      </View>
    </View>
  );
}

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

function VoucherMenuGlyph({ color: tint }: { color: string }): React.JSX.Element {
  return <ProxyIcon color={tint} name="cup" size={26} />;
}

function ServiceRow({ row, onPress }: { row: MenuRow; onPress?: () => void }): React.JSX.Element {
  const icon = row.icon === "P" ? (
    <Image accessibilityLabel="Proxy" resizeMode="contain" source={OTTER_LOGO} style={styles.serviceLogo} />
  ) : row.icon === "facet-logo" ? (
    // FACET-LOGO-001: 参考稿 Proxy_COMPLETE_FiveRoot_FACET_v11.html 的真牌标
    // （黄黑对半分、白圆+四角星），不是随手指一个通用图标顶替。
    <Image accessibilityLabel="FACET" resizeMode="contain" source={FACET_LOGO} style={styles.serviceLogo} />
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

export { AbilitySheet, AvRuleSheet, AvDaySheet, FakeQr, QrCard, SocialRow, AvailabilitySheet, MeLocationContext, VoucherMenuGlyph, ServiceRow };

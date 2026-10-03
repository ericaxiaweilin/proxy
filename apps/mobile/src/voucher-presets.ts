import type { VoucherFamily } from "./voucher-client";

// VOUCHER-PRESET-001（2026-10-01，用户「商家的发卷 现在要输入一堆 改为预设好 默认
// 标准值。商家点击创建就可以」）
//
// 原来 CREATE 页的实际情况：类型 / 权益价值 / 数量 / 有效期都**已经有默认值**，
// 唯一逼着商家动手的是「适用范围」—— 它初始是空串，而 issue() 硬要求
// `scope.trim()`，于是「创建」一按就报「请填写权益价值、数量和适用范围」。
// 一张标准咖啡券本来是商家最常发的东西，却要他先想清楚这张券在哪能用。
//
// 现在把「一张常规券该长什么样」收成一张表：商家点一下类型/预设，值就填好，
// 直接按创建即可。输入框还在（要改仍然能改），但**不再是必填**。
//
// 为什么预设值放在这里而不是散在组件里：issue() 里原来还有几处写死的东西 ——
// `scopeDetail: … || "河内"`、`redeemTimeWindow: "14:00 – 18:00"`、`minimumSpend:
// "无"`、`perPersonLimit: 1`。它们既没在界面上出现过、也没人能改，商家看到的券
// 和他填出来的东西可能对不上。放进预设表之后，每一个值都能在界面上被看见和改。

export type VoucherPreset = {
  id: string;
  family: VoucherFamily;
  /** 预设名，商家一眼知道这张是什么券。 */
  label: string;
  /** 一句话说明，界面上原样显示，避免"预设"变成黑箱。 */
  hint: string;
  displayValue: number;
  quantity: number;
  /** 适用范围。写"本店"而不是编一个城市 —— 见下方 SCOPE 说明。 */
  scopeName: string;
  redeemTimeWindow: string;
  minimumSpend: string;
  perPersonLimit: number;
};

// SCOPE 说明：这张券的"适用范围"是**核销时的约束**，不是地址。以前空串兜底成
// "河内"，那是凭空给券安了一个城市（河内 / 胡志明都有本店），券面会印着一个
// 商家从没填过的地名。现在默认"本店"：对商家自己发的券来说，这句话是真的，
// 而且不含任何编造的地理信息。要指定别的范围，商家仍然可以自己填。
export const VOUCHER_PRESETS: readonly VoucherPreset[] = [
  {
    id: "coffee-standard",
    family: "COFFEE",
    label: "标准咖啡券",
    hint: "50,000₫ 面值 · 20 张 · 本店通用 · 14:00–18:00 核销",
    displayValue: 50_000,
    quantity: 20,
    scopeName: "本店",
    redeemTimeWindow: "14:00 – 18:00",
    minimumSpend: "无",
    perPersonLimit: 1
  },
  {
    id: "coffee-large",
    family: "COFFEE",
    label: "大额咖啡券",
    hint: "90,000₫ 面值 · 20 张 · 本店通用 · 14:00–18:00 核销",
    displayValue: 90_000,
    quantity: 20,
    scopeName: "本店",
    redeemTimeWindow: "14:00 – 18:00",
    minimumSpend: "无",
    perPersonLimit: 1
  },
  {
    id: "experience-standard",
    family: "EXPERIENCE",
    label: "标准体验券",
    hint: "150,000₫ 面值 · 10 张 · 本店通用 · 预约后使用",
    displayValue: 150_000,
    quantity: 10,
    scopeName: "本店",
    redeemTimeWindow: "预约后使用",
    minimumSpend: "无",
    perPersonLimit: 1
  },
  {
    id: "activity-standard",
    family: "ACTIVITY",
    label: "标准活动券",
    hint: "200,000₫ 面值 · 10 张 · 本店通用 · 报名 / 预约",
    displayValue: 200_000,
    quantity: 10,
    scopeName: "本店",
    redeemTimeWindow: "报名 / 预约",
    minimumSpend: "无",
    perPersonLimit: 1
  }
];

export const DEFAULT_PRESET_ID = "coffee-standard";

export function voucherPresetById(id: string): VoucherPreset | undefined {
  return VOUCHER_PRESETS.find((preset) => preset.id === id);
}

/** 每个类型至少有一个预设 —— 否则"点了类型没东西可填"又变成一种卡住。 */
export function defaultPresetForFamily(family: VoucherFamily): VoucherPreset {
  return VOUCHER_PRESETS.find((preset) => preset.family === family) ?? VOUCHER_PRESETS[0]!;
}

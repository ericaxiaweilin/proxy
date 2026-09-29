import { z } from "zod";

// WALLET-001: 钱包读模型（服务端驱动：前端只渲染下发的 payload）。
// 货币只有钻石/金豆两种，整数记账；余额是分录推导值，客户端不计算。

export const WalletCurrencySchema = z.enum(["DIAMOND", "BEAN"]);
export type WalletCurrency = z.infer<typeof WalletCurrencySchema>;

export const WalletEntrySchema = z.object({
  id: z.string().min(1),
  userId: z.string().min(1),
  currency: WalletCurrencySchema,
  delta: z.number().int(),
  reason: z.string().min(1),
  refId: z.string().optional(),
  createdAt: z.string()
});
export type WalletEntry = z.infer<typeof WalletEntrySchema>;

export const WalletVipSchema = z.object({
  active: z.boolean(),
  expiresAt: z.string().optional()
});
export type WalletVip = z.infer<typeof WalletVipSchema>;

export const RechargePackageSchema = z.object({
  id: z.string().min(1),
  diamonds: z.number().int().positive(),
  bonusDiamonds: z.number().int().nonnegative(),
  priceVND: z.number().int().positive(),
  tag: z.string().optional()
});
export type RechargePackage = z.infer<typeof RechargePackageSchema>;

export const WalletProviderSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  note: z.string().optional(),
  enabled: z.boolean()
});
export type WalletProvider = z.infer<typeof WalletProviderSchema>;

export const ExchangeItemSchema = z.object({
  id: z.string().min(1),
  costBeans: z.number().int().positive(),
  kind: z.string().min(1),
  amount: z.number().int().positive(),
  unit: z.string().optional(),
  enabled: z.boolean(),
  disabledHint: z.string().optional()
});
export type ExchangeItem = z.infer<typeof ExchangeItemSchema>;

export const GetWalletResultSchema = z.object({
  diamonds: z.number().int(),
  beans: z.number().int(),
  vip: WalletVipSchema,
  rechargePackages: z.array(RechargePackageSchema),
  exchangeCatalog: z.array(ExchangeItemSchema),
  providers: z.array(WalletProviderSchema)
});
export type GetWalletResult = z.infer<typeof GetWalletResultSchema>;

export const ListWalletEntriesResultSchema = z.object({
  entries: z.array(WalletEntrySchema)
});
export type ListWalletEntriesResult = z.infer<typeof ListWalletEntriesResultSchema>;

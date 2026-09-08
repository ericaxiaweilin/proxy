// 礼券默认有效期（纯函数）：今天起 30 天。
// CREATE 页曾经写死 2026-08-21 → 2026-08-31，过期后发出来的券上架
// 即过期（服务端按 validUntil < today 置 EXPIRED）。改走动态日期。
export interface VoucherValidity {
  /** wire 格式 YYYY-MM-DD */
  validFrom: string;
  validUntil: string;
  /** 展示格式 YYYY/MM/DD */
  fromLabel: string;
  untilLabel: string;
}

function ymd(date: Date): string {
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

export function defaultVoucherValidity(now: Date = new Date(), days = 30): VoucherValidity {
  const from = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const until = new Date(from.getFullYear(), from.getMonth(), from.getDate() + days);
  return {
    validFrom: ymd(from),
    validUntil: ymd(until),
    fromLabel: ymd(from).replaceAll("-", "/"),
    untilLabel: ymd(until).replaceAll("-", "/")
  };
}

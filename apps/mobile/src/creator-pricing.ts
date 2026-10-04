// CREATOR-LIST-CARD-001（2026-10-04，用户「给你替换 proxy 的商家侧-我的 creator list
// 展示形式 这次比较亮眼 之前太素了」）
//
// Creator 报价的格式化只有这一个实现。横滑卡（merchant-creator-recommendations）和
// 商家侧「我的 → Creator 经营」列表读的是同一个 SupplierCandidate.referencePrice ——
// 各写一份就会出现「同一个人两个价」，商家只能猜哪个是错的。和 CREATOR-AVATAR-001
// 钉照片解析是同一个理由。
//
// 为什么单独一个文件（而不是放在 surfaces/merchant-creator-recommendations.tsx 里）：
// 那个模块 import 了 expo-image / react-native，测试环境解析不了它的依赖图，于是
// 纯函数也没法被单元测试直接调用 —— 只能退化成 grep 源码。这里没有 RN 依赖，
// 边界（0 / 千位以下 / K / tr）可以真的断言。
//
// referencePrice 是主币单位（不是 minor），按调用方现有口径来，不改数据含义。
export function formatReferencePrice(referencePrice: number, currency: string): string {
  // 没有报价就是没有报价。印「0 VND」会被读成「免费」，比空着更糟。
  if (!(referencePrice > 0)) return "报价待沟通";
  if (referencePrice >= 1_000) {
    const thousands = Math.round(referencePrice / 1_000);
    // 进位后够得着 1000K 的（999_999 这类）走百万位 ——「1000K VND」比
    // 「1.0tr VND」难读。越南盾百万位印 tr（triệu），越南商家不认 M；
    // 其他币种暂时印 M —— 多币种汇率兑换以后再做，现在只按原币种印单位，不换算。
    if (thousands < 1_000) return `${thousands}K ${currency}`;
    const unit = currency === "VND" ? "tr" : "M";
    return `${(referencePrice / 1_000_000).toFixed(1)}${unit} ${currency}`;
  }
  // 先判 >= 1000 再四舍五入：否则 900 会被印成「1K VND」，把报价说高了。
  return `${referencePrice} ${currency}`;
}

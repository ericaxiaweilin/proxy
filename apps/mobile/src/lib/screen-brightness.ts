// 出示码时把系统亮度拉满，退出时还原 —— 微信 / 支付宝出示码那一屏的做法。
//
// 为什么单独一个模块：放大层（`qr-zoom-overlay.tsx`）和「我的二维码」页都要用，
// 而这段逻辑有两个不能各抄一遍的地方 —— 延迟加载的写法、以及还原语义。
//
// **坑：绝不能在模块顶层 `import` expo-brightness。**
// `expo-brightness/build/ExpoBrightness.js` 在**模块作用域**就执行
// `requireNativeModule('ExpoBrightness')`，而 `requireNativeModule` 在原生模块缺失时是
// **抛异常**、不是返回 null（见 `expo-modules-core/src/requireNativeModule.ts`）。
// 这个 hook 挂在 me.tsx / merchant-storefront / friend-crm 的正常 import 图里 ——
// 顶层 import 会让**还没装这个 pod 的包一启动就崩**。
// 所以走下面的 `loadBrightness()` 延迟 require + try/catch：原生模块不在就当没这功能，
// 白底满屏照常生效。
//
// 顺带记一笔：`expo-modules-core` 的 `requireOptionalNativeModule` 语义更合适，但那个包在
// `apps/mobile/package.json` 里**没有声明**，pnpm 严格布局下从 apps/mobile 解析不到，
// 不能直接引（和 `qrcode` 那次是同一个坑）。
//
// 生效前提：`pod install` + **重建 dev client**（Metro reload 不够 —— 原生模块不在 JS 里）。

import { useEffect } from "react";

type BrightnessApi = {
  getBrightnessAsync: () => Promise<number>;
  setBrightnessAsync: (brightnessValue: number) => Promise<void>;
};

/**
 * 延迟加载 expo-brightness。返回 undefined = 这个包里没有对应原生模块（还没重建 dev client），
 * 调用方静默降级。**别把它换成顶层 import** —— 原因见文件头注释（会一启动就崩）。
 */
function loadBrightness(): BrightnessApi | undefined {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require("expo-brightness") as Partial<BrightnessApi>;
    if (typeof mod.getBrightnessAsync !== "function" || typeof mod.setBrightnessAsync !== "function") {
      return undefined;
    }
    return mod as BrightnessApi;
  } catch {
    return undefined;
  }
}

/**
 * `active` 为 true 期间把屏幕拉到最亮，转 false / 卸载时还原。
 *
 * 还原语义（两条都不能省）：
 *  - **读不到原值就什么都不写** —— 宁可还原不了，也不要瞎写一个值，那会把用户的亮度改坏。
 *  - **还原挂在同一条 promise 链上** —— 否则「开→马上关」时原值还没读到，还原被跳过，
 *    亮度就卡在 1 下不来。
 *
 * 调用方要保证同一时刻只有一个 `active`（两个同时为 true 会互相抢亮度）。
 */
export function useScreenBrightness(active: boolean): void {
  useEffect(() => {
    if (!active) return undefined;
    const brightness = loadBrightness();
    if (!brightness) return undefined;

    // 一条链：读原值 → 拉满 → 把原值带出来。任何一步失败都退化成 undefined（= 不还原）。
    const restoreTo = brightness
      .getBrightnessAsync()
      .then(async (before) => {
        await brightness.setBrightnessAsync(1);
        return before;
      })
      .catch(() => undefined);

    return () => {
      void restoreTo.then((before) => {
        if (before === undefined) return;
        void brightness.setBrightnessAsync(before).catch(() => {});
      });
    };
  }, [active]);
}

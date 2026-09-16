// `qrcode` 不带类型，也不值得为这一小块用途拉一个 @types 依赖 —— 这里只声明我们
// 真正用到的部分：矩阵生成。包本身是纯 JS（`browser` 字段把 lib/index.js 换成
// lib/browser.js，后者只 require core/qrcode 和两个 renderer，RN 下安全）。
//
// 这个声明文件**不能**当成「依赖已经装好」的证据：它只是把类型补齐，Metro 该怎么解析
// 还是怎么解析。`qrcode` 必须留在 apps/mobile/package.json 的 dependencies 里 ——
// 曾经它是 react-native-qrcode-svg 的传递依赖，pnpm 严格布局下**从 apps/mobile 里
// 根本解析不到**（node require.resolve 也是 MODULE_NOT_FOUND），只有把它提成直接依赖
// 才会在 apps/mobile/node_modules 下建出符号链接。改动这里时记得跑一次
// `node -e "require.resolve('qrcode',{paths:['apps/mobile']})"` 验一下。
//
// 注意：`create()` 同步抛错（文本超长、编码失败），调用方要接住。
declare module "qrcode" {
  export type QrErrorCorrectionLevel = "L" | "M" | "Q" | "H";

  export type QrCode = {
    modules: {
      /** 行优先的 0/1 矩阵，长度 = size * size。 */
      data: Uint8Array;
      size: number;
    };
  };

  export function create(
    text: string,
    options?: { errorCorrectionLevel?: QrErrorCorrectionLevel },
  ): QrCode;
}

// 静态图片资源类型声明（Expo / Metro 通过 require 打包 PNG）。
declare module "*.png" {
  const source: number;
  export default source;
}

// 音效（寻宝）：Metro 默认把 wav 当资源打包。
declare module "*.wav" {
  const source: number;
  export default source;
}

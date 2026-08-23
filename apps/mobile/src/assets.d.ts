// 静态图片资源类型声明（Expo / Metro 通过 require 打包 PNG）。
declare module "*.png" {
  const source: number;
  export default source;
}

// 全局分页模块注册表 — 架构层统一滑动，不逐个 surface 改
// 每个分页模块在此声明 pages，App Shell 自动用 PaginatedModuleShell 包裹
// 新增模块只需在此加一条，无需各自 import ProxyModulePager

import type { PagerPageDefinition } from "../components/module-pager";

export interface RegisteredPaginatedModule {
  id: string;
  // 声明式 pages：标题与组件工厂，架构层负责 rememberPage、swipe、onExit
  pages: PagerPageDefinition[];
}

// 已注册：券（已回退至 R3 纯审核视觉，现由架构注入滑动）
// 后续：动态 / 市场 / 任务 / 收藏 等所有含 tabs 的模块在此追加即可
// 例：
// export const FEED_MODULE: RegisteredPaginatedModule = {
//   id: "feed",
//   pages: [
//     { id: "forYou", title: "推荐", component: <FeedForYou /> },
//     { id: "following", title: "关注", component: <FeedFollowing /> },
//   ],
// };
export const PAGINATED_MODULES: Record<string, RegisteredPaginatedModule> = {
  voucher: {
    id: "voucher",
    // 占位：实际 pages 由 VoucherSurface 在运行时通过 tabsToPagerPages 动态生成
    // 此处仅声明 id，用于 rememberPage key 与架构识别
    pages: [],
  },
};

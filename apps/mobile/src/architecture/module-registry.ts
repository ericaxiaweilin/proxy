// 全局分页模块注册表 — 架构层统一滑动，不逐个 surface 改
// 每个分页模块在此声明 pages，App Shell 自动用 PaginatedModuleShell 包裹
// 新增模块只需在此加一条，无需各自 import ProxyModulePager

import type { PagerPageDefinition } from "../components/module-pager";

export interface RegisteredPaginatedModule {
  id: string;
  // 声明式 pages：标题与组件工厂，架构层负责 rememberPage、swipe、onExit
  pages: PagerPageDefinition[];
}

// 只登记已经接入真实完整页面的模块；禁止用空 pages 或演示条冒充完成。
export const PAGINATED_MODULES: Record<string, RegisteredPaginatedModule> = {
  voucher: { id: "voucher", pages: [] },
};

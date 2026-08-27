// 架构层统一滑动 — 不逐个模块改
// 设计依据：docs/design/Proxy_Module_Pagination_Touch_Spec.md §2/§6/§12/§14
// 原则：Router 管模块，Pager 管模块内 Page。模块只声明 pages，滑动由架构托管。

import { ReactNode } from "react";
import { ProxyModulePager, type PagerPageDefinition } from "../components/module-pager";

// 模块定义：纯数据，不含手势逻辑。审核视觉（如 Voucher 的 FAMILY 卡）保留在各自 surface，
// 分页交互由本层统一注入，符合“不要一个个改，是架构支持”。
export interface PaginatedModuleDefinition {
  id: string;
  pages: PagerPageDefinition[];
  initialPage?: number;
  rememberPage?: boolean;
}

// 架构壳：任何已审核的 Tab/分页模块，只需把原 tabs 的 pages 传进来即获得左右滑。
// 例：Voucher 审核版（1d2629f）的 AVAILABLE/USED/EXPIRED 三 tabs，原为 Pressable 切换，
// 现包一层即得滑动，无需各模块各自 import Pager、处理 rememberPage、onExit。
export function PaginatedModuleShell({
  definition,
  onExit,
  page,
  onPageChange,
}: {
  definition: PaginatedModuleDefinition;
  onExit: () => void;
  page?: number | undefined;
  onPageChange?: ((index: number) => void) | undefined;
}): React.JSX.Element {
  const pagerProps: Record<string, unknown> = {
    moduleId: definition.id,
    pages: definition.pages,
    rememberPage: definition.rememberPage ?? true,
    onExit,
  };
  if (definition.initialPage !== undefined) pagerProps.initialPage = definition.initialPage;
  if (page !== undefined) pagerProps.page = page;
  if (onPageChange !== undefined) pagerProps.onPageChange = onPageChange;
  return <ProxyModulePager {...(pagerProps as unknown as React.ComponentProps<typeof ProxyModulePager>)} />;
}

// 适配器：将任意已审核的 tabs 表面（tabs + visible 过滤）无侵入转为 pager pages
// 保持视觉 100% 已审，仅交互升级为滑动。
export function tabsToPagerPages<T extends string>(options: {
  tabs: readonly T[];
  activeTab: T;
  renderPage: (tab: T) => ReactNode;
  titleOf?: (tab: T) => string;
}): PagerPageDefinition[] {
  return options.tabs.map((tab) => ({
    id: tab.toLowerCase(),
    title: options.titleOf?.(tab) ?? tab,
    component: options.renderPage(tab),
  }));
}

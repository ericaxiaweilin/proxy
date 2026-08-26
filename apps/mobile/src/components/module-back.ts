// Proxy 模块分页触控规范 §4/§13：Back 一律退整个模块；但模块内部的
// 子页面（详情/发布器等）在 Android 硬件返回时需要先逐层收起——否则
// 用户在二级页按返回会直接退出 App。
// 设计：模块内组件用 useModuleBackHandler 注册「当前最上层」的返回处理，
// 后注册的先消费（栈序=渲染序，重渲染自动置顶）；App Shell 最后兜底关模块。
// 平台分工：Android 硬件返回走这条链；iOS 右滑过头退出由 ModulePager 承担。
import { useEffect } from "react";

export type ModuleBackHandler = () => boolean;

const stack: ModuleBackHandler[] = [];

/** 注册处理器，返回注销函数。同一次注册重复 push 时保持幂等（先清旧位）。 */
export function pushModuleBack(handler: ModuleBackHandler): () => void {
  const existing = stack.indexOf(handler);
  if (existing >= 0) stack.splice(existing, 1);
  stack.push(handler);
  return () => {
    const index = stack.indexOf(handler);
    if (index >= 0) stack.splice(index, 1);
  };
}

/** 自栈顶向下的第一个返回 true 的处理器即消费本次返回；无人消费 = false。 */
export function handleModuleBack(): boolean {
  for (let i = stack.length - 1; i >= 0; i--) {
    const handler = stack[i];
    if (handler && handler()) return true;
  }
  return false;
}

export function moduleBackDepth(): number {
  return stack.length;
}

/**
 * 组件内声明式注册：传 undefined 表示本组件当前无可处理层级（如停在列表根）。
 * 无依赖数组——每次渲染重新置顶注册并捕获最新闭包，保证「最后渲染的最上层」优先。
 */
export function useModuleBackHandler(handler: ModuleBackHandler | undefined): void {
  useEffect(() => {
    if (!handler) return;
    return pushModuleBack(handler);
  });
}

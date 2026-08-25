// 规范 §5 页面状态：模块退出后记住停留 Page，重进回到上次位置。
// 内存级（App 会话内有效）——规范要求的是"再次进入模块"而非"跨 App 启动"。

const lastPage = new Map<string, number>();

export function getLastPage(moduleId: string): number | undefined {
  return lastPage.get(moduleId);
}

export function setLastPage(moduleId: string, page: number): void {
  lastPage.set(moduleId, page);
}

export function clearLastPage(moduleId?: string): void {
  if (moduleId === undefined) lastPage.clear();
  else lastPage.delete(moduleId);
}

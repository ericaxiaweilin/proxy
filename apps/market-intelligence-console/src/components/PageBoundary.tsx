// OPS-PAGE-BOUNDARY-001：一页渲染出错只坏这一页。
//
// 以前没有任何错误边界：某一页在渲染时抛错（例如接口少了一个字段、库是空的），
// React 会卸掉整棵树 —— 侧栏一起消失，整个控制台白屏，只能刷新；而刷新会触发
// pagehide 注销会话，于是还得重新收验证码。现在出错的那一页显示错误信息，
// 侧栏照常可用，换一页就恢复（App 用 key={page} 重挂本组件）。
import { Component, type ErrorInfo, type ReactNode } from "react";

type Props = { page: string; children: ReactNode };
type State = { error?: Error };

export class PageBoundary extends Component<Props, State> {
  state: State = {};

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(`[ops-console] page "${this.props.page}" crashed`, error, info.componentStack);
  }

  render(): ReactNode {
    if (!this.state.error) return this.props.children;
    return (
      <div className="notice" role="alert">
        <b>这一页渲染出错：</b>{this.state.error.message || String(this.state.error)}
        <div style={{ marginTop: 6, color: "var(--muted, #8a8490)" }}>其他页面不受影响；详细堆栈在浏览器控制台。</div>
      </div>
    );
  }
}

import { Component, type ReactNode } from "react";
import { AlertTriangle } from "lucide-react";

export class LazyScreenBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (this.state.failed) return <div className="splash error" role="alert"><AlertTriangle /><strong>页面加载失败</strong><p>页面资源未能加载，请重新加载。</p><button className="primary" onClick={() => window.location.reload()}>重新加载</button></div>;
    return this.props.children;
  }
}

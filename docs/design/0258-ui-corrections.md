# 导航、论文库概览与表格（0.2.58）

## 当前要求与实施顺序

1. 导航各项统一 42px 高度、3px 间距，Logo 使用主题强调色底色。参考 Windows NavigationView 的一致点击区，保留 0.2.54 入口和顺序。
2. 论文库概览使用 0.2.52 的标题、三项统计和未读概况布局，沿用各主题已有配色。
3. 表格主标题使用 600 字重，副标题保持常规；表头与单元格恢复 1px 列分隔线。
4. 核对“合并导出”的用户确认要求，再实现对应交互。参考 Windows 对话框规范，确认流程复用项目 Modal。
5. 桌面实测两种窗口尺寸、多主题、导航间距与表格；运行测试与构建，打包 0.2.58 并启动发布程序验证。

## 参考

- [Windows NavigationView](https://learn.microsoft.com/en-us/windows/apps/design/controls/navigationview)
- [Windows 对话框](https://learn.microsoft.com/en-us/windows/apps/design/controls/dialogs-and-flyouts/dialogs)
- 项目 0.2.52 原有主题与论文库概览实现。

## 外观实测

- Tauri/WebView2：导航相邻按钮间距为 3px（九处一致），Logo 背景为主题强调色，主标题 600 字重，列边框为 1 CSS px（125% 缩放下测得 0.8px）。
- 1440 × 900 与 1100 × 700 论文库检查通过；四套主题的浅色/深色与纯黑共九种组合，概览统计位于容器内，无页面横向溢出。
- npm run check：58 个测试文件、223 项通过，TypeScript 与 Vite 构建通过。
- 截图：output/playwright/0258-library-light.png、0258-library-light-narrow.png、0258-library-black.png。
- 合并导出的确认语义等待用户回复；现有行为为直接写入工作区 report-full.md，本阶段未更改。

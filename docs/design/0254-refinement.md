# 0.2.54 基础调整（0.2.57）

## 当前要求

以 0.2.54（8c321e7）为界面基底，保留该版本的导航形态、布局、组件与主题。局部调整字号、字重与交互反馈；使用该版本的系统字体配置。

## 实施

1. 归档上一轮未完成草稿，从 0.2.54 恢复公共样式、字体及精读、论文库相关界面。
2. 导航提高到 15px、字重 600；常用按钮 14px、正文 16px、辅助文字 12–13px。调整按原有布局进行。
3. 保留 PDF 显示、任务切换、输入法与弹窗的既有修复；保留筛选菜单的键盘交互，补齐刷新状态和表格密度反馈。
4. 运行 Tauri，在 1440 × 900、1100 × 700 检查论文库、导航、调研、精读、弹窗和 PDF；检查浅色、深色和纯黑主题。
5. 测试和生产构建通过后打包 0.2.57，启动发布程序复查。

## 验收

字体实际使用 0.2.54 系统字体；导航与原版结构一致、可读性提高；无页面横向溢出，筛选、菜单与弹窗正常。纯黑主体背景继续为 #000。

## 每项改动的参考依据

| 部位 | 联网核对的成熟产品 / 规范 | 本次落实 |
|---|---|---|
| 字体 | [Windows Typography](https://learn.microsoft.com/en-us/windows/apps/design/style/typography) | Segoe UI Variable 与中文系统字体；正文 regular、导航与标题 semibold；14px 控件、16px 阅读正文 |
| 导航 | [Windows NavigationView](https://learn.microsoft.com/en-us/windows/apps/design/controls/navigationview) | 保留 0.2.54 左侧入口、选中背景和图标形态；扩大文字和点击区，分别显示悬停与键盘焦点 |
| 论文库 | [Zotero Quick Start](https://www.zotero.org/support/quick_start_guide) | 保留文件夹 / 文献列表 / 详情的组织；减少表格竖线，标题和辅助字段分层，选中行不被悬停覆盖 |
| 工具栏 | [VS Code Sidebars / Toolbars](https://code.visualstudio.com/api/ux-guidelines/sidebars) | 保留主要操作，窄窗保存和刷新采用有名称与提示的图标，菜单与按钮提供焦点反馈 |
| 研究问题 | [Radix Collapsible](https://www.radix-ui.com/primitives/docs/components/collapsible) | 入口与内容区域形成完整展开组件；保留原生 details 键盘行为，提供文字展开状态和旋转图标 |

网页核对快照位于 output/ui-research。上述规则用于指导局部适配，未引入外部产品组件源码。

## 验证记录

- 回归测试覆盖定位后重新筛选：旧实现失败，修复后通过。
- Tauri 实测：导航 15px / 600，正文 16px；字体使用 0.2.54 系统字体栈。
- 浅色、标准深色、纯黑在 1100 × 700 均无页面横向溢出；研究问题可通过 Enter 展开和收起，筛选器方向键与 Escape 焦点恢复正常。
- PDF 容器宽度与滚动宽度均为 440px；选篇弹窗 880 × 630px，顶部 35px。
- 截图：output/playwright/0257-*.png。

- 最终完整测试：58 个文件、223 项通过；TypeScript / Vite 生产构建通过。
- 导航中文实际使用 Microsoft YaHei UI Bold（系统字体）；表格密度实测为 56px / 48px。
- 其余七个主要页面在 1100 × 700 均无页面横向溢出。

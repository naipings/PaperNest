# 界面风格

PaperNest 使用固定侧栏、分栏列表、正文与工具栏组织桌面界面。

| 元素 | 规则 |
|---|---|
| 壳层 | 全高平铺；导航宽 216px，收起后 56px；面板以分隔线划分 |
| 配色 | 主题决定配色，公共布局位于 src/desktop.css；控件使用实色与轻边框 |
| 控件 | 按钮高度约 34px，圆角 4–5px；选中、悬停与键盘焦点分别可辨 |
| 字体 | 英文 Segoe UI，中文随包提供 Noto Sans SC 可变字体（内部字体名 PaperNest Sans SC）；导航 14px、操作 13px、正文 16px / 1.75；字重 400/500/600，代码使用 Cascadia Code / Consolas |
| 页头 | 功能标题、必要说明与右侧操作；文字陈述当前功能和状态 |
| 论文库 | 细边框标题栏与全部/在读/已读/未读计数同行；数字使用等宽数字特性，标签间距 8px，统计组间有细分隔线；窄窗工具栏将保存和刷新缩为图标 |
| 精读 | 任务列表与正文分栏；常用操作为复制和对照阅读，原文、文件夹、重新生成放在更多菜单；正文避免重复显示论文标题 |
| 追问 | 问答滚动，输入区位于底部；空状态和进度使用直接说明 |
| 对照阅读 | PDF 工具栏按面板宽度换行；证据定位与批注保留原有行为 |
| 对话框 | body portal 居中显示，8px 圆角；Tab 限于当前窗口，Escape 关闭最上层窗口，关闭后焦点返回入口 |
| 任务与日历 | 今日、逾期、完成计数与清单、日历并列；日期文字随主题保持可读 |

## 主题

在「设置 → 个人资料 → 主题」选择并保存。

| 选项 | 实现 |
|---|---|
| 标准 · 跟随系统 / 浅色 / 深色 | styles.css + reference-theme.css |
| 紫色 · 跟随系统 / 浅色 / 深色 | lilac-dashboard-theme.css |
| 蓝灰 · 跟随系统 / 浅色 / 深色 | mist-dashboard-theme.css |
| 苔绿 · 跟随系统 / 浅色 / 深色 | willow-dashboard-theme.css |
| 纯黑 · 夜间 | black-theme.css；主体与阅读背景 #000，控件深灰，正文浅灰 |

纯黑主题保存为 profile.visualTheme = black、profile.theme = dark，重启后恢复。侧栏切换明暗时进入标准浅色主题。PDF 默认反色显示，阅读工具栏「PDF 原色」可临时切回原色；该变化仅影响显示。

PDF.js 官方样式经 Vite/PostCSS 限定在 .continuous-page-host 内。精读面板内部样式在 components/deepread/DeepRead.css；公共桌面样式与主题依次覆盖布局和颜色。

实施记录：[桌面界面与纯黑主题](design/desktop-refinement.md)、[字号与界面层次](design/interface-polish.md)。

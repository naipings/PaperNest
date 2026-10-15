# 阅读工作区（0.2.59）

## 要求与步骤

1. 调研标题、操作区、研究问题使用独立布局位置。按钮固定 36px 高度，展开研究问题只改变其内容区，不触发按钮拉伸或换行。
2. 调研工作区由 CSS Grid/Flex 分配视口剩余高度，列表和正文独立滚动。标题、工具栏和轮次选择保持可见。
3. 调研报告保留一处轮次选择，切换轮次回到正文顶部。阅读区支持键盘聚焦和滚动。
4. 精读与 Skill 文档使用主题面板、细边框与阅读留白，正文限制宽度；纯黑主题保持黑色文档背景。
5. 检查 1100 × 700、1440 × 900、2560 × 1380，覆盖展开前后坐标、滚动、轮次切换、各主题、精读对照和 Skill 详情。运行回归与构建，打包并启动发布版。

## 布局依据

- [VS Code 用户界面](https://code.visualstudio.com/docs/getstarted/userinterface)：侧栏、编辑区域、面板与顶部页签分别承担导航、阅读和操作。
- [Carbon Content switcher](https://carbondesignsystem.com/components/content-switcher/usage/)：在同一屏幕区域切换相关内容，以稳定的容器承载视图。
- 本轮保留现有导航、主题、入口与功能，布局变化集中在阅读工作区。

## 验证

- Tauri/WebView2 实测 2560 × 1380、1440 × 900、1100 × 700。按钮均为 36px 高；研究问题展开前后，三个按钮的 x/y 坐标保持一致。
- 三个阅读界面 × 三种尺寸 × 九种主题组合共 81 项边界检查通过：内容区域在视口内，无页面横向溢出或额外页面滚动。
- 滚动调研报告 900px 后，工具栏 y 坐标保持不变；切换轮次的正文 scrollTop 为 0。1100 × 700 展开研究问题后仍可滚动阅读报告。
- Skill 详情键盘 PageDown 滚动约 598px；切换 Skill 后 scrollTop 为 0。窄窗精读对照阅读正常，PDF 工具栏与报告均位于视口内。
- 纯黑精读文档背景为 rgb(0, 0, 0)，边界为 rgb(39, 39, 39)。
- npm run check 通过：59 个测试文件、225 项测试，TypeScript 与 Vite 构建通过。报告组件测试覆盖轮次切换、对话指定轮次后的自由切换与回到顶部。
- 截图位于 output/playwright/0259-research-1440.png、0259-deepread-1440.png、0259-deepread-black.png、0259-skill-narrow.png、0259-compare-narrow.png。

## 发布验证

- NSIS 构建通过，安装包 release/windows/PaperNest_0.2.59_x64-setup.exe，57,705,566 字节；release/windows/PaperNest.exe 的 ProductVersion 为 0.2.59。
- 启动发布程序后复测 2560 × 1380 与 1100 × 700：三个调研操作按钮均为 36px，研究问题展开前后坐标相同。
- 发布版报告滚动约 850px，工具栏保持原位；切换轮次 scrollTop 回到 0。精读与 Skill 文档列边界生效，无横向溢出。
- 发布截图：output/playwright/0259-release-research.png、0259-release-deepread.png、0259-release-skill.png。

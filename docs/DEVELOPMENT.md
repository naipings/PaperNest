# PaperNest 开发文档

## 产品边界

- Windows 单机、单用户、本地优先。
- V1 范围：本地资料库、PDF 阅读批注、术语与写作素材、任务日历、备份恢复。
- 在线元数据、LLM 与翻译由用户主动启用。
- 批注独立保存；导出时创建副本。

## 架构

```text
React + TypeScript + Vite
        ↕ 类型化 Tauri 命令
Rust + SQLx + SQLite/FTS5
        ↕
受管资料库：library.db、pdf/originals、figures、avatars、backups、manifest.json
```

- 前端通过类型化 Tauri 命令访问后端。
- SQLite 使用迁移、外键与 WAL；数据库只记录受管文件的相对路径和元数据。
- 删除论文先写入 `deletedAt`，永久删除是回收站中的显式操作。
- 资料库位置由用户选择。

## PDF 阅读器

连续阅读必须使用 `pdfjs-dist/web/pdf_viewer.mjs` 的 `PDFPageView`。该组件统一画布输出倍率、CSS 缩放变量和文本层布局，避免在 Windows 125%/150% 缩放下出现文字选择与 PDF 内容错位。

- 自定义批注层挂载到 `PDFPageView.div`。
- 选择区域相对于该实际页面元素归一化。
- 新增旋转、搜索高亮或批注类型时保持以上坐标不变量。
- 左 Ctrl 缩放根据 `KeyboardEvent.code === "ControlLeft"` 判断；普通滚轮滚动页面。

## 数据模型

核心实体包括：`Paper`、`Annotation`、`VocabularyEntry`、`WritingExcerpt`、`FrameworkFigure`、`Task`、`SavedView`、`Profile`、`LlmSettings` 和 `OnlineMetadataSettings`。

- 术语、佳句、框架图和批注保存 `paperId`、页码及标准化坐标，确保可跳回原文。
- PDF 全文索引、术语、批注、佳句与标题/摘要进入搜索范围。
- Category 为单选，Tags 为多选；合并分类或标签应预览影响范围。

## 导入与智能辅助

- PDF 导入复制到受管资料库，随后按标题、作者、年份和 DOI 检测疑似重复。
- PDF 有文本层时建立逐页索引；扫描版先提示无文本层，OCR 由用户主动触发。
- LLM 分析在用户提供接口、模型和 Key 后运行；API Key 使用 Windows Credential Manager。
- Crossref 元数据补全默认关闭，启用后只请求标题、作者、DOI、摘要和出版信息。

## 翻译服务的可迁移设计

翻译调用接受 LibreTranslate 兼容接口，后端仅允许 HTTPS 或本机 `localhost`/`127.0.0.1` HTTP 地址。

- 公网 HTTPS 服务：迁移资料库后在新设备重新输入端点和 API Key。
- 本地免费服务：`scripts/setup-libretranslate.cmd` 使用 `%LOCALAPPDATA%\PaperNest\LibreTranslate` 建立虚拟环境和模型；`scripts/start-libretranslate.cmd` 仅绑定 `127.0.0.1:5000`。
- Python 虚拟环境、模型绝对路径和 API Key 均不写入资料库备份。

## 文本编码

所有源码和 Markdown 必须为 UTF-8。批量改写前先保留原文件，完成后检查 UTF-8 解码、替换字符 `U+FFFD` 与私有区异常字符。

## 验证清单

```powershell
node .\node_modules\typescript\bin\tsc -b
node .\node_modules\vitest\vitest.mjs run
node .\node_modules\vite\bin\vite.js build
cd src-tauri; cargo check
```

涉及桌面端功能时还应验证：导入、搜索、连续阅读、文本选择、高亮、术语/佳句收录、批量回收站、备份恢复和换机后的翻译端点配置。

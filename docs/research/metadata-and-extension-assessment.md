# 元数据补全与扩展能力评估

> 调研日期：2026-08-03。系统架构与阅读台实现见 [开发文档](../DEVELOPMENT.md)。引用 Crossref、Microsoft、Google Chrome、Mozilla PDF.js 与 pdf-lib 的官方资料。

## 结论

| 能力 | 纳入 PaperNest | 推荐范围与顺序 |
| --- | --- | --- |
| 在线元数据补全 | 已实现 | Crossref；默认关闭；论文详情手动触发；导入 PDF 不联网 |
| 自定义字段 | 已实现 | 七种标量类型；设置页定义；详情页填写；可选表格列 |
| Word 插件 | 独立后续模块 | 从 PaperNest 搜索并插入格式化引用/参考文献；与桌面应用分项目、分安装包交付。 |
| 浏览器插件 | 轻量采集器，晚于 Word 插件 | Manifest V3 网页采集器提取 URL、DOI、标题和下载链接，发送待导入请求。 |
| PDF 正文修改 | 否 | 边界为批注、导出副本和表单填写。 |
| PDF 页面重排 | 导出型派生副本 | 用户明确导出时重排/删除/插入页面；原件、批注与阅读位置保持不变。 |

Tauri + Rust 后端已有受管资料库、类型化命令、`reqwest`、pdfjs-dist（阅读内核）与 pdf-lib（带批注导出）。Crossref 的最小增量是后端命令与确认面板。Word 和浏览器扩展有各自的宿主、清单、安装和权限模型，与桌面壳分离交付。PDF 正文编辑会打破「原 PDF 保留、批注坐标可追溯」的约束。

## 1. Crossref 在线元数据补全

### 官方能力与限制

Crossref 公开 REST API 无需注册，返回 JSON；数据来自成员及可信来源的存档。`/works/{doi}` 返回单个 DOI 的记录，`/works` 可搜索记录。当前官方文档基址为 `https://api.crossref.org/v1`。它提供书目元数据、基金、许可、更新、ORCID、ROR 以及部分摘要；摘要受作者或出版商版权限制。  
来源：[Crossref REST API](https://www.crossref.org/documentation/retrieve-metadata/rest-api/)、[Crossref Access and authentication](https://www.crossref.org/documentation/retrieve-metadata/rest-api/access-and-authentication/)、[API Swagger](https://api.crossref.org/swagger-ui/index.html)

调用优先级：

1. DOI 已存在：`GET /v1/works/{url-encoded DOI}`，只接受精确单项结果。
2. 没有 DOI：以规范化标题、第一作者、年份组合向 `GET /v1/works?query.bibliographic=…&rows=5` 发出低频候选查询；返回候选和匹配度，用户确认具体条目。
3. 写入前显示字段差异，逐字段勾选。用户已填写、LLM 已生成或手工修改过的值默认保留。

`Paper` 可映射的字段：`title` → 英文标题、`author` → 作者、`container-title` → 期刊/会议、`published-print`/`published-online` → 发表日期、`DOI`、`URL`，以及用户接受时的英文摘要。保留原始 Crossref 响应的受控快照和 `retrievedAt`；`reference`、复杂 `relation`、funding 等字段留待产品设计后再纳入表格列。  
来源：[Crossref REST API](https://www.crossref.org/documentation/retrieve-metadata/rest-api/)

### 礼貌池、User-Agent 与限流

设置页新增「在线元数据补全」开关，**默认关闭**。开启后要求填写有效联系邮箱；请求由 Rust 后端发送。每个请求带：

```text
User-Agent: PaperNest/0.1 (+https://github.com/<项目地址>; mailto:<用户邮箱>)
mailto=<用户邮箱>
```

`mailto` 或 `agent` header 是进入 polite pool 的官方方式；本项目使用前者并同时提供可识别的 User-Agent。当前官方限制：public pool 每秒 5 请求、并发 1；polite pool 每秒 10 请求、并发 3。实现读取 `x-rate-limit-limit`、`x-rate-limit-interval` 和 `x-concurrency-limit`，收到 `429` 时指数退避并显示「稍后重试」。单篇手动补全最多一次精确 DOI 请求或一次候选搜索，导入时不自动联网；成功和失败均缓存，避免重复查询。  
来源：[Crossref Access and authentication](https://www.crossref.org/documentation/retrieve-metadata/rest-api/access-and-authentication/)、[Crossref REST API 使用建议](https://crossref.org/documentation/retrieve-metadata/rest-api/tips-for-using-the-crossref-rest-api/)

### 实施设计

```text
设置：开关 + 联系邮箱 + 隐私提示
        ↓（用户在论文详情点击「查找元数据」）
Rust 命令 metadata_lookup
        ↓
Crossref DOI 精确查找 / 标题候选查找
        ↓
待确认差异面板 → 用户逐项接受 → save_paper
```

建议新增类型：

```ts
interface MetadataProviderSettings {
  enabled: boolean;
  provider: "crossref";
  contactEmail?: string;
}

interface MetadataCandidate {
  provider: "crossref";
  sourceUrl: string;
  retrievedAt: string;
  confidence: number;
  patch: Partial<Paper>;
}
```

验收要点：关闭时所有代码路径均不发出网络请求；查不到或非 Crossref DOI 时给出明确结果；候选搜索需用户确认后才导入；网络错误和 429 不影响本地导入、全文索引和阅读。

## 2. 自定义元数据字段

Notion 式任意字段涵盖字段定义、类型系统、跨库关系、公式、汇总、视图表达式和权限语义。单机论文管理器的价值在于「用户为论文添加少量自定义元数据」。

### 推荐实现

第一版支持：文本、数字、日期、URL、布尔值、单选、多选。每个字段包含稳定 ID、显示名、类型、选项及颜色；每篇论文以字段 ID 保存对应值。SQLite 层采用定义表 + 值表：

```text
custom_field_definitions(id, name, type, options_json, position, archived_at)
paper_custom_field_values(paper_id, field_id, value_json, updated_at)
```

主表可选择展示这些字段、筛选和排序；长文本只在详情中显示。字段改名不迁移值；删除改为归档并给影响预览。导入、LLM 和 Crossref 的自动写入只写固定核心字段。

### 后续阶段

- 公式、汇总、双向关联、嵌套页面、自动化、看板/日历公式表达式。
- 任意 SQL、任意 JSON 路径查询或前端直接数据库访问。

这些能力会把固定的 `Paper`、FTS 索引、保存视图和类型化 Rust 命令变成动态数据库平台，测试面和迁移风险与论文管理价值不成比例。此项在 Crossref 之后实施。

## 3. Word 插件

### 官方机制

Word 插件是 Office Add-in：用 HTML/CSS/JavaScript（或 TypeScript）实现，任务窗格运行网页代码，通过 Word JavaScript API 操作 Word 文档对象。Word API 可访问 body、段落、内容控件和图片；插件由 manifest 描述宿主、权限和显示方式，可发布到网络共享、应用目录或 Microsoft Marketplace。它运行在 Word Web、Windows、Mac 和 iPad 等宿主。  
来源：[Word Add-ins 概览](https://learn.microsoft.com/en-us/office/dev/add-ins/word/word-add-ins-programming-overview)、[Office Add-ins 开发总览](https://learn.microsoft.com/en-us/office/dev/add-ins/develop/develop-overview)

### 判断与实现

研究生写作时「搜索论文 → 插入正文引用 → 更新参考文献」价值高，需先有可靠的引用数据模型（authors、title、year、venue、DOI、citation key）。与当前桌面功能分批次交付。

范围限定为独立的 `apps/word-addin`：

- Word 任务窗格提供本地搜索、引用样式选择、插入 citation 字段以及插入/更新 bibliography。
- 初期只支持用户主动选择的一种样式（例如 IEEE 或 GB/T 7714），由 PaperNest 生成引用文本。
- Office 插件和桌面应用通过本机受限桥接协议通信。桥接只能查询可引用条目、返回格式化字符串与引用 ID。
- Word 文档中保存稳定的 PaperNest citation ID，便于后续更新；PaperNest 未运行时显示可恢复错误。

这要求独立 manifest、任务窗格资源、兼容性测试和安装/旁加载文档，排在自定义字段之后。Office.js 的生命周期和权限属于 Word 宿主，从 Tauri 前端直接复用 Office.js 不可行。

## 4. 浏览器插件

### 官方机制与安全边界

Chrome/Edge 扩展使用 Manifest V3。权限、host permissions 和 content-script match pattern 在 manifest 中声明；可选权限可在运行时由用户授予。MV3 禁止远程托管可执行代码。  
来源：[Chrome Manifest V3](https://developer.chrome.com/docs/extensions/develop/migrate/what-is-mv3)、[Chrome 权限声明](https://developer.chrome.com/docs/extensions/develop/concepts/declare-permissions)

浏览器扩展通过 Chrome/Edge Native Messaging 与桌面应用通信：扩展声明 `nativeMessaging` 权限；浏览器启动独立 native host 子进程，通过 stdin/stdout 以带长度前缀的 JSON 通讯。content script 经 service worker 转发；单条 host → 浏览器消息上限为 1 MiB。Windows 下安装程序注册 native-host manifest，`allowed_origins` 以精确扩展 ID 列出。  
来源：[Chrome Native Messaging](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging)、[Microsoft Edge Native Messaging](https://learn.microsoft.com/en-us/microsoft-edge/extensions/developer-guide/native-messaging)

### 判断与实现

第一版定位为「保存当前论文页面」，排在 Word 插件之后：

```text
用户点击扩展图标
→ 扩展读取当前页 title / canonical URL / DOI / PDF URL
→ service worker → native host
→ PaperNest 显示待导入卡片
→ 用户确认后由桌面应用下载或要求选择本地 PDF
```

实施条件：

- 只申请 `activeTab`、`storage` 和 `nativeMessaging`；网站读取使用用户点击临时授权，必要 host permission 作为 optional permission。
- Native host 独立为 Rust 小程序，通过认证的本机 named pipe 向已运行的 PaperNest 发送严格 schema 的 `clip_candidate`。只允许 `url`、`title`、`doi`、`pdfUrl` 和站点来源。
- 安装器为 Chrome 和 Edge 分别注册 host manifest；两个商店发布时把两个固定扩展 ID 都写入 `allowed_origins`。
- 下载、联网元数据查询或入库均在 PaperNest 可见 UI 中再次确认。

## 5. PDF 正文修改与页面重排

### 当前库的实际边界

PDF.js 的 display API 用于加载、渲染和取得文档信息；`getData()` 返回原始文档数据，`saveDocument()` 返回已保存文档的完整字节。  
来源：[PDF.js 入门与层次](https://mozilla.github.io/pdf.js/getting_started/)、[PDFDocumentProxy API](https://mozilla.github.io/pdf.js/api/draft/module-pdfjsLib-PDFDocumentProxy.html)

pdf-lib 能添加、插入、删除和复制页面，也能绘制文字、图像和矢量内容。它可以填写/修改 AcroForm 文本字段；对普通页面上非表单字段的文本，pdf-lib 没有移除或编辑 API。  
来源：[pdf-lib 功能与限制](https://github.com/Hopding/pdf-lib)、[PDFDocument API：insertPage / removePage](https://pdf-lib.js.org/docs/api/classes/pdfdocument)

### 产品决定

| 要求 | 技术结论 | 产品决定 |
| --- | --- | --- |
| 编辑论文普通正文 | PDF.js + pdf-lib 无法可靠地进行语义级文本替换、重排段落或重排版。覆盖白块再绘字会损坏可检索性、字体、连字、阅读顺序和数字签名。 | 保留批注、手绘、导出副本；后续可考虑表单字段填写。 |
| 删除、插入、重排页面 | pdf-lib 可以创建新页序和删除页。 | 只做「导出派生副本」，受管原 PDF 保持不变。 |

页面编排流程：选择页缩略图 → 生成新 PDF 副本 → 在导出元数据中保存 `sourcePaperId`、页映射和生成时间 → 用户下载/另存。删除页前先列出会失去定位的批注、术语、佳句和框架图；原论文的阅读位置、PDF 文本索引和批注不迁移。

## 建议实施顺序

1. Crossref 设置、后端限流客户端、详情页的「查找并确认」差异面板。
2. 自定义元数据字段（六种标量类型）及其表格列显隐、筛选、排序。
3. 引用数据模型与纯本地参考文献格式化；再开始独立 Word Add-in。
4. 独立 MV3 浏览器采集器和受限 Native Messaging host。
5. 如确有用户需求，做 pdf-lib 驱动的「页面整理后导出副本」。

每一阶段更新 README、开发文档、变更记录和权限说明，并覆盖离线/默认关闭、用户取消、网络 429、不存在 DOI、插件未安装/桌面应用未运行、派生导出不改变原件等验收场景。

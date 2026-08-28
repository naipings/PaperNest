# 论文库文件夹功能评估与实施计划

> 调研日期：2026-08-24；修订：2026-08-25。  
> 基于 PaperNest 当前代码库（schema_version=4）与 Zotero、Calibre、JabRef 等公开实现资料。  
> 产品选择已按现有实现定稿。

## 结论摘要


| 问题             | 定稿                                                                            |
| -------------- | ----------------------------------------------------------------------------- |
| 是否有必要做文件夹？     | **有条件有必要**：与主/子领域正交；解决「按课题/项目组织」；库小且只按 ACM 浏览时可延后                             |
| 物理路径还是逻辑分组？    | **逻辑分组**：PDF 仍在 `pdf/originals/{uuid}.pdf`；移动论文 = 改 `folder_id`，不搬文件          |
| 一篇论文几个文件夹？     | **单 folder**（`papers.folder_id`，可空=未归档）。对齐 Windows 文件管理器与现有 `categoryId` 单选模式 |
| 写作库跳转？         | **保持现网：开 PDF 到指定页**。知识树继续「定位到论文库表格」                                           |
| 删除文件夹？         | **仅当整棵子树内没有任何未删除论文时可删**；否则弹窗拒绝。空子文件夹不挡删除，随父级一并删除                              |
| 与 category/tag | **正交共存**：taxonomy 描述「是什么」；folder 描述「放在哪」                                      |
| 实施顺序           | 数据模型 → 左侧树 + 筛选 → CRUD（含空删校验）→ 导入/移动 → 跨模块定位                                  |


---



## 0. 产品定稿（相对上一版的变更）



### 0.1 单 folder membership（否决多对多）

上一版建议 Zotero 式多对多。结合本项目实现与你的交互诉求，改为 **单文件夹**：


| 依据              | 说明                                                                               |
| --------------- | -------------------------------------------------------------------------------- |
| 用户心智            | 明确要求「类似 Windows 文件管理器」：一个文件同一时刻只在一个目录                                            |
| 现有数据模式          | `categoryId` 已是单选；多归属用 `tagIds`。folder 更接近「位置」，对齐 category 而非 tag                |
| Ctrl+X / Ctrl+V | 「剪切 → 粘贴」在单 parent 下语义就是改 `folder_id`；多 membership 下还要区分「添加 vs 移动」，与 Windows 不一致 |
| 定位跳转            | `locatePaper` 只需读一个 `folder_id`，无需「主 folder / 最近访问」启发式                           |
| 空文件夹删除          | 你定义的「子树内无论文才可删」在单归属下可判定；多归属时「论文还在别的 folder」会模糊「非空」语义                             |


**不采用** `paper_folders` 多对多表。跨课题复用同一论文时，继续用 **tag / SavedView / 自定义字段**，不靠一篇论文挂多个 folder。

### 0.2 写作库跳转：开 PDF（保持现网）


| 入口                | 现网行为                                        | 定稿                                        |
| ----------------- | ------------------------------------------- | ----------------------------------------- |
| 写作资料库 footer      | `onOpenPaper={openPdf}` → 开阅读台到 `item.page` | **不变**。素材带页码，目标是回看原文                      |
| 知识树「在论文表格中定位」/ 双击 | `setSelectedId` + `setScreen("library")`    | **扩展为** `locatePaper`：切换到论文所在 folder 并选中行 |
| 论文库双击行            | `openPdf`                                   | 不变                                        |


理由：`App.tsx` 已故意把写作库与知识树绑到不同回调；写作库是「引用 → 阅读」，知识树是「关系图 → 库内定位」。V1 **不**为写作库加「在库中显示」次要按钮；若后续需要，再加，不阻塞 folder。

### 0.3 删除文件夹：仅允许「无论文的子树」

定稿规则（前后端都要强制）：

```text
删除 folder F：
  若 F 或其任意后代 folder 中，存在 deleted_at IS NULL 的论文
    → 拒绝，弹窗：「不能删除非空文件夹。请先移出或删除其中的论文。」
  否则
    → 删除 F 及其全部后代 folder（可含空子文件夹）
    → 不删除、不改写任何 papers 行（此时子树内本就没有未删除论文）
```

要点：

- 「非空」= **子树内有未软删论文**，不是「有子文件夹」。
- 仅含空子文件夹的父文件夹 **可以删**，子文件夹一并删掉。
- 软删除论文（在回收站）**不计入**「非空」；其 `folder_id` 可保留，恢复后回到原位置。若仅剩回收站论文挂在某 folder，该 folder 仍可删；删除时对这些已软删论文执行 `folder_id = NULL`（见 §4.3）。
- **禁止** Zotero 式「删 folder 但论文仍在库里、仅解除关系却不提示」——与 Windows「非空目录不能直接删」更接近，也符合你的明确要求。

---



## 1. 当前项目实现分析



### 1.1 存储与资料库结构

PaperNest 采用 **SQLite + 受管文件目录** 的单库扁平模型：

```text
PaperNestLibrary/
├── library.db
├── pdf/originals/     # 所有 PDF：{paperUuid}.pdf（扁平，与分类无关）
├── figures/
├── avatars/
└── backups/
```

- 论文元数据在 `papers` 表；`pdf_path` 存相对路径。
- **不存在** folder 相关表。
- 备份/迁移按整目录 walk；逻辑 folder 纯 DB 变更即可。

相关文件：`src-tauri/src/schema.sql`、`src-tauri/src/lib.rs`。

### 1.2 现有分类与视图体系


| 机制                  | 存储                    | 基数    | 用途       |
| ------------------- | --------------------- | ----- | -------- |
| **主领域 category**    | `papers.category_id`  | 每篇 ≤1 | 学科分类     |
| **子领域 tag**         | `papers.tag_ids_json` | 多选    | 方法/任务    |
| **阅读状态 / 收藏**       | `status` / `favorite` | —     | 工作流      |
| **自定义字段**           | EAV                   | 按定义   | 扩展元数据    |
| **SavedView**       | `saved_views.json`    | 筛选快照  | 动态视图，非容器 |
| **relatedPaperIds** | JSON                  | 版本簇   | 导入去重     |


`filterPapers` 支持：`status`、`categoryId`、`uncategorized`、`missingInfo`、`favorite`。无 tag / folder。

### 1.3 论文库 UI 现状

`LibraryView`：**扁平表格 + 顶部筛选**，无左侧树。

- 选中定位：找不到 `selectedId` 时 reset 为「全部 + 清空筛选」（`LibraryView.tsx`）。
- `PaperTable`：单击选中、双击开 PDF；勾选批量移入回收站。



### 1.4 跨模块跳转中枢


| 状态                        | 作用                 |
| ------------------------- | ------------------ |
| `selectedId`              | 表格选中 + DetailPanel |
| `readerPaper` + `openPdf` | PdfReader overlay  |



| 来源    | 行为                                                            |
| ----- | ------------------------------------------------------------- |
| 写作资料库 | **开 PDF**（`App.tsx` → `WritingLibrary onOpenPaper={openPdf}`） |
| 知识树   | **定位表格**（`setSelectedId` + `setScreen("library")`）            |
| 任务日历  | 仅展示 `paperId`，无跳转                                             |


缺口：跳转不带 folder；加 folder 后 `locatePaper` 必须先切到 `paper.folderId`（或「未归档」）。

### 1.5 PDF 导入

```text
选 PDF → import_pdfs → pdf/originals/{uuid}.pdf → papers
→ 判重 → 封面 → 可选 LLM
```

无目标 folder；快捷键仅 `Ctrl+K` / `Escape`。

### 1.6 知识树

全库非删除论文构图；folder **不改变**图拓扑（V1 不做「仅当前 folder 子图」）。

---



## 2. 是否有必要实现文件夹？



### 2.1 taxonomy 已解决什么

category + tag 回答「研究方向 / 方法是什么」，不回答「属于哪个课题 / 组会清单 / 收件箱」。

### 2.2 SavedView 不能替代 folder

SavedView 是动态筛选，不是显式成员容器；无嵌套、无「导入到此处」、无 Windows 式移动。

### 2.3 决策

**纳入路线图，与 taxonomy 正交。** 多课题并行时收益高；仅 ACM 浏览且库很小可延后。

---



## 3. 开源项目调研（摘要）


| 项目          | 做法                                  | 对本项目                                                |
| ----------- | ----------------------------------- | --------------------------------------------------- |
| **Zotero**  | 多对多 collection；删 collection 不删 item | 数据解耦 PDF 路径可借鉴；**membership 模型不采用**（与 Windows 心智冲突） |
| **Calibre** | 库内禁止用户文件夹；Virtual Library + tag     | **禁止**把 `pdf/originals` 改成按 folder 建物理目录            |
| **JabRef**  | ExplicitGroup ≈ 手动组                 | V1 只做显式单归属；动态组用 SavedView                           |


文献管理器常允许多 collection；你要的是 **文件管理器式位置**，故 PaperNest 选单 `folder_id`。跨切面标签继续用 tag。

---



## 4. 推荐设计方案（PaperNest）



### 4.1 概念定义

```text
Folder              = 可嵌套逻辑容器（课题 / 项目位置）
papers.folder_id    = 每篇至多一个 folder；NULL = 未归档
Category / Tag      = 不变
SavedView           = 属性筛选；可可选保存 folderId
PDF 路径            = 始终 pdf/originals/{id}.pdf
「移动论文」         = UPDATE papers.folder_id
「删除文件夹」       = 仅空子树（无未删除论文）可删
```



### 4.2 数据库草案（schema_version → 5）

```sql
CREATE TABLE folders (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  parent_id TEXT REFERENCES folders(id) ON DELETE CASCADE,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_folders_parent ON folders(parent_id, position);

-- 单归属：挂在 papers 上，与 category_id 同模式
ALTER TABLE papers ADD COLUMN folder_id TEXT REFERENCES folders(id) ON DELETE SET NULL;
CREATE INDEX idx_papers_folder ON papers(folder_id);
```

说明：

- **不用** `paper_folders` junction。
- `folders.parent_id ON DELETE CASCADE`：删父时一并删空子树（仅在「可删」校验通过后执行）。
- `papers.folder_id ON DELETE SET NULL`：兜底；正常路径在删 folder 前已保证无未删除论文，仅软删论文可能被 SET NULL。
- 同级重名：V1 **允许**（与 Windows 默认不同，但避免阻塞；若产品要唯一，再加 `(parent_id, name)` UNIQUE，注意 SQLite 下多个 `parent_id NULL` 的 UNIQUE 行为）。



### 4.3 删除文件夹：算法与 UI

**判定「可删」**（Rust 与前端双重校验，以后端为准）：

```text
function can_delete_folder(folder_id) -> Result<(), String>:
  subtree = folder_id 及全部后代 id
  if EXISTS paper WHERE folder_id IN subtree AND deleted_at IS NULL:
    return Err("不能删除非空文件夹。请先移出或删除其中的论文。")
  Ok(())
```

**执行删除**：

```text
1. can_delete_folder
2. 对该子树内仍挂着的软删论文：UPDATE folder_id = NULL（避免悬空语义，虽有 ON DELETE SET NULL）
3. DELETE FROM folders WHERE id IN subtree  -- CASCADE 子行亦可从根删
4. 若当前 UI 选中的 folder 在被删集合内 → 切到「全部论文」
```

**UI**：

- 右键「删除」→ 先本地/后端检查。
- 非空：`confirm` 或 Modal：**仅提示不能删**，不提供「强制删除并移出论文」入口（V1 保持简单；移出用剪切）。
- 可删且含空子文件夹：确认文案如「将删除该文件夹及其 N 个空子文件夹。其中没有论文。」



### 4.4 类型与快照

```ts
interface Folder {
  id: Id;
  name: string;
  parentId?: Id;
  position: number;
  createdAt: string;
  updatedAt: string;
}

// Paper 增加
folderId?: Id;

// LibrarySnapshot 增加
folders: Folder[];

// SavedView.filter 可选
folderId?: Id;       // 精确匹配该 folder（不含子孙，见 4.6）
unfiledOnly?: boolean;
```

不再需要 `PaperFolder`、`includeSubfolders`（V1）、`set_paper_folders` 多值 API。

### 4.5 Rust 命令（最小集）


| 命令                      | 职责                                                  |
| ----------------------- | --------------------------------------------------- |
| `save_folder`           | 新建 / 重命名 / 改 `parent_id`（**环检测**：新 parent 不能是自己或后代） |
| `delete_folder`         | 按 §4.3：非空拒绝；空子树级联删                                  |
| `move_papers_to_folder` | 批量设置 `folder_id`（目标可为 `null`=未归档）；不可移到已软删论文以外的非法 id |
| `import_pdfs`           | 可选 `folder_id`；校验 folder 存在后写入                      |


`save_paper` 若带 `folderId`，同样校验 folder 存在。

### 4.6 UI 信息架构

```text
论文库
├── 左侧 FolderTree（可折叠）
│   ├── 全部论文（虚拟，folderFilter=null）
│   ├── 未归档（虚拟，folder_id IS NULL）
│   └── 用户 folder 树
│         右键：新建子文件夹 / 重命名 / 删除
├── 主区
│   ├── Breadcrumb
│   ├── 现有工具栏（SavedView / 状态 / 领域）
│   └── PaperTable（仅当前 folder 的直接论文）
└── DetailPanel
      显示「所在位置」面包屑（单路径）；提供「移动到…」
```

**V1 不做** 内容区混合显示「子文件夹行 + 论文行」（完整资源管理器）。文件夹只在左侧树操作；与现有 `PaperTable` 改动最小。若后续要 Windows 式内容区双栏，列为 P2。

**父 folder 是否显示子 folder 内论文**：V1 **否**（对齐资源管理器：进入子目录才看到其文件）。表格 = `paper.folderId === currentFolderId`。虚拟「全部」= 不按 folder 过滤。

### 4.7 移动论文


| 方式                  | 行为                                                                                                                 |
| ------------------- | ------------------------------------------------------------------------------------------------------------------ |
| **Ctrl+X / Ctrl+V** | X：记下 `clipboardPaperIds`；V：把它们的 `folder_id` 设为**当前选中真实 folder**，或在「未归档」视图下设为 `NULL`。不可粘贴到「全部论文」→ 提示「请先选中目标文件夹或未归档」 |
| **拖拽**              | 表格行 → 左侧 tree 节点（真实 folder 或未归档）                                                                                   |
| **右键 / 批量栏**        | 「移动到…」folder picker                                                                                                |
| **详情**              | 「移动到…」                                                                                                             |


约束：

- 仅 `screen === "library"` 且 focus 不在 `input`/`textarea` 时处理 Ctrl+X/V。
- 阅读台打开时不抢快捷键。
- 无「Shift+V 复制到另一 folder」（单归属下不存在复制位置）。



### 4.8 导入时 folder

- 默认：当前选中的**真实 folder**；若当前是「全部」或「未归档」→ `folder_id = NULL`。
- UI：导入前可用 tree picker 覆盖默认。
- `import_pdfs(paths, folder_id?)` 事务内写入。



### 4.9 其它逻辑边界（审核补充）


| 场景                       | 定稿行为                                                            |
| ------------------------ | --------------------------------------------------------------- |
| 论文移入回收站                  | **保留** `folder_id`；恢复后仍在原 folder（若 folder 已删，则因 SET NULL 变为未归档） |
| 永久删除论文                   | `ON DELETE` 随 papers 行删除；folder 不受影响                            |
| 删除非空 folder              | 拒绝；用户须先剪切论文到别处或进回收站                                             |
| 将 folder 拖到自己的子 folder 下 | `save_folder` 环检测拒绝                                             |
| 当前选中 folder 被删           | UI 切到「全部论文」                                                     |
| 新建论文（PaperEditor）        | V1：写入当前选中 folder（与导入一致）；编辑器可不展示 folder 字段                       |
| SavedView 保存了已删 folderId | 打开时视为无效，回退「全部」并提示                                               |
| 软删论文仍占 folder 时删 folder  | 允许删 folder；软删论文 `folder_id` 置空                                  |
| 知识树 / 写作库                | 见 §0.2；写作库**不**改 folder 上下文                                     |
| FTS                      | V1 不索引 folder 名                                                 |
| 备份                       | 新列/新表随 DB；路径不变                                                  |


---



## 5. 对现有功能的影响矩阵


| 功能                       | 影响        | 调整                                              |
| ------------------------ | --------- | ----------------------------------------------- |
| PDF / Bib 导入             | 中         | 可选 `folder_id`；默认跟当前 tree 选中                    |
| LibraryView              | 高         | 左侧树；`filterPapers` 增 `folderId` / `unfiledOnly` |
| 选中定位                     | 高         | `locatePaper`：切 folder → 选中 → scrollIntoView    |
| 写作资料库                    | **无行为变更** | 继续 `openPdf`；不强制进 folder                        |
| 知识树                      | 中         | 改为 `locatePaper(id)`                            |
| DetailPanel              | 低         | 位置面包屑 + 移动                                      |
| PaperTable               | 低         | 可选「文件夹」列；批量「移动到」                                |
| 回收站                      | 低         | 保留 `folder_id`；folder 已删则恢复为未归档                 |
| 快捷键                      | 中         | Ctrl+X/V 仅库内                                    |
| 知识树构图 / Crossref / 自定义字段 | 无         | —                                               |




### 5.1 统一导航 API

```ts
function locatePaper(paperId: string) {
  const paper = data.papers.find(p => p.id === paperId && !p.deletedAt);
  if (!paper) return;
  setFolderSelection(paper.folderId ? { kind: "folder", id: paper.folderId } : { kind: "unfiled" });
  setSearch("");
  setSelectedId(paperId);
  setScreen("library");
}

// 写作库：保持
onOpenPaper={openPdf}

// 知识树：
onOpenPaper={paper => locatePaper(paper.id)}
```



### 5.2 LibraryView 定位

1. 外部 `locatePaper` 已设好 folder 选中。
2. 若当前筛选（状态/领域）仍藏住该行 → 清空属性筛选，**保留** folder 选中。
3. 仍不可见（例如论文已删）→ 不 silent 乱跳；可短提示。

---



## 6. 分阶段实施计划



### 阶段 0：产品定稿 — **已完成（本文 §0）**

- [x] 单 folder（`papers.folder_id`）
- [x] 写作库继续开 PDF；知识树 `locatePaper`
- [x] 删除：仅空子树（无未删除论文）；非空弹窗拒绝



### 阶段 1：数据层（1–2 天）

- [x] schema v5：`folders` + `papers.folder_id`
- [x] `save_folder` / `delete_folder`（含空校验）/ `move_papers_to_folder`
- [x] snapshot 加载 `folders`；`Paper.folderId`
- [x] 验收：环检测；非空删失败；空父+空子可删；软删论文不挡删



### 阶段 2：只读树 + 筛选（2–3 天）

- [x] `FolderTree`：全部 / 未归档 / 用户树；计数（仅未删除论文）
- [x] `filterPapers` + breadcrumb
- [x] 验收：与状态/领域 AND；父目录不列出子目录论文



### 阶段 3：Folder CRUD（1–2 天）

- [x] 新建 / 重命名 / 删除（§4.3 文案与确认）
- [x] 改 parent（环检测；V1 通过新建子文件夹）
- [x] 验收：深层嵌套；删当前选中后回「全部」



### 阶段 4：论文移动与导入（2–3 天）

- [x] 导入默认 folder（当前选中）
- [x] Ctrl+X/V、拖拽、批量「移动到」
- [x] DetailPanel 位置展示
- [x] 验收：移动不改 PDF 路径；粘贴到「全部」被拒绝



### 阶段 5：跨模块定位（1 天）

- [x] `locatePaper`；知识树接入
- [x] `LibraryView.locate.test.tsx` 覆盖
- [x] 验收：写作库开 PDF 回归不变



### 阶段 6：文档（0.5 天）

- [x] `DEVELOPMENT.md`、`CHANGELOG.md`、`README.md`
- [x] SavedView.filter 已支持 `folderId` / `unfiledOnly`（保存当前视图时写入）

**实现版本**：0.1.86（2026-08-25）。

---



## 7. 风险与权衡


| 风险                       | 缓解                        |
| ------------------------ | ------------------------- |
| 单归属不如 Zotero 灵活          | 跨课题用 tag / SavedView；文档写明 |
| 非空不可删显得「麻烦」              | 符合你的要求与 Windows 习惯；剪切即可腾空 |
| 左侧树 + 表不如资源管理器「内容区也有文件夹」 | V1 接受；P2 再做混合列表           |
| Ctrl+X 冲突                | 限定 library + 非输入焦点        |
| 期望物理目录                   | 文档写明 logical only         |
| 误删空目录树                   | 确认框列出将删的空子文件夹数量           |


---



## 8. 验收标准

1. 可创建任意深度 folder，重命名；**仅空子树可删**；非空有明确弹窗且 folder 仍在。
2. 父下仅有空子 folder、无未删除论文时，删除父成功，子 folder 一并消失。
3. 每篇论文至多一个 `folder_id`；移动 = 更新该字段；PDF 路径不变。
4. 导入可进当前 folder；「全部/未归档」下导入 → 未归档。
5. 左侧选中 folder 后表格只显示该 folder **直接**论文。
6. Ctrl+X → 选目标 folder → Ctrl+V 成功；对「全部」粘贴失败并提示。
7. 知识树定位：打开对应 folder（或未归档），行选中且可见。
8. 写作库点击来源：**仍直接开 PDF 到页**，与加 folder 前一致。
9. 备份恢复后 folder 树与 `folder_id` 完整。
10. taxonomy / Crossref / 知识树全库构图无回归。

---



## 9. 替代方案（若不做 folder）


| 方案           | 缺点             |
| ------------ | -------------- |
| 增强 SavedView | 无树、无导入容器、无剪切移动 |
| 自定义字段「课题」    | 无层级            |
| 导出时写物理目录     | 不解决库内浏览        |


---



## 10. 参考资料

- [Zotero Collections and Tags](https://www.zotero.org/support/collections_and_tags)
- [Zotero userdata.sql](https://github.com/zotero/zotero/blob/main/resource/schema/userdata.sql)
- [Calibre Virtual libraries](https://manual.calibre-ebook.com/virtual_libraries.html)
- [JabRef Groups](https://docs.jabref.org/finding-sorting-and-cleaning-entries/groups)
- 项目：[开发文档](../DEVELOPMENT.md)、[元数据扩展评估](./metadata-and-extension-assessment.md)

---



## 附录 A：代码锚点


| 主题        | 路径                                           |
| --------- | -------------------------------------------- |
| DB schema | `src-tauri/src/schema.sql`                   |
| 快照 / 导入   | `src-tauri/src/lib.rs`                       |
| 类型        | `src/types.ts`                               |
| 筛选        | `src/lib/search.ts`                          |
| 论文库       | `src/components/LibraryView.tsx`             |
| 导航        | `src/App.tsx`（写作库 L108 / 知识树 L109）           |
| 写作库       | `src/components/WritingLibrary.tsx`          |
| 定位测试      | `src/components/LibraryView.locate.test.tsx` |




## 附录 B：相对 2026-08-24 初稿的修正清单


| 项          | 初稿                         | 现稿                       |
| ---------- | -------------------------- | ------------------------ |
| membership | 多对多 `paper_folders`        | **单** `papers.folder_id` |
| 删 folder   | 级联删 folder，论文保留、仅解绑        | **非空拒绝**；仅空子树可删          |
| 写作库        | 待确认 / 双按钮                  | **维持 openPdf**           |
| 定位歧义       | 多 folder 需启发式              | 单 `folderId` / 未归档       |
| Ctrl+V     | 默认移动 + Shift 复制 membership | **仅移动**；不可贴到「全部」         |
| 父目录列子项论文   | Zotero 可选                  | V1 **不列**（进子目录才看见）       |
| 阶段 0       | 待确认三项                      | **已定稿**                  |



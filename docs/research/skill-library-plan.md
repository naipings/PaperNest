# Skill 库 实现计划

PaperNest 维护一份独立的 Agent Skill 库：从本地目录或 GitHub 仓库导入 skill，复制到资料库自行管理；按上游 GitHub 仓库检查更新；论文精读「追问」时由模型按描述自动选用 skill。

## 1. 已确认决策

| 决策 | 内容 |
|------|------|
| 使用方式 | 追问时自动选用：系统提示列出已启用 skill 的名称与描述，模型按需调用工具读取 SKILL.md 及其引用文件（渐进式加载） |
| 存储 | 文件放 `PaperNestLibrary/skills/<目录名>/`，来源、版本、启用状态存 `library.db` 的 `skills` 表；随资料库完整备份 |
| 首批内容 | 从 `~/.cursor/skills` 精选导入 14 个 skill 与其依赖的 3 个共享目录（见 §7） |
| 含脚本的 skill | 允许导入，标注「含脚本，PaperNest 不执行」；模型只读取文字 |
| 更新策略 | 先列出新增/删除/修改的文件，确认后覆盖；旧版本移到 `skills/.backup/<目录名>-<时间戳>/` |

## 2. 参考实现

| 项目 | 借鉴点 |
|------|--------|
| [vercel-labs/skills](https://github.com/vercel-labs/skills)（`npx skills`） | lock 记录 `source`、`skillPath`、`skillFolderHash`；`skillFolderHash` 取 GitHub Trees API 中 skill 目录的 tree SHA，检查更新时一次请求取整仓树、逐个比对目录 SHA；`GITHUB_TOKEN` 可选 |
| Skill Link | 记录仓库、路径、引用；更新前备份；可把本地 skill 关联到 GitHub 来源 |
| skills-manage（Tauri） | 中央库目录 + 数据库元数据，界面上按单个/全部导入、更新、删除 |
| [Agent Skills 规范](https://agentskills.io/specification) | frontmatter：`name`、`description` 必填，`license`、`compatibility`、`metadata`、`allowed-tools` 可选；渐进式加载：元数据 → SKILL.md → 引用文件 |

## 3. 存储与数据表

目录平铺：`skills/<目录名>/`。部分 skill 用 `../nature-shared/`、`../ccf-common/` 引用同级共享目录，平铺后相对路径照常解析。目录名全库唯一，导入同名目录时拒绝并显示已有来源。

```sql
CREATE TABLE IF NOT EXISTS skills (
  dir TEXT PRIMARY KEY,                -- skills/ 下的目录名
  name TEXT NOT NULL,                  -- frontmatter name；共享目录取目录名
  description TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL CHECK(kind IN ('skill','shared')),  -- 无 SKILL.md 的共享目录为 shared
  license TEXT,
  has_scripts INTEGER NOT NULL DEFAULT 0,
  enabled INTEGER NOT NULL DEFAULT 1,
  requires_json TEXT NOT NULL DEFAULT '[]',  -- 依赖的同级目录名
  source_repo TEXT,                    -- owner/repo；NULL 表示未关联
  source_path TEXT,                    -- 仓库内目录路径
  tree_sha TEXT,                       -- 本地内容对应的上游目录 tree SHA；本地与上游不一致时为 NULL
  latest_tree_sha TEXT,                -- 最近一次检查到的上游目录 SHA；上游已删除该目录时为 NULL
  checked_at TEXT,
  installed_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

状态由后端计算：未关联（`source_repo` 为空）、未检查（`checked_at` 为空）、已最新（`tree_sha = latest_tree_sha`）、有更新（两者不等）、上游已删除（已检查且 `latest_tree_sha` 为空）。

## 4. 后端（`src-tauri/src/skills.rs`）

### 4.1 本地导入

```text
skills_scan_local(root)
  列出 root 下含 SKILL.md 的子目录：目录名、frontmatter、是否含脚本、依赖、是否已在库中
  读取 root/_installed-from-repos.json 的 repos（去掉 " (…)" 版本后缀）作为候选来源仓库
skills_import_local(root, dirs)
  dirs 与其传递依赖一起复制到 skills/，写入 skills 表
```

- frontmatter 用 `serde_yaml` 解析，取 `name`、`description`、`license`。
- 脚本判定：目录内存在 `.py .sh .js .mjs .cjs .ts .ps1 .bat .cmd .rb .pl` 文件。
- 依赖解析：扫描 `.md .yaml .yml .json .txt` 文件中的 `../<目录>/` 片段，相对**引用它的文件**解析；落在 skill 目录之外、且是 root 下同级目录的，记为依赖。`references/` 里的 `../scripts` 指向本 skill 内部，不算依赖。

### 4.2 来源关联

```text
skills_link_sources(repos, dirs?)
  每个仓库调用一次 Trees API：GET /repos/{owner}/{repo}/git/trees/HEAD?recursive=1
  按目录名找到仓库中的同名目录，逐文件比对 blob SHA
  全部一致：记录 source_repo/source_path，tree_sha = latest_tree_sha = 该目录 tree SHA
  存在差异：记录来源，tree_sha = NULL（界面显示「与上游不同」，可更新为上游版本）
```

- blob SHA = `sha1("blob <字节数>\0" + 内容)`。本地文件先按原字节比对，不一致再把 CRLF 转 LF 比对，兼容 Windows 下 git 检出的换行转换。
- 未自动关联的 skill 可在界面手动填写 `owner/repo` 关联。

### 4.3 GitHub 导入

```text
skills_scan_github(source)      source 为 owner/repo 或仓库 URL；返回仓库中含 SKILL.md 的目录
skills_import_github(repo, paths)
  按 tree 下载各文件：raw.githubusercontent.com/{owner}/{repo}/{commit}/{path}
  逐文件校验 blob SHA，与 tree 一致才写入
  依赖解析同 4.1，在仓库中取同级目录一并导入
```

### 4.4 检查更新、差异、更新、删除

```text
skills_check_updates(dirs?)   每个来源仓库一次 tree 请求，写 latest_tree_sha、checked_at
skills_diff(dir)              对比本地与上游：新增 / 删除 / 修改的文件
skills_update(dirs)           下载到 skills/.staging/<dir> 并校验 → 旧目录移到 skills/.backup/<dir>-<时间戳>/ → 新目录就位 → 更新表；新出现的依赖从同仓库导入
skills_delete(dirs)           删除目录与记录；界面先列出依赖它的 skill 供确认
skills_set_enabled(dir, enabled)
```

- GitHub 未认证限额 60 次/小时。检查更新按仓库计请求，14 个 skill 来自 3 个仓库只需 3 次。可在页面保存 GitHub Token（`keyring` 条目 `PaperNest/github_token`），请求带 `Authorization: Bearer`。
- 网络或 GitHub 返回错误时，命令直接报错并显示原因。

## 5. 追问接入（`deepread_ask`）

存在已启用的 skill 时：

1. 系统提示追加「可用 skill」清单（名称 + 描述），说明先调用 `load_skill` 读说明、再按需 `read_skill_file` 读引用文件；脚本不可执行，只参考文字。
2. 工具：
   - `load_skill(name)`：返回 SKILL.md 全文与该 skill 的文件清单（脚本文件标注不可执行）。
   - `read_skill_file(name, path)`：读取 skill 目录内文本文件，`path` 可以是 `../<依赖目录>/…`，解析后必须位于 `skills/` 内；单次最多 40,000 字符。
3. 用 `research_llm_with_tools` 跑工具循环，最多 8 轮；第 8 轮仍在调用工具则报错。
4. 回答消息记录本轮读取过的 skill（`PaperExplainMessage.skills`），追问界面在回答下方显示。

无已启用 skill 时保持现有单次调用。

## 6. 前端

- 侧栏新增「Skill 库」页（`src/components/SkillLibraryView.tsx`）：
  - 列表：名称、描述、类型、来源、状态、含脚本标记、启用开关；
  - 工具栏：从本地导入、从 GitHub 导入、检查全部更新、全部更新、GitHub Token；
  - 单项操作：查看 SKILL.md、差异与更新、关联来源、打开目录、删除；
  - 多选后批量删除。
- 本地导入对话框：选择文件夹 → 勾选 skill → 显示将一并导入的依赖与候选来源仓库 → 导入并自动关联来源。
- GitHub 导入对话框：输入仓库 → 勾选 skill → 导入。
- 追问消息下方显示「使用 skill：…」。

## 7. 首批导入

来源 `C:\Users\A1398\.cursor\skills`：

| 类别 | skill |
|------|------|
| 精读与审稿 | nature-reader、nature-paper-card、nature-reviewer、ccf-paper-reviewer、ccf-idea-reviewer |
| 论证核查 | paper-claim-audit、citation-audit、formula-derivation、proof-checker、kill-argument、novelty-check |
| 实验与图表 | experiment-audit、figure-description、analyze-results |
| 共享目录（依赖） | nature-shared、ccf-common、shared-references |

## 8. 测试

Rust 单元测试：frontmatter 解析、blob SHA（含 CRLF 归一）、依赖解析、读取路径限制在 `skills/` 内、GitHub 地址解析、本地/上游差异计算。桌面端验证：通过界面完成 §7 导入、来源关联、检查更新，并在追问中触发 skill。

## 9. 实施阶段

| 阶段 | 内容 |
|------|------|
| 1 | `skills.rs` 存储、导入、关联、更新、删除与单元测试 |
| 2 | Skill 库页面 |
| 3 | `deepread_ask` 工具循环与追问界面 |
| 4 | 桌面端完成首批导入与更新检查 |
| 5 | 文档同步，版本 0.2.52，构建发布 |

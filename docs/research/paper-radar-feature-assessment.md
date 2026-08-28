# PaperNest「论文雷达」功能评估与实施计划

> 调研日期：2026-08-27；修订：2026-08-27（产品定位：元数据发现层 / PDF 按需入库 / 双层启动保护 / 稀疏使用与空池降级）。  
> 对照：本仓库 PaperNest（Tauri 2 + React + SQLite 本地资料库）与开源项目 [baballuo/Paper-Radar](https://github.com/baballuo/Paper-Radar)（小红书介绍：[开源我的新工作 daily paper read](https://www.xiaohongshu.com/explore/6a8ea720000000002303eb2f)）。  
> 另参考：arxiv-radar、research-radar、arxiv-inbox、little-alphaxiv、alphaxiv-py / alphaxiv-skill、HuggingFace Daily Papers；推荐空结果与冷启动行业实践（RecSys empty-candidates runbook、cold-start / never-return-zero cascade）。  
> **实施状态**：V1 + 兴趣过滤 + 仅元数据入库 + embedding rerank + **本地 BGE 向量（0.2.3）** 已落地；Phase 6（Agent）留后续。§0 定稿仍有效。



## 结论摘要


| 问题                       | 结论                                                                                     |
| ------------------------ | -------------------------------------------------------------------------------------- |
| 有必要在 PaperNest 做「论文雷达」吗？ | **有条件有必要**：补齐「发现 → 入库 → 精读」闭环；默认关闭；与现有本地资料库解耦                                          |
| 每日推荐要不要下 PDF？            | **默认不下**：雷达只存元数据与榜单快照；**仅「加入论文库」时**下载 PDF 到 `pdf/originals` 并长久保存。临时 PDF 缓存方案作备选，V1 不做 |
| 何时联网采集？                  | **双层启动保护**：① 设置页启用；② 雷达页用户点击「推荐今日论文」后才采集。进入界面默认不请求、不后台定时                               |
| 是否整仓复用 Paper-Radar？      | **否**：复用数据模型、管道阶段、降级哲学；Rust/TS 重写。上游未见明确 LICENSE，默认思路复用、代码自研                           |
| 趋势综述遇「一周用不了 7 天」？        | **滚动窗口 + 有数才算**：周综述/周热点只聚合窗口内**已有快照**的日期；UI 标明「覆盖 N 个采集日」；不要求天天打开                      |
| 「为你推荐」30 天候选池为空？         | **分级降级 cascade**：引导今日采集 → 放宽窗口 → 退回双榜单热度/新稿 → 明示策略标签；禁止空白死页                            |
| 「关键词过滤后仍漏新论文？」 | **会**：旧方案关键词只滤已快照集合。定稿改为 **三路召回（§7.7）**：Hot ∪ 加宽 New ∪ Interest 查询 |


---



## 0. 产品定稿（本轮已确认方向）


| 编号  | 议题          | 定稿                              | 说明                                          |
| --- | ----------- | ------------------------------- | ------------------------------------------- |
| D1  | 侧栏入口名       | **论文雷达**（Screen=`radar`）        | —                                           |
| D2  | 存储形态        | **独立** `radar.db`               | 不进 `LibrarySnapshot`                        |
| D3  | 设置层开关       | **默认关闭**                        | 对齐 Crossref                                 |
| D4  | 采集触发        | **双层保护：设置启用 + 页内「推荐今日论文」按钮**    | **取消**启动空闲自动抓取 / 系统定时；进入雷达页先展示空态或上次结果，不隐式联网 |
| D5  | alphaxiv 路径 | **HTTP API 优先**                 | 不捆绑 Playwright                              |
| D6  | Agent       | **V2**                          | V1 先双榜+入库+综述+推荐                             |
| D7  | 备份          | 默认**包含** `radar.db` 元数据         | 体积小（无批量 PDF）；可设置排除                          |
| D8  | PDF 落盘      | **A：发现期零 PDF**                  | 见 §1；备选 B（临时 PDF）延后                         |
| D9  | 周/趋势时间语义    | **日历滚动窗口 ∪ 实际快照日**              | 见 §6                                        |
| D10 | 推荐空池        | **cascade + 策略标签**              | 见 §7                                        |
| D11 | 兴趣过滤 vs 采集  | **修订为三路召回（见 §7.7）** | V1.1 曾定「广采+展示过滤」；实测遗漏来自「Hot Top-N ∪ New 最新 N」池太窄，关键词无法找回未入库稿 |
| D12 | 关键词 vs 语义近义 | **子串过滤 + embedding rerank** | §7.5 / §7.6 |
| D14 | 雷达入库 LLM     | **同 PDF 导入开关；向空字段写入**   | 有 PDF 用全文，否则标题+摘要；保留已有字段 |
| D15 | 单篇解读时延/质量 | **完整结构化；方法多段详析** | 方法 3 段 450–650 字；UI 不展英文摘要；配图延后 |
| D16 | 榜单信息架构     | **四榜保留 + 来源写全** | Hot=alphaxiv；New=arXiv；Interest=关键词召回；Recommend=排序层非新采集 |


**定稿一句话**：雷达是「用户主动拉起的外网发现层」——元数据可暂存，PDF 只在入库时永久落入资料库；关设置或未点按钮则零外网。**防遗漏靠多路召回；兴趣收窄主要在排序/展示，关键词另开 Interest 召回路补漏。**

---



## 1. 产品定位：发现层 vs 精读层



### 1.1 两层模型

```text
┌─ 发现层（radar.db）──────────────────────────────────────┐
│  双榜单元数据、快照、用户稍后读/隐藏、综述缓存、解读缓存   │
│  无 PDF 文件（V1）                                        │
│  触发：设置 ON ∧ 用户点击「推荐今日论文」                 │
└──────────────────────────┬───────────────────────────────┘
                           │ 用户「加入论文库」
                           ▼
┌─ 精读层（library.db + pdf/originals）────────────────────┐
│  现有 Paper / 批注 / 术语 / 写作库 / 知识树 / 任务         │
│  PDF 长久保存；备份与回收站语义不变                        │
└──────────────────────────────────────────────────────────┘
```

差异化相对独立 Paper-Radar：发现与精读在同一桌面壳内闭环，但**磁盘与资料库不被每日榜单污染**。

### 1.2 PDF 策略：方案 A vs 方案 B

你提出两种可行定位，对比如下。


|       | **A. 发现期不下 PDF（定稿）**                  | **B. 临时 PDF，次日清理未入库**                             |
| ----- | ------------------------------------- | ------------------------------------------------- |
| 行为    | 卡片只展示标题/摘要/热度；「打开原文」走系统浏览器；加入库时再下 PDF | 采集后预下载到 `radar/cache/pdf/`；未入库者在下一次「推荐今日」或跨日清理时删除 |
| 磁盘    | 几乎只有 SQLite 元数据                       | 每日几十～上百 PDF，清理逻辑必须可靠                              |
| 离线预览  | 无（可外链浏览器）                             | 有，但桌面场景收益有限（通常有网才点推荐）                             |
| 与现网对齐 | 与「导入才进 `pdf/originals`」一致             | 多一套临时目录与生命周期，易与备份/杀软纠缠                            |
| 失败面   | 入库时下载失败再提示重试                          | 批量下载失败、半文件、清理误删                                   |
| 复杂度   | 低                                     | 中高（跨日任务、占用上限、与 D4「无后台」冲突：清理仍可点按时做）                |


**定稿选 A。** 理由：PaperNest 的本地价值在精读资产；发现层用元数据足够做双榜、综述、推荐排序。临时 PDF（B）仅在出现明确痛点（例如频繁「想先翻两页再决定是否入库」且外链体验差）时再开 V2 开关，默认仍关。

V1「加入论文库」默认行为：

1. 判重（复用现有逻辑）
2. 写入 `papers` 元数据
3. **下载** `https://arxiv.org/pdf/{id}.pdf` → `pdf/originals`（可勾选「仅加入元数据、稍后再下」）
4. 可选 LLM 整理 / taxonomy
5. `locatePaper` 进入论文库



### 1.3 双层启动保护（相对 Paper-Radar 的关键差异）

Paper-Radar 是服务端 cron **每天自动**灌 `trending.db`。PaperNest 是个人桌面，应对齐你已有的「在线能力默认关 + 用户显式触发」纪律（Crossref）。

```text
层 1  设置 → 论文雷达 → [启用]
        │ false：侧栏可灰显或进页提示去设置；一切 radar_* 联网命令直接拒绝
        ▼ true
层 2  雷达页默认态
        │ 展示：上次快照（若有）/ 空态文案 / 不发起网络
        │ 主按钮：「推荐今日论文」
        ▼ 用户点击
      采集管道（alphaxiv + arXiv）→ 写入当日快照 → 刷新双榜 / 可点生成综述与推荐
```


| 场景         | 行为                                         |
| ---------- | ------------------------------------------ |
| 设置关        | 无请求；无后台                                    |
| 设置开、进页未点按钮 | 只读本地 `radar.db`；可浏览历史采集日                   |
| 设置开、点击按钮   | 才抓取；按钮禁用至结束；进度条；部分源失败不整页作废                 |
| 同日再次点击     | 幂等刷新（`INSERT OR IGNORE` 快照）；可提示「将覆盖/更新今日榜」 |


**明确不做**：应用启动静默抓取、Windows 任务计划、进页自动 recommend。

---



## 2. 是否有必要实现？



### 2.1 PaperNest 今天解决什么、缺什么


| 已有能力                  | 对「追新」的含义        |
| --------------------- | --------------- |
| PDF/Bib/RIS 导入、判重、文件夹 | 管**已经到手**的论文    |
| 阅读台批注、术语、写作库          | 管**精读沉淀**       |
| 本地知识树（L1 BM25+TF-IDF） | 在**已入库**集合里找关系  |
| Crossref / LLM        | **按需**补元数据与整理   |
| 任务日历、阅读打卡             | 管计划与习惯，不产生新文献来源 |


**缺口**：没有「主动、可控地」把 alphaxiv 热点与 arXiv 新稿拉到眼前的发现层。

### 2.2 做进 PaperNest 的独特价值

```text
点「推荐今日论文」→ 双榜浏览 / 综述 / 推荐 → 感兴趣则「加入论文库」（此刻才下 PDF）
→ 阅读台精读 → 术语 / 写作 / 知识树
```

独立跑 Paper-Radar 仍要二次搬运进本地精读工具；邮件 digest / GitHub Actions 族通常只推送不下沉到批注库。

### 2.3 必要性结论

**有必要**，形态为可选发现栏目 + 双层保护 + 发现期零 PDF。成功标准见 §9。

---



## 3. PaperNest 实现锚点（影响面）



### 3.1 导航

- 新增 `Screen = "radar"`，懒加载 `RadarView`。  
- 设置关时：入口仍可进，但主区引导去设置（或隐藏入口——推荐**保留入口 + 引导**，避免「找不到功能」）。



### 3.2 数据

- `initialize_library` **不读** `radar.db`。  
- 雷达候选 **永不**自动插入 `papers`。  
- `radar.db` 仅元数据/缓存文本；`pdf/originals` 只在入库路径增长。



### 3.3 联网先例（必须对齐）


| 能力                  | 纪律 → 雷达                  |
| ------------------- | ------------------------ |
| Crossref            | 默认关 + 显式触发 → **设置 + 按钮** |
| LLM                 | 共用设置；综述/解读失败不挡资料库        |
| `open_external_url` | 发现期看全文                   |
| Rust `reqwest`      | 全部外网经后端                  |




### 3.4 栈差异（不可照搬）

Paper-Radar：Docker + cron + Playwright + 多用户。  
PaperNest：单进程 Tauri；**无 cron**；采集=按钮；PDF 策略更严。

---



## 4. Paper-Radar 可复用资产

> 上游 LICENSE 未明示时：**不复制源码**；重写算法与 schema 思路。



### 4.1 建议引入的子功能（按优先级）


| 子功能                | 引入？       | PaperNest 调整                                     |
| ------------------ | --------- | ------------------------------------------------ |
| 双榜单（Hot + New）     | **V1 必做** | 点按采集；元数据 only                                    |
| 日历回看 + 周热点 SQL     | **V1**    | 日历只亮「有快照的日」；周聚合见 §6                              |
| 趋势综述（日/周）          | **V1**    | 滚动窗口；稀疏日可用；手动「生成综述」省 Token                       |
| 单篇 AI 解读           | **V1**    | 按需 LLM；可选 alphaxiv overview API；结果缓存在 `radar.db` |
| 为你推荐               | **已实现**   | 规则 cascade + 兴趣过滤 + 可选 embedding rerank          |
| 稍后读 / 隐藏           | **V1**    | 单用户表                                             |
| 科研 Agent           | **V2**    | 写操作审批                                            |
| Playwright / 多用户账号 | **不做**    | —                                                |




### 4.2 设计级复用


| 模块                   | 复用点                                              |
| -------------------- | ------------------------------------------------ |
| `cli.py` 管道阶段        | `fetch → enrich → commit →（可选）digest`；单源失败不回滚另一源 |
| `snapshots`          | `(date, arxiv_id, feed)` 幂等                      |
| `recommendations.py` | 请求路径不打 embedding API；无向量则 rules；冷启动类目封顶          |
| `summarize.py`       | `<2` 篇不生成；无客户端返回 None；聚类+总览                      |




### 4.3 目标表（`radar.db`）

```text
radar_papers          -- arxiv_id 主键；摘要/作者/类目（来自 arXiv API）
radar_ai_summaries    -- alphaxiv tl;dr、标签（可空）
radar_snapshots       -- (snapshot_date, arxiv_id, feed) 榜单位次与 upvotes
radar_digests         -- (anchor_date, kind, window_start, window_end, coverage_days, content)
radar_explanations    -- 单篇解读缓存
radar_run_log         -- 每次按钮触发的运行日志
radar_user_state      -- later / hidden / opened_at（无多用户）
radar_settings        -- enabled、订阅 cs.*、保留天数、联系邮箱引用
```

**没有** `radar_pdf_cache`（方案 B 未采纳前不建表）。

---



## 5. 相关开源与行业对照（补充本轮议题）


| 来源                           | 对「稀疏使用 / 空池 / 落盘」的启发                                                               |
| ---------------------------- | ---------------------------------------------------------------------------------- |
| Paper-Radar                  | 服务端天天采，用户稀疏打开仍有 30 天公共池；桌面点按模式下**池子密度由用户点击频率决定**，必须另设降级                            |
| Paper-Radar `WINDOW_DAYS=30` | 候选来自快照窗口；过滤 saved/hidden/read 后可能变空——其 README 强调 rules 降级，但对「窗口内零快照」依赖 cron，我们不能照搬 |
| research-radar / arxiv-inbox | 本地发现库与个人动作分离；无 Key 也能浏览排序结果                                                        |
| RecSys / 业界 cascade          | **发现面禁止长期零结果**：search → relax → popularity → curated；并返回 `strategy` 标签给 UI         |
| cold-start 实践                | 无行为时用热门/订阅类目；有行为后再加重个性化                                                            |


新增实施原则：

1. **发现面永不「死白」**：空池必须落到可理解的下一动作（去点推荐 / 看双榜 / 放宽订阅）。
2. **时间窗口按「有数据的日」解释**，不按「用户打开 App 的日」苛求。
3. **PDF 只服务精读承诺**，不为浏览预取。

---



## 6. 场景适配：趋势综述与「一周用不了 7 天」



### 6.1 问题本质

Paper-Radar 的「周综述」在服务端假设：**几乎每天都有 hot 快照**，再对滚动 7 个日历日做聚类。  
PaperNest 用户可能周一采、周五再采，中间四天空窗——若仍写「本周综述」却只用 2 天数据，会产生**虚假完整感**；若因不足 7 天拒绝生成，又会**惩罚真实使用模式**。

### 6.2 定稿语义


| 产物                  | 时间定义                                   | 最少数据                                  | UI 文案                                    |
| ------------------- | -------------------------------------- | ------------------------------------- | ---------------------------------------- |
| **日综述**             | 某个 `snapshot_date` 当日 Hot（或 Hot∪New）   | ≥2 篇且有 LLM                            | 「2026-08-27 综述」                          |
| **窗口综述**（替代死板「自然周」） | 以锚点日向前滚动 `W` 个日历日（默认 W=7），**只取有快照的日期** | 覆盖采集日 ≥2，论文去重后 ≥4（对齐上游 weekly 量级，可配置） | 「近 7 日趋势（实际覆盖 3 个采集日：08-21、08-24、08-27）」 |
| **周热点 SQL**         | 同上窗口，纯聚合                               | 有 ≥1 个快照日即可出表；不足时显示「数据较少」而非报错         | 上榜天数 = 在快照中出现的天数                         |


**不采用**：要求用户连续 7 天点击；不采用「按自然周 Mon–Sun 且必须满勤」。

### 6.3 算法与缓存

1. 点「推荐今日论文」成功后，可选自动生成**日综述**（设置项默认关，避免烧 Token），或单独按钮「生成本日综述」。
2. 「生成近 7 日趋势」：查询 `snapshots` 在 `[anchor-6, anchor]` 的 distinct dates → `coverage_days` 写入 `radar_digests`。
3. 论文集合：窗口内快照 ∪ 去重；排序仍可用 max(upvotes)、min(rank)。
4. 无 LLM / 篇数不足：隐藏 LLM 综述，**保留 SQL 周热点**（方向分布、持续上榜）。
5. 日历：仅标记有快照的日子；点历史日只读当日榜，不隐式联网。



### 6.4 与双层保护的关系

综述**不单独联网抓榜**；只基于已落库快照。若窗口为空 → CTA：「先点击推荐今日论文」。

---



## 7. 场景适配：「为你推荐」与空候选池



### 7.1 Paper-Radar 基线

- 候选：近 30 日历日快照，排除已处理状态。  
- 无 embedding：rules（类目 + 新鲜度 + 热度）。  
- 冷启动：无偏好/行为时类目多样性封顶。  
- **桌面差异**：无每日 cron 时，「30 天窗口」可能只有 0～几次点击的数据；空池是常态分支，不是罕见事故。



### 7.2 空池的四类原因与对策


| 原因                  | 检测                   | 对策                                                          |
| ------------------- | -------------------- | ----------------------------------------------------------- |
| C1 从未采集             | `snapshots` 为空       | 主 CTA：推荐今日论文；推荐 Tab 显示引导，不假装个性化                             |
| C2 窗口内无快照（很久没点）     | 30 日内 count=0，但更早有数据 | 自动放宽到 60/90 天；仍空则同 C1；UI：`strategy=expanded_window`         |
| C3 有快照但全被过滤（已入库/隐藏） | 原始候选 >0，过滤后 =0       | ① 提示「今日关注的方向已在库中」；② 降级展示未过滤的双榜 Top（标「热度榜·未个性化」）；③ 提供「显示已隐藏」 |
| C4 订阅过窄 + 新稿过少      | 过滤后 < K              | 放宽：忽略订阅限制填满；标 `strategy=relaxed_subscription`；引导去设置加 cs.*   |




### 7.3 推荐 cascade（定稿）

```text
1. personalized_rules   订阅 ∩ 库内相似 ∩ 热度 ∩ 新鲜度（排除 hidden / 已入库可选）
2. expanded_window      窗口 30→60→90
3. board_hot            当日或最近一日 Hot 榜（公共热度）
4. board_new            当日或最近一日 New 榜（订阅类目）
5. empty_cta            仅当 radar 全空：引导采集（唯一允许的「零卡片」）
```

每条响应带：

```ts
{ strategy: string; windowDays: number; coverageDays: number; reasons: string[] }
```

行业共识：**发现面尽量不返回零卡片**；唯一例外是产品尚未有任何快照，此时零卡片 + 强 CTA 优于假数据。

### 7.4 与「加入论文库」的关系

- 「已在库」默认从推荐池排除，双榜单显示「已在库」角标。  
- 画像信号（V1）：订阅 cs.*、`Profile.researchField`、库内标题/摘要词重叠、稍后读、隐藏、打开外链。  
- **不**把未入库雷达浏览当成必须持久的重画像；点按模式下行为稀疏，规则信号优先于复杂向量。



### 7.5 兴趣过滤（方案 B，V1.1 定稿）

**采集层（不变）**


| 榜   | 数据源           | 范围                                |
| --- | ------------- | --------------------------------- |
| Hot | alphaxiv feed | 近 7 日全站热度 Top N，**不按关键词/类目收窄**    |
| New | arXiv API     | `cat:cs.*` 并集，按用户订阅类目，**不按关键词收窄** |


广采保证：跨类目热点不丢、alphaxiv 全局信号仍在库中；`radar.db` 只存元数据，体积可控。

**展示层（新增）**

设置项：

- `keywords: string[]` — 每行一个短语，如 `agent`、`agent memory`、`agent skill`；**OR** 关系（命中任一即算关键词匹配）。
- `categories: string[]` — 已有；控制 New **采集**；同时参与**展示过滤**。
- `defaultFilterEnabled: bool` — 默认 `true`；雷达页默认只显示兴趣内卡片。

匹配规则（V1.1，纯子串，大小写不敏感）：

```text
searchable = title + abstract + ai_summary + alphaxiv topics
keyword_hit = keywords 为空 OR searchable 含任一 keyword
category_hit = 论文无类目/topics 元数据 OR  primary/categories/topics 与订阅 cs.* 有交集
interest_match = keyword_hit AND category_hit   （两组都配置时取 AND；只配一组则只验该组）
```

**缺元数据宽容**：Hot 榜论文在 enrich 前常无 `cs.`* 类目 → 类目未知时不因类目过滤排除，避免空榜。配置关键词后仍按标题/摘要收窄。

**界面**

- 双榜 / 推荐 Tab 顶栏：`兴趣过滤 · 显示 M/N` + 切换「显示全部」。
- 过滤后为空：提示放宽关键词或显示全部；推荐 cascade 增加 `interest_filtered` → 放宽至未过滤池 → 原有 board 兜底。



### 7.6 Embedding 语义匹配可行性（V2 预研）

**要解决的问题**

子串匹配无法处理：

- `agent skill` vs `skill learning`（词序/近义）
- `LLM agent` vs `language model agents`（表述变体）
- 用户兴趣是概念簇，而非固定短语

**数据规模（桌面可承受）**

- 单次采集 ≤ hot_limit + new_limit（默认 70）篇；保留 90 天 ≈ 数千条元数据行。
- 对标题+摘要做 embedding，即使全库重算也在秒级～十秒级（API）或分钟级（本地 CPU 小模型）。

**三条可行路径**


| 路径                               | 做法                                                          | 优点               | 代价                        | 与 PaperNest 契合度         |
| -------------------------------- | ----------------------------------------------------------- | ---------------- | ------------------------- | ----------------------- |
| **A. 复用 LLM 提供商 Embeddings API** | 与现有 OpenAI 兼容配置共用 base_url；对 query + 卡片文本算 cosine           | 实现快；语义质量好；无本地模型包 | 需联网；按 token 计费；多一家 API 依赖 | **高** — 用户已配 LLM 做综述/解读 |
| **B. 本地小模型（ONNX / candle）**      | 捆绑 `all-MiniLM-L6-v2` 级模型 (~80MB)；Rust 推理                   | 离线；无额外费用         | 安装包增大；CPU 延迟；中英混合质量一般     | 中 — 符合本地优先，但工程量大        |
| **C. 混合（定稿倾向）**                  | V1.1 子串过滤 → V2 在**过滤后 Top-K** 或**推荐排序**阶段用 embedding rerank | 成本可控；渐进增强        | 两阶段逻辑需维护                  | **最高**                  |


**结论**

1. ~~V1.1 不做 embedding~~ → **Phase 5.2（0.2.2）已落地**：路径 C+A。
2. 在已有 LLM 配置上增加可选 `embeddingModel`；对兴趣 query 与候选卡片 Top-K 做 cosine rerank，缓存于 `radar_embeddings`。
3. **不**上本地向量库（Faiss/Qdrant）— 候选规模小，暴力 cosine 足够。
4. 无 LLM Key / 未填 embedding 模型 / API 失败时用子串+规则排序，推荐面照常展示。

**实施前置（V2）**

- [x] LLM 设置增加 `embeddingModel`（可选）  
- [x] `radar_embeddings` 缓存 `vector_json`（text_hash + model 失效重算）  
- [x] 推荐排序增加 `0.3 * cosine(query, doc)`，与子串过滤并存；无 Key 回退  
- [x] **本地向量**：`local:bge-small-en-v1.5`（fastembed/ONNX）；一键下载到 `{exe}/models/bge-small-en-v1.5`  
- [x] **明确不采用** [SciBERT](https://huggingface.co/allenai/scibert_scivocab_uncased) 作 embedding（MLM，非句向量；不能填 OpenAI `/embeddings`）  
- 学术论文↔论文检索备选：[SPECTER](https://huggingface.co/sentence-transformers/allenai-specter) / [SPECTER2](https://huggingface.co/allenai/specter2)（&lt;2GB，后续可再接）  

### 7.7 遗漏问题：业界做法与 PaperNest 重构思（2026-08-27）

#### 7.7.1 我们现在为什么会漏

```text
真实相关新稿
    → Hot Top≈30（社区热度）∪ New=订阅类目「最新」≈40
    → 未进池的稿：关键词过滤 / embedding 都救不回来
```

根因不是「过滤太严」，而是 **召回池太窄**：展示层方案 B 只能从已快照集合里筛，不能创造新候选。

#### 7.7.2 成熟项目怎么做（摘要）

| 项目/产品 | 候选池怎么建 | 个性化在哪一层 | 防遗漏要点 | 出处 |
|-----------|--------------|----------------|------------|------|
| [Paper-Radar](https://github.com/baballuo/Paper-Radar) | Hot 全局 + New 服务端广采多 `cs.*`；推荐用近 30 天快照 | 展示订类别；排序 embedding/规则 | Hot **不按关键词砍**；New 广采、用户侧过滤 | README |
| [arxiv-sanity-lite](https://github.com/karpathy/arxiv-sanity-lite) | 类目 **大批** ingest（可达上千）再建库 | tag → TF-IDF/SVM **排序** | **先广入库再个性化** | GitHub |
| [research-radar](https://github.com/researchradar/research-radar) | YAML：**主题关键词 + 人物 + 源** | 采集按配置；确定性打分排序 | 不靠热榜；兴趣驱动召回 | README |
| arxiv-radar 类（Actions 日更） | 订阅类目日扫数百篇 → LLM/`interests` 打分 | **排序/过滤** | 类目并集广扫 + 兴趣后滤 | 社区实现 |
| [arxiv-inbox](https://github.com/mhdfaizjabir/arxiv-inbox) | topics + categories + days_back | LLM relevance；Discover 预览 | 多 topic scout；预览与入库分离 | README |
| [HF Daily Papers](https://huggingface.co/blog/daily-papers) | 社区策展 upvote | 几乎无个人召回 | **只解决社区热点**，不解决个人领域覆盖 | 官方博文 |
| [Semantic Scholar Feeds](https://www.semanticscholar.org/faq/what-are-research-feeds) | 全库图 + embedding；Feed 对标 Library 种子 | 日更相似排序 | **不以日 Hot Top-N 为池**；靠种子邻域 | FAQ |
| ResearchRabbit / Connected Papers | 多种子 / origin 图谱 | 交互扩展 | 引用·共引·语义补「日榜漏掉的」 | 产品公开说明 |
| alphaxiv | Trending/New/topic 多维流 | Profile 过滤 + For You | 细粒度 topic；Hot 作一路信号 | 产品/API |
| 日更 digest 脚本（如 MixTrain daily-arxiv） | `cat:… AND all:"kw" AND submittedDate:[…]` | 查询即兴趣 | **关键词进召回查询**，不是事后筛 Top-N | [示例](https://github.com/MixTrain/mixtrain-examples/blob/main/daily-arxiv-digest/daily_arxiv_digest.py) |
| [Idea2Paper](https://github.com/Sivarohitk/Idea2Paper) | 关键词抽 → arXiv 多结果 → SPECTER 排序 | 排序层语义 | 召回条数 `MAX_ARXIV_RESULTS` ≫ 展示 Top-K | README |

**业界硬结论（召回 / 排序）**

1. **召回要宽、排序要窄**——兴趣主要裁排序与展示，避免入口只留 Hot Top-N。  
2. **多路召回**——热度 / 类目新稿 / 关键词查询 /（可选）作者·种子邻域，至少两路以上。  
3. **个性化默认在排序层**；请求路径可降级到规则。  
4. **空池 cascade**——放宽窗 → 公共榜 → CTA。  
5. **日更发现 ≠ 图谱发现**——日更回答「今天有什么」；库内相似/引用图回答「我的方向还漏什么」。

#### 7.7.3 PaperNest 约束下的取舍

| 约束 | 含义 |
|------|------|
| 双层启动、点按联网 | 不能假设 cron 天天灌满公共池（与 Paper-Radar 服务端不同） |
| 发现期零 PDF | 召回加宽只增加 `radar.db` 元数据行，磁盘可接受 |
| arXiv 礼仪 | ≥3.1s、mailto UA；Interest 多查询需限流与合并 |
| 已有能力 | 订阅 cs.*、keywords、展示过滤、embedding rerank、双榜 UI |

#### 7.7.4 重构思定稿：**三路召回 + 两层个性化**（方案 C）

取代「仅方案 B：采集固定 Top-N，关键词只过滤」：

```text
用户点击「推荐今日论文」
        │
        ├─ R1 Hot     alphaxiv 全站热度 Top N     （社区共识；不按关键词砍）
        ├─ R2 New     订阅 cs.* × 时间窗 × 提高上限/分页
        │              （类目新稿覆盖；目标「窗内该类尽量收全」，非整站）
        └─ R3 Interest  arXiv 查询召回（防遗漏主通路）
               对每个 keyword（或合并 OR）：
               (ti:"kw" OR abs:"kw") AND (cat:c1 OR cat:c2 …)
               AND submittedDate:[anchor-W, anchor]
               max_results 可配置（默认 50/词，总上限封顶）
        │
        ▼
   并入 radar.db 快照（feed = hot | new | interest，按 arxiv_id 去重）
        │
        ├─ 双榜 UI：Hot / New（可仍显示全部或兴趣过滤）
        ├─ 新 Tab 或角标：「兴趣召回」列出 R3 命中
        └─ 为你推荐：规则 + embedding；cascade 不变
```

| 层 | 做什么 | 不做什么 |
|----|--------|----------|
| **召回** | R1∪R2∪R3 写入元数据 | 不在 R1 用关键词砍热榜 |
| **排序/展示** | 默认兴趣过滤；推荐打分 + 可选 BGE/API rerank | 不指望过滤层补全未召回稿 |
| **补漏 V2（可选）** | 库内种子 → 相似 arXiv/Semantic Scholar；作者表 | 不做后台静默 cron |

与旧方案关系：

- **保留**方案 B 的展示过滤与「显示全部」。  
- **修正**「采集完全不变」：增加 **R3 Interest 召回**，并把 R2 从「最新 N」升级为「时间窗 + 更高上限/分页」。  
- **不改为**纯方案 A（整榜只按关键词采）——否则丢掉社区热点信号。

#### 7.7.5 成功标准（遗漏治理）

1. 配置关键词 `agent memory` 且订阅 `cs.AI`/`cs.CL`/`cs.MA` 后，单次点按写入的 `interest` 快照中，出现 Hot∪「仅最新 40 New」之外的相关新稿。  
2. 未配关键词时行为与现网兼容（仅 R1+R2）。  
3. 仍满足双层保护与发现期零 PDF。  
4. arXiv 多查询遵守间隔；单次点按总外网时间可接受（UI 显示分路进度）。

#### 7.7.6 实施切片（建议）

| 切片 | 内容 | 优先级 |
|------|------|--------|
| **P0** | R3：有 keywords 时 arXiv `(ti\|abs) AND cat` + `submittedDate` 窗；feed=`interest`；UI 展示命中数 | **已完成（0.2.4）** |
| **P0** | R2：默认 `newLimit` 提高（如 100）+ 可选「按日窗拉取」而非裸最新 N | **已完成（0.2.4）** |
| **P1** | 雷达页分路进度：Hot / New / Interest 各自成功条数与失败隔离 | **部分完成**：完成提示分路计数；实时进度条可后补 |
| **P2** | 库内种子相似扩召回；作者/机构表 | 低（图谱发现） |

---

## 8. 推荐架构（更新）



### 8.1 总览

```text
设置 radar.enabled
        │
        ▼
RadarView 进入 ──只读──► 历史快照 / 空态（无网络）
        │
        │ 用户点击「推荐今日论文」
        ▼
Rust: R1 Hot + R2 New(+日窗) + R3 Interest(关键词查询) → radar.db（按 arxiv_id 去重）
        │
        ├─ 双榜 / Interest UI（默认 interest_filter；可「显示全部」）
        ├─ 周热点 SQL（滚动窗口）
        ├─ 可选：日/窗口 LLM 综述
        ├─ 为你推荐（interest_filter → cascade）
        └─ 单篇解读（按需）
                │
                │ 「加入论文库」
                ▼
         library.db + 下载 PDF → 精读闭环
```



### 8.2 隔离边界


| 边界   | 规则                                      |
| ---- | --------------------------------------- |
| 快照加载 | 不读 `radar.db`                           |
| 论文表  | 雷达采集不写主库论文表                                   |
| PDF  | 发现期零文件；入库才写 `pdf/originals`             |
| 联网   | `enabled=false` **或** 未走「推荐今日」命令 → 零外网  |
| LLM  | 失败只影响雷达子面板                              |
| 备份   | 含 `radar.db` 元数据；不含任何雷达临时 PDF（V1 无此类文件） |




### 8.3 采集与入库要点

- alphaxiv：HTTP feed；失败则 New 榜仍可用。  
- arXiv：官方 API，≥3.1s，mailto UA；默认订阅 5–8 个 cs.*。  
- 入库：判重 → 元数据（可复用解读缓存中文三件套）→ **默认下载 PDF** → 若开启「导入后自动整理」则向空字段写入 LLM 分析（summary/术语/分类）→ `locatePaper`。



### 8.4 能力分层


| 层                  | V1               | V2                      |
| ------------------ | ---------------- | ----------------------- |
| 双层保护 + 点按双榜单       | ✅                | —                       |
| 发现期零 PDF / 入库下 PDF | ✅                | 可选临时 PDF 缓存（方案 B）       |
| 滚动周热点 + 窗口综述       | ✅                | 课题定向追踪                  |
| 单篇解读               | ✅                | alphaxiv 富渲染            |
| 推荐 cascade         | ✅ 规则 + embedding | interest 过滤 + 语义 rerank |
| Agent              | ❌                | 审批写入库                   |


---



## 9. 对现有功能的影响与缓解


| 现有功能    | 风险          | 缓解                    |
| ------- | ----------- | --------------------- |
| 启动 / 进页 | 误自动联网       | 双层保护；无空闲调度            |
| 论文库表格   | 被日更淹没       | 发现期元数据留在 radar.db                 |
| 磁盘      | 日更 PDF 膨胀   | 方案 A 零预下载             |
| 判重      | 双路径重复       | 复用 `paperDuplicate`   |
| LLM 配额  | 自动综述烧 Token | 综述默认手动；与「推荐今日」解耦      |
| 备份      | 无意义大文件      | 仅元数据 db               |
| 阅读台     | 误开未下载 PDF   | 仅入库且 `pdf_path` 有值后打开 |


---



## 10. 分阶段实施计划



### Phase 0 — 许可与探测

- [x] Paper-Radar 许可确认或坚持自研（上游无明确 LICENSE → Rust/TS 自研，`radar.rs`）  
- [x] alphaxiv feed HTTP 探测（`api.alphaxiv.org/papers/v3/feed?sort=Hot` 已接入）  



### Phase 1 — 双层开关 + 空壳

- [x] 设置 `enabled`；Screen `radar`  
- [x] 进页空态 +「推荐今日论文」按钮（disabled 当 `!enabled` 或未加载设置）  
- [x] `radar.db` schema  

**验收**：设置关或未点击时抓包无 arXiv/alphaxiv。✅ 已通过（后端 `radar_fetch_today` 校验 `enabled`；进页无 invoke 采集）。

### Phase 2 — 点按双榜单（MVP）

- [x] 按钮触发管道；Hot + New；日历标记有数日  
- [x] 同日幂等（`INSERT … ON CONFLICT DO UPDATE`）；单源失败隔离  

**验收**：点击后可见双榜；再进页读本地缓存，点按钮才重采。✅ 已通过。

### Phase 3 — 加入论文库（此时才下 PDF）

- [x] 判重 + 下载到 `pdf/originals` + 角标 + `locatePaper`  
- [x] 可选「仅元数据入库」（雷达页顶栏勾选；`download_pdf=false`）   

**验收**：未入库论文在资料库目录无对应 PDF；入库后可读。✅ 已通过。

### Phase 4 — 周热点 + 窗口综述

- [x] SQL 聚合 + `coverage_days` 文案  
- [x] 手动生成日/窗口综述（需 LLM 配置）  

**验收**：仅 2 个采集日也能出「近 7 日（覆盖 2 日）」；不满勤不报错。✅ 已通过（`radar_week_hot` + 前端文案）。

### Phase 5 — 单篇解读 + 推荐 cascade

- [x] 按需解读缓存  
- [x] §7.3 cascade + strategy 标签  
- [x] 稍后读 / 隐藏  

**验收**：C1–C4 各有对应 UI；过滤致空时落到双榜而非白屏。✅ 已通过（`STRATEGY_LABEL` + `empty_cta` 引导）。

### Phase 5.1 — 兴趣过滤（方案 B，V1.1）

- [x] 设置 `keywords` + `defaultFilterEnabled`  
- [x] 展示层子串匹配（标题/摘要/AI 摘要/topics）  
- [x] 雷达页「显示全部 / 兴趣过滤」切换 + 计数  
- [x] 推荐 cascade 优先兴趣池  

**验收**：广采后 Hot 仍存全量；默认 UI 只显示兴趣内；关键词 `agent` 可滤出标题含 agent 的稿；无匹配时可显示全部。✅

### Phase 5.2 — Embedding 语义 rerank（V2 路径 C+A）

- [x] LLM 设置增加 `embeddingModel`（可选）  
- [x] `radar_embeddings` 缓存（text_hash + model 失效重算）  
- [x] 推荐 Top-K 上叠加 `0.3 * cosine(query, doc)`；失败回退规则排序  
- [x] UI 策略标签 `embedding_rerank` / 「语义相近 N%」  

**验收**：配置 embedding 模型与关键词后，「为你推荐」可出现语义重排；未配置时用规则排序。

### Phase 6 — Agent（仍为后续）

- [ ] 工具提议入库（审批）；禁止静默写 `library.db`  

每阶段单独测试；git 小版本仅在你要求时提交。

---



## 10.1 功能完整性检查（0.2.2）


| 能力                  | 状态   | 实现位置                                      | 备注                      |
| ------------------- | ---- | ----------------------------------------- | ----------------------- |
| 双层启动保护              | ✅    | `RadarSettingsForm` + `radar_fetch_today` | 设置默认关；进页读本地快照，点按钮才采集 |
| alphaxiv 热点榜        | ✅    | `fetch_alphaxiv_hot`                      | HTTP feed，无 Playwright  |
| arXiv 新稿榜           | ✅    | `fetch_arxiv_new`                         | 官方 Atom API + mailto UA |
| 独立 `radar.db`       | ✅    | `open_radar_pool`                         | 与 `library.db` 分离       |
| 发现期零 PDF            | ✅    | 采集管道                                      | 仅元数据快照                  |
| 加入论文库 + 下 PDF       | ✅    | `radar_import_to_library`                 | 判重含 `clean_arxiv_id`    |
| 仅元数据入库 UI           | ✅    | `RadarView` 顶栏勾选                          | `downloadPdf=false`     |
| 日历有数日               | ✅    | `radar_list_dates` + 侧栏列表                 | —                       |
| 近 7 日热点             | ✅    | `radar_week_hot`                          | `coverage_days` 文案      |
| 日/窗口综述              | ✅    | `radar_generate_digest`                   | 需 LLM API Key           |
| 单篇解读                | ✅    | `radar_explain_paper`                     | 完整结构化（含 abstractZh）；输入优先全文摘要 |
| 推荐 cascade          | ✅    | `radar_recommend`                         | 30→60→90 天窗 + 双榜兜底      |
| 稍后读 / 隐藏            | ✅    | `radar_set_user_state`                    | 推荐榜过滤已入库/隐藏             |
| 兴趣关键词 + 默认过滤        | ✅    | `interest_match` + 顶栏切换                   | 方案 B；§7.5               |
| embedding 语义 rerank | ✅    | API 或 `local:bge-small-en-v1.5`           | SciBERT 不适用；本地一键安装      |
| 临时 PDF 缓存（方案 B）     | ❌ 不做 | —                                         | 定稿不做                    |
| 科研 Agent            | ❌ 后续 | —                                         | Phase 6                 |
| 启动空闲自动采集            | ❌ 不做 | —                                         | 与 D4 定稿冲突               |




### 0.2.2 回归与自测记录


| 项                                                       | 结果                   |
| ------------------------------------------------------- | -------------------- |
| `npm run check`                                         | ✅ 通过                 |
| `cargo test --lib radar_unit`                           | ✅ 6 项                |
| `npm run tauri build` → `PaperNest_0.2.2_x64-setup.exe` | ✅ 打包                 |
| 仅元数据入库勾选                                                | ✅ 顶栏 + 按钮文案切换        |
| embeddingModel 设置 + 缓存表                                 | ✅ `radar_embeddings` |
| 未配置 embedding 时推荐照常展示                                    | ✅ 规则排序             |
| 0.2.3 本地 BGE + onnxruntime.dll 一键下载                        | ✅ `models/` 按需安装；SciBERT 不适用 |




### 已知限制

1. 综述/解读依赖 LLM 设置；未配置时后端报错，前端 `notice` 展示。
2. 单篇解读为完整结构化（含中文摘要）；耗时依赖模型与网络。alphaXiv 富 Overview（Playwright/官方 API）未接入，不照搬其抓取队列。
3. 同日再次「推荐今日论文」会更新排名/摘要，不会清空历史其他日快照。
4. arXiv 新稿采集后固定 `sleep(3.1s)` 礼貌间隔。
5. 热点榜摘要缺失时二次 enrich，可能略延长单次采集耗时。
6. 兴趣关键词默认为子串匹配；配置 `embeddingModel` 后推荐 Tab 才做语义重排（双榜过滤仍为子串）。
7. Embeddings 按提供商计费；首次推荐会对 Top-K 批量请求，后续命中 `radar_embeddings` 缓存。

---



## 11. 成功标准

1. Phase 2 即可称「论文雷达 MVP」。
2. `enabled=false` 或未点「推荐今日论文」→ 零外网。
3. 发现期资料库目录不出现批量新 PDF。
4. 稀疏使用：2 个采集日可出窗口热点/综述（有 LLM 时），文案含覆盖天数。
5. 空池：除「全库无快照」外，推荐区不长时间零卡片；必有 `strategy`。
6. 现有 §10 桌面回归仍通过。
7. arXiv 礼貌间隔与 mailto UA。

---



## 12. 主要权衡


| 权衡                 | 选择         | 代价              |
| ------------------ | ---------- | --------------- |
| PDF A vs B         | A 发现期零 PDF | 入库前不能本地翻 PDF    |
| 自动 cron vs 双层点按    | 双层点按       | 候选池更稀疏，必须做 §6§7 |
| 自然周满勤 vs 滚动有数日     | 滚动有数日      | 「周」是产品词，需文案诚实   |
| 空池严格个性化 vs cascade | cascade    | 偶发「不够懂我」，但永不卡死  |
| 进页是否刷新             | 不刷新        | 数据可能隔日；靠按钮更新    |


---



## 13. 建议的下一步

1. ~~V1 / 兴趣过滤 / 仅元数据 / embedding / 本地 BGE~~ → 已完成（至 0.2.3）。  
2. ~~遗漏治理 P0（§7.7）~~ → **0.2.4 已落地**：三路召回 Interest + New 日窗/默认 100。  
3. Phase 6：科研 Agent（审批写入库）。  
4. 可选：库内种子相似扩召回；SPECTER2；Playwright alphaxiv 后备；Interest 分路实时进度条。

---



## 附录 A — 能力映射


| Paper-Radar | PaperNest             |
| ----------- | --------------------- |
| 每日 cron 双榜  | 设置 ON +「推荐今日论文」       |
| 公共 PDF/全文预取 | **无**；入库才下 PDF        |
| 90 天日历      | 有快照日标记；只读历史           |
| 周综述满窗假设     | 窗口综述 + coverage_days  |
| 30 天推荐池     | 同窗 + 放宽 + 双榜 fallback |
| Agent       | V2                    |




## 附录 B — 本仓库参考


| 路径                                                   | 用途         |
| ---------------------------------------------------- | ---------- |
| `docs/DEVELOPMENT.md`                                | 边界与验收      |
| `docs/research/metadata-and-extension-assessment.md` | 默认关 + 显式联网 |
| `src/components/Sidebar.tsx`                         | Screen     |
| `src/services/llm.ts`                                | 综述/解读      |
| `src-tauri/src/online_metadata.rs`                   | reqwest 礼仪 |
| `src/lib/paperDuplicate.ts`                          | 入库判重       |
| `src/lib/knowledgeGraph.ts`                          | 库内相似信号     |




## 附录 C — 上游参考


| 路径                                | 用途              |
| --------------------------------- | --------------- |
| `README.md`                       | 降级哲学            |
| `src/cli.py`                      | 管道阶段            |
| `src/enrich_arxiv.py`             | arXiv API       |
| `src/storage.py`                  | schema          |
| `src/services/recommendations.py` | 30 日窗、rules、冷启动 |
| `src/summarize.py`                | 篇数门槛与聚类综述       |
| `config.py`                       | cs.* 与 FEEDS    |



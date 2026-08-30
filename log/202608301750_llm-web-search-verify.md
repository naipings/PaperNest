# llm_web_search 真实调研验证（会话 03f81474）

## 环境

- 库：`E:\PaperNest\PaperNestLibrary`
- 会话：`03f81474-aa6b-4482-b5ad-582a517cfa44`
- 状态：`completed`
- 产物版本：0.2.21 → 修复后 0.2.22

## 轨迹检查

| 项 | 结果 |
|----|------|
| `llm_web_search` 调用 | ✅ seq 13，百炼/Qwen 返回综述 |
| 学术工具链 | ✅ search_library / search_arxiv / search_web |
| finish_research | ✅ 完成，report.md 3701 字 |
| 来源总数 | 52（local 5, arxiv 25, openalex 20, crossref 2） |
| `llm_web` 来源 | ❌ 0（百炼兼容模式无 search_info） |

## 修复（0.2.22）

`research_llm_web.rs`：`finalize_result` 在无结构化来源时从综述提取 `arXiv:` 与 URL，登记 `llm_web` 来源。

## 复验命令

```powershell
$env:PYTHONIOENCODING='utf-8'
python log/watch_research.py
```

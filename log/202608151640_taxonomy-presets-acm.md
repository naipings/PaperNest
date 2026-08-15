# 预设主领域与子领域标签

**Date**: 2026-08-15 16:40  
**Type**: Plan / Feature  
**Project**: paperReader / PaperNest  

## Background

论文库原先仅 3 个主领域与少量标签，不便于按 ACM/国内常见 CS 方向归类。

## Proposed Solution

- 主领域 16 个：对齐 ACM CCS 2012 顶层，并将计算方法下常用方向（CV/NLP/ML/推荐等）拆成独立单选项。
- 子领域标签 31 个：方法、任务、阅读用途，可多选。
- `schema.sql` 用 `INSERT OR IGNORE`；旧库启动即补全；「系统与优化」更名为「计算机系统与体系结构」。

## Key Decisions

- 主领域坚持单选、子领域用现有 tags 多选，不新增表结构。
- 文案统一为「主领域 / 子领域」。

## Next Steps

- [x] schema + seed + UI + docs
- [ ] 用户重启应用后在「设置 → 分类与标签」确认预设已出现

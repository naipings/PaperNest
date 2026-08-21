# 临床医学临时打包方案

**Date**: 2026-08-19 21:50  
**Type**: Plan / Solution Analysis  
**Project**: paperReader / PaperNest  

## Background

需要临时打一版面向临床医学研究生的安装包：默认主领域/子领域、个人资料研究方向、LLM 导入与翻译提示词改为临床医学语境。打完包后工作区恢复为计算机科学内容；临床改动单独备份，便于以后再套用。

## Proposed Solution

1. 主领域改为临床医学二级学科（1997 学科目录 1002 系列 + 专硕常用「重症医学」），共 16 项，新 ID（`cat-im` 等），避免与 CS 的 `cat-cv` 混用。
2. 子领域改为研究设计 / 临床问题 / 阅读用途（CONSORT、STROBE、PRISMA、STARD 对应类型）。
3. LLM 系统提示改为临床医学学术语体：药物通用名、试验名、统计量（HR/OR/CI/ITT）、生存结局 OS 等按医学义项。
4. `frameworkPage` 提示改为识别 CONSORT/PRISMA 流程图或研究设计图。
5. 打包后从备份说明恢复 CS 源文件；临床全文副本放在 `backup/clinical-medicine/`。

## Key Decisions

- 不改产品 identifier 与版本号，以免和现有 CS 安装路径冲突；窗口标题改为「临床医学论文库」，安装包复制时加 `-clinmed` 后缀。
- 不把 README/CHANGELOG 打进安装包，工作区文档保持 CS；调研与恢复步骤写在备份目录说明里。
- 浏览器预览种子论文换成 SPRINT / KEYNOTE-189 / PRISMA 2020，仍用 `paper-1` 等 ID，避免破坏现有筛选单测。

## Next Steps

- [x] 调研学科目录与临床研究设计标签
- [x] 改 schema/seed/prompts/设置文案
- [x] 测试 + tauri build
- [x] 备份临床文件并恢复 CS

安装包：`release/windows/PaperNest-clinmed_0.1.71_x64-setup.exe`  
备份：`backup/clinical-medicine/`

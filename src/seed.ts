import type { Category, LibrarySnapshot, Tag } from "./types";

/** 主领域：对齐 ACM CCS 2012 顶层及国内常用 CS 研究方向；每篇论文最多选一个。 */
export const defaultCategories: Category[] = [
  { id: "cat-cv", name: "计算机视觉", color: "#7c6fcd" },
  { id: "cat-nlp", name: "自然语言处理", color: "#3b8d89" },
  { id: "cat-ml", name: "机器学习", color: "#5b7fda" },
  { id: "cat-ai", name: "人工智能", color: "#6a5acd" },
  { id: "cat-dm", name: "数据挖掘与知识发现", color: "#2f9e8f" },
  { id: "cat-ir", name: "信息检索与推荐系统", color: "#4f83cc" },
  { id: "cat-db", name: "信息系统与数据库", color: "#3d8ea5" },
  { id: "cat-net", name: "计算机网络", color: "#4682b4" },
  { id: "cat-sys", name: "计算机系统与体系结构", color: "#c27b55" },
  { id: "cat-se", name: "软件工程", color: "#b86b6b" },
  { id: "cat-sec", name: "安全与隐私", color: "#c45c6a" },
  { id: "cat-hci", name: "人机交互", color: "#9a6bb5" },
  { id: "cat-theory", name: "计算理论", color: "#708090" },
  { id: "cat-mm", name: "多媒体与计算机图形学", color: "#d17a4a" },
  { id: "cat-dist", name: "分布式与并行计算", color: "#5f8a6b" },
  { id: "cat-robot", name: "机器人学", color: "#6b8e4e" }
];

/** 子领域标签：可多选；方法 / 任务 / 阅读用途。 */
export const defaultTags: Tag[] = [
  { id: "tag-transformer", name: "Transformer", color: "#8b7bd6" },
  { id: "tag-llm", name: "大语言模型", color: "#6b7fd6" },
  { id: "tag-vlm", name: "视觉语言模型", color: "#7a6fcf" },
  { id: "tag-gnn", name: "图神经网络", color: "#5c8fd6" },
  { id: "tag-diffusion", name: "扩散模型", color: "#8a6bb8" },
  { id: "tag-rl", name: "强化学习", color: "#4f9b7a" },
  { id: "tag-transfer", name: "迁移学习", color: "#5a9e8c" },
  { id: "tag-contrastive", name: "对比学习", color: "#4a8f9c" },
  { id: "tag-federated", name: "联邦学习", color: "#3d8ea5" },
  { id: "tag-distill", name: "知识蒸馏", color: "#6a8f7a" },
  { id: "tag-continual", name: "持续学习", color: "#5b8a6f" },
  { id: "tag-fewshot", name: "少样本学习", color: "#6b9b6b" },
  { id: "tag-pretrain", name: "预训练", color: "#7b7fc0" },
  { id: "tag-detection", name: "目标检测", color: "#4f83cc" },
  { id: "tag-segmentation", name: "语义分割", color: "#5a7fc0" },
  { id: "tag-recsys", name: "推荐系统", color: "#4f83cc" },
  { id: "tag-seqrec", name: "序列推荐", color: "#5b8acc" },
  { id: "tag-retrieval", name: "信息检索", color: "#4682b4" },
  { id: "tag-dialogue", name: "对话系统", color: "#3b8d89" },
  { id: "tag-kg", name: "知识图谱", color: "#2f9e8f" },
  { id: "tag-codegen", name: "代码生成", color: "#6b8e4e" },
  { id: "tag-cf", name: "协同过滤", color: "#5c8fd6" },
  { id: "tag-os", name: "操作系统", color: "#c27b55" },
  { id: "tag-edge", name: "边缘计算", color: "#b86b6b" },
  { id: "tag-dp", name: "差分隐私", color: "#c45c6a" },
  { id: "tag-crypto", name: "密码学", color: "#a05060" },
  { id: "tag-prog-analysis", name: "程序分析", color: "#b86b6b" },
  { id: "tag-survey", name: "综述", color: "#d18b5b" },
  { id: "tag-beginner", name: "入门", color: "#4b9b7d" },
  { id: "tag-benchmark", name: "基准评测", color: "#c29a4a" },
  { id: "tag-repro", name: "实验复现", color: "#b89a5a" }
];

export const seedSnapshot: LibrarySnapshot = {
  libraryPath: "浏览器预览模式 · 数据保存在本地浏览器",
  categories: defaultCategories,
  tags: defaultTags,
  papers: [
    {
      id: "paper-1", titleEn: "Attention Is All You Need", titleZh: "注意力机制就是你所需要的一切",
      authors: [{ id: "a1", name: "Ashish Vaswani" }, { id: "a2", name: "Noam Shazeer" }],
      categoryId: "cat-nlp", tagIds: ["tag-transformer", "tag-beginner"], status: "read",
      summary: "提出完全基于注意力机制的 Transformer，移除循环和卷积结构。",
      abstractEn: "The dominant sequence transduction models are based on complex recurrent or convolutional neural networks.",
      abstractZh: "主流序列转换模型通常依赖复杂的循环或卷积神经网络。",
      venue: "NeurIPS", publicationDate: "2017-06-12", doi: "10.48550/arXiv.1706.03762", arxivId: "1706.03762",
      sourceUrl: "https://arxiv.org/abs/1706.03762", favorite: true, pageCount: 15, hasTextLayer: true,
      readingPage: 6, createdAt: "2026-07-28T10:00:00Z", updatedAt: "2026-08-02T12:00:00Z", relatedPaperIds: []
    },
    {
      id: "paper-2", titleEn: "You Only Look Once: Unified, Real-Time Object Detection", titleZh: "YOLO：统一的实时目标检测",
      authors: [{ id: "a3", name: "Joseph Redmon" }, { id: "a4", name: "Santosh Divvala" }],
      categoryId: "cat-cv", tagIds: ["tag-detection", "tag-beginner"], status: "reading",
      summary: "将目标检测重构为单次回归问题，实现端到端实时检测。", venue: "CVPR", publicationDate: "2016-06-27",
      sourceUrl: "https://arxiv.org/abs/1506.02640", favorite: false, pageCount: 10, hasTextLayer: true,
      readingPage: 3, createdAt: "2026-07-30T10:00:00Z", updatedAt: "2026-08-03T08:00:00Z", relatedPaperIds: []
    },
    {
      id: "paper-3", titleEn: "A Survey of Large Language Models", titleZh: "大语言模型综述",
      authors: [{ id: "a5", name: "Wayne Xin Zhao" }], categoryId: "cat-nlp", tagIds: ["tag-survey", "tag-llm"], status: "unread",
      summary: "系统梳理大语言模型的预训练、适配、使用与能力评测。", venue: "arXiv", publicationDate: "2023-03-31",
      sourceUrl: "https://arxiv.org/abs/2303.18223", favorite: false, pageCount: 100, hasTextLayer: true,
      createdAt: "2026-08-01T10:00:00Z", updatedAt: "2026-08-01T10:00:00Z", relatedPaperIds: []
    }
  ],
  annotations: [{ id: "ann-1", paperId: "paper-1", page: 2, type: "highlight", geometry: { rects: [{ x: .12, y: .28, width: .64, height: .025 }] }, quote: "The Transformer allows for significantly more parallelization", color: "#f2ce67", createdAt: "2026-08-02T12:00:00Z", updatedAt: "2026-08-02T12:00:00Z" }],
  vocabulary: [{ id: "voc-1", paperId: "paper-1", termEn: "sequence transduction", meaningZh: "序列转换：把一个序列映射为另一个序列", sentenceEn: "The dominant sequence transduction models are based on complex recurrent neural networks.", sentenceZh: "主流序列转换模型基于复杂的循环神经网络。", page: 1, annotationId: "ann-1" }],
  figures: [],
  excerpts: [{ id: "ext-1", paperId: "paper-1", sourceText: "We propose a new simple network architecture, the Transformer, based solely on attention mechanisms.", translationZh: "我们提出了一种仅基于注意力机制的简单网络架构 Transformer。", purpose: "方法描述", personalRewrite: "We develop a unified architecture built entirely upon ...", page: 1, tags: ["提出方法"], createdAt: "2026-08-02T12:00:00Z" }],
  views: [],
  tasks: [],
  readingDays: [],
  profile: { displayName: "研究生同学", researchField: "计算机科学", theme: "system" },
  llm: { baseUrl: "https://api.openai.com/v1", model: "gpt-4.1-mini", autoAnalyzeOnImport: true, visionEnabled: true, apiKeySaved: false },
  metadata: { enabled: false, provider: "crossref" }
};

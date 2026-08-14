import type { LibrarySnapshot } from "./types";

export const seedSnapshot: LibrarySnapshot = {
  libraryPath: "浏览器预览模式 · 数据保存在本地浏览器",
  categories: [
    { id: "cat-cv", name: "计算机视觉", color: "#7c6fcd" },
    { id: "cat-nlp", name: "自然语言处理", color: "#3b8d89" },
    { id: "cat-sys", name: "系统与优化", color: "#c27b55" }
  ],
  tags: [
    { id: "tag-transformer", name: "Transformer", color: "#8b7bd6" },
    { id: "tag-survey", name: "综述", color: "#d18b5b" },
    { id: "tag-beginner", name: "入门", color: "#4b9b7d" },
    { id: "tag-detection", name: "目标检测", color: "#4f83cc" }
  ],
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
      readingPage: 6, createdAt: "2026-07-28T10:00:00Z", updatedAt: "2026-08-02T12:00:00Z"
    },
    {
      id: "paper-2", titleEn: "You Only Look Once: Unified, Real-Time Object Detection", titleZh: "YOLO：统一的实时目标检测",
      authors: [{ id: "a3", name: "Joseph Redmon" }, { id: "a4", name: "Santosh Divvala" }],
      categoryId: "cat-cv", tagIds: ["tag-detection", "tag-beginner"], status: "reading",
      summary: "将目标检测重构为单次回归问题，实现端到端实时检测。", venue: "CVPR", publicationDate: "2016-06-27",
      sourceUrl: "https://arxiv.org/abs/1506.02640", favorite: false, pageCount: 10, hasTextLayer: true,
      readingPage: 3, createdAt: "2026-07-30T10:00:00Z", updatedAt: "2026-08-03T08:00:00Z"
    },
    {
      id: "paper-3", titleEn: "A Survey of Large Language Models", titleZh: "大语言模型综述",
      authors: [{ id: "a5", name: "Wayne Xin Zhao" }], categoryId: "cat-nlp", tagIds: ["tag-survey"], status: "unread",
      summary: "系统梳理大语言模型的预训练、适配、使用与能力评测。", venue: "arXiv", publicationDate: "2023-03-31",
      sourceUrl: "https://arxiv.org/abs/2303.18223", favorite: false, pageCount: 100, hasTextLayer: true,
      createdAt: "2026-08-01T10:00:00Z", updatedAt: "2026-08-01T10:00:00Z"
    }
  ],
  annotations: [{ id: "ann-1", paperId: "paper-1", page: 2, type: "highlight", geometry: { rects: [{ x: .12, y: .28, width: .64, height: .025 }] }, quote: "The Transformer allows for significantly more parallelization", color: "#f2ce67", createdAt: "2026-08-02T12:00:00Z", updatedAt: "2026-08-02T12:00:00Z" }],
  vocabulary: [{ id: "voc-1", paperId: "paper-1", termEn: "sequence transduction", meaningZh: "序列转换：把一个序列映射为另一个序列", sentenceEn: "The dominant sequence transduction models are based on complex recurrent neural networks.", sentenceZh: "主流序列转换模型基于复杂的循环神经网络。", page: 1, annotationId: "ann-1" }],
  figures: [],
  excerpts: [{ id: "ext-1", paperId: "paper-1", sourceText: "We propose a new simple network architecture, the Transformer, based solely on attention mechanisms.", translationZh: "我们提出了一种仅基于注意力机制的简单网络架构 Transformer。", purpose: "方法描述", personalRewrite: "We develop a unified architecture built entirely upon ...", page: 1, tags: ["提出方法"], createdAt: "2026-08-02T12:00:00Z" }],
  views: [],
  tasks: [],
  profile: { displayName: "研究生同学", researchField: "计算机科学", theme: "system" }
  ,llm: { baseUrl: "https://api.openai.com/v1", model: "gpt-4.1-mini", autoAnalyzeOnImport: true, visionEnabled: true, apiKeySaved: false },
  metadata: { enabled: false, provider: "crossref" }
};

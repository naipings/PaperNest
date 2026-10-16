import type { Category, LibrarySnapshot, Tag } from "./types";

/** 主领域：1997 学科目录临床医学二级学科，加专硕常用重症医学；每篇论文最多选一个。 */
export const defaultCategories: Category[] = [
  { id: "cat-im", name: "内科学", color: "#c45c6a" },
  { id: "cat-surg", name: "外科学", color: "#c27b55" },
  { id: "cat-obgyn", name: "妇产科学", color: "#b86b6b" },
  { id: "cat-ped", name: "儿科学", color: "#d17a4a" },
  { id: "cat-neuro", name: "神经病学", color: "#7c6fcd" },
  { id: "cat-psych", name: "精神病与精神卫生学", color: "#9a6bb5" },
  { id: "cat-derm", name: "皮肤病与性病学", color: "#d18b5b" },
  { id: "cat-imaging", name: "影像医学与核医学", color: "#4f83cc" },
  { id: "cat-lab", name: "临床检验诊断学", color: "#3d8ea5" },
  { id: "cat-oph", name: "眼科学", color: "#5b7fda" },
  { id: "cat-ent", name: "耳鼻咽喉科学", color: "#4682b4" },
  { id: "cat-onco", name: "肿瘤学", color: "#6a5acd" },
  { id: "cat-anes", name: "麻醉学", color: "#5f8a6b" },
  { id: "cat-em", name: "急诊医学", color: "#c45c26" },
  { id: "cat-cc", name: "重症医学", color: "#8a3d4a" },
  { id: "cat-rehab", name: "康复医学与理疗学", color: "#2f9e8f" }
];

/** 子领域标签：可多选；研究设计 / 临床问题 / 阅读用途。 */
export const defaultTags: Tag[] = [
  { id: "tag-rct", name: "随机对照试验", color: "#c45c6a" },
  { id: "tag-nonrct", name: "非随机干预研究", color: "#c27b55" },
  { id: "tag-cohort", name: "队列研究", color: "#b86b6b" },
  { id: "tag-casecontrol", name: "病例对照研究", color: "#d17a4a" },
  { id: "tag-crosssec", name: "横断面研究", color: "#d18b5b" },
  { id: "tag-rwe", name: "真实世界研究", color: "#4f83cc" },
  { id: "tag-diagacc", name: "诊断准确性研究", color: "#3d8ea5" },
  { id: "tag-sr", name: "系统评价", color: "#7c6fcd" },
  { id: "tag-meta", name: "荟萃分析", color: "#6a5acd" },
  { id: "tag-guideline", name: "临床指南", color: "#5b7fda" },
  { id: "tag-casereport", name: "病例报告", color: "#9a6bb5" },
  { id: "tag-consensus", name: "专家共识", color: "#5f8a6b" },
  { id: "tag-dx", name: "诊断", color: "#4682b4" },
  { id: "tag-tx", name: "治疗", color: "#2f9e8f" },
  { id: "tag-px", name: "预后", color: "#3b8d89" },
  { id: "tag-prev", name: "预防", color: "#4f9b7a" },
  { id: "tag-drugtrial", name: "药物试验", color: "#6b7fd6" },
  { id: "tag-surgery", name: "外科手术", color: "#c27b55" },
  { id: "tag-imgdx", name: "影像诊断", color: "#4f83cc" },
  { id: "tag-biomarker", name: "生物标志物", color: "#3d8ea5" },
  { id: "tag-molpath", name: "分子病理", color: "#8a6bb8" },
  { id: "tag-epi", name: "流行病学", color: "#5a9e8c" },
  { id: "tag-hecon", name: "卫生经济学", color: "#b89a5a" },
  { id: "tag-stats", name: "统计方法", color: "#708090" },
  { id: "tag-consort", name: "CONSORT", color: "#c45c6a" },
  { id: "tag-prisma", name: "PRISMA", color: "#7c6fcd" },
  { id: "tag-strobe", name: "STROBE", color: "#4f83cc" },
  { id: "tag-guideline-read", name: "指南精读", color: "#5b7fda" },
  { id: "tag-proposal", name: "课题设计", color: "#6b8e4e" },
  { id: "tag-survey", name: "综述", color: "#d18b5b" },
  { id: "tag-beginner", name: "入门", color: "#4b9b7d" }
];

export const seedSnapshot: LibrarySnapshot = {
  libraryPath: "浏览器预览模式 · 数据保存在本地浏览器",
  folders: [],
  categories: defaultCategories,
  tags: defaultTags,
  papers: [
    {
      id: "paper-1", titleEn: "A Randomized Trial of Intensive versus Standard Blood-Pressure Control", titleZh: "SPRINT：强化降压与标准降压的随机试验",
      authors: [{ id: "a1", name: "SPRINT Research Group" }],
      categoryId: "cat-im", tagIds: ["tag-rct", "tag-beginner"], status: "read",
      summary: "比较强化收缩压目标与标准目标对心血管结局的影响。",
      abstractEn: "The SPRINT trial compared intensive and standard systolic blood-pressure targets and reported the hazard ratio for cardiovascular events.",
      abstractZh: "SPRINT 比较强化与标准收缩压目标，并报告心血管事件的风险比。",
      venue: "NEJM", publicationDate: "2015-11-26", doi: "10.1056/NEJMoa1511939",
      sourceUrl: "https://doi.org/10.1056/NEJMoa1511939", favorite: true, pageCount: 12, hasTextLayer: true,
      readingPage: 4, createdAt: "2026-07-28T10:00:00Z", updatedAt: "2026-08-02T12:00:00Z", relatedPaperIds: []
    },
    {
      id: "paper-2", titleEn: "Pembrolizumab plus Chemotherapy in Metastatic Non-Small-Cell Lung Cancer", titleZh: "帕博利珠单抗联合化疗治疗转移性非小细胞肺癌",
      authors: [{ id: "a3", name: "Leena Gandhi" }],
      categoryId: "cat-onco", tagIds: ["tag-rct", "tag-drugtrial"], status: "reading",
      summary: "KEYNOTE-189 比较帕博利珠单抗联合化疗与单纯化疗对转移性非鳞非小细胞肺癌总生存的影响。", venue: "NEJM", publicationDate: "2018-05-31",
      doi: "10.1056/NEJMoa1801005", sourceUrl: "https://doi.org/10.1056/NEJMoa1801005", favorite: false, pageCount: 11, hasTextLayer: true,
      readingPage: 3, createdAt: "2026-07-30T10:00:00Z", updatedAt: "2026-08-03T08:00:00Z", relatedPaperIds: []
    },
    {
      id: "paper-3", titleEn: "The PRISMA 2020 statement: an updated guideline for reporting systematic reviews", titleZh: "PRISMA 2020：系统评价报告规范的更新",
      authors: [{ id: "a5", name: "Matthew J. Page" }], categoryId: "cat-im", tagIds: ["tag-survey", "tag-prisma", "tag-sr"], status: "unread",
      summary: "更新系统评价与荟萃分析的报告条目，对应 PRISMA 流程图。", venue: "BMJ", publicationDate: "2021-03-29",
      doi: "10.1136/bmj.n71", sourceUrl: "https://doi.org/10.1136/bmj.n71", favorite: false, pageCount: 9, hasTextLayer: true,
      createdAt: "2026-08-01T10:00:00Z", updatedAt: "2026-08-01T10:00:00Z", relatedPaperIds: []
    }
  ],
  annotations: [{ id: "ann-1", paperId: "paper-1", page: 2, type: "highlight", geometry: { rects: [{ x: .12, y: .28, width: .64, height: .025 }] }, quote: "Intensive treatment reduced the hazard of cardiovascular events", color: "#f2ce67", createdAt: "2026-08-02T12:00:00Z", updatedAt: "2026-08-02T12:00:00Z" }],
  vocabulary: [{ id: "voc-1", paperId: "paper-1", termEn: "hazard ratio", meaningZh: "风险比：两组发生事件的瞬时风险之比", sentenceEn: "The trial reported the hazard ratio for the primary cardiovascular outcome.", sentenceZh: "试验报告了主要心血管结局的风险比。", page: 1, annotationId: "ann-1" }],
  figures: [],
  excerpts: [{ id: "ext-1", paperId: "paper-1", sourceText: "Intensive systolic blood-pressure treatment lowered the rate of cardiovascular events compared with standard treatment.", translationZh: "与标准降压相比，强化收缩压治疗降低了心血管事件发生率。", purpose: "结果描述", personalRewrite: "Intensive blood-pressure control reduced cardiovascular events relative to the standard target.", page: 1, tags: ["主要结果"], createdAt: "2026-08-02T12:00:00Z" }],
  views: [],
  tasks: [],
  readingDays: [],
  profile: { displayName: "研究生同学", researchField: "临床医学", theme: "system", visualTheme: "workbench" },
  llm: { baseUrl: "https://api.openai.com/v1", model: "gpt-4.1-mini", autoAnalyzeOnImport: true, visionEnabled: true, apiKeySaved: false, autoClassifyOnImport: true, taxonomyStrictness: "strict" },
  metadata: { enabled: false, provider: "crossref" },
  customFieldDefinitions: [],
  customFieldValues: []
};

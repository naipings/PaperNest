export type Id = string;
export type PaperStatus = "unread" | "reading" | "read" | "archived";
export type AnnotationType = "highlight" | "underline" | "text" | "sticky" | "ink";
export type TaskStatus = "todo" | "in_progress" | "done";
export type TaskPriority = "low" | "medium" | "high";

export interface Author { id: Id; name: string; }
export interface Category { id: Id; name: string; color: string; }
export interface Tag { id: Id; name: string; color: string; }
export interface Folder {
  id: Id;
  name: string;
  parentId?: Id;
  position: number;
  createdAt: string;
  updatedAt: string;
}

/** 论文库左侧位置：全部 / 未归档 / 用户文件夹 */
export type FolderSelection =
  | { kind: "all" }
  | { kind: "unfiled" }
  | { kind: "folder"; id: Id };

export interface Paper {
  id: Id;
  titleEn: string;
  titleZh?: string;
  authors: Author[];
  categoryId?: Id;
  folderId?: Id;
  tagIds: Id[];
  status: PaperStatus;
  summary?: string;
  abstractEn?: string;
  abstractZh?: string;
  venue?: string;
  publicationDate?: string;
  doi?: string;
  arxivId?: string;
  sourceUrl?: string;
  pdfPath?: string;
  pdfSha256?: string;
  pageCount?: number;
  hasTextLayer?: boolean;
  favorite: boolean;
  readingPage?: number;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
  relatedPaperIds?: string[];
}

export interface Rect { x: number; y: number; width: number; height: number; }
export interface Point { x: number; y: number; }
export type NoteFontSize = "sm" | "md" | "lg";
export interface NormalizedPageGeometry { rects?: Rect[]; points?: Point[]; anchor?: Point; fontSize?: NoteFontSize; rotation?: number; }

export interface Annotation {
  id: Id;
  paperId: Id;
  page: number;
  type: AnnotationType;
  geometry: NormalizedPageGeometry;
  quote?: string;
  comment?: string;
  color: string;
  createdAt: string;
  updatedAt: string;
}

export interface VocabularyEntry {
  id: Id;
  paperId: Id;
  termEn: string;
  meaningZh: string;
  sentenceEn?: string;
  sentenceZh?: string;
  page?: number;
  annotationId?: Id;
  note?: string;
}

export interface FrameworkFigure {
  id: Id;
  paperId: Id;
  imagePath: string;
  title?: string;
  explanationEn?: string;
  explanationZh?: string;
  page?: number;
  geometry?: NormalizedPageGeometry;

  isPrimary: boolean;
}

export interface Task {
  id: Id; title: string; notes?: string; dueDate?: string; status: TaskStatus; priority: TaskPriority;
  paperId?: Id; createdAt: string; updatedAt: string; completedAt?: string;
}

/** 某天在阅读台累计停留秒数（按本地日 + 论文） */
export interface PaperDayRead {
  day: string;
  paperId: Id;
  seconds: number;
}

export interface WritingExcerpt {
  id: Id;
  paperId: Id;
  sourceText: string;
  translationZh?: string;
  purpose: string;
  personalRewrite?: string;
  page?: number;
  annotationId?: Id;
  tags: string[];
  createdAt: string;
}

export interface SavedView {
  id: Id;
  name: string;
  builtin?: boolean;
  filter: { status?: PaperStatus; categoryId?: Id; missingInfo?: boolean; uncategorized?: boolean; favorite?: boolean; folderId?: Id; unfiledOnly?: boolean };
  sorting: { id: string; desc: boolean }[];
  columnVisibility: Record<string, boolean>;
  density: "compact" | "comfortable";
}

export interface Profile { displayName: string; researchField: string; avatarPath?: string; theme: "light" | "dark" | "system"; visualTheme?: "workbench" | "lilac" | "mist" | "willow"; }

/** The key itself is deliberately never returned to the webview or stored in SQLite. */
export type TaxonomyStrictness = "strict" | "standard" | "relaxed";
export interface LlmSettings {
  baseUrl: string;
  model: string;
  autoAnalyzeOnImport: boolean;
  visionEnabled: boolean;
  apiKeySaved: boolean;
  autoClassifyOnImport: boolean;
  taxonomyStrictness: TaxonomyStrictness;
  /** OpenAI 兼容 embeddings 模型；留空则雷达推荐不做语义 rerank */
  embeddingModel?: string;
}
export interface ImportedPaper { paper: Paper; isNew: boolean; }
export interface OnlineMetadataSettings { enabled: boolean; provider: "crossref"; mailto?: string; }
export interface OnlineMetadataCandidate { titleEn?: string; authors: string[]; abstractEn?: string; venue?: string; publicationDate?: string; doi?: string; sourceUrl?: string; score?: number; }
export interface OnlineMetadataLookup { provider: "crossref"; candidates: OnlineMetadataCandidate[]; cached?: boolean; }

export interface RadarSettings {
  enabled: boolean;
  mailto?: string;
  categories: string[];
  keywords?: string[];
  defaultFilterEnabled?: boolean;
  hotLimit: number;
  newLimit: number;
  retainDays: number;
}
export interface RadarFeedPage {
  cards: RadarCard[];
  totalCount: number;
  interestFilterApplied: boolean;
}
export interface RadarCard {
  arxivId: string;
  title: string;
  abstractText?: string;
  aiSummary?: string;
  authors: string[];
  categories: string[];
  topics?: string[];
  primaryCategory?: string;
  publishedDate?: string;
  absUrl?: string;
  alphaxivUrl?: string;
  feed: string;
  rank?: number;
  upvotes?: number;
  snapshotDate: string;
  inLibrary: boolean;
  later: boolean;
  hidden: boolean;
}
export interface RadarFetchResult {
  snapshotDate: string;
  hotCount: number;
  newCount: number;
  interestCount?: number;
  errors: string[];
  status: string;
}
export interface RadarWeekHot {
  windowStart: string;
  windowEnd: string;
  coverageDays: number;
  categories: { category: string; paperCount: number; maxUpvotes: number }[];
  persistent: { arxivId: string; title: string; days: number; peakUpvotes: number }[];
}
export interface RadarDigest {
  anchorDate: string;
  kind: string;
  windowStart?: string;
  windowEnd?: string;
  coverageDays: number;
  overview: string;
  clusters: { theme: string; summary: string; papers: { id: string; title: string }[] }[];
  paperCount: number;
  model?: string;
}
export interface RadarExplanation {
  arxivId: string;
  titleEn?: string;
  titleZh?: string;
  abstractEn?: string;
  abstractZh?: string;
  summaryZh?: string;
  problem: string;
  method: string;
  finding: string;
  highlight: string;
  model?: string;
}
export interface RadarRecommendResult {
  strategy: string;
  windowDays: number;
  coverageDays: number;
  items: { card: RadarCard; reasons: string[]; score: number }[];
}
export interface RadarImportResult {
  paper: Paper;
  downloadedPdf: boolean;
  alreadyInLibrary: boolean;
}

export interface ResearchLlmSettings {
  enabled: boolean;
  baseUrl: string;
  model: string;
  apiKeySaved: boolean;
  allowWebSearch: boolean;
  maxIterations: number;
  maxTokensPerStep: number;
  reportMaxTokens: number;
  researchMode: "react" | "pipeline" | string;
  researchDepth: "quick" | "standard" | "deep" | string;
  maxReactRounds: number;
  maxToolCalls: number;
  /** auto | dashscope | zhipu | openai_responses | off */
  llmNativeWebSearch: string;
}

export interface ResearchSession {
  id: string;
  title: string;
  query: string;
  outputRequirements: string;
  workspacePath: string;
  reportPath: string;
  status: "draft" | "running" | "completed" | "failed" | string;
  reportPreview?: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ResearchSource {
  id: string;
  kind: string;
  url?: string;
  title: string;
  accessedAt: string;
  excerpt: string;
  localPaperId?: string;
  page?: number;
  storedLocally: boolean;
}

export interface ResearchStepSummary {
  fileName: string;
  kind: string;
  createdAt: string;
  label?: string;
  detail?: string;
}

export interface ResearchAttachmentInput {
  name: string;
  kind: "image" | "text" | "link";
  mime?: string;
  text?: string;
  dataBase64?: string;
  url?: string;
}

export interface ResearchAttachment {
  name: string;
  kind: string;
  mime?: string;
  path?: string;
  url?: string;
}

export interface ResearchTurnView {
  turn: number;
  question: string;
  attachments: ResearchAttachment[];
  answer: string;
  status: string;
  createdAt: string;
  error?: string;
}

export interface ResearchContextBucket {
  id: string;
  label: string;
  tokens: number;
}

export interface ResearchContextUsage {
  contextWindow: number;
  thresholdRatio: number;
  usedTokens: number;
  percentFull: number;
  nearCompaction: boolean;
  buckets: ResearchContextBucket[];
}

export interface ResearchProposal {
  id: string;
  kind: string;
  status: string;
  title: string;
  arxivId?: string;
  abstractEn?: string;
  url?: string;
  sourceId: string;
  createdAt: string;
  resolvedPaperId?: string;
}

export interface ResearchImportResult {
  paperId: string;
  title: string;
  downloadedPdf: boolean;
}

export interface McpInfo {
  command: string;
  libraryPath: string;
  tools: string[];
}

export interface LlmPageImage { page: number; dataUrl: string; }
export interface LlmAnalysisInput { text: string; candidateImages: LlmPageImage[]; }
export interface LlmVocabularySuggestion { termEn: string; meaningZh: string; sentenceEn?: string; sentenceZh?: string; page?: number; }
export interface LlmAnalysis {
  titleEn?: string; titleZh?: string; authors?: string[]; abstractEn?: string; abstractZh?: string; summary?: string;
  venue?: string; publicationDate?: string; doi?: string; sourceUrl?: string; frameworkPage?: number;
  frameworkTitle?: string; frameworkExplanationEn?: string; frameworkExplanationZh?: string; vocabulary?: LlmVocabularySuggestion[];
}
export interface LlmTaxonomyInput {
  titleEn: string;
  titleZh?: string;
  abstractEn?: string;
  abstractZh?: string;
  summary?: string;
}
export interface LlmTaxonomyResult {
  categoryId: string | null;
  tagIds: string[];
  abstain: boolean;
  reason?: string;
}
export interface DuplicateCandidate { paperId: string; title: string; reason: string; }

export type CustomFieldType = "text" | "number" | "date" | "url" | "boolean" | "select" | "multiselect";
export interface CustomFieldOption { id: Id; label: string; color: string; }
export interface CustomFieldDefinition {
  id: Id;
  name: string;
  type: CustomFieldType;
  options: CustomFieldOption[];
  position: number;
  showInTable: boolean;
  archivedAt?: string;
}
export type CustomFieldValue = string | number | boolean | string[] | null;
export interface PaperCustomFieldValue { paperId: Id; fieldId: Id; value: CustomFieldValue; updatedAt: string; }

export interface LibrarySnapshot {
  papers: Paper[];
  folders: Folder[];
  categories: Category[];
  tags: Tag[];
  annotations: Annotation[];
  vocabulary: VocabularyEntry[];
  figures: FrameworkFigure[];
  excerpts: WritingExcerpt[];
  views: SavedView[];
  profile: Profile;
  llm: LlmSettings;
  tasks: Task[];
  readingDays: PaperDayRead[];
  libraryPath: string;
  libraryNotice?: string;
  metadata: OnlineMetadataSettings;
  customFieldDefinitions: CustomFieldDefinition[];
  customFieldValues: PaperCustomFieldValue[];
}

export interface SearchHit { kind: "paper" | "pdf" | "vocabulary" | "annotation" | "excerpt"; paperId: Id; title: string; snippet: string; page?: number; score: number; }

export const uuid = () => crypto.randomUUID();
export const now = () => new Date().toISOString();

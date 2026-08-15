export type Id = string;
export type PaperStatus = "unread" | "reading" | "read" | "archived";
export type AnnotationType = "highlight" | "underline" | "text" | "ink";
export type TaskStatus = "todo" | "in_progress" | "done";
export type TaskPriority = "low" | "medium" | "high";

export interface Author { id: Id; name: string; }
export interface Category { id: Id; name: string; color: string; }
export interface Tag { id: Id; name: string; color: string; }

export interface Paper {
  id: Id;
  titleEn: string;
  titleZh?: string;
  authors: Author[];
  categoryId?: Id;
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
export interface NormalizedPageGeometry { rects?: Rect[]; points?: Point[]; rotation?: number; }

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
  filter: { status?: PaperStatus; categoryId?: Id; missingInfo?: boolean; uncategorized?: boolean };
  sorting: { id: string; desc: boolean }[];
  columnVisibility: Record<string, boolean>;
  density: "compact" | "comfortable";
}

export interface Profile { displayName: string; researchField: string; avatarPath?: string; theme: "light" | "dark" | "system"; }

/** The key itself is deliberately never returned to the webview or stored in SQLite. */
export interface LlmSettings { baseUrl: string; model: string; autoAnalyzeOnImport: boolean; visionEnabled: boolean; apiKeySaved: boolean; }
export interface ImportedPaper { paper: Paper; isNew: boolean; }
export interface OnlineMetadataSettings { enabled: boolean; provider: "crossref"; mailto?: string; }
export interface OnlineMetadataCandidate { titleEn?: string; authors: string[]; abstractEn?: string; venue?: string; publicationDate?: string; doi?: string; sourceUrl?: string; score?: number; }
export interface OnlineMetadataLookup { provider: "crossref"; candidates: OnlineMetadataCandidate[]; }

export interface LlmPageImage { page: number; dataUrl: string; }
export interface LlmAnalysisInput { text: string; candidateImages: LlmPageImage[]; }
export interface LlmVocabularySuggestion { termEn: string; meaningZh: string; sentenceEn?: string; sentenceZh?: string; page?: number; }
export interface LlmAnalysis {
  titleEn?: string; titleZh?: string; authors?: string[]; abstractEn?: string; abstractZh?: string; summary?: string;
  venue?: string; publicationDate?: string; doi?: string; sourceUrl?: string; frameworkPage?: number;
  frameworkTitle?: string; frameworkExplanationEn?: string; frameworkExplanationZh?: string; vocabulary?: LlmVocabularySuggestion[];
}
export interface DuplicateCandidate { paperId: string; title: string; reason: string; }

export interface LibrarySnapshot {
  papers: Paper[];
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
  libraryPath: string;
  metadata: OnlineMetadataSettings;
}

export interface SearchHit { kind: "paper" | "pdf" | "vocabulary" | "annotation" | "excerpt"; paperId: Id; title: string; snippet: string; page?: number; score: number; }

export const uuid = () => crypto.randomUUID();
export const now = () => new Date().toISOString();

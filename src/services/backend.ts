import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { seedSnapshot } from "../seed";
import type { Annotation, Category, DuplicateCandidate, FrameworkFigure, ImportedPaper, LibrarySnapshot, LlmAnalysis, LlmAnalysisInput, LlmSettings, OnlineMetadataLookup, OnlineMetadataSettings, Paper, Profile, SavedView, SearchHit, Tag, Task, VocabularyEntry, WritingExcerpt } from "../types";

const STORAGE_KEY = "papernest-preview-v1";
export const isTauri = () => "__TAURI_INTERNALS__" in window;

function loadPreview(): LibrarySnapshot {
  try { const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "") as Partial<LibrarySnapshot>; return { ...structuredClone(seedSnapshot), ...saved, llm: saved.llm ?? structuredClone(seedSnapshot.llm) }; }
  catch { return structuredClone(seedSnapshot); }
}
function persistPreview(snapshot: LibrarySnapshot) { localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot)); }

export const backend = {
  async initialize(): Promise<LibrarySnapshot> {
    return isTauri() ? invoke("initialize_library") : loadPreview();
  },
  async savePaper(paper: Paper): Promise<void> {
    if (isTauri()) return invoke("save_paper", { paper });
    const data = loadPreview(); const index = data.papers.findIndex(p => p.id === paper.id);
    index >= 0 ? data.papers[index] = paper : data.papers.unshift(paper); persistPreview(data);
  },
  async saveAnnotation(annotation: Annotation): Promise<void> {
    if (isTauri()) return invoke("save_annotation", { annotation });
    const data = loadPreview(); const index = data.annotations.findIndex(a => a.id === annotation.id);
    index >= 0 ? data.annotations[index] = annotation : data.annotations.push(annotation); persistPreview(data);
  },
  async deleteAnnotation(id: string): Promise<void> {
    if (isTauri()) return invoke("delete_annotation", { id });
    const data = loadPreview(); data.annotations = data.annotations.filter(a => a.id !== id); persistPreview(data);
  },
  async saveVocabulary(entry: VocabularyEntry): Promise<void> {
    if (isTauri()) return invoke("save_vocabulary", { entry });
    const data = loadPreview(); const index = data.vocabulary.findIndex(v => v.id === entry.id);
    index >= 0 ? data.vocabulary[index] = entry : data.vocabulary.push(entry); persistPreview(data);
  },
  async saveExcerpt(entry: WritingExcerpt): Promise<void> {
    if (isTauri()) return invoke("save_excerpt", { entry });
    const data = loadPreview(); const index = data.excerpts.findIndex(v => v.id === entry.id);
    index >= 0 ? data.excerpts[index] = entry : data.excerpts.push(entry); persistPreview(data);
  },
  async deleteVocabulary(id: string): Promise<void> {
    if (isTauri()) return invoke("delete_vocabulary", { id });
    const data = loadPreview(); data.vocabulary = data.vocabulary.filter(item => item.id !== id); persistPreview(data);
  },
  async deleteExcerpt(id: string): Promise<void> {
    if (isTauri()) return invoke("delete_excerpt", { id });
    const data = loadPreview(); data.excerpts = data.excerpts.filter(item => item.id !== id); persistPreview(data);
  },
  async purgePaper(id: string): Promise<void> {
    if (isTauri()) return invoke("purge_paper", { id });
    const data = loadPreview();
    const paper = data.papers.find(item => item.id === id);
    if (!paper?.deletedAt) throw new Error("请先移入回收站再永久删除");
    data.papers = data.papers.filter(item => item.id !== id);
    data.annotations = data.annotations.filter(item => item.paperId !== id);
    data.vocabulary = data.vocabulary.filter(item => item.paperId !== id);
    data.excerpts = data.excerpts.filter(item => item.paperId !== id);
    data.figures = data.figures.filter(item => item.paperId !== id);
    persistPreview(data);
  },
  async saveTask(task: Task): Promise<void> {
    if (isTauri()) return invoke("save_task", { task });
    const data = loadPreview(); const index = data.tasks.findIndex(item => item.id === task.id);
    index >= 0 ? data.tasks[index] = task : data.tasks.push(task); persistPreview(data);
  },
  async deleteTask(id: string): Promise<void> {
    if (isTauri()) return invoke("delete_task", { id });
    const data = loadPreview(); data.tasks = data.tasks.filter(task => task.id !== id); persistPreview(data);
  },
  async saveFigure(figure: FrameworkFigure, bytes?: number[]): Promise<void> {
    if (isTauri()) return invoke("save_figure", { figure, bytes });
    const data = loadPreview(); const index = data.figures.findIndex(v => v.id === figure.id);
    index >= 0 ? data.figures[index] = figure : data.figures.push(figure); persistPreview(data);
  },
  async saveCategory(category: Category): Promise<void> {
    if (isTauri()) return invoke("save_category", { category });
    const data = loadPreview(); const index = data.categories.findIndex(v => v.id === category.id);
    index >= 0 ? data.categories[index] = category : data.categories.push(category); persistPreview(data);
  },
  async saveTag(tag: Tag): Promise<void> {
    if (isTauri()) return invoke("save_tag", { tag });
    const data = loadPreview(); const index = data.tags.findIndex(v => v.id === tag.id);
    index >= 0 ? data.tags[index] = tag : data.tags.push(tag); persistPreview(data);
  },
  async mergeTaxonomy(kind: "category" | "tag", sourceId: string, targetId?: string): Promise<void> {
    if (isTauri()) return invoke("merge_taxonomy", { kind, sourceId, targetId });
    const data = loadPreview();
    if (kind === "category") { data.papers.forEach(p => { if (p.categoryId === sourceId) p.categoryId = targetId; }); data.categories = data.categories.filter(c => c.id !== sourceId); }
    else { data.papers.forEach(p => { if (p.tagIds.includes(sourceId)) p.tagIds = [...new Set(p.tagIds.map(id => id === sourceId ? targetId : id).filter(Boolean) as string[])]; }); data.tags = data.tags.filter(t => t.id !== sourceId); }
    persistPreview(data);
  },
  async saveView(view: SavedView): Promise<void> {
    if (isTauri()) return invoke("save_view", { view });
    const data = loadPreview(); const index = data.views.findIndex(v => v.id === view.id);
    index >= 0 ? data.views[index] = view : data.views.push(view); persistPreview(data);
  },
  async saveProfile(profile: Profile): Promise<void> {
    if (isTauri()) return invoke("save_profile", { profile });
    const data = loadPreview(); data.profile = profile; persistPreview(data);
  },
  async saveOnlineMetadataSettings(settings: OnlineMetadataSettings): Promise<OnlineMetadataSettings> { if (isTauri()) return invoke("save_online_metadata_settings", { settings }); const data = loadPreview(); data.metadata = settings; persistPreview(data); return settings; },
  async lookupOnlineMetadata(paperId: string): Promise<OnlineMetadataLookup> { if (!isTauri()) throw new Error("浏览器预览模式不支持在线元数据查询"); return invoke("lookup_online_metadata", { paperId }); },
  async saveLlmSettings(settings: LlmSettings, apiKey?: string): Promise<LlmSettings> {
    if (isTauri()) return invoke("save_llm_settings", { settings, apiKey });
    const data = loadPreview(); data.llm = { ...settings, apiKeySaved: Boolean(apiKey) || settings.apiKeySaved }; persistPreview(data); return data.llm;
  },
  async testLlmConnection(): Promise<void> { if (!isTauri()) throw new Error("浏览器预览模式不支持 LLM 连接"); return invoke("test_llm_connection"); },
  async translateText(endpoint: string, text: string, apiKey?: string): Promise<string> {
    if (isTauri()) return invoke("translate_text", { endpoint, text, apiKey });
    const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ q: text, source: "en", target: "zh-Hans", format: "text", api_key: apiKey }) });
    const payload = await response.json() as { translatedText?: string; error?: string };
    if (!response.ok || !payload.translatedText) throw new Error(payload.error ?? `Translation request failed (${response.status}).`);
    return payload.translatedText;
  },
  async translateWithLlm(text: string, mode: "term" | "sentence" = "sentence", context?: string): Promise<string> {
    if (!isTauri()) throw new Error("浏览器预览模式不支持 LLM 翻译");
    return invoke("translate_with_llm", { text, mode, context });
  },
  async analyzePaper(paperId: string, input: LlmAnalysisInput): Promise<LlmAnalysis> { if (!isTauri()) throw new Error("浏览器预览模式不支持 LLM 分析"); return invoke("analyze_paper_with_llm", { paperId, input }); },
  async findDuplicateCandidates(paperId: string): Promise<DuplicateCandidate[]> { return isTauri() ? invoke("find_duplicate_candidates", { paperId }) : []; },

  async chooseAndImportPdfs(): Promise<ImportedPaper[]> {
    if (!isTauri()) return [];
    const paths = await open({ multiple: true, filters: [{ name: "PDF", extensions: ["pdf"] }] });
    return paths ? invoke<ImportedPaper[]>("import_pdfs", { paths: Array.isArray(paths) ? paths : [paths] }) : [];
  },
  async chooseAndImportCitations(): Promise<Paper[]> {
    if (!isTauri()) return [];
    const paths = await open({ multiple: true, filters: [{ name: "文献数据", extensions: ["bib", "bibtex", "ris"] }] });
    return paths ? invoke("import_citation_files", { paths: Array.isArray(paths) ? paths : [paths] }) : [];
  },
  async readPdf(path: string): Promise<Uint8Array> {
    if (!isTauri()) throw new Error("浏览器预览模式不能读取本地 PDF");
    const bytes = await invoke<number[]>("read_managed_file", { path }); return new Uint8Array(bytes);
  },
  async indexPdf(paperId: string, pages: { page: number; text: string }[]): Promise<void> {
    if (isTauri()) return invoke("index_pdf_pages", { paperId, pages });
  },
  async indexedPdfPages(paperId: string): Promise<{ page: number; text: string }[]> {
    return isTauri() ? invoke("indexed_pdf_pages", { paperId }) : [];
  },
  async ocrPage(paperId: string, page: number, png: Uint8Array): Promise<string> { if (!isTauri()) throw new Error("浏览器预览模式不支持本地 OCR"); return invoke("ocr_page_image", { paperId, page, png: Array.from(png) }); },
  async chooseLibraryLocation(): Promise<string | null> { if (!isTauri()) return null; const parent = await open({ directory: true, multiple: false }); if (!parent || Array.isArray(parent)) return null; return invoke("prepare_library_relocation", { targetParent: parent }); },
  async search(query: string): Promise<SearchHit[]> { return isTauri() ? invoke("search_library", { query }) : []; },
  async exportBytes(defaultName: string, bytes: Uint8Array): Promise<boolean> {
    if (!isTauri()) { const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/pdf" })); a.download = defaultName; a.click(); return true; }
    const path = await save({ defaultPath: defaultName, filters: [{ name: "PDF", extensions: ["pdf"] }] });
    if (!path) return false; await invoke("write_export_file", { path, bytes: Array.from(bytes) }); return true;
  },
  async backup(): Promise<string | null> { return isTauri() ? invoke("create_backup") : null; },
  async restore(): Promise<boolean> {
    if (!isTauri()) return false;
    const path = await open({ multiple: false, filters: [{ name: "PaperNest 备份", extensions: ["zip"] }] });
    if (!path || Array.isArray(path)) return false; await invoke("restore_backup", { path }); return true;
  },
  resetPreview() { localStorage.removeItem(STORAGE_KEY); }
};

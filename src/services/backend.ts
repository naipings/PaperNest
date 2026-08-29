import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { seedSnapshot } from "../seed";
import type { Annotation, Category, CustomFieldDefinition, DuplicateCandidate, Folder, FrameworkFigure, ImportedPaper, LibrarySnapshot, LlmAnalysis, LlmAnalysisInput, LlmSettings, LlmTaxonomyInput, LlmTaxonomyResult, McpInfo, OnlineMetadataLookup, OnlineMetadataSettings, Paper, PaperCustomFieldValue, Profile, RadarDigest, RadarExplanation, RadarFeedPage, RadarFetchResult, RadarImportResult, RadarRecommendResult, RadarSettings, RadarCard, RadarWeekHot, ResearchAttachmentInput, ResearchImportResult, ResearchLlmSettings, ResearchProposal, ResearchSession, ResearchSource, ResearchStepSummary, ResearchTurnView, SavedView, SearchHit, Tag, Task, VocabularyEntry, WritingExcerpt } from "../types";
import { folderSiblingNameTaken } from "../lib/folders";
import { dayKey } from "../lib/readingActivity";

const STORAGE_KEY = "papernest-preview-v1";
export const isTauri = () => "__TAURI_INTERNALS__" in window;

function loadPreview(): LibrarySnapshot {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "") as Partial<LibrarySnapshot>;
    return {
      ...structuredClone(seedSnapshot),
      ...saved,
      folders: saved.folders ?? structuredClone(seedSnapshot.folders),
      llm: saved.llm ?? structuredClone(seedSnapshot.llm),
      readingDays: saved.readingDays ?? structuredClone(seedSnapshot.readingDays),
      customFieldDefinitions: saved.customFieldDefinitions ?? structuredClone(seedSnapshot.customFieldDefinitions),
      customFieldValues: saved.customFieldValues ?? structuredClone(seedSnapshot.customFieldValues),
    };
  }
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
  async addReadingSeconds(paperId: string, day: string, seconds: number): Promise<number> {
    if (seconds <= 0) return 0;
    if (isTauri()) return invoke("add_reading_seconds", { paperId, day, seconds });
    const data = loadPreview();
    const key = day || dayKey(new Date());
    const index = data.readingDays.findIndex(row => row.day === key && row.paperId === paperId);
    if (index >= 0) data.readingDays[index] = { ...data.readingDays[index], seconds: data.readingDays[index].seconds + seconds };
    else data.readingDays.push({ day: key, paperId, seconds });
    persistPreview(data);
    return data.readingDays.find(row => row.day === key && row.paperId === paperId)!.seconds;
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
    data.readingDays = data.readingDays.filter(item => item.paperId !== id);
    data.customFieldValues = data.customFieldValues.filter(item => item.paperId !== id);
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
  async deleteFigure(id: string): Promise<void> {
    if (isTauri()) return invoke("delete_figure", { id });
    const data = loadPreview(); data.figures = data.figures.filter(item => item.id !== id); persistPreview(data);
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
  async saveFolder(folder: Folder): Promise<void> {
    if (isTauri()) return invoke("save_folder", { folder });
    const data = loadPreview();
    const index = data.folders.findIndex(item => item.id === folder.id);
    if (folder.parentId) {
      if (folder.parentId === folder.id) throw new Error("不能将文件夹设为自己的子文件夹");
      if (!data.folders.some(item => item.id === folder.parentId)) throw new Error("父文件夹不存在");
      const descendantIds = new Set<string>([folder.id]);
      let grew = true;
      while (grew) {
        grew = false;
        for (const item of data.folders) {
          if (item.parentId && descendantIds.has(item.parentId) && !descendantIds.has(item.id)) {
            descendantIds.add(item.id);
            grew = true;
          }
        }
      }
      if (descendantIds.has(folder.parentId)) throw new Error("不能将文件夹移动到自己的子文件夹下");
    }
    if (folderSiblingNameTaken(data.folders, folder.name, folder.parentId, folder.id)) {
      throw new Error("同一层级已存在同名文件夹");
    }
    index >= 0 ? data.folders[index] = folder : data.folders.push(folder);
    persistPreview(data);
  },
  async deleteFolder(id: string): Promise<void> {
    if (isTauri()) return invoke("delete_folder", { id });
    const data = loadPreview();
    const subtree = new Set<string>([id]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const item of data.folders) {
        if (item.parentId && subtree.has(item.parentId) && !subtree.has(item.id)) {
          subtree.add(item.id);
          grew = true;
        }
      }
    }
    if (data.papers.some(paper => !paper.deletedAt && paper.folderId && subtree.has(paper.folderId))) {
      throw new Error("不能删除非空文件夹。请先移出或删除其中的论文。");
    }
    data.papers.forEach(paper => { if (paper.folderId && subtree.has(paper.folderId)) paper.folderId = undefined; });
    data.folders = data.folders.filter(item => !subtree.has(item.id));
    persistPreview(data);
  },
  async movePapersToFolder(paperIds: string[], folderId?: string | null): Promise<void> {
    if (isTauri()) return invoke("move_papers_to_folder", { paperIds, folderId: folderId ?? null });
    const data = loadPreview();
    if (folderId && !data.folders.some(item => item.id === folderId)) throw new Error("目标文件夹不存在");
    const stamp = new Date().toISOString();
    data.papers.forEach(paper => {
      if (!paperIds.includes(paper.id)) return;
      paper.folderId = folderId || undefined;
      paper.updatedAt = stamp;
    });
    persistPreview(data);
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
  async saveCustomFieldDefinition(definition: CustomFieldDefinition): Promise<CustomFieldDefinition> {
    if (isTauri()) return invoke("save_custom_field_definition", { definition });
    const data = loadPreview();
    const index = data.customFieldDefinitions.findIndex(item => item.id === definition.id);
    index >= 0 ? data.customFieldDefinitions[index] = definition : data.customFieldDefinitions.push(definition);
    persistPreview(data);
    return definition;
  },
  async archiveCustomFieldDefinition(fieldId: string): Promise<number> {
    if (isTauri()) return invoke("archive_custom_field_definition", { fieldId });
    const data = loadPreview();
    const field = data.customFieldDefinitions.find(item => item.id === fieldId);
    if (field) field.archivedAt = new Date().toISOString();
    persistPreview(data);
    return data.customFieldValues.filter(item => item.fieldId === fieldId).length;
  },
  async savePaperCustomFieldValues(paperId: string, values: PaperCustomFieldValue[]): Promise<void> {
    if (isTauri()) return invoke("save_paper_custom_field_values", { paperId, values });
    const data = loadPreview();
    for (const value of values) {
      data.customFieldValues = data.customFieldValues.filter(item => !(item.paperId === paperId && item.fieldId === value.fieldId));
      if (value.value == null || value.value === "" || (Array.isArray(value.value) && !value.value.length)) continue;
      data.customFieldValues.push(value);
    }
    persistPreview(data);
  },
  async saveLlmSettings(settings: LlmSettings, apiKey?: string): Promise<LlmSettings> {
    if (isTauri()) return invoke("save_llm_settings", { settings, apiKey });
    const data = loadPreview(); data.llm = { ...settings, apiKeySaved: Boolean(apiKey) || settings.apiKeySaved }; persistPreview(data); return data.llm;
  },
  async testLlmConnection(): Promise<void> { if (!isTauri()) throw new Error("浏览器预览模式不支持 LLM 连接"); return invoke("test_llm_connection"); },
  async localEmbeddingStatus(): Promise<{ modelId: string; displayName: string; hfUrl: string; cacheDir: string; installed: boolean; ready: boolean; approxSizeHint: string; note: string }> {
    if (!isTauri()) {
      return {
        modelId: "local:bge-small-en-v1.5",
        displayName: "BAAI/bge-small-en-v1.5",
        hfUrl: "https://huggingface.co/BAAI/bge-small-en-v1.5",
        cacheDir: "",
        installed: false,
        ready: false,
        approxSizeHint: "约 130MB（ONNX）",
        note: "浏览器预览模式不支持本地向量。",
      };
    }
    return invoke("local_embedding_status");
  },
  async ensureLocalEmbeddingModel(): Promise<{ modelId: string; displayName: string; hfUrl: string; cacheDir: string; installed: boolean; ready: boolean; approxSizeHint: string; note: string }> {
    if (!isTauri()) throw new Error("浏览器预览模式不支持本地下载向量模型");
    return invoke("ensure_local_embedding_model");
  },
  async enableLocalEmbeddingModel(): Promise<LlmSettings> {
    if (!isTauri()) throw new Error("浏览器预览模式不支持本地向量模型");
    return invoke("enable_local_embedding_model");
  },
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
  async classifyPaperTaxonomy(input: LlmTaxonomyInput): Promise<LlmTaxonomyResult> {
    if (!isTauri()) {
      return { categoryId: null, tagIds: [], abstain: true, reason: "浏览器预览模式不支持自动分类" };
    }
    return invoke("classify_paper_taxonomy", { input });
  },
  async openExternalUrl(url: string): Promise<void> {
    const trimmed = url.trim();
    if (!trimmed) return;
    if (isTauri()) return invoke("open_external_url", { url: trimmed });
    const href = /^https?:\/\//i.test(trimmed) ? trimmed : trimmed.startsWith("10.") ? `https://doi.org/${trimmed}` : `https://${trimmed}`;
    window.open(href, "_blank", "noopener,noreferrer");
  },
  async findDuplicateCandidates(paperId: string): Promise<DuplicateCandidate[]> { return isTauri() ? invoke("find_duplicate_candidates", { paperId }) : []; },

  async chooseAndImportPdfs(folderId?: string | null): Promise<ImportedPaper[]> {
    if (!isTauri()) return [];
    const paths = await open({ multiple: true, filters: [{ name: "PDF", extensions: ["pdf"] }] });
    return paths ? invoke<ImportedPaper[]>("import_pdfs", { paths: Array.isArray(paths) ? paths : [paths], folderId: folderId ?? null }) : [];
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
  async radarGetSettings(): Promise<RadarSettings> {
    if (!isTauri()) throw new Error("浏览器预览模式不支持论文雷达");
    return invoke("radar_get_settings");
  },
  async radarSaveSettings(settings: RadarSettings): Promise<RadarSettings> {
    if (!isTauri()) throw new Error("浏览器预览模式不支持论文雷达");
    return invoke("radar_save_settings", { settings });
  },
  async radarCategoryCatalog(): Promise<[string, string][]> {
    if (!isTauri()) return [];
    return invoke("radar_category_catalog");
  },
  async radarListDates(): Promise<string[]> {
    if (!isTauri()) return [];
    return invoke("radar_list_dates");
  },
  async radarListFeed(date: string, feed: string, interestFilter?: boolean, includeHidden?: boolean): Promise<RadarFeedPage> {
    if (!isTauri()) return { cards: [], totalCount: 0, interestFilterApplied: false };
    return invoke("radar_list_feed", { date, feed, interestFilter: interestFilter ?? null, includeHidden: includeHidden ?? null });
  },
  async radarFetchToday(): Promise<RadarFetchResult> {
    if (!isTauri()) throw new Error("浏览器预览模式不支持论文雷达");
    return invoke("radar_fetch_today");
  },
  async radarWeekHot(anchorDate?: string): Promise<RadarWeekHot> {
    if (!isTauri()) throw new Error("浏览器预览模式不支持论文雷达");
    return invoke("radar_week_hot", { anchorDate: anchorDate ?? null });
  },
  async radarSetUserState(arxivId: string, later?: boolean, hidden?: boolean): Promise<void> {
    if (!isTauri()) return;
    return invoke("radar_set_user_state", { arxivId, later: later ?? null, hidden: hidden ?? null });
  },
  async radarRecommend(anchorDate?: string, interestFilter?: boolean): Promise<RadarRecommendResult> {
    if (!isTauri()) throw new Error("浏览器预览模式不支持论文雷达");
    return invoke("radar_recommend", { anchorDate: anchorDate ?? null, interestFilter: interestFilter ?? null });
  },
  async radarGenerateDigest(kind: "daily" | "weekly", anchorDate?: string): Promise<RadarDigest> {
    if (!isTauri()) throw new Error("浏览器预览模式不支持论文雷达");
    return invoke("radar_generate_digest", { kind, anchorDate: anchorDate ?? null });
  },
  async radarGetDigest(kind: "daily" | "weekly", anchorDate: string): Promise<RadarDigest | null> {
    if (!isTauri()) return null;
    return invoke("radar_get_digest", { kind, anchorDate });
  },
  async radarExplainPaper(arxivId: string): Promise<RadarExplanation> {
    if (!isTauri()) throw new Error("浏览器预览模式不支持论文雷达");
    return invoke("radar_explain_paper", { arxivId });
  },
  async radarGetExplanation(arxivId: string): Promise<RadarExplanation | null> {
    if (!isTauri()) return null;
    return invoke("radar_get_explanation", { arxivId });
  },
  async radarListExplainedIds(): Promise<string[]> {
    if (!isTauri()) return [];
    return invoke("radar_list_explained_ids");
  },
  async radarDeleteExplanation(arxivId: string): Promise<void> {
    if (!isTauri()) return;
    return invoke("radar_delete_explanation", { arxivId });
  },
  async radarImportToLibrary(arxivId: string, downloadPdf = true, folderId?: string | null): Promise<RadarImportResult> {
    if (!isTauri()) throw new Error("浏览器预览模式不支持论文雷达");
    return invoke("radar_import_to_library", { arxivId, downloadPdf, folderId: folderId ?? null });
  },
  async researchGetSettings(): Promise<ResearchLlmSettings> {
    if (!isTauri()) throw new Error("浏览器预览模式不支持文献调研");
    return invoke("research_get_settings");
  },
  async researchSaveSettings(settings: ResearchLlmSettings, apiKey?: string): Promise<ResearchLlmSettings> {
    if (!isTauri()) throw new Error("浏览器预览模式不支持文献调研");
    return invoke("research_save_settings", { settings, apiKey: apiKey ?? null });
  },
  async researchTestConnection(): Promise<void> {
    if (!isTauri()) throw new Error("浏览器预览模式不支持文献调研");
    return invoke("research_test_connection");
  },
  async researchListSessions(): Promise<ResearchSession[]> {
    if (!isTauri()) return [];
    return invoke("research_list_sessions");
  },
  async researchCreateSession(input: { query: string; outputRequirements?: string; workspacePath?: string; title?: string; attachments?: ResearchAttachmentInput[] }): Promise<ResearchSession> {
    if (!isTauri()) throw new Error("浏览器预览模式不支持文献调研");
    return invoke("research_create_session", { input });
  },
  async researchGetSession(id: string): Promise<ResearchSession> {
    if (!isTauri()) throw new Error("浏览器预览模式不支持文献调研");
    return invoke("research_get_session", { id });
  },
  async researchListTurns(id: string): Promise<ResearchTurnView[]> {
    if (!isTauri()) return [];
    return invoke("research_list_turns", { id });
  },
  async researchContinueSession(id: string, question: string, attachments: ResearchAttachmentInput[]): Promise<ResearchSession> {
    if (!isTauri()) throw new Error("浏览器预览模式不支持文献调研");
    return invoke("research_continue_session", { input: { id, question, attachments } });
  },
  async researchExportReport(id: string): Promise<string> {
    if (!isTauri()) throw new Error("浏览器预览模式不支持文献调研");
    return invoke("research_export_report", { id });
  },
  async researchReadSources(id: string): Promise<ResearchSource[]> {
    if (!isTauri()) return [];
    return invoke("research_read_sources", { id });
  },
  async researchListSteps(id: string): Promise<ResearchStepSummary[]> {
    if (!isTauri()) return [];
    return invoke("research_list_steps", { id });
  },
  async researchRunSession(id: string): Promise<ResearchSession> {
    if (!isTauri()) throw new Error("浏览器预览模式不支持文献调研");
    return invoke("research_run_session", { id });
  },
  async researchCancelSession(id: string): Promise<ResearchSession> {
    if (!isTauri()) throw new Error("浏览器预览模式不支持文献调研");
    return invoke("research_cancel_session", { id });
  },
  async researchResumeSession(id: string, boundarySeq?: number): Promise<ResearchSession> {
    if (!isTauri()) throw new Error("浏览器预览模式不支持文献调研");
    return invoke("research_resume_session", { input: { id, boundarySeq } });
  },
  async researchForkSession(id: string, boundarySeq?: number, title?: string): Promise<ResearchSession> {
    if (!isTauri()) throw new Error("浏览器预览模式不支持文献调研");
    return invoke("research_fork_session", { input: { id, boundarySeq, title } });
  },
  async researchOpenWorkspace(id: string): Promise<void> {
    if (!isTauri()) return;
    return invoke("research_open_workspace", { id });
  },
  async researchDeleteSession(id: string): Promise<void> {
    if (!isTauri()) return;
    return invoke("research_delete_session", { id });
  },
  async researchListProposals(sessionId: string): Promise<ResearchProposal[]> {
    if (!isTauri()) return [];
    return invoke("research_list_proposals", { sessionId });
  },
  async researchApproveProposal(sessionId: string, proposalId: string, downloadPdf: boolean): Promise<ResearchImportResult> {
    if (!isTauri()) throw new Error("浏览器预览模式不支持文献调研");
    return invoke("research_approve_proposal", { sessionId, proposalId, downloadPdf });
  },
  async researchRejectProposal(sessionId: string, proposalId: string): Promise<void> {
    if (!isTauri()) return;
    return invoke("research_reject_proposal", { sessionId, proposalId });
  },
  async mcpGetInfo(): Promise<McpInfo> {
    if (!isTauri()) throw new Error("浏览器预览模式不支持 MCP");
    return invoke("mcp_get_info");
  },
  async researchChooseWorkspace(): Promise<string | null> {
    if (!isTauri()) return null;
    const path = await open({ directory: true, multiple: false });
    if (!path || Array.isArray(path)) return null;
    return path;
  },
  resetPreview() { localStorage.removeItem(STORAGE_KEY); }
};

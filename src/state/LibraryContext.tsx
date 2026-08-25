import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { backend } from "../services/backend";
import type { Annotation, Category, CustomFieldDefinition, Folder, FrameworkFigure, LibrarySnapshot, Paper, PaperCustomFieldValue, Profile, SavedView, Tag, Task, VocabularyEntry, WritingExcerpt } from "../types";

interface LibraryContextValue {
  data?: LibrarySnapshot; loading: boolean; error?: string;
  importBusy: string; importNotice: string;
  setImportBusy(value: string): void; setImportNotice(value: string): void;
  refresh(): Promise<void>; savePaper(paper: Paper): Promise<void>; saveAnnotation(annotation: Annotation): Promise<void>;
  deleteAnnotation(id: string): Promise<void>; saveVocabulary(entry: VocabularyEntry): Promise<void>; deleteVocabulary(id: string): Promise<void>;
  saveExcerpt(entry: WritingExcerpt): Promise<void>; deleteExcerpt(id: string): Promise<void>; purgePaper(id: string): Promise<void>;
  saveTask(task: Task): Promise<void>; deleteTask(id: string): Promise<void>;
  addReadingSeconds(paperId: string, day: string, seconds: number): Promise<void>;
  saveFigure(figure: FrameworkFigure, bytes?: number[]): Promise<void>; deleteFigure(id: string): Promise<void>; saveCategory(category: Category): Promise<void>; saveTag(tag: Tag): Promise<void>;
  saveFolder(folder: Folder): Promise<void>; deleteFolder(id: string): Promise<void>;
  movePapersToFolder(paperIds: string[], folderId?: string | null): Promise<void>;
  mergeTaxonomy(kind: "category" | "tag", sourceId: string, targetId?: string): Promise<void>; saveView(view: SavedView): Promise<void>; saveProfile(profile: Profile): Promise<void>;
  saveCustomFieldDefinition(definition: CustomFieldDefinition): Promise<void>;
  archiveCustomFieldDefinition(fieldId: string): Promise<void>;
  savePaperCustomFieldValues(paperId: string, values: PaperCustomFieldValue[]): Promise<void>;
}

const LibraryContext = createContext<LibraryContextValue | null>(null);

export function LibraryProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<LibrarySnapshot>(); const [loading, setLoading] = useState(true); const [error, setError] = useState<string>();
  const [importBusy, setImportBusy] = useState(""); const [importNotice, setImportNotice] = useState("");
  const refresh = useCallback(async () => { try { setError(undefined); setData(await backend.initialize()); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setLoading(false); } }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  const wrap = useCallback(<T,>(fn: (value: T) => Promise<void>) => async (value: T) => { await fn(value); await refresh(); }, [refresh]);
  const addReadingSeconds = useCallback(async (paperId: string, day: string, seconds: number) => {
    const total = await backend.addReadingSeconds(paperId, day, seconds);
    setData(prev => {
      if (!prev) return prev;
      const readingDays = [...(prev.readingDays ?? [])];
      const index = readingDays.findIndex(row => row.day === day && row.paperId === paperId);
      if (index >= 0) readingDays[index] = { ...readingDays[index], seconds: total };
      else readingDays.push({ day, paperId, seconds: total });
      return { ...prev, readingDays };
    });
  }, []);
  const value = useMemo<LibraryContextValue>(() => ({ data, loading, error, importBusy, importNotice, setImportBusy, setImportNotice, refresh,
    savePaper: wrap(backend.savePaper), saveAnnotation: wrap(backend.saveAnnotation), deleteAnnotation: wrap(backend.deleteAnnotation),
    saveVocabulary: wrap(backend.saveVocabulary), deleteVocabulary: async id => { await backend.deleteVocabulary(id); await refresh(); },
    saveExcerpt: wrap(backend.saveExcerpt), deleteExcerpt: async id => { await backend.deleteExcerpt(id); await refresh(); },
    purgePaper: async id => { await backend.purgePaper(id); await refresh(); },
    addReadingSeconds,
    saveFigure: async (figure, bytes) => { await backend.saveFigure(figure, bytes); await refresh(); },
    deleteFigure: async id => { await backend.deleteFigure(id); await refresh(); },
    saveCategory: wrap(backend.saveCategory), saveTag: wrap(backend.saveTag),
    saveFolder: wrap(backend.saveFolder),
    deleteFolder: async id => { await backend.deleteFolder(id); await refresh(); },
    movePapersToFolder: async (paperIds, folderId) => { await backend.movePapersToFolder(paperIds, folderId); await refresh(); },
    mergeTaxonomy: async (kind, sourceId, targetId) => { await backend.mergeTaxonomy(kind, sourceId, targetId); await refresh(); },
    saveView: wrap(backend.saveView), saveProfile: wrap(backend.saveProfile),
    saveCustomFieldDefinition: async definition => { await backend.saveCustomFieldDefinition(definition); await refresh(); },
    archiveCustomFieldDefinition: async fieldId => { await backend.archiveCustomFieldDefinition(fieldId); await refresh(); },
    savePaperCustomFieldValues: async (paperId, values) => { await backend.savePaperCustomFieldValues(paperId, values); await refresh(); },
    saveTask: wrap(backend.saveTask), deleteTask: async id => { await backend.deleteTask(id); await refresh(); },
  }), [data, loading, error, importBusy, importNotice, refresh, wrap, addReadingSeconds]);
  return <LibraryContext.Provider value={value}>{children}</LibraryContext.Provider>;
}

export function useLibrary() { const value = useContext(LibraryContext); if (!value) throw new Error("LibraryProvider missing"); return value; }

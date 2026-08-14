import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { backend } from "../services/backend";
import type { Annotation, Category, FrameworkFigure, LibrarySnapshot, Paper, Profile, SavedView, Tag, Task, VocabularyEntry, WritingExcerpt } from "../types";

interface LibraryContextValue {
  data?: LibrarySnapshot; loading: boolean; error?: string;
  refresh(): Promise<void>; savePaper(paper: Paper): Promise<void>; saveAnnotation(annotation: Annotation): Promise<void>;
  deleteAnnotation(id: string): Promise<void>; saveVocabulary(entry: VocabularyEntry): Promise<void>; saveExcerpt(entry: WritingExcerpt): Promise<void>;
  saveTask(task: Task): Promise<void>; deleteTask(id: string): Promise<void>;
  saveFigure(figure: FrameworkFigure, bytes?: number[]): Promise<void>; saveCategory(category: Category): Promise<void>; saveTag(tag: Tag): Promise<void>;
  mergeTaxonomy(kind: "category" | "tag", sourceId: string, targetId?: string): Promise<void>; saveView(view: SavedView): Promise<void>; saveProfile(profile: Profile): Promise<void>;
}

const LibraryContext = createContext<LibraryContextValue | null>(null);

export function LibraryProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<LibrarySnapshot>(); const [loading, setLoading] = useState(true); const [error, setError] = useState<string>();
  const refresh = useCallback(async () => { try { setError(undefined); setData(await backend.initialize()); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setLoading(false); } }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  const wrap = useCallback(<T,>(fn: (value: T) => Promise<void>) => async (value: T) => { await fn(value); await refresh(); }, [refresh]);
  const value = useMemo<LibraryContextValue>(() => ({ data, loading, error, refresh,
    savePaper: wrap(backend.savePaper), saveAnnotation: wrap(backend.saveAnnotation), deleteAnnotation: wrap(backend.deleteAnnotation),
    saveVocabulary: wrap(backend.saveVocabulary), saveExcerpt: wrap(backend.saveExcerpt),
    saveFigure: async (figure, bytes) => { await backend.saveFigure(figure, bytes); await refresh(); },
    saveCategory: wrap(backend.saveCategory), saveTag: wrap(backend.saveTag),
    mergeTaxonomy: async (kind, sourceId, targetId) => { await backend.mergeTaxonomy(kind, sourceId, targetId); await refresh(); },
    saveView: wrap(backend.saveView), saveProfile: wrap(backend.saveProfile),
    saveTask: wrap(backend.saveTask), deleteTask: async id => { await backend.deleteTask(id); await refresh(); },
  }), [data, loading, error, refresh, wrap]);
  return <LibraryContext.Provider value={value}>{children}</LibraryContext.Provider>;
}

export function useLibrary() { const value = useContext(LibraryContext); if (!value) throw new Error("LibraryProvider missing"); return value; }

import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, LoaderCircle } from "lucide-react";
import { Sidebar, type Screen } from "./components/Sidebar";
import { Topbar } from "./components/LlmTopbar";
import { LibraryView } from "./components/LibraryView";
import { DetailPanel } from "./components/DetailPanel";
import type { PdfReaderHandle } from "./components/PdfReader";
import { Modal } from "./components/Modal";
import { PaperEditor } from "./components/PaperEditor";
import { LazyScreenBoundary } from "./components/LazyScreenBoundary";
import { useLibrary } from "./state/LibraryContext";
import { backend } from "./services/backend";
import type { FolderSelection, Paper } from "./types";
import { now } from "./types";
import { importFolderId } from "./components/FolderTree";

const SIDEBAR_COLLAPSED_KEY = "papernest.sidebarCollapsed";
const PdfReader = lazy(() => import("./components/PdfReader").then(module => ({ default: module.PdfReader })));
const WritingLibrary = lazy(() => import("./components/WritingLibrary").then(module => ({ default: module.WritingLibrary })));
const TrashView = lazy(() => import("./components/TrashView").then(module => ({ default: module.TrashView })));
const SettingsView = lazy(() => import("./components/SettingsView").then(module => ({ default: module.SettingsView })));
const KnowledgeGraphInteractive = lazy(() => import("./components/KnowledgeGraphInteractive").then(module => ({ default: module.KnowledgeGraphInteractive })));
const TaskCalendar = lazy(() => import("./components/TaskCalendar").then(module => ({ default: module.TaskCalendar })));
const RadarView = lazy(() => import("./components/RadarView").then(module => ({ default: module.RadarView })));
const ResearchView = lazy(() => import("./components/ResearchView").then(module => ({ default: module.ResearchView })));

function readSidebarCollapsed() {
  return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "1";
}

function isTypingTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable;
}

export default function App() {
  const { data, loading, error, refresh, savePaper, saveProfile, movePapersToFolder, importBusy, importNotice, radarBusy, radarNotice, radarExplainBusy, researchBusy, researchNotice } = useLibrary();
  const [screen, setScreen] = useState<Screen>("library");
  const [search, setSearch] = useState("");
  const [searchHitPaperIds, setSearchHitPaperIds] = useState<string[]>([]);
  const [searchError, setSearchError] = useState<string>();
  const [selectedId, setSelectedId] = useState<string>();
  const [folderSelection, setFolderSelection] = useState<FolderSelection>({ kind: "all" });
  const [cutPaperIds, setCutPaperIds] = useState<string[]>([]);
  const [readerPaper, setReaderPaper] = useState<Paper>();
  const [creating, setCreating] = useState(false);
  const [leavePrompt, setLeavePrompt] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(readSidebarCollapsed);
  const [libraryNotice, setLibraryNotice] = useState("");
  const libraryNoticeTimer = useRef<number | undefined>(undefined);
  const readerRef = useRef<PdfReaderHandle>(null);
  const leaveAfterRef = useRef<(() => void) | undefined>(undefined);
  const selected = useMemo(() => data?.papers.find(p => p.id === selectedId), [data, selectedId]);

  const clearLibraryNotice = useCallback(() => {
    setLibraryNotice("");
    if (libraryNoticeTimer.current) window.clearTimeout(libraryNoticeTimer.current);
  }, []);

  const showLibraryNotice = useCallback((message: string) => {
    setLibraryNotice(message);
    if (libraryNoticeTimer.current) window.clearTimeout(libraryNoticeTimer.current);
    libraryNoticeTimer.current = window.setTimeout(() => setLibraryNotice(""), 3200);
  }, []);

  const toggleSidebarCollapsed = useCallback(() => {
    setSidebarCollapsed(current => {
      const next = !current;
      localStorage.setItem(SIDEBAR_COLLAPSED_KEY, next ? "1" : "0");
      return next;
    });
  }, []);

  const requestLeave = useCallback((after?: () => void) => {
    if (!readerPaper || !readerRef.current?.isDirty()) {
      setReaderPaper(undefined);
      after?.();
      return;
    }
    leaveAfterRef.current = after;
    setLeavePrompt(true);
  }, [readerPaper]);

  const finishLeave = async (discard: boolean) => {
    if (discard) await readerRef.current?.discard();
    const after = leaveAfterRef.current;
    leaveAfterRef.current = undefined;
    setLeavePrompt(false);
    setReaderPaper(undefined);
    after?.();
  };

  const locatePaper = useCallback((paperId: string) => {
    const paper = data?.papers.find(item => item.id === paperId && !item.deletedAt);
    if (!paper) return;
    setFolderSelection(paper.folderId ? { kind: "folder", id: paper.folderId } : { kind: "unfiled" });
    setSearch("");
    setSelectedId(paperId);
    setScreen("library");
  }, [data]);

  useEffect(() => { let active=true; setSearchError(undefined); const timer=window.setTimeout(() => { if(!search.trim()){setSearchHitPaperIds([]);return;} void backend.search(search).then(hits => { if(active)setSearchHitPaperIds([...new Set(hits.map(hit=>hit.paperId))]); }).catch(error=>{ if(active){setSearchHitPaperIds([]);setSearchError(`全文搜索失败：${error instanceof Error ? error.message : String(error)}`);} }); },180); return()=>{active=false;window.clearTimeout(timer);}; },[search]);
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        (document.querySelector(".topbar .search-box input") as HTMLInputElement | null)?.focus();
      }
      if (event.key === "Escape" && readerPaper) {
        event.preventDefault();
        requestLeave();
      }
      if (readerPaper || screen !== "library" || isTypingTarget(event.target)) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "x") {
        const ids = selectedId ? [selectedId] : [];
        if (!ids.length) return;
        event.preventDefault();
        setCutPaperIds(ids);
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "v") {
        if (!cutPaperIds.length) return;
        event.preventDefault();
        if (folderSelection.kind === "all") {
          window.alert("请先选中目标文件夹或未归档");
          return;
        }
        const target = folderSelection.kind === "folder" ? folderSelection.id : null;
        const count = cutPaperIds.length;
        void movePapersToFolder(cutPaperIds, target).then(() => {
          setCutPaperIds([]);
          showLibraryNotice(`已移动 ${count} 篇论文`);
        });
      }
      if ((event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === "z") {
        if (!cutPaperIds.length) return;
        event.preventDefault();
        setCutPaperIds([]);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [readerPaper, requestLeave, screen, selectedId, cutPaperIds, folderSelection, movePapersToFolder, showLibraryNotice]);
  useEffect(() => {
    if (screen !== "library") clearLibraryNotice();
  }, [screen, clearLibraryNotice]);
  useEffect(() => () => {
    if (libraryNoticeTimer.current) window.clearTimeout(libraryNoticeTimer.current);
  }, []);
  useEffect(() => {
    if (!data) return;
    const theme = data.profile.theme === "system" ? (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light") : data.profile.theme;
    document.documentElement.dataset.theme = theme;
    document.documentElement.dataset.uiTheme = data.profile.visualTheme ?? "workbench";
  }, [data?.profile.theme, data?.profile.visualTheme]);
  useEffect(() => {
    if (!data || folderSelection.kind !== "folder") return;
    if (!data.folders.some(item => item.id === folderSelection.id)) setFolderSelection({ kind: "all" });
  }, [data, folderSelection]);
  if (loading) return <div className="splash"><LoaderCircle className="spin" /><strong>正在打开本地论文库…</strong></div>;
  if (error || !data) return <div className="splash error"><AlertTriangle /><strong>无法打开资料库</strong><p>{error}</p><button className="primary" onClick={refresh}>重试</button></div>;
  const openPdf = (paper: Paper, page?: number) => { setReaderPaper(page ? { ...paper, readingPage: page } : paper); setScreen("library"); };
  const theme = async () => saveProfile({ ...data.profile, theme: data.profile.theme === "dark" ? "light" : "dark" });
  const pageFallback = <div className="splash"><LoaderCircle className="spin" /><strong>正在加载页面…</strong></div>;
  const defaultFolderId = importFolderId(folderSelection);
  return <div className={`app-shell${sidebarCollapsed ? " sidebar-collapsed" : ""}`}>
    <Sidebar
      screen={screen}
      onNavigate={value => requestLeave(() => { clearLibraryNotice(); setScreen(value); setSelectedId(undefined); })}
      profile={data.profile}
      onTheme={theme}
      collapsed={sidebarCollapsed}
      onToggleCollapsed={toggleSidebarCollapsed}
    />
    <div className="workspace">
      {data.libraryNotice && <div className="library-recovery-banner" role="status">{data.libraryNotice}</div>}
      {screen === "library" && <>
        <Topbar search={search} searchError={searchError} onSearch={setSearch} onCreate={() => setCreating(true)} onRefresh={async () => { clearLibraryNotice(); await refresh(); }} importFolderId={defaultFolderId} libraryNotice={libraryNotice} />
        <div className={`main-with-detail ${selected ? "has-detail" : ""}`}>
          <LibraryView
            search={search}
            searchHitPaperIds={searchHitPaperIds}
            selectedId={selectedId}
            folderSelection={folderSelection}
            cutPaperIds={cutPaperIds}
            onFolderSelection={setFolderSelection}
            onSelect={p => setSelectedId(p.id)}
            onOpenPdf={openPdf}
            onCutPapers={setCutPaperIds}
            onClearCut={() => setCutPaperIds([])}
            onLibraryNotice={showLibraryNotice}
            onClearLibraryNotice={clearLibraryNotice}
          />
          {selected && <DetailPanel paper={selected} onClose={() => setSelectedId(undefined)} onOpenPdf={openPdf} onSelect={p => setSelectedId(p.id)} />}
        </div>
      </>}
      {screen !== "library" && (importBusy || importNotice) && <div className="import-status-banner">{importBusy ? <><LoaderCircle className="spin" size={15} />{importBusy}</> : importNotice}</div>}
      {radarBusy && screen !== "radar" && <div className="import-status-banner"><LoaderCircle className="spin" size={15} />{radarBusy}</div>}
      {!radarBusy && radarExplainBusy && screen !== "radar" && <div className="import-status-banner"><LoaderCircle className="spin" size={15} />{radarExplainBusy}</div>}
      {!radarBusy && !radarExplainBusy && radarNotice && screen !== "radar" && <div className="import-status-banner">{radarNotice}</div>}
      {researchBusy && screen !== "research" && <div className="import-status-banner"><LoaderCircle className="spin" size={15} />{researchBusy}</div>}
      {!researchBusy && researchNotice && screen !== "research" && <div className="import-status-banner">{researchNotice}</div>}
      {screen === "writing" && <LazyScreenBoundary><Suspense fallback={pageFallback}><WritingLibrary onOpenPaper={openPdf} /></Suspense></LazyScreenBoundary>}
      {screen === "knowledge" && <LazyScreenBoundary><Suspense fallback={pageFallback}><KnowledgeGraphInteractive onOpenPaper={paper => locatePaper(paper.id)} /></Suspense></LazyScreenBoundary>}
      {screen === "tasks" && <LazyScreenBoundary><Suspense fallback={pageFallback}><TaskCalendar /></Suspense></LazyScreenBoundary>}
      {screen === "radar" && <LazyScreenBoundary><Suspense fallback={pageFallback}><RadarView onImported={paperId => locatePaper(paperId)} /></Suspense></LazyScreenBoundary>}
      {screen === "research" && <LazyScreenBoundary><Suspense fallback={pageFallback}><ResearchView /></Suspense></LazyScreenBoundary>}
      {screen === "trash" && <LazyScreenBoundary><Suspense fallback={pageFallback}><TrashView /></Suspense></LazyScreenBoundary>}
      {readerPaper && <LazyScreenBoundary><Suspense fallback={pageFallback}><PdfReader ref={readerRef} embedded paper={data.papers.find(p => p.id === readerPaper.id) ?? readerPaper} onBack={() => requestLeave()} /></Suspense></LazyScreenBoundary>}
      {screen === "settings" && <LazyScreenBoundary><Suspense fallback={pageFallback}><SettingsView /></Suspense></LazyScreenBoundary>}
    </div>
    {creating && <PaperEditor modalTitle="新建论文" categories={data.categories} tags={data.tags} onCancel={() => setCreating(false)} onSave={async paper => {
      const withFolder = { ...paper, folderId: defaultFolderId || undefined, updatedAt: now() };
      await savePaper(withFolder);
      setCreating(false);
      if (defaultFolderId) setFolderSelection({ kind: "folder", id: defaultFolderId });
      else setFolderSelection({ kind: "unfiled" });
      setSelectedId(paper.id);
    }} />}
    {leavePrompt && <Modal title="离开阅读台" onClose={() => { leaveAfterRef.current = undefined; setLeavePrompt(false); }}>
      <div className="paper-editor">
        <p>当前有高亮、批注或收录改动。是否保存后离开？</p>
        <footer>
          <button type="button" className="ghost" onClick={() => { leaveAfterRef.current = undefined; setLeavePrompt(false); }}>取消</button>
          <button type="button" className="secondary" onClick={() => void finishLeave(true)}>不保存</button>
          <button type="button" className="primary" onClick={() => void finishLeave(false)}>保存并离开</button>
        </footer>
      </div>
    </Modal>}
  </div>;
}

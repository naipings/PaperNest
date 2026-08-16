import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, LoaderCircle } from "lucide-react";
import { Sidebar, type Screen } from "./components/Sidebar";
import { Topbar } from "./components/LlmTopbar";
import { LibraryView } from "./components/LibraryView";
import { DetailPanel } from "./components/DetailPanel";
import { PdfReader, type PdfReaderHandle } from "./components/PdfReader";
import { WritingLibrary } from "./components/WritingLibrary";
import { TrashView } from "./components/TrashView";
import { SettingsView } from "./components/SettingsView";
import { KnowledgeGraphInteractive } from "./components/KnowledgeGraphInteractive";
import { TaskCalendar } from "./components/TaskCalendar";
import { Modal } from "./components/Modal";
import { PaperEditor } from "./components/PaperEditor";
import { useLibrary } from "./state/LibraryContext";
import { backend } from "./services/backend";
import type { Paper } from "./types";

export default function App() {
  const { data, loading, error, refresh, savePaper, saveProfile, importBusy, importNotice } = useLibrary();
  const [screen, setScreen] = useState<Screen>("library");
  const [search, setSearch] = useState("");
  const [searchHitPaperIds, setSearchHitPaperIds] = useState<string[]>([]);
  const [selectedId, setSelectedId] = useState<string>();
  const [readerPaper, setReaderPaper] = useState<Paper>();
  const [creating, setCreating] = useState(false);
  const [leavePrompt, setLeavePrompt] = useState(false);
  const readerRef = useRef<PdfReaderHandle>(null);
  const leaveAfterRef = useRef<(() => void) | undefined>(undefined);
  const selected = useMemo(() => data?.papers.find(p => p.id === selectedId), [data, selectedId]);

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

  useEffect(() => { let active=true; const timer=window.setTimeout(() => { if(!search.trim()){setSearchHitPaperIds([]);return;} void backend.search(search).then(hits => { if(active)setSearchHitPaperIds([...new Set(hits.map(hit=>hit.paperId))]); }).catch(()=>{ if(active)setSearchHitPaperIds([]); }); },180); return()=>{active=false;window.clearTimeout(timer);}; },[search]);
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
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [readerPaper, requestLeave]);
  useEffect(() => {
    if (!data) return;
    const theme = data.profile.theme === "system" ? (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light") : data.profile.theme;
    document.documentElement.dataset.theme = theme;
    document.documentElement.dataset.uiTheme = data.profile.visualTheme ?? "workbench";
  }, [data?.profile.theme, data?.profile.visualTheme]);
  if (loading) return <div className="splash"><LoaderCircle className="spin" /><strong>正在打开本地论文库…</strong></div>;
  if (error || !data) return <div className="splash error"><AlertTriangle /><strong>无法打开资料库</strong><p>{error}</p><button className="primary" onClick={refresh}>重试</button></div>;
  const openPdf = (paper: Paper, page?: number) => { setReaderPaper(page ? { ...paper, readingPage: page } : paper); setScreen("library"); };
  const theme = async () => saveProfile({ ...data.profile, theme: data.profile.theme === "dark" ? "light" : "dark" });
  return <div className="app-shell">
    <Sidebar screen={screen} onNavigate={value => requestLeave(() => { setScreen(value); setSelectedId(undefined); })} profile={data.profile} onTheme={theme} />
    <div className="workspace">
      {screen === "library" && <><Topbar search={search} onSearch={setSearch} onCreate={() => setCreating(true)} onRefresh={refresh} /><div className={`main-with-detail ${selected ? "has-detail" : ""}`}><LibraryView search={search} searchHitPaperIds={searchHitPaperIds} selectedId={selectedId} onSelect={p => setSelectedId(p.id)} onOpenPdf={openPdf} />{selected && <DetailPanel paper={selected} onClose={() => setSelectedId(undefined)} onOpenPdf={openPdf} onSelect={p => setSelectedId(p.id)} />}</div></>}
      {screen !== "library" && (importBusy || importNotice) && <div className="import-status-banner">{importBusy ? <><LoaderCircle className="spin" size={15} />{importBusy}</> : importNotice}</div>}
      {screen === "writing" && <WritingLibrary onOpenPaper={openPdf} />}
      {screen === "knowledge" && <KnowledgeGraphInteractive onOpenPaper={paper => { setSelectedId(paper.id); setScreen("library"); }} /> }
      {screen === "tasks" && <TaskCalendar />}
      {screen === "trash" && <TrashView />}
      {readerPaper && <PdfReader ref={readerRef} embedded paper={data.papers.find(p => p.id === readerPaper.id) ?? readerPaper} onBack={() => requestLeave()} />}
      {screen === "settings" && <SettingsView />}
    </div>
    {creating && <Modal title="新建论文" onClose={() => setCreating(false)} wide><PaperEditor categories={data.categories} tags={data.tags} onCancel={() => setCreating(false)} onSave={async paper => { await savePaper(paper); setCreating(false); setSelectedId(paper.id); }} /></Modal>}
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

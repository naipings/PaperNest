import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, LoaderCircle } from "lucide-react";
import { Sidebar, type Screen } from "./components/Sidebar";
import { Topbar } from "./components/LlmTopbar";
import { LibraryView } from "./components/LibraryView";
import { DetailPanel } from "./components/DetailPanel";
import { PdfReader } from "./components/PdfReader";
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
  const { data, loading, error, refresh, savePaper, saveProfile } = useLibrary(); const [screen, setScreen] = useState<Screen>("library"); const [search, setSearch] = useState(""); const [searchHitPaperIds, setSearchHitPaperIds] = useState<string[]>([]); const [selectedId, setSelectedId] = useState<string>(); const [readerPaper, setReaderPaper] = useState<Paper>(); const [creating, setCreating] = useState(false);
  const selected = useMemo(() => data?.papers.find(p => p.id === selectedId), [data, selectedId]);
  useEffect(() => { let active=true; const timer=window.setTimeout(() => { if(!search.trim()){setSearchHitPaperIds([]);return;} void backend.search(search).then(hits => { if(active)setSearchHitPaperIds([...new Set(hits.map(hit=>hit.paperId))]); }).catch(()=>{ if(active)setSearchHitPaperIds([]); }); },180); return()=>{active=false;window.clearTimeout(timer);}; },[search]);
  useEffect(() => { const handler = (event: KeyboardEvent) => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") { event.preventDefault(); (document.querySelector(".topbar .search-box input") as HTMLInputElement | null)?.focus(); } if (event.key === "Escape" && readerPaper) setReaderPaper(undefined); }; window.addEventListener("keydown", handler); return () => window.removeEventListener("keydown", handler); }, [readerPaper]);
  useEffect(() => { if (!data) return; const theme = data.profile.theme === "system" ? (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light") : data.profile.theme; document.documentElement.dataset.theme = theme; }, [data?.profile.theme]);
  if (loading) return <div className="splash"><LoaderCircle className="spin" /><strong>正在打开本地论文库…</strong></div>;
  if (error || !data) return <div className="splash error"><AlertTriangle /><strong>无法打开资料库</strong><p>{error}</p><button className="primary" onClick={refresh}>重试</button></div>;
  const openPdf = (paper: Paper, page?: number) => { setReaderPaper(page ? { ...paper, readingPage: page } : paper); setScreen("library"); };
  const theme = async () => saveProfile({ ...data.profile, theme: data.profile.theme === "dark" ? "light" : "dark" });
  return <div className="app-shell"><Sidebar screen={screen} onNavigate={value => { setScreen(value); setSelectedId(undefined); }} profile={data.profile} onTheme={theme} /><div className="workspace">
    {screen === "library" && <><Topbar search={search} onSearch={setSearch} onCreate={() => setCreating(true)} onRefresh={refresh} /><div className={`main-with-detail ${selected ? "has-detail" : ""}`}><LibraryView search={search} searchHitPaperIds={searchHitPaperIds} selectedId={selectedId} onSelect={p => setSelectedId(p.id)} onOpenPdf={openPdf} />{selected && <DetailPanel paper={selected} onClose={() => setSelectedId(undefined)} onOpenPdf={openPdf} />}</div></>}
    {screen === "writing" && <WritingLibrary onOpenPaper={openPdf} />}
    {screen === "knowledge" && <KnowledgeGraphInteractive onOpenPaper={paper => { setSelectedId(paper.id); setScreen("library"); }} /> }
    {screen === "tasks" && <TaskCalendar />}
    {screen === "trash" && <TrashView />}
    {readerPaper && <PdfReader embedded paper={data.papers.find(p => p.id === readerPaper.id) ?? readerPaper} onBack={() => setReaderPaper(undefined)} />}
    {screen === "settings" && <SettingsView />}
  </div>{creating && <Modal title="新建论文" onClose={() => setCreating(false)} wide><PaperEditor categories={data.categories} tags={data.tags} onCancel={() => setCreating(false)} onSave={async paper => { await savePaper(paper); setCreating(false); setSelectedId(paper.id); }} /></Modal>}</div>;
}

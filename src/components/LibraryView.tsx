import { useEffect, useState } from "react";
import { BookmarkPlus, ChevronDown, Filter, LayoutList, Rows3 } from "lucide-react";
import { useLibrary } from "../state/LibraryContext";
import type { Paper, PaperStatus, SavedView } from "../types";
import { uuid } from "../types";
import { filterPapers } from "../lib/search";
import { PaperTable } from "./PaperTable";

const builtinViews: SavedView[] = [
  { id: "all", name: "\u5168\u90e8\u8bba\u6587", builtin: true, filter: {}, sorting: [], columnVisibility: {}, density: "comfortable" },
  { id: "unread", name: "\u672a\u8bfb", builtin: true, filter: { status: "unread" }, sorting: [], columnVisibility: {}, density: "comfortable" },
  { id: "reading", name: "\u5728\u8bfb", builtin: true, filter: { status: "reading" }, sorting: [], columnVisibility: {}, density: "comfortable" },
  { id: "missing", name: "\u4fe1\u606f\u5f85\u8865\u5145", builtin: true, filter: { missingInfo: true }, sorting: [], columnVisibility: {}, density: "comfortable" },
  { id: "uncategorized", name: "\u672a\u5206\u7c7b", builtin: true, filter: { uncategorized: true }, sorting: [], columnVisibility: {}, density: "comfortable" }
];

export function LibraryView({ search, searchHitPaperIds, selectedId, onSelect, onOpenPdf }: { search: string; searchHitPaperIds: string[]; selectedId?: string; onSelect(paper: Paper): void; onOpenPdf(paper: Paper): void }) {
  const { data, savePaper, saveView } = useLibrary();
  const [viewId, setViewId] = useState("all");
  const [status, setStatus] = useState<PaperStatus | "">("");
  useEffect(() => {
    const toggleDensity = () => { document.documentElement.dataset.tableDensity = document.documentElement.dataset.tableDensity !== "compact" ? "compact" : "comfortable"; };
    const button = document.querySelector<HTMLButtonElement>(".view-tools .icon-button");
    button?.addEventListener("click", toggleDensity);
    return () => button?.removeEventListener("click", toggleDensity);
  }, []);
  if (!data) return null;
  const allViews = [...builtinViews, ...data.views];
  const baseView = allViews.find(view => view.id === viewId) ?? builtinViews[0];
  const view: SavedView = status ? { ...baseView, filter: { ...baseView.filter, status } } : baseView;
  const localMatches = filterPapers(data, search, view);
  const visibleInView = filterPapers(data, "", view);
  const localIds = new Set(localMatches.map(paper => paper.id));
  const backendIds = new Set(searchHitPaperIds);
  const papers = search.trim() ? visibleInView.filter(paper => localIds.has(paper.id) || backendIds.has(paper.id)) : visibleInView;
  const saveCurrent = async () => { const name = window.prompt("\u89c6\u56fe\u540d\u79f0", "\u6211\u7684\u7b5b\u9009"); if (!name) return; const custom: SavedView = { ...view, id: uuid(), name, builtin: false }; await saveView(custom); setViewId(custom.id); };
  const recyclePapers = (items: Paper[]) => { const timestamp = new Date().toISOString(); void Promise.all(items.map(paper => savePaper({ ...paper, deletedAt: timestamp, updatedAt: timestamp }))); };
  return <main className="library-view"><div className="view-header"><div><h1>\u6211\u7684\u8bba\u6587\u5e93</h1><p>{papers.length} \u7bc7\u8bba\u6587 · \u6570\u636e\u4ec5\u4fdd\u5b58\u5728\u672c\u673a</p></div><div className="view-tools"><label><LayoutList size={15} /><select value={viewId} onChange={event => setViewId(event.target.value)}>{allViews.map(view => <option value={view.id} key={view.id}>{view.name}</option>)}</select><ChevronDown size={14} /></label><label><Filter size={15} /><select value={status} onChange={event => setStatus(event.target.value as PaperStatus | "")}><option value="">\u5168\u90e8\u72b6\u6001</option><option value="unread">\u672a\u8bfb</option><option value="reading">\u5728\u8bfb</option><option value="read">\u5df2\u8bfb</option><option value="archived">\u5df2\u5f52\u6863</option></select></label><button className="ghost" onClick={saveCurrent}><BookmarkPlus size={15} />\u4fdd\u5b58\u89c6\u56fe</button><button className="icon-button" title="\u5207\u6362\u8868\u683c\u5bc6\u5ea6"><Rows3 size={17} /></button></div></div><PaperTable papers={papers} categories={data.categories} tags={data.tags} selectedId={selectedId} onSelect={onSelect} onOpenPdf={onOpenPdf} onToggleFavorite={paper => savePaper({ ...paper, favorite: !paper.favorite, updatedAt: new Date().toISOString() })} onBulkRecycle={recyclePapers} /></main>;
}

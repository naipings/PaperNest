import { useEffect, useState } from "react";
import { BookmarkPlus, ChevronDown, Filter, LayoutList, Rows3 } from "lucide-react";
import { useLibrary } from "../state/LibraryContext";
import type { Paper, PaperStatus, SavedView } from "../types";
import { uuid } from "../types";
import { filterPapers } from "../lib/search";
import { PaperTable } from "./PaperTable";

const builtinViews: SavedView[] = [
  { id: "all", name: "全部论文", builtin: true, filter: {}, sorting: [], columnVisibility: {}, density: "comfortable" },
  { id: "unread", name: "未读", builtin: true, filter: { status: "unread" }, sorting: [], columnVisibility: {}, density: "comfortable" },
  { id: "reading", name: "在读", builtin: true, filter: { status: "reading" }, sorting: [], columnVisibility: {}, density: "comfortable" },
  { id: "missing", name: "信息待补充", builtin: true, filter: { missingInfo: true }, sorting: [], columnVisibility: {}, density: "comfortable" },
  { id: "uncategorized", name: "未分类", builtin: true, filter: { uncategorized: true }, sorting: [], columnVisibility: {}, density: "comfortable" }
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
  const saveCurrent = async () => { const name = window.prompt("视图名称", "我的筛选"); if (!name) return; const custom: SavedView = { ...view, id: uuid(), name, builtin: false }; await saveView(custom); setViewId(custom.id); };
  const recyclePapers = (items: Paper[]) => { const timestamp = new Date().toISOString(); void Promise.all(items.map(paper => savePaper({ ...paper, deletedAt: timestamp, updatedAt: timestamp }))); };
  return <main className="library-view">
    <div className="view-header">
      <div><h1>我的论文库</h1><p>{papers.length} 篇论文 · 数据仅保存在本机</p></div>
      <div className="view-tools">
        <label><LayoutList size={15} /><select value={viewId} onChange={event => setViewId(event.target.value)}>{allViews.map(view => <option value={view.id} key={view.id}>{view.name}</option>)}</select><ChevronDown size={14} /></label>
        <label><Filter size={15} /><select value={status} onChange={event => setStatus(event.target.value as PaperStatus | "")}><option value="">全部状态</option><option value="unread">未读</option><option value="reading">在读</option><option value="read">已读</option><option value="archived">已归档</option></select></label>
        <button className="ghost" onClick={saveCurrent}><BookmarkPlus size={15} />保存视图</button>
        <button className="icon-button" title="切换表格密度"><Rows3 size={17} /></button>
      </div>
    </div>
    <PaperTable papers={papers} categories={data.categories} tags={data.tags} selectedId={selectedId} onSelect={onSelect} onOpenPdf={onOpenPdf} onToggleFavorite={paper => savePaper({ ...paper, favorite: !paper.favorite, updatedAt: new Date().toISOString() })} onBulkRecycle={recyclePapers} />
  </main>;
}

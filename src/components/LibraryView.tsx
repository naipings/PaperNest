import { useEffect, useState } from "react";
import { BookOpenCheck, BookmarkPlus, BrainCircuit, Clock3, Filter, Heart, LayoutList, RefreshCw, Rows3, Sparkles, Tags } from "lucide-react";
import { useLibrary } from "../state/LibraryContext";
import type { Paper, PaperStatus, SavedView } from "../types";
import { uuid } from "../types";
import { filterPapers } from "../lib/search";
import { PaperTable } from "./PaperTable";
import { FilterMenu } from "./FilterMenu";

const builtinViews: SavedView[] = [
  { id: "all", name: "全部论文", builtin: true, filter: {}, sorting: [], columnVisibility: {}, density: "comfortable" },
  { id: "missing", name: "信息待补充", builtin: true, filter: { missingInfo: true }, sorting: [], columnVisibility: {}, density: "comfortable" }
];

const statusOptions = [
  { id: "", label: "全部状态" },
  { id: "unread", label: "未读" },
  { id: "reading", label: "在读" },
  { id: "read", label: "已读" },
  { id: "archived", label: "已归档" }
];

const favoriteOptions = [
  { id: "", label: "全部收藏" },
  { id: "favorite", label: "仅收藏" }
];

export function LibraryView({ search, searchHitPaperIds, selectedId, onSelect, onOpenPdf }: { search: string; searchHitPaperIds: string[]; selectedId?: string; onSelect(paper: Paper): void; onOpenPdf(paper: Paper): void }) {
  const { data, refresh, savePaper, saveView } = useLibrary();
  const [viewId, setViewId] = useState("all");
  const [status, setStatus] = useState<PaperStatus | "">("");
  const [category, setCategory] = useState("");
  const [favoriteOnly, setFavoriteOnly] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  useEffect(() => {
    const toggleDensity = () => { document.documentElement.dataset.tableDensity = document.documentElement.dataset.tableDensity !== "compact" ? "compact" : "comfortable"; };
    const button = document.querySelector<HTMLButtonElement>(".view-tools .icon-button");
    button?.addEventListener("click", toggleDensity);
    return () => button?.removeEventListener("click", toggleDensity);
  }, []);
  useEffect(() => {
    if (!selectedId || !data) return;
    const paper = data.papers.find(item => item.id === selectedId && !item.deletedAt);
    if (!paper) return;
    const allViews = [...builtinViews, ...data.views];
    const baseView = allViews.find(view => view.id === viewId) ?? builtinViews[0];
    const filter = { ...baseView.filter };
    if (status) filter.status = status;
    else delete filter.status;
    if (category === "uncategorized") { filter.uncategorized = true; delete filter.categoryId; }
    else if (category) { filter.categoryId = category; delete filter.uncategorized; }
    else { delete filter.uncategorized; delete filter.categoryId; }
    if (favoriteOnly) filter.favorite = true;
    else delete filter.favorite;
    const visible = filterPapers(data, search, { ...baseView, filter });
    if (visible.some(item => item.id === selectedId)) return;
    setViewId("all");
    setStatus("");
    setCategory("");
    setFavoriteOnly(false);
  }, [selectedId, data, viewId, status, category, favoriteOnly, search]);
  if (!data) return null;
  const allViews = [...builtinViews, ...data.views];
  const baseView = allViews.find(view => view.id === viewId) ?? builtinViews[0];
  const filter = { ...baseView.filter };
  if (status) filter.status = status;
  else delete filter.status;
  if (category === "uncategorized") { filter.uncategorized = true; delete filter.categoryId; }
  else if (category) { filter.categoryId = category; delete filter.uncategorized; }
  else { delete filter.uncategorized; delete filter.categoryId; }
  if (favoriteOnly) filter.favorite = true;
  else delete filter.favorite;
  const view: SavedView = { ...baseView, filter };
  const applyView = (id: string) => {
    setViewId(id);
    const next = allViews.find(item => item.id === id);
    setStatus(next?.filter.status ?? "");
    setCategory(next?.filter.uncategorized ? "uncategorized" : (next?.filter.categoryId ?? ""));
    setFavoriteOnly(Boolean(next?.filter.favorite));
  };
  const localMatches = filterPapers(data, search, view);
  const visibleInView = filterPapers(data, "", view);
  const localIds = new Set(localMatches.map(paper => paper.id));
  const backendIds = new Set(searchHitPaperIds);
  const papers = search.trim() ? visibleInView.filter(paper => localIds.has(paper.id) || backendIds.has(paper.id)) : visibleInView;
  const readingCount = data.papers.filter(paper => !paper.deletedAt && paper.status === "reading").length;
  const unreadCount = data.papers.filter(paper => !paper.deletedAt && paper.status === "unread").length;
  const completedCount = data.papers.filter(paper => !paper.deletedAt && paper.status === "read").length;
  const saveCurrent = async () => { const name = window.prompt("视图名称", "我的筛选"); if (!name) return; const custom: SavedView = { ...view, id: uuid(), name, builtin: false }; await saveView(custom); setViewId(custom.id); };
  const recyclePapers = (items: Paper[]) => { const timestamp = new Date().toISOString(); void Promise.all(items.map(paper => savePaper({ ...paper, deletedAt: timestamp, updatedAt: timestamp }))); };
  const refreshLibrary = async () => { setRefreshing(true); try { await refresh(); } finally { setRefreshing(false); } };
  return <main className="library-view">
    <section className="research-overview" aria-label="论文库概览">
      <div className="overview-intro"><span className="eyebrow"><Sparkles size={14} />研究工作台</span><h1>今天，从一篇论文开始</h1><p>集中查看阅读进度、待办论文与本地研究素材。</p></div>
      <div className="overview-metrics">
        <article><span className="metric-icon blue"><BookOpenCheck size={18} /></span><div><strong>{data.papers.filter(paper => !paper.deletedAt).length}</strong><small>已收录论文</small></div></article>
        <article><span className="metric-icon coral"><Clock3 size={18} /></span><div><strong>{readingCount}</strong><small>正在阅读</small></div></article>
        <article><span className="metric-icon mint"><BookOpenCheck size={18} /></span><div><strong>{completedCount}</strong><small>已完成阅读</small></div></article>
      </div>
      <aside className="overview-assistant"><div><span className="assistant-label"><BrainCircuit size={15} />智能研读</span><strong>{unreadCount ? `有 ${unreadCount} 篇论文等待开始` : "论文库已整理完成"}</strong><small>在设置中配置 LLM 后，可自动整理摘要、术语和方法框架。</small></div><span className="assistant-orb" aria-hidden="true" /></aside>
    </section>
    <div className="view-header">
      <div><h1>我的论文库</h1><p>{papers.length} 篇论文 · 数据仅保存在本机</p></div>
      <div className="view-tools">
        <FilterMenu icon={<LayoutList size={15} />} value={viewId} onChange={applyView} groups={[
          { title: "范围", options: builtinViews.map(item => ({ id: item.id, label: item.name })) },
          ...(data.views.length ? [{ title: "我的视图", options: data.views.map(item => ({ id: item.id, label: item.name })) }] : [])
        ]} />
        <FilterMenu icon={<Heart size={15} />} value={favoriteOnly ? "favorite" : ""} onChange={value => setFavoriteOnly(value === "favorite")} groups={[{ title: "收藏", options: favoriteOptions }]} />
        <FilterMenu icon={<Filter size={15} />} value={status} onChange={value => setStatus(value as PaperStatus | "")} groups={[{ title: "阅读状态", options: statusOptions }]} />
        <FilterMenu icon={<Tags size={15} />} value={category} onChange={setCategory} groups={[{ title: "领域", options: [
          { id: "", label: "全部领域" },
          { id: "uncategorized", label: "未分类" },
          ...data.categories.map(item => ({ id: item.id, label: item.name }))
        ] }]} />
        <button className="ghost" onClick={saveCurrent}><BookmarkPlus size={15} />保存视图</button>
        <button className="ghost" disabled={refreshing} onClick={() => void refreshLibrary()} title="从资料库重新加载"><RefreshCw size={15} className={refreshing ? "spin" : undefined} />刷新</button>
        <button className="icon-button" title="切换表格密度"><Rows3 size={17} /></button>
      </div>
    </div>
    <PaperTable papers={papers} categories={data.categories} tags={data.tags} customFieldDefinitions={data.customFieldDefinitions} customFieldValues={data.customFieldValues} selectedId={selectedId} onSelect={onSelect} onOpenPdf={onOpenPdf} onToggleFavorite={paper => savePaper({ ...paper, favorite: !paper.favorite, updatedAt: new Date().toISOString() })} onBulkRecycle={recyclePapers} />
  </main>;
}

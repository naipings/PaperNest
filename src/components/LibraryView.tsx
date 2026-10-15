import { useEffect, useRef, useState } from "react";
import { BookmarkPlus, Filter, Heart, LayoutList, RefreshCw, Rows3, Tags } from "lucide-react";
import { useLibrary } from "../state/LibraryContext";
import type { Folder, FolderSelection, Paper, PaperStatus, SavedView } from "../types";
import { now, uuid } from "../types";
import { filterPapers } from "../lib/search";
import { PaperTable } from "./PaperTable";
import { folderSiblingNameTaken } from "../lib/folders";
import { FilterMenu } from "./FilterMenu";
import { FolderTree, folderBreadcrumb } from "./FolderTree";
import { MovePapersDialog } from "./MovePapersDialog";

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

function applyFolderFilter(filter: SavedView["filter"], selection: FolderSelection): SavedView["filter"] {
  const next = { ...filter };
  delete next.folderId;
  delete next.unfiledOnly;
  if (selection.kind === "folder") next.folderId = selection.id;
  if (selection.kind === "unfiled") next.unfiledOnly = true;
  return next;
}

export function LibraryView({
  search, searchHitPaperIds, selectedId, folderSelection, cutPaperIds, onFolderSelection, onSelect, onOpenPdf, onCutPapers, onClearCut, onLibraryNotice, onClearLibraryNotice,
}: {
  search: string;
  searchHitPaperIds: string[];
  selectedId?: string;
  folderSelection: FolderSelection;
  cutPaperIds: string[];
  onFolderSelection(selection: FolderSelection): void;
  onSelect(paper: Paper): void;
  onOpenPdf(paper: Paper): void;
  onCutPapers(ids: string[]): void;
  onClearCut(): void;
  onLibraryNotice(message: string): void;
  onClearLibraryNotice(): void;
}) {
  const { data, refresh, savePaper, saveView, saveFolder, deleteFolder, movePapersToFolder } = useLibrary();
  const [viewId, setViewId] = useState("all");
  const [status, setStatus] = useState<PaperStatus | "">("");
  const [category, setCategory] = useState("");
  const [favoriteOnly, setFavoriteOnly] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [compact, setCompact] = useState(() => document.documentElement.dataset.tableDensity === "compact");
  const [clearChecksToken, setClearChecksToken] = useState(0);
  const [movePaperIds, setMovePaperIds] = useState<string[]>();
  const locatedId = useRef<string>();
  useEffect(() => {
    document.documentElement.dataset.tableDensity = compact ? "compact" : "comfortable";
  }, [compact]);
  useEffect(() => {
    if (!selectedId) { locatedId.current = undefined; return; }
    if (!data || locatedId.current === selectedId) return;
    const paper = data.papers.find(item => item.id === selectedId && !item.deletedAt);
    if (!paper) return;
    locatedId.current = selectedId;
    const allViews = [...builtinViews, ...data.views];
    const baseView = allViews.find(view => view.id === viewId) ?? builtinViews[0];
    const filter = applyFolderFilter({ ...baseView.filter }, folderSelection);
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
  }, [selectedId, data, viewId, status, category, favoriteOnly, search, folderSelection]);
  if (!data) return null;
  const allViews = [...builtinViews, ...data.views];
  const baseView = allViews.find(view => view.id === viewId) ?? builtinViews[0];
  const filter = applyFolderFilter({ ...baseView.filter }, folderSelection);
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
  const refreshLibrary = async () => { onClearLibraryNotice(); setRefreshing(true); try { await refresh(); } finally { setRefreshing(false); } };
  const createFolder = async (parentId?: string, selectInLibrary = true) => {
    const name = window.prompt("文件夹名称", "新建文件夹");
    if (!name?.trim()) return;
    const trimmed = name.trim();
    if (folderSiblingNameTaken(data.folders, trimmed, parentId)) {
      window.alert("同一层级已存在同名文件夹");
      return;
    }
    const stamp = now();
    const folder: Folder = { id: uuid(), name: trimmed, ...(parentId ? { parentId } : {}), position: 0, createdAt: stamp, updatedAt: stamp };
    try {
      await saveFolder(folder);
      if (selectInLibrary) onFolderSelection({ kind: "folder", id: folder.id });
      return folder.id;
    } catch (error) {
      window.alert(error instanceof Error ? error.message : String(error));
    }
  };
  const renameFolder = async (folder: Folder) => {
    const name = window.prompt("重命名文件夹", folder.name);
    if (!name?.trim() || name.trim() === folder.name) return;
    const trimmed = name.trim();
    if (folderSiblingNameTaken(data.folders, trimmed, folder.parentId, folder.id)) {
      window.alert("同一层级已存在同名文件夹");
      return;
    }
    try {
      await saveFolder({ ...folder, name: trimmed, updatedAt: now() });
    } catch (error) {
      window.alert(error instanceof Error ? error.message : String(error));
    }
  };
  const removeFolder = async (folder: Folder) => {
    const subtree = new Set<string>([folder.id]);
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
    const active = data.papers.filter(paper => !paper.deletedAt && paper.folderId && subtree.has(paper.folderId)).length;
    if (active > 0) {
      window.alert("不能删除非空文件夹。请先移出或删除其中的论文。");
      return;
    }
    const emptyChildren = subtree.size - 1;
    const message = emptyChildren > 0
      ? `将删除「${folder.name}」及其 ${emptyChildren} 个空子文件夹。其中没有论文。`
      : `删除空文件夹「${folder.name}」？`;
    if (!window.confirm(message)) return;
    try {
      await deleteFolder(folder.id);
      if (folderSelection.kind === "folder" && subtree.has(folderSelection.id)) onFolderSelection({ kind: "all" });
    } catch (error) {
      window.alert(error instanceof Error ? error.message : String(error));
    }
  };
  const dropPapers = async (folderId: string | null, paperIds: string[]) => {
    if (!paperIds.length) return;
    try {
      await movePapersToFolder(paperIds, folderId);
      onClearCut();
      setClearChecksToken(token => token + 1);
      onLibraryNotice(`已移动 ${paperIds.length} 篇论文`);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : String(error));
    }
  };
  const crumbs = folderBreadcrumb(data.folders, folderSelection);
  return <main className="library-view">
    <section className="research-overview" aria-label="论文库概览">
      <div className="overview-intro"><h1>论文库</h1></div>
      <div className="overview-metrics">
        <article><div><strong>{data.papers.filter(paper => !paper.deletedAt).length}</strong><small>全部</small></div></article>
        <article><div><strong>{readingCount}</strong><small>在读</small></div></article>
        <article><div><strong>{completedCount}</strong><small>已读</small></div></article>
        <article><div><strong>{unreadCount}</strong><small>未读</small></div></article>
      </div>
    </section>
    <div className="library-body">
      <FolderTree
        folders={data.folders}
        papers={data.papers}
        selection={folderSelection}
        onSelect={onFolderSelection}
        onCreateRoot={() => void createFolder()}
        onCreateChild={parentId => void createFolder(parentId)}
        onCreateSibling={folder => void createFolder(folder.parentId)}
        onRename={renameFolder}
        onDelete={removeFolder}
        onDropPapers={(folderId, paperIds) => void dropPapers(folderId, paperIds)}
      />
      <div className="library-main">
        <div className="view-header">
          <div>
            <h1>{crumbs.at(-1) || "全部论文"}</h1>
            <p className="folder-breadcrumb">{crumbs.join(" / ")} · {papers.length} 篇</p>
          </div>
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
            <button className="ghost view-save" aria-label="保存视图" title="保存视图" onClick={saveCurrent}><BookmarkPlus size={15} /><span>保存视图</span></button>
            <button className="ghost view-refresh" disabled={refreshing} aria-busy={refreshing} aria-label={refreshing ? "刷新中…" : "刷新"} onClick={() => void refreshLibrary()} title={refreshing ? "刷新中…" : "从资料库重新加载"}><RefreshCw size={15} className={refreshing ? "spin" : undefined} /><span>{refreshing ? "刷新中…" : "刷新"}</span></button>
            <button className="icon-button" title="切换表格密度" aria-pressed={compact} onClick={() => setCompact(value => !value)}><Rows3 size={17} /></button>
          </div>
        </div>
        <PaperTable
          papers={papers}
          categories={data.categories}
          tags={data.tags}
          folders={data.folders}
          customFieldDefinitions={data.customFieldDefinitions}
          customFieldValues={data.customFieldValues}
          selectedId={selectedId}
          cutPaperIds={cutPaperIds}
          onSelect={onSelect}
          onOpenPdf={onOpenPdf}
          onToggleFavorite={paper => savePaper({ ...paper, favorite: !paper.favorite, updatedAt: new Date().toISOString() })}
          onBulkRecycle={recyclePapers}
          onCut={onCutPapers}
          onMoveToFolder={(paperIds, folderId) => void dropPapers(folderId, paperIds)}
          onRequestMove={setMovePaperIds}
          clearChecksToken={clearChecksToken}
        />
      </div>
    </div>
    {movePaperIds && <MovePapersDialog
      folders={data.folders}
      count={movePaperIds.length}
      onClose={() => setMovePaperIds(undefined)}
      onMove={folderId => { void dropPapers(folderId, movePaperIds); setMovePaperIds(undefined); }}
      onCreate={parentId => createFolder(parentId, false)}
    />}
  </main>;
}

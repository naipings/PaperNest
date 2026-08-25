import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, ChevronRight, Folder, FolderOpen, FolderPlus, Pencil, Trash2 } from "lucide-react";
import type { Folder as FolderRecord, FolderSelection, Paper } from "../types";

const FOLDER_WIDTH_KEY = "papernest.library.folderWidth";
const FOLDER_WIDTH_DEFAULT = 220;
const FOLDER_WIDTH_MIN = 160;
const FOLDER_WIDTH_MAX = 420;
const LIBRARY_MAIN_MIN = 320;

type FolderMenu = { x: number; y: number; folder?: FolderRecord };

function readFolderWidth() {
  const saved = Number(localStorage.getItem(FOLDER_WIDTH_KEY));
  return Number.isFinite(saved) && saved >= FOLDER_WIDTH_MIN && saved <= FOLDER_WIDTH_MAX ? saved : FOLDER_WIDTH_DEFAULT;
}

function childrenOf(folders: FolderRecord[], parentId?: string) {
  return folders
    .filter(item => (parentId ? item.parentId === parentId : !item.parentId))
    .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name, "zh"));
}

function countInFolder(papers: Paper[], folderId: string) {
  return papers.filter(paper => !paper.deletedAt && paper.folderId === folderId).length;
}

function countUnfiled(papers: Paper[]) {
  return papers.filter(paper => !paper.deletedAt && !paper.folderId).length;
}

function FolderNode({
  folder, folders, papers, selection, depth, expanded, onToggle, onSelect, onCreateChild, onRename, onDelete, onDropPapers, onOpenMenu,
}: {
  folder: FolderRecord;
  folders: FolderRecord[];
  papers: Paper[];
  selection: FolderSelection;
  depth: number;
  expanded: Set<string>;
  onToggle(id: string): void;
  onSelect(selection: FolderSelection): void;
  onCreateChild(parentId: string): void;
  onRename(folder: FolderRecord): void;
  onDelete(folder: FolderRecord): void;
  onDropPapers(folderId: string | null, paperIds: string[]): void;
  onOpenMenu(event: ReactMouseEvent, folder: FolderRecord): void;
}) {
  const kids = childrenOf(folders, folder.id);
  const open = expanded.has(folder.id);
  const active = selection.kind === "folder" && selection.id === folder.id;
  const count = countInFolder(papers, folder.id);
  return <div className="folder-node">
    <div
      role="treeitem"
      aria-selected={active}
      aria-expanded={kids.length ? open : undefined}
      aria-label={`${folder.name}，${count} 篇`}
      className={`folder-row ${depth === 0 ? "virtual" : ""} ${active ? "active" : ""}`}
      style={{ paddingLeft: depth === 0 ? undefined : 8 + depth * 14 }}
      onClick={() => onSelect({ kind: "folder", id: folder.id })}
      onContextMenu={event => onOpenMenu(event, folder)}
      onDragOver={event => { event.preventDefault(); event.dataTransfer.dropEffect = "move"; }}
      onDrop={event => {
        event.preventDefault();
        const raw = event.dataTransfer.getData("application/x-papernest-papers");
        if (!raw) return;
        onDropPapers(folder.id, JSON.parse(raw) as string[]);
      }}
    >
      <button type="button" className="folder-twist" onClick={event => { event.stopPropagation(); onToggle(folder.id); }} aria-label={open ? "折叠" : "展开"}>
        {kids.length ? (open ? <ChevronDown size={14} /> : <ChevronRight size={14} />) : <span className="folder-twist-spacer" />}
      </button>
      {open || active ? <FolderOpen size={15} /> : <Folder size={15} />}
      <span className="folder-name">{folder.name}</span>
      <small className="folder-count">{count}</small>
      <span className="folder-actions">
        <button type="button" title="新建子文件夹" onClick={event => { event.stopPropagation(); if (!open) onToggle(folder.id); onCreateChild(folder.id); }}><FolderPlus size={13} /></button>
        <button type="button" title="重命名" onClick={event => { event.stopPropagation(); onRename(folder); }}><Pencil size={13} /></button>
        <button type="button" title="删除" onClick={event => { event.stopPropagation(); onDelete(folder); }}><Trash2 size={13} /></button>
      </span>
    </div>
    {open && kids.map(child => (
      <FolderNode key={child.id} folder={child} folders={folders} papers={papers} selection={selection} depth={depth + 1}
        expanded={expanded} onToggle={onToggle} onSelect={onSelect} onCreateChild={onCreateChild} onRename={onRename} onDelete={onDelete} onDropPapers={onDropPapers} onOpenMenu={onOpenMenu} />
    ))}
  </div>;
}

export function FolderTree({
  folders, papers, selection, onSelect, onCreateRoot, onCreateChild, onCreateSibling, onRename, onDelete, onDropPapers,
}: {
  folders: FolderRecord[];
  papers: Paper[];
  selection: FolderSelection;
  onSelect(selection: FolderSelection): void;
  onCreateRoot(): void;
  onCreateChild(parentId: string): void;
  onCreateSibling(folder: FolderRecord): void;
  onRename(folder: FolderRecord): void;
  onDelete(folder: FolderRecord): void;
  onDropPapers(folderId: string | null, paperIds: string[]): void;
}) {
  const roots = useMemo(() => childrenOf(folders), [folders]);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(folders.map(item => item.id)));
  const [width, setWidth] = useState(readFolderWidth);
  const [resizing, setResizing] = useState(false);
  const [menu, setMenu] = useState<FolderMenu>();
  const treeRef = useRef<HTMLElement>(null);
  useEffect(() => {
    setExpanded(current => {
      const next = new Set(current);
      if (selection.kind !== "folder") return next;
      let cursor = folders.find(item => item.id === selection.id);
      while (cursor?.parentId) {
        next.add(cursor.parentId);
        cursor = folders.find(item => item.id === cursor!.parentId);
      }
      return next;
    });
  }, [folders, selection]);
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(undefined);
    window.addEventListener("click", close);
    window.addEventListener("scroll", close, true);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [menu]);
  const toggle = (id: string) => setExpanded(current => {
    const next = new Set(current);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });
  const clearSelection = () => onSelect({ kind: "all" });
  const openRootMenu = (event: ReactMouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    setMenu({ x: event.clientX, y: event.clientY });
  };
  const openFolderMenu = (event: ReactMouseEvent, folder: FolderRecord) => {
    event.preventDefault();
    event.stopPropagation();
    setMenu({ x: event.clientX, y: event.clientY, folder });
  };
  const createChild = (parentId: string) => {
    if (!expanded.has(parentId)) toggle(parentId);
    onCreateChild(parentId);
    setMenu(undefined);
  };
  const startResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const body = treeRef.current?.closest(".library-body") as HTMLElement | null;
    if (!body) return;
    const bounds = body.getBoundingClientRect();
    const maxWidth = Math.min(FOLDER_WIDTH_MAX, Math.max(FOLDER_WIDTH_MIN, bounds.width - LIBRARY_MAIN_MIN));
    const handle = event.currentTarget;
    const pointerId = event.pointerId;
    handle.setPointerCapture(pointerId);
    setResizing(true);
    document.body.classList.add("is-folder-resizing");
    const onMove = (move: PointerEvent) => {
      const next = Math.min(maxWidth, Math.max(FOLDER_WIDTH_MIN, move.clientX - bounds.left));
      setWidth(next);
    };
    const onUp = () => {
      handle.releasePointerCapture(pointerId);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      setResizing(false);
      document.body.classList.remove("is-folder-resizing");
      setWidth(current => {
        const rounded = Math.round(current);
        localStorage.setItem(FOLDER_WIDTH_KEY, String(rounded));
        return rounded;
      });
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };
  const total = papers.filter(paper => !paper.deletedAt).length;
  return <aside
    ref={treeRef}
    className={"folder-tree" + (resizing ? " is-resizing" : "")}
    aria-label="文件夹"
    style={{ width, flexBasis: width }}
    onContextMenu={openRootMenu}
  >
    <div className="folder-resize-handle" role="separator" aria-orientation="vertical" aria-label="调整文件夹栏宽度" onPointerDown={startResize} />
    <div className="folder-tree-header" onContextMenu={openRootMenu}>
      <strong>文件夹</strong>
      <button type="button" className="icon-button" title="新建文件夹" onClick={() => onCreateRoot()}><FolderPlus size={15} /></button>
    </div>
    <div
      className="folder-tree-body"
      onClick={event => { if (event.target === event.currentTarget) clearSelection(); }}
    >
      <button type="button" className={`folder-row virtual ${selection.kind === "all" ? "active" : ""}`} onClick={() => onSelect({ kind: "all" })} onContextMenu={openRootMenu}>
        <Folder size={15} /><span className="folder-name">全部论文</span><small className="folder-count">{total}</small>
      </button>
      <button
        type="button"
        className={`folder-row virtual ${selection.kind === "unfiled" ? "active" : ""}`}
        onClick={() => onSelect({ kind: "unfiled" })}
        onContextMenu={openRootMenu}
        onDragOver={event => { event.preventDefault(); event.dataTransfer.dropEffect = "move"; }}
        onDrop={event => {
          event.preventDefault();
          const raw = event.dataTransfer.getData("application/x-papernest-papers");
          if (!raw) return;
          onDropPapers(null, JSON.parse(raw) as string[]);
        }}
      >
        <Folder size={15} /><span className="folder-name">未归档</span><small className="folder-count">{countUnfiled(papers)}</small>
      </button>
      {roots.length > 0 && <div className="folder-tree-divider" aria-hidden="true" />}
      {roots.map(folder => (
        <FolderNode key={folder.id} folder={folder} folders={folders} papers={papers} selection={selection} depth={0}
          expanded={expanded} onToggle={toggle} onSelect={onSelect} onCreateChild={createChild} onRename={onRename} onDelete={onDelete} onDropPapers={onDropPapers} onOpenMenu={openFolderMenu} />
      ))}
    </div>
    {menu && createPortal(
      <div className="folder-context-menu" style={{ left: menu.x, top: menu.y }} onClick={event => event.stopPropagation()} onContextMenu={event => event.preventDefault()}>
        {menu.folder ? <>
          <button type="button" onClick={() => createChild(menu.folder!.id)}><FolderPlus size={14} />新建子文件夹</button>
          <button type="button" onClick={() => { onCreateSibling(menu.folder!); setMenu(undefined); }}><FolderPlus size={14} />新建同级文件夹</button>
          <button type="button" onClick={() => { onRename(menu.folder!); setMenu(undefined); }}><Pencil size={14} />重命名</button>
          <button type="button" className="danger" onClick={() => { onDelete(menu.folder!); setMenu(undefined); }}><Trash2 size={14} />删除</button>
        </> : <button type="button" onClick={() => { onCreateRoot(); setMenu(undefined); }}><FolderPlus size={14} />新建文件夹</button>}
      </div>,
      document.body,
    )}
  </aside>;
}

export function folderBreadcrumb(folders: FolderRecord[], selection: FolderSelection): string[] {
  if (selection.kind === "all") return ["全部论文"];
  if (selection.kind === "unfiled") return ["未归档"];
  const path: string[] = [];
  let current = folders.find(item => item.id === selection.id);
  while (current) {
    path.unshift(current.name);
    current = current.parentId ? folders.find(item => item.id === current!.parentId) : undefined;
  }
  return path.length ? path : ["未知文件夹"];
}

export function importFolderId(selection: FolderSelection): string | null {
  return selection.kind === "folder" ? selection.id : null;
}

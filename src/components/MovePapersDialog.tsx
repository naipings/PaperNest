import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Folder, FolderPlus } from "lucide-react";
import { folderIdsVisibleForQuery } from "../lib/folders";
import type { Folder as FolderRecord } from "../types";
import { Modal } from "./Modal";

type PickTarget = { kind: "unfiled" } | { kind: "folder"; id: string };

function childrenOf(folders: FolderRecord[], parentId?: string) {
  return folders
    .filter(item => (parentId ? item.parentId === parentId : !item.parentId))
    .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name, "zh"));
}

function PickerNode({
  folder, folders, depth, visible, expanded, selectedId, onToggle, onSelect,
}: {
  folder: FolderRecord;
  folders: FolderRecord[];
  depth: number;
  visible?: Set<string>;
  expanded: Set<string>;
  selectedId?: string;
  onToggle(id: string): void;
  onSelect(id: string): void;
}) {
  if (visible && !visible.has(folder.id)) return null;
  const kids = childrenOf(folders, folder.id);
  const open = expanded.has(folder.id);
  return <div>
    <button type="button" className={`folder-row ${selectedId === folder.id ? "active" : ""}`} style={{ paddingLeft: 8 + depth * 14 }} onClick={() => onSelect(folder.id)}>
      <span className="folder-twist" onClick={event => { event.stopPropagation(); if (kids.length) onToggle(folder.id); }} aria-hidden="true">
        {kids.length ? (open ? <ChevronDown size={14} /> : <ChevronRight size={14} />) : <span className="folder-twist-spacer" />}
      </span>
      <Folder size={15} />
      <span className="folder-name">{folder.name}</span>
    </button>
    {open && kids.map(child => (
      <PickerNode key={child.id} folder={child} folders={folders} depth={depth + 1} visible={visible} expanded={expanded} selectedId={selectedId} onToggle={onToggle} onSelect={onSelect} />
    ))}
  </div>;
}

export function MovePapersDialog({
  folders, count, onClose, onMove, onCreate,
}: {
  folders: FolderRecord[];
  count: number;
  onClose(): void;
  onMove(folderId: string | null): void;
  onCreate(parentId?: string): Promise<string | undefined>;
}) {
  const [query, setQuery] = useState("");
  const [pick, setPick] = useState<PickTarget>();
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(folders.map(item => item.id)));
  const [creating, setCreating] = useState(false);
  const visible = useMemo(() => folderIdsVisibleForQuery(folders, query), [folders, query]);
  const roots = childrenOf(folders).filter(folder => !visible || visible.has(folder.id));
  const toggle = (id: string) => setExpanded(current => {
    const next = new Set(current);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });
  const createHere = async () => {
    setCreating(true);
    try {
      const parentId = pick?.kind === "folder" ? pick.id : undefined;
      const id = await onCreate(parentId);
      if (!id) return;
      if (parentId) setExpanded(current => new Set(current).add(parentId));
      setPick({ kind: "folder", id });
      setQuery("");
    } finally {
      setCreating(false);
    }
  };
  return <Modal title={`移动 ${count} 篇论文`} onClose={onClose}>
    <div className="move-folder-dialog">
      <input aria-label="搜索文件夹" placeholder="搜索文件夹" value={query} onChange={event => setQuery(event.target.value)} />
      <div className="picker-scroll" role="tree">
        <button type="button" className={`folder-row ${pick?.kind === "unfiled" ? "active" : ""}`} onClick={() => setPick({ kind: "unfiled" })}>
          <Folder size={15} /><span className="folder-name">未归档</span>
        </button>
        {roots.map(folder => (
          <PickerNode key={folder.id} folder={folder} folders={folders} depth={0} visible={visible} expanded={query.trim() ? new Set(folders.map(item => item.id)) : expanded} selectedId={pick?.kind === "folder" ? pick.id : undefined} onToggle={toggle} onSelect={id => setPick({ kind: "folder", id })} />
        ))}
        {query.trim() && roots.length === 0 && <p className="muted">没有匹配的文件夹</p>}
      </div>
      <footer>
        <button type="button" className="secondary" disabled={creating} onClick={() => void createHere()}><FolderPlus size={15} />在此新建</button>
        <button type="button" className="ghost" onClick={onClose}>取消</button>
        <button type="button" className="primary" disabled={!pick} onClick={() => pick && onMove(pick.kind === "folder" ? pick.id : null)}>移动</button>
      </footer>
    </div>
  </Modal>;
}

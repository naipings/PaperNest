import { useEffect, useMemo, useRef, useState } from "react";
import { createColumnHelper, flexRender, getCoreRowModel, getSortedRowModel, useReactTable, type SortingState } from "@tanstack/react-table";
import { ExternalLink, FileText, FolderInput, Heart, Scissors, Trash2 } from "lucide-react";
import { backend } from "../services/backend";
import { formatCustomFieldValue, tableCustomFields, valuesForPaper } from "../lib/customFields";
import { beginPaperDrag, endPaperDrag, publishDropTarget, resolveDraggedPaperIds } from "../lib/paperDrag";
import { resolvePaperSourceUrl } from "../lib/paperSourceUrl";
import type { Category, CustomFieldDefinition, Folder, Paper, PaperCustomFieldValue, Tag } from "../types";

const statusLabel = { unread: "未读", reading: "在读", read: "已读", archived: "已归档" };
const helper = createColumnHelper<Paper>();
const DRAG_THRESHOLD = 6;

type RowPointerDrag = {
  pointerId: number;
  startX: number;
  startY: number;
  ids: string[];
  label: string;
  active: boolean;
  ghost?: HTMLDivElement;
};

function folderDropAt(clientX: number, clientY: number) {
  const el = document.elementFromPoint(clientX, clientY)?.closest("[data-folder-drop]") as HTMLElement | null;
  const key = el?.dataset.folderDrop;
  publishDropTarget(key);
  return key;
}

export function PaperTable({
  papers, categories, tags, folders, customFieldDefinitions, customFieldValues, selectedId, cutPaperIds,
  onSelect, onOpenPdf, onToggleFavorite, onBulkRecycle, onCut, onMoveToFolder, clearChecksToken,
}: {
  papers: Paper[];
  categories: Category[];
  tags: Tag[];
  folders: Folder[];
  customFieldDefinitions: CustomFieldDefinition[];
  customFieldValues: PaperCustomFieldValue[];
  selectedId?: string;
  cutPaperIds: string[];
  clearChecksToken?: number;
  onSelect(paper: Paper): void;
  onOpenPdf(paper: Paper): void;
  onToggleFavorite(paper: Paper): void;
  onBulkRecycle(papers: Paper[]): void;
  onCut(ids: string[]): void;
  onMoveToFolder(paperIds: string[], folderId: string | null): void;
}) {
  const [sorting, setSorting] = useState<SortingState>([{ id: "updatedAt", desc: true }]);
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());
  const [draggingIds, setDraggingIds] = useState<string[]>([]);
  const skipClickRef = useRef(false);
  const pointerDragRef = useRef<RowPointerDrag | null>(null);
  const selectedPapers = papers.filter(paper => checkedIds.has(paper.id));
  const toggle = (id: string) => setCheckedIds(current => { const next = new Set(current); next.has(id) ? next.delete(id) : next.add(id); return next; });
  const toggleAll = () => setCheckedIds(current => current.size === papers.length ? new Set() : new Set(papers.map(paper => paper.id)));
  useEffect(() => {
    setCheckedIds(current => {
      const visible = new Set(papers.map(paper => paper.id));
      let changed = false;
      const next = new Set<string>();
      for (const id of current) {
        if (visible.has(id)) next.add(id);
        else changed = true;
      }
      return changed ? next : current;
    });
  }, [papers]);
  useEffect(() => {
    if (!clearChecksToken) return;
    setCheckedIds(new Set());
  }, [clearChecksToken]);
  useEffect(() => {
    const finishGhost = (drag: RowPointerDrag) => {
      drag.ghost?.remove();
      drag.ghost = undefined;
    };
    const onMove = (event: PointerEvent) => {
      const drag = pointerDragRef.current;
      if (!drag || event.pointerId !== drag.pointerId) return;
      if (!drag.active) {
        if (Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < DRAG_THRESHOLD) return;
        drag.active = true;
        beginPaperDrag(drag.ids);
        setDraggingIds(drag.ids);
        document.body.classList.add("is-paper-dragging");
        const ghost = document.createElement("div");
        ghost.className = "paper-drag-ghost floating";
        ghost.textContent = drag.label;
        document.body.appendChild(ghost);
        drag.ghost = ghost;
      }
      if (drag.ghost) {
        drag.ghost.style.transform = `translate(${event.clientX + 14}px, ${event.clientY + 12}px)`;
      }
      folderDropAt(event.clientX, event.clientY);
    };
    const onUp = (event: PointerEvent) => {
      const drag = pointerDragRef.current;
      if (!drag || event.pointerId !== drag.pointerId) return;
      pointerDragRef.current = null;
      finishGhost(drag);
      const dropKey = drag.active ? folderDropAt(event.clientX, event.clientY) : undefined;
      publishDropTarget(undefined);
      setDraggingIds([]);
      endPaperDrag();
      document.body.classList.remove("is-paper-dragging");
      if (!drag.active) return;
      skipClickRef.current = true;
      if (dropKey === undefined) return;
      onMoveToFolder(drag.ids, dropKey === "unfiled" ? null : dropKey);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      document.body.classList.remove("is-paper-dragging");
      publishDropTarget(undefined);
      endPaperDrag();
    };
  }, [onMoveToFolder]);
  const tableFields = useMemo(() => tableCustomFields(customFieldDefinitions), [customFieldDefinitions]);
  const folderName = (id?: string) => id ? folders.find(item => item.id === id)?.name ?? "—" : "未归档";
  const columns = useMemo(() => {
    const base = [
    helper.display({ id: "select", header: () => <input className="row-check" type="checkbox" aria-label="全选论文" checked={papers.length > 0 && checkedIds.size === papers.length} ref={element => { if (element) element.indeterminate = checkedIds.size > 0 && checkedIds.size < papers.length; }} onClick={event => event.stopPropagation()} onChange={toggleAll} />, size: 48, enableSorting: false, enableResizing: false, cell: info => <input className="row-check" type="checkbox" aria-label="选择论文" checked={checkedIds.has(info.row.original.id)} onClick={event => event.stopPropagation()} onChange={() => toggle(info.row.original.id)} /> }),
    helper.accessor("favorite", { id: "favorite", header: "", size: 38, enableSorting: true, cell: info => <button className={`favorite ${info.getValue() ? "on" : ""}`} onClick={event => { event.stopPropagation(); onToggleFavorite(info.row.original); }} aria-label="收藏"><Heart size={15} fill={info.getValue() ? "currentColor" : "none"} /></button> }),
    helper.accessor("titleEn", { id: "title", header: "论文题目", size: 300, cell: info => <div className="title-cell"><strong>{info.row.original.titleZh || info.getValue()}</strong>{info.row.original.titleZh && <small>{info.getValue()}</small>}</div> }),
    helper.accessor("folderId", { id: "folder", header: "文件夹", size: 110, cell: info => <span className="ellipsis muted-strong">{folderName(info.getValue())}</span> }),
    helper.accessor("authors", { header: "作者", size: 150, cell: info => <span className="ellipsis">{info.getValue().map(author => author.name).join(", ") || "—"}</span> }),
    helper.accessor("status", { header: "状态", size: 84, cell: info => <span className={`status status-${info.getValue()}`}>{statusLabel[info.getValue()]}</span> }),
    helper.accessor("categoryId", { header: "领域", size: 130, cell: info => { const category = categories.find(item => item.id === info.getValue()); return category ? <span className="category" style={{ "--tag-color": category.color } as React.CSSProperties}>{category.name}</span> : <span className="muted">未分类</span>; } }),
    helper.accessor("tagIds", { header: "子领域", size: 175, enableSorting: false, cell: info => { const items = tags.filter(tag => info.getValue().includes(tag.id)); return <div className="tags">{items.slice(0, 2).map(tag => <span key={tag.id} style={{ "--tag-color": tag.color } as React.CSSProperties}>{tag.name}</span>)}{items.length > 2 && <small>+{items.length - 2}</small>}</div>; } }),
    helper.accessor("summary", { header: "一句话总结", size: 280, cell: info => <span className="ellipsis muted-strong" title={info.getValue()}>{info.getValue() || "待补充"}</span> }),
    helper.accessor("venue", { header: "期刊 / 会议", size: 110, cell: info => info.getValue() || "—" }),
    helper.accessor("publicationDate", { header: "发布日期", size: 110, cell: info => info.getValue()?.slice(0, 10) || "—" }),
    helper.accessor("updatedAt", { header: "最近更新", size: 115, cell: info => new Date(info.getValue()).toLocaleDateString("zh-CN") }),
    helper.display({ id: "links", header: "链接", size: 84, cell: info => { const source = resolvePaperSourceUrl(info.row.original); return <div className="row-actions">{source && <button title="打开原文" onClick={event => { event.stopPropagation(); void backend.openExternalUrl(source); }}><ExternalLink size={15} /></button>}<button title={info.row.original.pdfPath ? "打开 PDF" : "未关联 PDF"} disabled={!info.row.original.pdfPath} onClick={event => { event.stopPropagation(); onOpenPdf(info.row.original); }}><FileText size={16} /></button></div>; } })
    ];
    const custom = tableFields.map(field => helper.display({
      id: `custom:${field.id}`,
      header: field.name,
      size: field.type === "text" ? 180 : 120,
      cell: info => {
        const value = valuesForPaper(customFieldValues, info.row.original.id).get(field.id);
        const label = formatCustomFieldValue(field, value);
        if (field.type === "select" || field.type === "multiselect") {
          const option = field.type === "select" && typeof value === "string" ? field.options.find(item => item.id === value) : undefined;
          return option
            ? <span className="category" style={{ "--tag-color": option.color } as React.CSSProperties}>{option.label}</span>
            : <span className="ellipsis">{label}</span>;
        }
        return <span className="ellipsis" title={label}>{label}</span>;
      },
    }));
    return [...base.slice(0, -2), ...custom, ...base.slice(-2)];
  }, [categories, checkedIds, customFieldValues, folders, onOpenPdf, onToggleFavorite, papers.length, tableFields, tags]);
  const table = useReactTable({ data: papers, columns, state: { sorting }, onSortingChange: setSorting, getCoreRowModel: getCoreRowModel(), getSortedRowModel: getSortedRowModel(), columnResizeMode: "onChange" });
  useEffect(() => {
    if (!selectedId) return;
    const row = document.querySelector<HTMLElement>(`tr[data-paper-id="${selectedId}"]`);
    row?.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
  }, [selectedId, papers]);
  const recycleSelected = () => { if (!selectedPapers.length || !confirm(`将 ${selectedPapers.length} 篇论文及其受管 PDF 移入回收站？`)) return; onBulkRecycle(selectedPapers); setCheckedIds(new Set()); };
  const cutSelected = () => {
    if (!selectedPapers.length) return;
    onCut(selectedPapers.map(paper => paper.id));
  };
  useEffect(() => {
    const typing = (target: EventTarget | null) => {
      if (!(target instanceof HTMLElement)) return false;
      const tag = target.tagName;
      return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable;
    };
    const handler = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "x") return;
      if (typing(event.target)) return;
      const checked = papers.filter(paper => checkedIds.has(paper.id)).map(paper => paper.id);
      const ids = checked.length ? checked : selectedId ? [selectedId] : [];
      if (!ids.length) return;
      event.preventDefault();
      event.stopPropagation();
      onCut(ids);
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [papers, checkedIds, selectedId, onCut]);
  const moveSelected = () => {
    if (!selectedPapers.length) return;
    const ids = selectedPapers.map(paper => paper.id);
    const options = ["未归档", ...folders.map(item => item.name)];
    const choice = window.prompt(`移动到文件夹（输入名称）\n可选：${options.join("、")}`, "未归档");
    if (choice === null) return;
    if (choice.trim() === "未归档" || choice.trim() === "") {
      onMoveToFolder(ids, null);
      setCheckedIds(new Set());
      return;
    }
    const target = folders.find(item => item.name === choice.trim());
    if (!target) {
      window.alert("未找到该文件夹");
      return;
    }
    onMoveToFolder(ids, target.id);
    setCheckedIds(new Set());
  };
  return <div className="table-scroll">
    {selectedPapers.length > 0 && <div className="table-bulk-actions">
      <strong>已选 {selectedPapers.length} 篇</strong>
      <button className="secondary" onClick={cutSelected}><Scissors size={15} />剪切</button>
      <button className="secondary" onClick={moveSelected}><FolderInput size={15} />移动到…</button>
      <button className="secondary danger" onClick={recycleSelected}><Trash2 size={15} />移入回收站</button>
      <button className="ghost" onClick={() => setCheckedIds(new Set())}>取消选择</button>
    </div>}
    <table className="paper-table" style={{ width: table.getTotalSize() }}>
      <colgroup>{table.getAllColumns().map(column => <col key={column.id} style={{ width: column.getSize() }} />)}</colgroup>
      <thead>{table.getHeaderGroups().map(group => <tr key={group.id}>{group.headers.map(header => {
        const size = header.getSize();
        return <th key={header.id} className={header.column.id === "select" ? "col-select" : undefined} style={{ width: size, minWidth: size, maxWidth: size }} onClick={header.column.getToggleSortingHandler()}>{flexRender(header.column.columnDef.header, header.getContext())}{header.column.getIsSorted() && <small>{header.column.getIsSorted() === "asc" ? " ↑" : " ↓"}</small>}{header.column.id !== "select" && <span className="resize-handle" onMouseDown={header.getResizeHandler()} onTouchStart={header.getResizeHandler()} />}</th>;
      })}</tr>)}</thead>
      <tbody>{table.getRowModel().rows.map(row => {
        const dragging = draggingIds.includes(row.original.id);
        return <tr
        key={row.id}
        data-paper-id={row.original.id}
        className={`${selectedId === row.original.id ? "selected" : ""} ${checkedIds.has(row.original.id) ? "checked" : ""} ${cutPaperIds.includes(row.original.id) ? "cut" : ""} ${dragging ? "is-dragging" : ""}`}
        onClick={() => {
          if (skipClickRef.current) {
            skipClickRef.current = false;
            return;
          }
          onSelect(row.original);
        }}
        onDoubleClick={() => onOpenPdf(row.original)}
        onPointerDown={event => {
          if (event.button !== 0) return;
          const target = event.target as HTMLElement | null;
          if (target?.closest("input, button, a, label, .resize-handle")) return;
          const ids = resolveDraggedPaperIds(row.original.id, checkedIds);
          pointerDragRef.current = {
            pointerId: event.pointerId,
            startX: event.clientX,
            startY: event.clientY,
            ids,
            label: ids.length > 1 ? `${ids.length} 篇论文` : (row.original.titleZh || row.original.titleEn || "1 篇论文"),
            active: false,
          };
        }}
      >{row.getVisibleCells().map(cell => {
        const size = cell.column.getSize();
        return <td key={cell.id} className={cell.column.id === "select" ? "col-select" : undefined} style={{ width: size, minWidth: size, maxWidth: size }}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</td>;
      })}</tr>;
      })}</tbody>
    </table>
    {papers.length === 0 && <div className="table-empty">当前视图没有论文</div>}
  </div>;
}

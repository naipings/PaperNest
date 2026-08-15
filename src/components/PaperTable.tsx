import { useMemo, useState } from "react";
import { createColumnHelper, flexRender, getCoreRowModel, getSortedRowModel, useReactTable, type SortingState } from "@tanstack/react-table";
import { ExternalLink, FileText, Heart, Trash2 } from "lucide-react";
import type { Category, Paper, Tag } from "../types";

const statusLabel = { unread: "未读", reading: "在读", read: "已读", archived: "已归档" };
const helper = createColumnHelper<Paper>();

export function PaperTable({ papers, categories, tags, selectedId, onSelect, onOpenPdf, onToggleFavorite, onBulkRecycle }: { papers: Paper[]; categories: Category[]; tags: Tag[]; selectedId?: string; onSelect(paper: Paper): void; onOpenPdf(paper: Paper): void; onToggleFavorite(paper: Paper): void; onBulkRecycle(papers: Paper[]): void }) {
  const [sorting, setSorting] = useState<SortingState>([{ id: "updatedAt", desc: true }]);
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());
  const selectedPapers = papers.filter(paper => checkedIds.has(paper.id));
  const toggle = (id: string) => setCheckedIds(current => { const next = new Set(current); next.has(id) ? next.delete(id) : next.add(id); return next; });
  const toggleAll = () => setCheckedIds(current => current.size === papers.length ? new Set() : new Set(papers.map(paper => paper.id)));
  const columns = useMemo(() => [
    helper.display({ id: "select", header: () => <input className="row-check" type="checkbox" aria-label="全选论文" checked={papers.length > 0 && checkedIds.size === papers.length} ref={element => { if (element) element.indeterminate = checkedIds.size > 0 && checkedIds.size < papers.length; }} onClick={event => event.stopPropagation()} onChange={toggleAll} />, size: 48, enableSorting: false, enableResizing: false, cell: info => <input className="row-check" type="checkbox" aria-label="选择论文" checked={checkedIds.has(info.row.original.id)} onClick={event => event.stopPropagation()} onChange={() => toggle(info.row.original.id)} /> }),
    helper.accessor("favorite", { id: "favorite", header: "", size: 38, enableSorting: true, cell: info => <button className={`favorite ${info.getValue() ? "on" : ""}`} onClick={event => { event.stopPropagation(); onToggleFavorite(info.row.original); }} aria-label="收藏"><Heart size={15} fill={info.getValue() ? "currentColor" : "none"} /></button> }),
    helper.accessor("titleEn", { id: "title", header: "论文题目", size: 330, cell: info => <div className="title-cell"><strong>{info.row.original.titleZh || info.getValue()}</strong>{info.row.original.titleZh && <small>{info.getValue()}</small>}</div> }),
    helper.accessor("authors", { header: "作者", size: 150, cell: info => <span className="ellipsis">{info.getValue().map(author => author.name).join(", ") || "—"}</span> }),
    helper.accessor("status", { header: "状态", size: 84, cell: info => <span className={`status status-${info.getValue()}`}>{statusLabel[info.getValue()]}</span> }),
    helper.accessor("categoryId", { header: "领域", size: 130, cell: info => { const category = categories.find(item => item.id === info.getValue()); return category ? <span className="category" style={{ "--tag-color": category.color } as React.CSSProperties}>{category.name}</span> : <span className="muted">未分类</span>; } }),
    helper.accessor("tagIds", { header: "标签", size: 175, enableSorting: false, cell: info => { const items = tags.filter(tag => info.getValue().includes(tag.id)); return <div className="tags">{items.slice(0, 2).map(tag => <span key={tag.id} style={{ "--tag-color": tag.color } as React.CSSProperties}>{tag.name}</span>)}{items.length > 2 && <small>+{items.length - 2}</small>}</div>; } }),
    helper.accessor("summary", { header: "一句话总结", size: 280, cell: info => <span className="ellipsis muted-strong" title={info.getValue()}>{info.getValue() || "待补充"}</span> }),
    helper.accessor("venue", { header: "期刊 / 会议", size: 110, cell: info => info.getValue() || "—" }),
    helper.accessor("publicationDate", { header: "发布日期", size: 110, cell: info => info.getValue()?.slice(0, 10) || "—" }),
    helper.accessor("updatedAt", { header: "最近更新", size: 115, cell: info => new Date(info.getValue()).toLocaleDateString("zh-CN") }),
    helper.display({ id: "links", header: "链接", size: 84, cell: info => <div className="row-actions">{info.row.original.sourceUrl && <button title="打开原文" onClick={event => { event.stopPropagation(); window.open(info.row.original.sourceUrl, "_blank"); }}><ExternalLink size={15} /></button>}<button title={info.row.original.pdfPath ? "打开 PDF" : "未关联 PDF"} disabled={!info.row.original.pdfPath} onClick={event => { event.stopPropagation(); onOpenPdf(info.row.original); }}><FileText size={16} /></button></div> })
  ], [categories, checkedIds, onOpenPdf, onToggleFavorite, papers.length, tags]);
  const table = useReactTable({ data: papers, columns, state: { sorting }, onSortingChange: setSorting, getCoreRowModel: getCoreRowModel(), getSortedRowModel: getSortedRowModel(), columnResizeMode: "onChange" });
  const recycleSelected = () => { if (!selectedPapers.length || !confirm(`将 ${selectedPapers.length} 篇论文及其受管 PDF 移入回收站？`)) return; onBulkRecycle(selectedPapers); setCheckedIds(new Set()); };
  return <div className="table-scroll">
    {selectedPapers.length > 0 && <div className="table-bulk-actions"><strong>已选 {selectedPapers.length} 篇</strong><button className="secondary danger" onClick={recycleSelected}><Trash2 size={15} />移入回收站</button><button className="ghost" onClick={() => setCheckedIds(new Set())}>取消选择</button></div>}
    <table className="paper-table" style={{ width: table.getTotalSize() }}>
      <colgroup>{table.getAllColumns().map(column => <col key={column.id} style={{ width: column.getSize() }} />)}</colgroup>
      <thead>{table.getHeaderGroups().map(group => <tr key={group.id}>{group.headers.map(header => {
        const size = header.getSize();
        return <th key={header.id} className={header.column.id === "select" ? "col-select" : undefined} style={{ width: size, minWidth: size, maxWidth: size }} onClick={header.column.getToggleSortingHandler()}>{flexRender(header.column.columnDef.header, header.getContext())}{header.column.getIsSorted() && <small>{header.column.getIsSorted() === "asc" ? " ↑" : " ↓"}</small>}{header.column.id !== "select" && <span className="resize-handle" onMouseDown={header.getResizeHandler()} onTouchStart={header.getResizeHandler()} />}</th>;
      })}</tr>)}</thead>
      <tbody>{table.getRowModel().rows.map(row => <tr key={row.id} className={`${selectedId === row.original.id ? "selected" : ""} ${checkedIds.has(row.original.id) ? "checked" : ""}`} onClick={() => onSelect(row.original)} onDoubleClick={() => onOpenPdf(row.original)}>{row.getVisibleCells().map(cell => {
        const size = cell.column.getSize();
        return <td key={cell.id} className={cell.column.id === "select" ? "col-select" : undefined} style={{ width: size, minWidth: size, maxWidth: size }}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</td>;
      })}</tr>)}</tbody>
    </table>
    {papers.length === 0 && <div className="table-empty">当前视图没有论文</div>}
  </div>;
}

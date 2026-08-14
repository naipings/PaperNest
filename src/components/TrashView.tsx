import { RotateCcw, Trash2 } from "lucide-react";
import { useLibrary } from "../state/LibraryContext";
import { EmptyState } from "./Sidebar";

export function TrashView() { const { data, savePaper } = useLibrary(); if (!data) return null; const papers = data.papers.filter(p => p.deletedAt); return <main className="content-page"><header className="page-heading"><div><h1>回收站</h1><p>删除的论文保留附件和批注，可随时恢复。</p></div></header>{!papers.length ? <EmptyState icon="trash" title="回收站是空的" description="删除的论文会先移动到这里，不会立即清除本地 PDF。" /> : <div className="trash-list">{papers.map(paper => <article key={paper.id}><Trash2 size={18} /><div><strong>{paper.titleZh || paper.titleEn}</strong><small>删除于 {new Date(paper.deletedAt!).toLocaleString("zh-CN")}</small></div><button className="secondary" onClick={() => savePaper({ ...paper, deletedAt: undefined })}><RotateCcw size={15} />恢复</button></article>)}</div>}</main>; }

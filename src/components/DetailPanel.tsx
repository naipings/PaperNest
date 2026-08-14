import { useEffect, useState } from "react";
import { BookText, Edit3, ExternalLink, FileImage, FileText, Languages, Plus, Tags, X } from "lucide-react";
import { backend } from "../services/backend";
import { useLibrary } from "../state/LibraryContext";
import type { Paper, VocabularyEntry } from "../types";
import { uuid } from "../types";
import { Modal } from "./Modal";
import { PaperEditor } from "./PaperEditor";

import { OnlineMetadataFillButton } from "./OnlineMetadataFillButton";
type Tab = "overview" | "abstract" | "vocabulary" | "framework";

export function DetailPanel({ paper, onClose, onOpenPdf }: { paper: Paper; onClose(): void; onOpenPdf(paper: Paper): void }) {
  const { data, savePaper, saveVocabulary, saveFigure } = useLibrary(); const [tab, setTab] = useState<Tab>("overview"); const [editing, setEditing] = useState(false); const [newTerm, setNewTerm] = useState(false);
  if (!data) return null;
  const category = data.categories.find(c => c.id === paper.categoryId); const tags = data.tags.filter(t => paper.tagIds.includes(t.id)); const vocab = data.vocabulary.filter(v => v.paperId === paper.id); const figures = data.figures.filter(v => v.paperId === paper.id);
  return <aside className="detail-panel">
    <header><div className="paper-kind"><BookText size={15} />论文详情</div><div><button className="icon-button" onClick={() => setEditing(true)} title="编辑"><Edit3 size={16} /></button><button className="icon-button" onClick={onClose} title="关闭"><X size={18} /></button></div></header>
    <div className="detail-title"><span className={`status status-${paper.status}`}>{paper.status === "unread" ? "未读" : paper.status === "reading" ? "在读" : paper.status === "read" ? "已读" : "归档"}</span><h2>{paper.titleZh || paper.titleEn}</h2>{paper.titleZh && <p>{paper.titleEn}</p>}<small>{paper.authors.map(a => a.name).join(", ") || "作者待补充"}</small></div>
    <nav className="detail-tabs">{([['overview','概览'],['abstract','双语摘要'],['vocabulary',`术语 ${vocab.length}`],['framework',`框架 ${figures.length}`]] as [Tab,string][]).map(([id,label]) => <button className={tab === id ? "active" : ""} onClick={() => setTab(id)} key={id}>{label}</button>)}</nav>
    <button className="paper-delete secondary" onClick={() => { if (confirm("Move this paper to the recycle bin?")) void savePaper({ ...paper, deletedAt: new Date().toISOString(), updatedAt: new Date().toISOString() }); }}>{"\u79fb\u5165\u56de\u6536\u7ad9"}</button>
    <div className="detail-body">
      {tab === "overview" && <>
        <section className="summary-card"><label>一句话总结</label><p>{paper.summary || "尚未补充。用一句话记录这篇论文解决了什么问题、采用了什么方法。"}</p></section>
        <dl className="metadata"><div><dt>主领域</dt><dd>{category ? <span className="category" style={{ "--tag-color": category.color } as React.CSSProperties}>{category.name}</span> : "未分类"}</dd></div><div><dt>标签</dt><dd><span className="tags">{tags.map(t => <span key={t.id} style={{ "--tag-color": t.color } as React.CSSProperties}>{t.name}</span>)}</span></dd></div><div><dt>期刊 / 会议</dt><dd>{paper.venue || "—"}</dd></div><div><dt>发布日期</dt><dd>{paper.publicationDate || "—"}</dd></div><div><dt>DOI</dt><dd>{paper.doi || "—"}</dd></div><div><dt>文件状态</dt><dd>{paper.pdfPath ? `已管理 · ${paper.pageCount ?? "?"} 页` : "未关联 PDF"}</dd></div></dl>
        <div className="detail-actions">{data.metadata.enabled && <OnlineMetadataFillButton paper={paper} onSave={savePaper} />}<button className="primary" disabled={!paper.pdfPath} onClick={() => onOpenPdf(paper)}><FileText size={16} />进入阅读台</button>{paper.sourceUrl && <button className="secondary" onClick={() => window.open(paper.sourceUrl, "_blank")}><ExternalLink size={16} />打开原文</button>}</div>
      </>}
      {tab === "abstract" && <div className="abstract-columns"><article><h3><Languages size={16} />中文摘要</h3><p>{paper.abstractZh || "待补充中文摘要"}</p></article><article><h3>EN</h3><p>{paper.abstractEn || "English abstract is not available."}</p></article></div>}
      {tab === "vocabulary" && <section className="stack-list"><button className="dashed-add" onClick={() => setNewTerm(true)}><Plus size={15} />添加专业词汇或短语</button>{vocab.map(item => <VocabularyCard entry={item} key={item.id} />)}{!vocab.length && <p className="muted centered">从 PDF 选中文本后可快速收为术语</p>}</section>}
      {tab === "framework" && <section className="stack-list"><label className="dashed-add"><FileImage size={15} />上传方法框架图<input hidden type="file" accept="image/png,image/jpeg,image/webp" onChange={async event => { const file=event.target.files?.[0]; if(!file)return; const bytes=Array.from(new Uint8Array(await file.arrayBuffer())); const title=window.prompt("框架图标题",file.name.replace(/\.[^.]+$/,""))||"方法框架图"; const explanationZh=window.prompt("中文解释（可稍后补充）")||undefined; const pageValue=window.prompt("来源页码（可留空）"); await saveFigure({id:uuid(),paperId:paper.id,imagePath:"",title,explanationZh,page:pageValue?Number(pageValue):undefined,isPrimary:figures.length===0},bytes); event.target.value=""; }} /></label>{figures.map(item => <article className="figure-card" key={item.id}><div className="figure-placeholder"><FileImage size={30} /></div><h3>{item.title || "方法框架图"}</h3><p>{item.explanationZh || "待补充中文解释"}</p><small>来源：第 {item.page ?? "?"} 页</small></article>)}{!figures.length && <p className="muted centered">还没有方法框架图</p>}</section>}
      {tab === "framework" && figures.length > 0 && <div className="llm-figure-gallery">{figures.map(item => <ManagedFigure key={`image-${item.id}`} path={item.imagePath} />)}</div>}
    </div>
    {editing && <Modal title="编辑论文" onClose={() => setEditing(false)} wide><PaperEditor initial={paper} categories={data.categories} tags={data.tags} onCancel={() => setEditing(false)} onSave={async p => { await savePaper(p); setEditing(false); }} /></Modal>}
    {newTerm && <TermEditor paperId={paper.id} onClose={() => setNewTerm(false)} onSave={async item => { await saveVocabulary(item); setNewTerm(false); }} />}
  </aside>;
function ManagedFigure({ path }: { path: string }) { const [url, setUrl] = useState<string>(); useEffect(() => { let active=true; let current=""; void backend.readPdf(path).then(bytes => { current=URL.createObjectURL(new Blob([bytes], { type: "image/png" })); if(active)setUrl(current); else URL.revokeObjectURL(current); }).catch(() => undefined); return () => { active=false; if(current)URL.revokeObjectURL(current); }; }, [path]); return url ? <img className="framework-image" src={url} alt="方法框架图" /> : <div className="figure-placeholder"><FileImage size={30} /></div>; }

}

function VocabularyCard({ entry }: { entry: VocabularyEntry }) { return <article className="vocab-card"><header><strong>{entry.termEn}</strong><span>{entry.meaningZh}</span></header>{entry.sentenceEn && <blockquote>{entry.sentenceEn}</blockquote>}{entry.sentenceZh && <p>{entry.sentenceZh}</p>}{entry.page && <small>来源 · 第 {entry.page} 页</small>}</article>; }

function TermEditor({ paperId, onClose, onSave }: { paperId: string; onClose(): void; onSave(entry: VocabularyEntry): Promise<void> }) {
  const [entry, setEntry] = useState<VocabularyEntry>({ id: uuid(), paperId, termEn: "", meaningZh: "" }); const set = (key: keyof VocabularyEntry, value: string | number) => setEntry(e => ({ ...e, [key]: value }));
  return <Modal title="添加专业词汇 / 短语" onClose={onClose}><form className="paper-editor" onSubmit={e => { e.preventDefault(); void onSave(entry); }}><label>英文词汇 / 短语<input autoFocus required value={entry.termEn} onChange={e => set("termEn", e.target.value)} /></label><label>中文释义<textarea required rows={2} value={entry.meaningZh} onChange={e => set("meaningZh", e.target.value)} /></label><label>代表性原句<textarea rows={3} value={entry.sentenceEn ?? ""} onChange={e => set("sentenceEn", e.target.value)} /></label><label>句子中文注释<textarea rows={3} value={entry.sentenceZh ?? ""} onChange={e => set("sentenceZh", e.target.value)} /></label><label>页码<input type="number" min="1" value={entry.page ?? ""} onChange={e => set("page", Number(e.target.value))} /></label><footer><button type="button" className="secondary" onClick={onClose}>取消</button><button className="primary">保存</button></footer></form></Modal>;
}

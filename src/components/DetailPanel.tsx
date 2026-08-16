import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { BookText, Edit3, ExternalLink, FileImage, FileText, Languages, Plus, Trash2, X } from "lucide-react";
import { backend } from "../services/backend";
import { resolvePaperSourceUrl } from "../lib/paperSourceUrl";
import { useLibrary } from "../state/LibraryContext";
import type { Paper, VocabularyEntry } from "../types";
import { uuid } from "../types";
import { Modal } from "./Modal";
import { PaperEditor } from "./PaperEditor";
import { OnlineMetadataFillButton } from "./OnlineMetadataFillButton";

type Tab = "overview" | "abstract" | "vocabulary" | "framework";

const DETAIL_WIDTH_KEY = "papernest.library.detailWidth";
const DETAIL_WIDTH_DEFAULT = 440;
const DETAIL_WIDTH_MIN = 300;
const LIBRARY_MIN = 280;

function readDetailWidth() {
  const saved = Number(localStorage.getItem(DETAIL_WIDTH_KEY));
  return Number.isFinite(saved) && saved >= DETAIL_WIDTH_MIN ? saved : DETAIL_WIDTH_DEFAULT;
}

export function DetailPanel({ paper, onClose, onOpenPdf, onSelect }: { paper: Paper; onClose(): void; onOpenPdf(paper: Paper): void; onSelect(paper: Paper): void }) {
  const { data, savePaper, saveVocabulary, deleteVocabulary, saveFigure, deleteFigure } = useLibrary();
  const [tab, setTab] = useState<Tab>("overview");
  const [editing, setEditing] = useState(false);
  const [newTerm, setNewTerm] = useState(false);
  const [checkedTermIds, setCheckedTermIds] = useState<Set<string>>(new Set());
  const [width, setWidth] = useState(readDetailWidth);
  const [resizing, setResizing] = useState(false);
  const panelRef = useRef<HTMLElement>(null);
  if (!data) return null;
  const category = data.categories.find(c => c.id === paper.categoryId);
  const tags = data.tags.filter(t => paper.tagIds.includes(t.id));
  const vocab = data.vocabulary.filter(v => v.paperId === paper.id);
  const figures = data.figures.filter(v => v.paperId === paper.id);
  const related = (paper.relatedPaperIds ?? []).map(id => data.papers.find(item => item.id === id && !item.deletedAt)).filter((item): item is Paper => Boolean(item));
  const startResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const shell = panelRef.current?.closest(".main-with-detail") as HTMLElement | null;
    if (!shell) return;
    const bounds = shell.getBoundingClientRect();
    const maxWidth = Math.max(DETAIL_WIDTH_MIN, bounds.width - LIBRARY_MIN);
    const handle = event.currentTarget;
    const pointerId = event.pointerId;
    handle.setPointerCapture(pointerId);
    setResizing(true);
    document.body.classList.add("is-detail-resizing");
    const onMove = (move: PointerEvent) => {
      const next = Math.min(maxWidth, Math.max(DETAIL_WIDTH_MIN, bounds.right - move.clientX));
      setWidth(next);
    };
    const onUp = () => {
      handle.releasePointerCapture(pointerId);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      setResizing(false);
      document.body.classList.remove("is-detail-resizing");
      setWidth(current => {
        localStorage.setItem(DETAIL_WIDTH_KEY, String(Math.round(current)));
        return Math.round(current);
      });
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };
  return <aside ref={panelRef} className={"detail-panel" + (resizing ? " is-resizing" : "")} style={{ width, flexBasis: width }}>
    <div className="detail-resize-handle" role="separator" aria-orientation="vertical" aria-label="调整详情面板宽度" onPointerDown={startResize} />
    <header><div className="paper-kind"><BookText size={15} />论文详情</div><div className="detail-header-actions"><button className="icon-button danger" title="移入回收站" onClick={() => { if (confirm("确定移入回收站？")) void savePaper({ ...paper, deletedAt: new Date().toISOString(), updatedAt: new Date().toISOString() }); }}><Trash2 size={16} /></button><button className="icon-button" onClick={() => setEditing(true)} title="编辑"><Edit3 size={16} /></button><button className="icon-button" onClick={onClose} title="关闭"><X size={18} /></button></div></header>
    <div className="detail-title"><span className={`status status-${paper.status}`}>{paper.status === "unread" ? "未读" : paper.status === "reading" ? "在读" : paper.status === "read" ? "已读" : "归档"}</span><h2>{paper.titleZh || paper.titleEn}</h2>{paper.titleZh && <p>{paper.titleEn}</p>}<small>{paper.authors.map(a => a.name).join(", ") || "作者待补充"}</small></div>
    <nav className="detail-tabs">{([['overview','概览'],['abstract','双语摘要'],['vocabulary',`术语 ${vocab.length}`],['framework',`框架 ${figures.length}`]] as [Tab,string][]).map(([id,label]) => <button className={tab === id ? "active" : ""} onClick={() => setTab(id)} key={id}>{label}</button>)}</nav>
    <div className="detail-body">
      {tab === "overview" && <>
        <section className="summary-card"><label>一句话总结</label><p>{paper.summary || "尚未补充。用一句话记录这篇论文解决了什么问题、采用了什么方法。"}</p></section>
        <dl className="metadata"><div><dt>主领域</dt><dd>{category ? <span className="category" style={{ "--tag-color": category.color } as React.CSSProperties}>{category.name}</span> : "未分类"}</dd></div><div><dt>子领域</dt><dd><span className="tags">{tags.map(t => <span key={t.id} style={{ "--tag-color": t.color } as React.CSSProperties}>{t.name}</span>)}</span></dd></div><div><dt>期刊 / 会议</dt><dd>{paper.venue || "—"}</dd></div><div><dt>发布日期</dt><dd>{paper.publicationDate || "—"}</dd></div><div><dt>DOI</dt><dd>{paper.doi || "—"}</dd></div>{paper.arxivId && <div><dt>arXiv</dt><dd>{paper.arxivId}</dd></div>}<div><dt>文件状态</dt><dd>{paper.pdfPath ? `已管理 · ${paper.pageCount ?? "?"} 页` : "未关联 PDF"}</dd></div>{related.length > 0 && <div><dt>历史版本</dt><dd className="version-links">{related.map(item => <button type="button" key={item.id} onClick={() => onSelect(item)}>{item.titleZh || item.titleEn}{item.arxivId ? ` · ${item.arxivId}` : ""}</button>)}</dd></div>}</dl>
        <div className="detail-actions">{data.metadata.enabled && <OnlineMetadataFillButton paper={paper} onSave={savePaper} />}<button className="primary" disabled={!paper.pdfPath} onClick={() => onOpenPdf(paper)}><FileText size={16} />进入阅读台</button>{resolvePaperSourceUrl(paper) && <button className="secondary" onClick={() => void backend.openExternalUrl(resolvePaperSourceUrl(paper)!)}><ExternalLink size={16} />打开原文</button>}</div>
      </>}
      {tab === "abstract" && <div className="abstract-columns"><article><h3><Languages size={16} />中文摘要</h3><p>{paper.abstractZh || "待补充中文摘要"}</p></article><article><h3>EN</h3><p>{paper.abstractEn || "English abstract is not available."}</p></article></div>}
      {tab === "vocabulary" && <section className="stack-list">
        <button className="dashed-add" onClick={() => setNewTerm(true)}><Plus size={15} />添加专业词汇或短语</button>
        {checkedTermIds.size > 0 && <div className="table-bulk-actions"><strong>已选 {checkedTermIds.size} 条</strong><button className="secondary danger" onClick={() => { if (!confirm(`删除选中的 ${checkedTermIds.size} 条术语？`)) return; void Promise.all([...checkedTermIds].map(id => deleteVocabulary(id))).then(() => setCheckedTermIds(new Set())); }}><Trash2 size={15} />删除选中</button><button className="ghost" onClick={() => setCheckedTermIds(new Set())}>取消选择</button></div>}
        {vocab.map(item => <VocabularyCard entry={item} key={item.id} checked={checkedTermIds.has(item.id)} onToggle={() => setCheckedTermIds(current => { const next = new Set(current); next.has(item.id) ? next.delete(item.id) : next.add(item.id); return next; })} onDelete={() => { if (confirm("删除这条术语？")) void deleteVocabulary(item.id); }} />)}
        {!vocab.length && <p className="muted centered">从 PDF 选中文本后可快速收为术语</p>}
      </section>}
      {tab === "framework" && <section className="stack-list">
        <label className="dashed-add"><FileImage size={15} />上传方法框架图
          <input hidden type="file" accept="image/png,image/jpeg,image/webp" onChange={async event => {
            const file = event.target.files?.[0];
            if (!file) return;
            const bytes = Array.from(new Uint8Array(await file.arrayBuffer()));
            const stem = file.name.replace(/\.[^.]+$/, "");
            const title = window.prompt("框架图标题", stem) || "方法框架图";
            const explanationZh = window.prompt("中文解释（可稍后补充）") || undefined;
            const pageValue = window.prompt("来源页码（可留空）");
            await saveFigure({
              id: uuid(),
              paperId: paper.id,
              imagePath: "",
              title,
              explanationZh,
              page: pageValue ? Number(pageValue) : undefined,
              isPrimary: figures.length === 0
            }, bytes);
            event.target.value = "";
          }} />
        </label>
        {figures.map(item => <article className="figure-card" key={item.id}>
          <div className="figure-placeholder"><FileImage size={30} /></div>
          <header>
            <div className="vocab-card-copy"><strong>{item.title || "方法框架图"}</strong></div>
            <button className="annotation-delete" title="删除框架图" onClick={() => { if (confirm("删除这张框架图？")) void deleteFigure(item.id); }}><Trash2 size={14} /></button>
          </header>
          <p>{item.explanationZh || "待补充中文解释"}</p>
          <small>来源：第 {item.page ?? "?"} 页</small>
        </article>)}
        {!figures.length && <p className="muted centered">还没有方法框架图</p>}
      </section>}
      {tab === "framework" && figures.length > 0 && <div className="llm-figure-gallery">{figures.map(item => <ManagedFigure key={`image-${item.id}`} path={item.imagePath} />)}</div>}
    </div>
    {editing && <Modal title="编辑论文" onClose={() => setEditing(false)} wide><PaperEditor initial={paper} categories={data.categories} tags={data.tags} onCancel={() => setEditing(false)} onSave={async p => { await savePaper(p); setEditing(false); }} /></Modal>}
    {newTerm && <TermEditor paperId={paper.id} onClose={() => setNewTerm(false)} onSave={async item => { await saveVocabulary(item); setNewTerm(false); }} />}
  </aside>;
}

function ManagedFigure({ path }: { path: string }) {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    let active = true;
    let current = "";
    void backend.readPdf(path).then(bytes => {
      current = URL.createObjectURL(new Blob([bytes], { type: "image/png" }));
      if (active) setUrl(current);
      else URL.revokeObjectURL(current);
    }).catch(() => undefined);
    return () => { active = false; if (current) URL.revokeObjectURL(current); };
  }, [path]);
  return url ? <img className="framework-image" src={url} alt="方法框架图" /> : <div className="figure-placeholder"><FileImage size={30} /></div>;
}

function VocabularyCard({ entry, checked, onToggle, onDelete }: { entry: VocabularyEntry; checked: boolean; onToggle(): void; onDelete(): void }) {
  return <article className={`vocab-card ${checked ? "checked" : ""}`}>
    <header>
      <label className="excerpt-check"><input className="row-check" type="checkbox" checked={checked} onChange={onToggle} aria-label="选择术语" /></label>
      <div className="vocab-card-copy"><strong>{entry.termEn}</strong><span>{entry.meaningZh}</span></div>
      <button className="annotation-delete" title="删除术语" onClick={onDelete}><Trash2 size={14} /></button>
    </header>
    {entry.sentenceEn && <blockquote>{entry.sentenceEn}</blockquote>}
    {entry.sentenceZh && <p>{entry.sentenceZh}</p>}
    {entry.page && <small>来源 · 第 {entry.page} 页</small>}
  </article>;
}

function TermEditor({ paperId, onClose, onSave }: { paperId: string; onClose(): void; onSave(entry: VocabularyEntry): Promise<void> }) {
  const [entry, setEntry] = useState<VocabularyEntry>({ id: uuid(), paperId, termEn: "", meaningZh: "" });
  const set = (key: keyof VocabularyEntry, value: string | number) => setEntry(e => ({ ...e, [key]: value }));
  return <Modal title="添加专业词汇 / 短语" onClose={onClose}><form className="paper-editor" onSubmit={e => { e.preventDefault(); void onSave(entry); }}><label>英文词汇 / 短语<input autoFocus required value={entry.termEn} onChange={e => set("termEn", e.target.value)} /></label><label>中文释义<textarea required rows={2} value={entry.meaningZh} onChange={e => set("meaningZh", e.target.value)} /></label><label>代表性原句<textarea rows={3} value={entry.sentenceEn ?? ""} onChange={e => set("sentenceEn", e.target.value)} /></label><label>句子中文注释<textarea rows={3} value={entry.sentenceZh ?? ""} onChange={e => set("sentenceZh", e.target.value)} /></label><label>页码<input type="number" min="1" value={entry.page ?? ""} onChange={e => set("page", Number(e.target.value))} /></label><footer><button type="button" className="secondary" onClick={onClose}>取消</button><button className="primary">保存</button></footer></form></Modal>;
}

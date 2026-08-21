import { useRef, useState } from "react";
import { ask } from "@tauri-apps/plugin-dialog";
import type { Category, Paper, Tag } from "../types";
import { now, uuid } from "../types";
import { isTauri } from "../services/backend";
import { Modal } from "./Modal";

function blankPaper(): Paper {
  return { id: uuid(), titleEn: "", authors: [], tagIds: [], status: "unread", favorite: false, createdAt: now(), updatedAt: now() };
}

function editorSnapshot(paper: Paper) {
  return JSON.stringify({
    titleEn: paper.titleEn,
    titleZh: paper.titleZh ?? "",
    authors: paper.authors.map(author => author.name).join(";"),
    status: paper.status,
    categoryId: paper.categoryId ?? "",
    publicationDate: paper.publicationDate ?? "",
    tagIds: [...paper.tagIds].sort(),
    summary: paper.summary ?? "",
    venue: paper.venue ?? "",
    doi: paper.doi ?? "",
    sourceUrl: paper.sourceUrl ?? "",
    abstractEn: paper.abstractEn ?? "",
    abstractZh: paper.abstractZh ?? "",
  });
}

async function confirmSaveEdits() {
  if (isTauri()) {
    return ask("编辑信息未保存，是否保存？", {
      title: "编辑论文",
      kind: "warning",
      okLabel: "保存",
      cancelLabel: "不保存",
    });
  }
  return window.confirm("编辑信息未保存，是否保存？");
}

export function PaperEditor({
  initial,
  categories,
  tags,
  onSave,
  onCancel,
  modalTitle,
}: {
  initial?: Paper;
  categories: Category[];
  tags: Tag[];
  onSave(paper: Paper): Promise<void>;
  onCancel(): void;
  modalTitle?: string;
}) {
  const seed = useRef(initial ?? blankPaper());
  const [paper, setPaper] = useState<Paper>(seed.current);
  const paperRef = useRef(paper);
  paperRef.current = paper;
  const baseline = useRef(editorSnapshot(seed.current));
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const set = <K extends keyof Paper>(key: K, value: Paper[K]) => setPaper(current => ({ ...current, [key]: value, updatedAt: now() }));
  const dirty = () => editorSnapshot(paperRef.current) !== baseline.current;

  const save = async (value = paperRef.current) => {
    setBusy(true);
    try { await onSave({ ...value, updatedAt: now() }); }
    catch (error) { setNotice(`保存论文失败：${error instanceof Error ? error.message : String(error)}`); }
    finally { setBusy(false); }
  };

  const discardClose = () => onCancel();

  const requestClose = async () => {
    await Promise.resolve();
    if (!dirty()) {
      onCancel();
      return;
    }
    if (await confirmSaveEdits()) {
      if (!paperRef.current.titleEn.trim()) return;
      await save(paperRef.current);
      return;
    }
    onCancel();
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!paper.titleEn.trim()) return;
    await save(paper);
  };

  const form = <form className="paper-editor" onSubmit={event => void submit(event)}>
    <div className="form-grid two"><label>英文标题<input autoFocus value={paper.titleEn} onChange={e => set("titleEn", e.target.value)} required /></label><label>中文标题<input value={paper.titleZh ?? ""} onChange={e => set("titleZh", e.target.value)} /></label></div>
    <label>作者（用分号分隔）<input value={paper.authors.map(a => a.name).join("; ")} onChange={e => set("authors", e.target.value.split(/[;；]/).map(name => name.trim()).filter(Boolean).map(name => ({ id: uuid(), name })))} /></label>
    <div className="form-grid three"><label>阅读状态<select value={paper.status} onChange={e => set("status", e.target.value as Paper["status"])}><option value="unread">未读</option><option value="reading">在读</option><option value="read">已读</option><option value="archived">已归档</option></select></label><label>主领域<select value={paper.categoryId ?? ""} onChange={e => set("categoryId", e.target.value || undefined)}><option value="">未分类</option>{categories.map(c => <option value={c.id} key={c.id}>{c.name}</option>)}</select></label><label>发布日期<input type="date" value={paper.publicationDate ?? ""} onChange={e => set("publicationDate", e.target.value)} /></label></div>
    <fieldset><legend>子领域标签（可多选）</legend><div className="tag-checks">{tags.map(tag => <label key={tag.id}><input type="checkbox" checked={paper.tagIds.includes(tag.id)} onChange={e => set("tagIds", e.target.checked ? [...paper.tagIds, tag.id] : paper.tagIds.filter(id => id !== tag.id))} /><span style={{ borderColor: tag.color }}>{tag.name}</span></label>)}</div></fieldset>
    <label>一句话工作总结<textarea rows={2} value={paper.summary ?? ""} onChange={e => set("summary", e.target.value)} /></label>
    <div className="form-grid two"><label>期刊 / 会议<input value={paper.venue ?? ""} onChange={e => set("venue", e.target.value)} /></label><label>DOI<input value={paper.doi ?? ""} onChange={e => set("doi", e.target.value)} /></label></div>
    <label>原文链接<input type="url" value={paper.sourceUrl ?? ""} onChange={e => set("sourceUrl", e.target.value)} /></label>
    <label>英文摘要<textarea rows={5} value={paper.abstractEn ?? ""} onChange={e => set("abstractEn", e.target.value)} /></label>
    <label>中文摘要<textarea rows={5} value={paper.abstractZh ?? ""} onChange={e => set("abstractZh", e.target.value)} /></label>
    {notice && <p className="inline-notice" role="alert">{notice}</p>}
    <footer><button type="button" className="secondary" disabled={busy} onClick={discardClose}>取消</button><button className="primary" type="submit" disabled={busy}>{busy ? "正在保存…" : "保存论文"}</button></footer>
  </form>;

  if (modalTitle) {
    return <Modal title={modalTitle} onClose={() => void requestClose()} wide>{form}</Modal>;
  }
  return form;
}

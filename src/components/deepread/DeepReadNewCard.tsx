import { useEffect, useMemo, useRef, useState } from "react";
import { BookOpenCheck, FileUp, FolderOpen, LoaderCircle, Search, X } from "lucide-react";
import { FilterMenu } from "../FilterMenu";
import { deepReadCandidates, type DeepReadScope } from "../../lib/deepReadCandidates";
import type { Folder, Paper } from "../../types";

type Source = "library" | "local";

type Props = {
  papers: Paper[];
  folders: Folder[];
  readPaperIds: Set<string>;
  seed?: { paperId: string; nonce: number };
  busy: boolean;
  ready: boolean;
  onCreateFromLibrary(papers: Paper[]): Promise<void>;
  onCreateFromFiles(files: File[]): Promise<void>;
};

function scopeValue(scope: DeepReadScope) {
  if (scope.kind === "folder") return `folder:${scope.id}`;
  return scope.kind;
}

export function DeepReadNewCard({ papers, folders, readPaperIds, seed, busy, ready, onCreateFromLibrary, onCreateFromFiles }: Props) {
  const [source, setSource] = useState<Source>("library");
  const [scope, setScope] = useState<DeepReadScope>({ kind: "all" });
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [files, setFiles] = useState<File[]>([]);
  const [dragging, setDragging] = useState(false);
  const [fileNotice, setFileNotice] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const activePapers = useMemo(() => papers.filter(paper => !paper.deletedAt), [papers]);
  const candidates = useMemo(() => deepReadCandidates(papers, scope, query), [papers, scope, query]);
  const folderOptions = useMemo(() => {
    const byId = new Map(folders.map(folder => [folder.id, folder]));
    return folders.map(folder => {
      const path = [folder.name];
      let parent = folder.parentId ? byId.get(folder.parentId) : undefined;
      while (parent) {
        path.unshift(parent.name);
        parent = parent.parentId ? byId.get(parent.parentId) : undefined;
      }
      return { id: `folder:${folder.id}`, label: path.join(" / ") };
    }).sort((a, b) => a.label.localeCompare(b.label, "zh-CN", { numeric: true }));
  }, [folders]);

  useEffect(() => {
    if (!seed) return;
    setSource("library");
    setScope({ kind: "neighborhood", originId: seed.paperId });
    setQuery("");
    setSelected([seed.paperId]);
  }, [seed]);

  const changeScope = (value: string) => {
    if (value === "all") setScope({ kind: "all" });
    else if (value === "neighborhood") setScope({ kind: "neighborhood", originId: selected[0] ?? activePapers[0]?.id ?? "" });
    else setScope({ kind: "folder", id: value.slice("folder:".length) });
  };

  const toggle = (id: string) =>
    setSelected(current => (current.includes(id) ? current.filter(item => item !== id) : [...current, id]));

  const addFiles = (list: FileList | null) => {
    const incoming = Array.from(list ?? []);
    const pdfs = incoming.filter(file => file.name.toLowerCase().endsWith(".pdf"));
    setFileNotice(incoming.length !== pdfs.length ? "仅支持 PDF 文件，其他文件未添加。" : "");
    setFiles(current => [...current, ...pdfs]);
  };

  const createFromLibrary = async () => {
    await onCreateFromLibrary(activePapers.filter(paper => selected.includes(paper.id)));
    setSelected([]);
  };

  const createFromFiles = async () => {
    await onCreateFromFiles(files);
    setFiles([]);
  };

  return (
    <section className="research-new-card deepread-new-card" aria-labelledby="deepread-new-heading">
      <header className="research-new-card-head">
        <div>
          <h3 id="deepread-new-heading">选择要读的论文</h3>
          <p>每篇论文单独生成报告，多篇按顺序处理。</p>
        </div>
        <span className="research-new-card-badge" aria-hidden>
          <BookOpenCheck size={14} />
        </span>
      </header>

      <div className="research-segmented-tabs deepread-source-tabs" role="tablist" aria-label="论文来源">
        <button type="button" role="tab" aria-selected={source === "library"} className={source === "library" ? "active" : ""} onClick={() => setSource("library")}>
          论文库
        </button>
        <button type="button" role="tab" aria-selected={source === "local"} className={source === "local" ? "active" : ""} onClick={() => setSource("local")}>
          本地 PDF
        </button>
      </div>

      {source === "library" ? (
        <>
          <div className="deepread-picker-filters">
            <div className="deepread-scope-picker" role="group" aria-label="论文范围">
              <FilterMenu icon={<FolderOpen size={16} />} value={scopeValue(scope)} onChange={changeScope} groups={[
                { title: "范围", options: [{ id: "all", label: "全部论文" }, { id: "neighborhood", label: "知识树邻域" }] },
                { title: "文件夹", options: folderOptions },
              ]} />
            </div>
            {scope.kind === "neighborhood" && (
              <select
                className="research-input"
                aria-label="知识树原点"
                value={scope.originId}
                onChange={event => setScope({ kind: "neighborhood", originId: event.target.value })}
              >
                {activePapers.slice(0, 200).map(paper => <option key={paper.id} value={paper.id}>原点：{paper.titleZh || paper.titleEn}</option>)}
              </select>
            )}
            <label className="deepread-picker-search">
              <Search size={14} />
              <input aria-label="搜索候选论文" value={query} placeholder="搜索标题或作者" onChange={event => setQuery(event.target.value)} />
              {query && <button type="button" className="ghost icon-only" aria-label="清空论文搜索" onClick={() => setQuery("")}><X size={14} /></button>}
            </label>
          </div>
          <ul className="deepread-picker-list" aria-label="候选论文">
            {candidates.map(paper => {
              const disabled = !paper.pdfPath;
              return (
                <li key={paper.id}>
                  <label className={disabled ? "disabled" : selected.includes(paper.id) ? "is-selected" : ""} title={disabled ? "该论文没有 PDF" : paper.titleEn}>
                    <input type="checkbox" disabled={disabled || busy} checked={selected.includes(paper.id)} onChange={() => toggle(paper.id)} />
                    <span>{paper.titleZh || paper.titleEn}</span>
                    {disabled && <em>无 PDF</em>}
                    {readPaperIds.has(paper.id) && <em className="done">已精读</em>}
                  </label>
                </li>
              );
            })}
            {!candidates.length && <li className="research-session-empty">没有符合条件的论文。</li>}
          </ul>
          <footer className="deepread-new-footer">
            <span aria-live="polite">已选 {selected.length} 篇</span>
            <button type="button" className="primary" disabled={busy || !ready || !selected.length} onClick={() => void createFromLibrary()}>
              {busy && <LoaderCircle className="spin" size={15} />}开始精读
            </button>
          </footer>
        </>
      ) : (
        <>
          <div
            className={`deepread-dropzone${dragging ? " is-dragging" : ""}`}
            onDragOver={event => { event.preventDefault(); if (!busy) setDragging(true); }}
            onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragging(false); }}
            onDrop={event => {
              event.preventDefault();
              setDragging(false);
              if (!busy) addFiles(event.dataTransfer.files);
            }}
          >
            <FileUp size={30} strokeWidth={1.5} />
            <p>{dragging ? "松开以添加 PDF" : "将论文 PDF 拖到这里"}</p>
            <span>支持同时选择多篇论文</span>
            <button type="button" className="secondary" disabled={busy} onClick={() => fileInput.current?.click()}>选择 PDF</button>
            <input ref={fileInput} type="file" accept=".pdf,application/pdf" multiple hidden onChange={event => { addFiles(event.target.files); event.target.value = ""; }} />
          </div>
          {fileNotice && <p className="deepread-file-notice" role="status">{fileNotice}</p>}
          <ul className="deepread-file-list">
            {files.map((file, index) => (
              <li key={`${file.name}-${index}`}>
                <span>{file.name}</span>
                <button type="button" className="ghost icon-only" disabled={busy} title="移除" aria-label={`移除 ${file.name}`} onClick={() => setFiles(current => current.filter((_, i) => i !== index))}>
                  <X size={13} />
                </button>
              </li>
            ))}
          </ul>
          <footer className="deepread-new-footer">
            <span>已选 {files.length} 篇 · 报告生成后可加入论文库</span>
            <button type="button" className="primary" disabled={busy || !ready || !files.length} onClick={() => void createFromFiles()}>
              {busy && <LoaderCircle className="spin" size={15} />}开始精读
            </button>
          </footer>
        </>
      )}
      {!ready && <p className="deepread-file-notice">开始前请在「设置 → 文献调研」启用模型并保存 API Key。</p>}
    </section>
  );
}

import { useEffect, useMemo, useRef, useState } from "react";
import { BookOpenCheck, FileUp, Search, X } from "lucide-react";
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
  const fileInput = useRef<HTMLInputElement>(null);
  const activePapers = useMemo(() => papers.filter(paper => !paper.deletedAt), [papers]);
  const candidates = useMemo(() => deepReadCandidates(papers, scope, query), [papers, scope, query]);

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
    const pdfs = Array.from(list ?? []).filter(file => file.name.toLowerCase().endsWith(".pdf"));
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
          <h3 id="deepread-new-heading">新建精读</h3>
          <p>每篇论文生成一份 What → Why → How → Experiment → Question 证据报告，完成后可继续追问。</p>
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
            <select className="research-input" aria-label="范围" value={scopeValue(scope)} onChange={event => changeScope(event.target.value)}>
              <option value="all">全部论文</option>
              <option value="neighborhood">知识树邻域</option>
              {folders.map(folder => <option key={folder.id} value={`folder:${folder.id}`}>文件夹：{folder.name}</option>)}
            </select>
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
              <input value={query} placeholder="搜索标题或作者" onChange={event => setQuery(event.target.value)} />
            </label>
          </div>
          <ul className="deepread-picker-list" aria-label="候选论文">
            {candidates.map(paper => {
              const disabled = !paper.pdfPath;
              return (
                <li key={paper.id}>
                  <label className={disabled ? "disabled" : ""} title={disabled ? "该论文没有 PDF" : paper.titleEn}>
                    <input type="checkbox" disabled={disabled} checked={selected.includes(paper.id)} onChange={() => toggle(paper.id)} />
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
            <span>已选 {selected.length} 篇</span>
            <button type="button" className="primary" disabled={busy || !ready || !selected.length} onClick={() => void createFromLibrary()}>
              开始精读
            </button>
          </footer>
        </>
      ) : (
        <>
          <div
            className="deepread-dropzone"
            onDragOver={event => event.preventDefault()}
            onDrop={event => {
              event.preventDefault();
              addFiles(event.dataTransfer.files);
            }}
          >
            <FileUp size={18} />
            <p>拖入 PDF，或</p>
            <button type="button" className="secondary" onClick={() => fileInput.current?.click()}>选择 PDF</button>
            <input ref={fileInput} type="file" accept=".pdf,application/pdf" multiple hidden onChange={event => { addFiles(event.target.files); event.target.value = ""; }} />
          </div>
          <ul className="deepread-file-list">
            {files.map((file, index) => (
              <li key={`${file.name}-${index}`}>
                <span>{file.name}</span>
                <button type="button" className="ghost icon-only" title="移除" onClick={() => setFiles(current => current.filter((_, i) => i !== index))}>
                  <X size={13} />
                </button>
              </li>
            ))}
          </ul>
          <footer className="deepread-new-footer">
            <span>外部 PDF 仅存入精读工作区，报告页可「加入论文库」</span>
            <button type="button" className="primary" disabled={busy || !ready || !files.length} onClick={() => void createFromFiles()}>
              开始精读
            </button>
          </footer>
        </>
      )}
    </section>
  );
}

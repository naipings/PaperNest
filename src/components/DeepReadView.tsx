import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BookOpenCheck, BookOpenText, Check, Columns2, Copy, FolderOpen, Library, LoaderCircle, MessageSquare, MoreHorizontal, Play, Plus, RefreshCw, RotateCcw, Square, Trash2, X } from "lucide-react";
import { backend, isTauri } from "../services/backend";
import { useLibrary } from "../state/LibraryContext";
import { extractPdfParagraphs } from "../lib/pdfParagraphs";
import { toBase64 } from "../lib/researchAttachments";
import { resolveImportedPaper } from "../lib/importDecisions";
import { fillFromPdf, importPorts } from "./LlmTopbar";
import { DeepReadNewCard } from "./deepread/DeepReadNewCard";
import { DeepReadReportTab, stageLabel } from "./deepread/DeepReadReportTab";
import { DeepReadChatTab } from "./deepread/DeepReadChatTab";
import { DeepReadCompare } from "./deepread/DeepReadCompare";
import { Modal } from "./Modal";
import "./deepread/DeepRead.css";
import type { DeepRead, DeepReadDetail, DeepReadStatus, Paper } from "../types";

type Tab = "report" | "chat";

const STATUS_LABEL: Record<DeepReadStatus, string> = {
  draft: "待生成",
  queued: "排队中",
  running: "生成中",
  completed: "已完成",
  failed: "失败",
  cancelled: "已停止",
};

const STATUS_CLASS: Record<DeepReadStatus, string> = {
  draft: "status-draft",
  queued: "status-running",
  running: "status-running",
  completed: "status-completed",
  failed: "status-failed",
  cancelled: "status-cancelled",
};

const isActive = (task: DeepRead) => task.status === "queued" || task.status === "running";
const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));
const fileName = (path: string) => path.split(/[\\/]/).at(-1) ?? path;

function formatTime(iso: string) {
  return new Date(iso).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
}

export function DeepReadView({ seed, onOpenPaper }: { seed?: { paperId: string; nonce: number }; onOpenPaper(paper: Paper): void }) {
  const { data, refresh } = useLibrary();
  const [tasks, setTasks] = useState<DeepRead[]>([]);
  const [selectedId, setSelectedId] = useState<string>();
  const [detail, setDetail] = useState<DeepReadDetail>();
  const [tab, setTab] = useState<Tab>("report");
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [answering, setAnswering] = useState(false);
  const [copied, setCopied] = useState(false);
  const [compareId, setCompareId] = useState<string>();
  const [creating, setCreating] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [detailRevision, setDetailRevision] = useState(0);
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);
  const selected = tasks.find(task => task.id === selectedId);

  useEffect(() => {
    if (!moreOpen) return;
    moreRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
    const close = (event: PointerEvent) => {
      if (!moreRef.current?.contains(event.target as Node)) setMoreOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMoreOpen(false);
        moreRef.current?.querySelector<HTMLButtonElement>('[aria-haspopup="menu"]')?.focus();
      }
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", close); document.removeEventListener("keydown", escape); };
  }, [moreOpen]);

  const showError = useCallback((error: unknown) => setNotice(messageOf(error)), []);

  const loadTasks = useCallback(async () => {
    const list = await backend.deepreadList();
    setTasks(list);
    setSelectedId(current => current ?? list[0]?.id);
  }, []);

  useEffect(() => {
    if (seed) setCreating(true);
  }, [seed]);

  useEffect(() => {
    if (!isTauri()) return;
    void backend.researchGetSettings().then(settings => setReady(settings.enabled && settings.apiKeySaved)).catch(showError);
    void loadTasks().catch(showError);
  }, [loadTasks, showError]);

  useEffect(() => {
    if (!selectedId) {
      setDetail(undefined);
      return;
    }
    let current = true;
    setDetail(currentDetail => currentDetail?.task.id === selectedId ? currentDetail : undefined);
    setLoadingDetail(true);
    void backend.deepreadGet(selectedId).then(next => {
      if (current) setDetail(next);
    }).catch(error => { if (current) showError(error); }).finally(() => {
      if (current) setLoadingDetail(false);
    });
    return () => { current = false; };
  }, [selectedId, selected?.updatedAt, detailRevision, showError]);

  const hasActive = tasks.some(isActive);

  useEffect(() => {
    if (!hasActive) return;
    const timer = window.setInterval(() => void loadTasks().catch(showError), 2000);
    return () => window.clearInterval(timer);
  }, [hasActive, loadTasks, showError]);

  const readPaperIds = useMemo(
    () => new Set(tasks.filter(task => task.status === "completed" && task.paperId).map(task => task.paperId!)),
    [tasks],
  );

  const queueCreated = async (createdIds: string[], notes: string[]) => {
    await loadTasks();
    if (createdIds.length) {
      setCreating(false);
      setSelectedId(createdIds[0]);
      setTab("report");
    }
    const head = createdIds.length ? `已加入 ${createdIds.length} 篇精读，按顺序逐篇生成` : "";
    setNotice([head, ...notes].filter(Boolean).join("；"));
  };

  const createFromLibrary = async (papers: Paper[]) => {
    const createdIds: string[] = [];
    const notes: string[] = [];
    for (let index = 0; index < papers.length; index++) {
      const paper = papers[index];
      setBusy(`正在抽取正文 ${index + 1}/${papers.length}：${paper.titleZh || paper.titleEn}`);
      try {
        const pages = await extractPdfParagraphs(await backend.readPdf(paper.pdfPath!));
        const task = await backend.deepreadCreate({ paperId: paper.id, title: paper.titleEn, sourceName: fileName(paper.pdfPath!), pages });
        await backend.deepreadRun(task.id, false);
        createdIds.push(task.id);
      } catch (error) {
        notes.push(`《${paper.titleZh || paper.titleEn}》${messageOf(error)}`);
      }
    }
    setBusy("");
    await queueCreated(createdIds, notes);
  };

  const createFromFiles = async (files: File[]) => {
    const createdIds: string[] = [];
    const notes: string[] = [];
    const { extractPdfCover } = await import("../lib/extractPdfCover");
    for (let index = 0; index < files.length; index++) {
      const file = files[index];
      setBusy(`正在抽取正文 ${index + 1}/${files.length}：${file.name}`);
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const cover = await extractPdfCover(bytes);
        const pages = await extractPdfParagraphs(bytes);
        const task = await backend.deepreadCreate({
          title: cover.titleEn || file.name.replace(/\.pdf$/i, ""),
          sourceName: file.name,
          pdfBase64: toBase64(bytes),
          pages,
        });
        await backend.deepreadRun(task.id, false);
        createdIds.push(task.id);
      } catch (error) {
        notes.push(`${file.name}：${messageOf(error)}`);
      }
    }
    setBusy("");
    await queueCreated(createdIds, notes);
  };

  const run = async (restart: boolean) => {
    if (!selected) return;
    if (restart && !confirm("重新生成会清空已生成的五个阶段，确定继续？")) return;
    try {
      await backend.deepreadRun(selected.id, restart);
      setNotice("");
      setTab("report");
      await loadTasks();
    } catch (error) {
      showError(error);
    }
  };

  const cancel = async () => {
    if (!selected) return;
    try {
      await backend.deepreadCancel(selected.id);
      await loadTasks();
    } catch (error) {
      showError(error);
    }
  };

  const remove = async (id: string) => {
    if (!confirm("删除该精读任务？报告与追问记录将一并删除。")) return;
    try {
      await backend.deepreadDelete(id);
      if (selectedId === id) setSelectedId(undefined);
      await loadTasks();
    } catch (error) {
      showError(error);
    }
  };

  const ask = async (question: string) => {
    if (!selected) return false;
    setAnswering(true);
    try {
      const next = await backend.deepreadAsk(selected.id, question);
      setDetail(current => current?.task.id === next.task.id ? next : current);
      return true;
    } catch (error) {
      showError(error);
      return false;
    } finally {
      setAnswering(false);
    }
  };

  const deleteTurn = async (messageIndex: number) => {
    if (!selected) return;
    try {
      const next = await backend.deepreadDeleteTurn(selected.id, messageIndex);
      setDetail(current => current?.task.id === next.task.id ? next : current);
    } catch (error) {
      showError(error);
    }
  };

  const copyReport = async () => {
    if (!detail?.report) return;
    try {
      await navigator.clipboard.writeText(detail.report);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch (error) {
      showError(error);
    }
  };

  const addToLibrary = async () => {
    if (!selected) return;
    setBusy("正在加入论文库…");
    try {
      const [imported] = await backend.importPdfPaths([`${selected.workspacePath}/source.pdf`], null);
      let paper = imported.paper;
      const notes: string[] = [];
      if (imported.isNew) {
        const filled = await fillFromPdf(paper, false);
        if (filled.failure) notes.push(`读取 PDF 信息失败：${filled.failure}`);
        const catalog = (await backend.initialize()).papers.filter(item => !item.deletedAt);
        const decided = await resolveImportedPaper(filled.paper, catalog, importPorts, new Set());
        if (decided.note) notes.push(decided.note);
        if (!decided.paper) {
          setNotice("已取消加入论文库");
          return;
        }
        paper = decided.paper;
      }
      await backend.deepreadLinkPaper(selected.id, paper.id);
      await refresh();
      await loadTasks();
      setNotice([`已加入论文库：${paper.titleZh || paper.titleEn}`, ...notes].join("；"));
    } catch (error) {
      showError(error);
    } finally {
      setBusy("");
    }
  };

  if (!isTauri()) {
    return (
      <main className="content-page research-page deepread-page">
        <header className="page-heading"><h1>论文精读</h1><p>请在桌面端使用此功能。</p></header>
      </main>
    );
  }

  const linkedPaper = selected?.paperId ? data?.papers.find(paper => paper.id === selected.paperId && !paper.deletedAt) : undefined;
  const stagesDone = detail?.task.id === selected?.id ? detail?.stagesDone ?? [] : [];
  const hasReport = !!detail?.report.trim() && detail.task.id === selected?.id;

  if (compareId) {
    return <DeepReadCompare tasks={tasks} initialId={compareId} onExit={id => {
      setSelectedId(id);
      setCompareId(undefined);
    }} />;
  }

  return (
    <main className="content-page research-page deepread-page">
        <header className="deepread-heading page-heading">
          <div className="page-title-block">
            <div className="page-title-row">
              <h1>论文精读</h1>
            </div>
          </div>
        <div className="page-heading-actions">
          <button type="button" className="secondary" disabled={!!busy || refreshing} onClick={async () => {
            setRefreshing(true);
            try { await loadTasks(); setDetailRevision(value => value + 1); }
            catch (error) { showError(error); }
            finally { setRefreshing(false); }
          }}>
            <RefreshCw size={15} className={refreshing ? "spin" : ""} />
            刷新
          </button>
          <button type="button" className="primary" disabled={!!busy} onClick={() => { setNotice(""); setCreating(true); }}><Plus size={16} />新建精读</button>
        </div>
        </header>

        {!creating && (notice || busy) && <div className="deepread-notice" role="status">
          {busy && <LoaderCircle className="spin" size={16} />}
          <span>{busy || notice}</span>
          {!busy && <button type="button" className="ghost icon-only" aria-label="关闭提示" onClick={() => setNotice("")}><X size={15} /></button>}
        </div>}

        {!ready && (
          <div className="info-card research-disabled-banner research-layout-full">
            <BookOpenCheck size={18} />
            <div>
              <strong>论文精读未就绪</strong>
              <p>请打开「设置 → 文献调研」，启用调研 LLM 并保存 API Key。</p>
            </div>
          </div>
        )}

        {creating && <Modal title="新建精读" wide onClose={() => setCreating(false)}>
          <DeepReadNewCard
            papers={data?.papers ?? []}
            folders={data?.folders ?? []}
            readPaperIds={readPaperIds}
            seed={seed}
            busy={!!busy}
            ready={ready}
            onCreateFromLibrary={createFromLibrary}
            onCreateFromFiles={createFromFiles}
          />
          {busy && <p className="deepread-create-progress" role="status"><LoaderCircle className="spin" size={15} />{busy}</p>}
          {!busy && notice && <p className="deepread-create-progress" role="alert">{notice}</p>}
        </Modal>}
      <div className="research-layout deepread-layout">
        <aside className="research-sidebar">
          <section className="research-history" aria-labelledby="deepread-history-heading">
            <div className="deepread-history-head"><h3 id="deepread-history-heading">精读任务</h3><span>{tasks.length} 篇</span></div>
            <ul className="research-session-list">
              {tasks.map(task => (
                <li key={task.id}>
                  <button type="button" aria-current={selectedId === task.id ? "true" : undefined} title={task.title} className={`research-session-item${selectedId === task.id ? " active" : ""}`} onClick={() => { setSelectedId(task.id); setTab("report"); setMoreOpen(false); }}>
                    <span className="research-session-item-top">
                      <strong>{task.title}</strong>
                      <span className={`research-session-status ${STATUS_CLASS[task.status]}`}>{STATUS_LABEL[task.status]}</span>
                    </span>
                    <small>
                      {task.sourceKind === "external" ? "外部 PDF" : "论文库"} · {formatTime(task.updatedAt)}
                      {task.status === "running" && task.stage ? ` · ${stageLabel(task.stage)}` : ""}
                    </small>
                  </button>
                  <button type="button" className="ghost icon-only research-session-delete" title="删除" aria-label={`删除精读：${task.title}`} onClick={() => void remove(task.id)}>
                    <Trash2 size={14} />
                  </button>
                </li>
              ))}
              {!tasks.length && <li className="research-session-empty">还没有精读任务<br />点击「新建精读」选择论文。</li>}
            </ul>
          </section>
        </aside>

        <section className="research-main deepread-main">
          {selected ? (
            <>
              <header className="research-detail-header">
                <div>
                  <div className="deepread-document-meta"><span className={`research-session-status ${STATUS_CLASS[selected.status]}`}>{STATUS_LABEL[selected.status]}</span><span>{selected.sourceKind === "external" ? "本地 PDF" : "来自论文库"}</span><span>{formatTime(selected.updatedAt)}</span></div>
                  <h2>{selected.title}</h2>
                  <p title={selected.sourceName}>{selected.model || selected.sourceName}</p>
                </div>
                <div className="research-detail-actions">
                  {isActive(selected) ? (
                    <button type="button" className="secondary" onClick={() => void cancel()}><Square size={16} />停止</button>
                  ) : (
                    <>
                      {!hasReport && (
                        <button type="button" className="primary" disabled={!ready} onClick={() => void run(false)}>
                          <Play size={16} />{stagesDone.length ? "继续生成" : "开始生成"}
                        </button>
                      )}
                    </>
                  )}
                  {hasReport && (
                    <button type="button" className="secondary" onClick={() => void copyReport()}>
                      {copied ? <Check size={16} /> : <Copy size={16} />}{copied ? "已复制" : "复制全文"}
                    </button>
                  )}
                  <button
                    type="button"
                    className="secondary"
                    disabled={!linkedPaper}
                    title={linkedPaper ? "左侧报告、右侧原文，点击证据跳到原文段落" : "外部 PDF 需先「加入论文库」"}
                    onClick={() => setCompareId(selected.id)}
                  >
                    <Columns2 size={16} />对照阅读
                  </button>
                  {selected.sourceKind === "external" && (
                    <button type="button" className="secondary" disabled={!!busy} onClick={() => void addToLibrary()}><Library size={16} />加入论文库</button>
                  )}
                  <div className="deepread-more" ref={moreRef}>
                    <button type="button" className="secondary" aria-label="更多操作" aria-haspopup="menu" aria-expanded={moreOpen} onClick={() => setMoreOpen(value => !value)}><MoreHorizontal size={16} /></button>
                    {moreOpen && <div className="deepread-action-menu" role="menu" aria-label="报告操作" onBlur={event => { if (!moreRef.current?.contains(event.relatedTarget as Node)) setMoreOpen(false); }} onKeyDown={event => {
                      const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
                      const index = items.indexOf(document.activeElement as HTMLButtonElement);
                      if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); items[(index + (event.key === "ArrowDown" ? 1 : items.length - 1)) % items.length]?.focus(); }
                    }}>
                      {linkedPaper && <button type="button" role="menuitem" onClick={() => { setMoreOpen(false); onOpenPaper(linkedPaper); }}><BookOpenText size={15} />打开原文</button>}
                      <button type="button" role="menuitem" onClick={() => { setMoreOpen(false); void backend.deepreadOpenWorkspace(selected.id).catch(showError); }}><FolderOpen size={15} />打开文件夹</button>
                      {stagesDone.length > 0 && !isActive(selected) && <button type="button" role="menuitem" disabled={!ready} onClick={() => { setMoreOpen(false); void run(true); }}><RotateCcw size={15} />重新生成报告</button>}
                    </div>}
                  </div>
                </div>
              </header>
              {selected.error && <p className="inline-notice">{selected.error}</p>}
              {isActive(selected) && (
                <div className="research-progress-banner">
                  <LoaderCircle className="spin" size={16} />
                  <div>
                    <strong>{selected.status === "queued" ? "排队中" : `生成中 · ${stageLabel(selected.stage)}`}</strong>
                    <p>{selected.status === "queued" ? "精读任务逐篇执行，前一篇完成后自动开始。" : "每个阶段完成后保存；点击「停止」在当前阶段结束后生效。"}</p>
                  </div>
                </div>
              )}
              <div className="research-detail-tabs research-segmented-tabs" role="tablist" aria-label="精读详情">
                <button type="button" role="tab" aria-controls="deepread-detail-panel" aria-selected={tab === "report"} className={tab === "report" ? "active" : ""} onClick={() => setTab("report")}><BookOpenText size={15} />精读报告</button>
                <button type="button" role="tab" aria-controls="deepread-detail-panel" aria-selected={tab === "chat"} className={tab === "chat" ? "active" : ""} onClick={() => setTab("chat")}>
                  <MessageSquare size={15} />继续追问
                  {detail?.task.id === selected.id && !!detail.messages.length && <span className="research-tab-badge">{Math.ceil(detail.messages.length / 2)}</span>}
                </button>
              </div>
              <div className="deepread-detail-panel" id="deepread-detail-panel" role="tabpanel" aria-label={tab === "report" ? "精读报告" : "继续追问"} aria-busy={loadingDetail}>
              {loadingDetail && detail?.task.id !== selected.id && <div className="deepread-loading" role="status"><LoaderCircle className="spin" size={22} /><span>正在加载精读内容…</span></div>}
              {!loadingDetail && !detail && <div className="deepread-loading"><p>精读内容加载失败，请点击刷新重试。</p></div>}
              {detail?.task.id === selected.id && tab === "report" && <DeepReadReportTab detail={detail} />}
              {detail?.task.id === selected.id && tab === "chat" && (
                <DeepReadChatTab
                  key={selected.id}
                  messages={detail.messages}
                  canAsk={hasReport && ready}
                  answering={answering}
                  onAsk={ask}
                  onDeleteTurn={index => void deleteTurn(index)}
                />
              )}
              </div>
            </>
          ) : (
            <div className="deepread-welcome">
              <h2>暂无精读报告</h2>
              <p>从论文库或本地 PDF 选择论文。</p>
              <button type="button" className="primary" onClick={() => setCreating(true)}><Plus size={16} />选择论文开始</button>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

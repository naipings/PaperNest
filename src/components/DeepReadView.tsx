import { useCallback, useEffect, useMemo, useState } from "react";
import { BookOpenCheck, BookOpenText, Check, Columns2, Copy, FolderOpen, Library, LoaderCircle, Play, RefreshCw, RotateCcw, Square, Trash2 } from "lucide-react";
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

  const showError = useCallback((error: unknown) => setNotice(messageOf(error)), []);

  const loadTasks = useCallback(async () => {
    const list = await backend.deepreadList();
    setTasks(list);
    setSelectedId(current => current ?? list[0]?.id);
  }, []);

  const loadDetail = useCallback(async (id: string) => setDetail(await backend.deepreadGet(id)), []);

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
    void loadDetail(selectedId).catch(showError);
  }, [selectedId, loadDetail, showError]);

  const selected = tasks.find(task => task.id === selectedId);
  const hasActive = tasks.some(isActive);

  useEffect(() => {
    if (!hasActive) return;
    const timer = window.setInterval(() => void loadTasks().catch(showError), 2000);
    return () => window.clearInterval(timer);
  }, [hasActive, loadTasks, showError]);

  useEffect(() => {
    if (selected && detail?.task.id === selected.id && selected.updatedAt > detail.task.updatedAt) {
      void loadDetail(selected.id).catch(showError);
    }
  }, [selected, detail, loadDetail, showError]);

  const readPaperIds = useMemo(
    () => new Set(tasks.filter(task => task.status === "completed" && task.paperId).map(task => task.paperId!)),
    [tasks],
  );

  const queueCreated = async (createdIds: string[], notes: string[]) => {
    await loadTasks();
    if (createdIds.length) {
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
      setDetail(await backend.deepreadAsk(selected.id, question));
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
      setDetail(await backend.deepreadDeleteTurn(selected.id, messageIndex));
    } catch (error) {
      showError(error);
    }
  };

  const copyReport = async () => {
    if (!detail?.report) return;
    await navigator.clipboard.writeText(detail.report);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
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
    return <DeepReadCompare tasks={tasks} initialId={compareId} onExit={() => {
      setSelectedId(compareId);
      setCompareId(undefined);
    }} />;
  }

  return (
    <main className="content-page research-page deepread-page">
      <div className="research-layout">
        <header className="research-page-header research-page-header-left page-heading">
          <div className="page-title-block">
            <div className="page-title-row">
              <span className="page-title-icon"><BookOpenCheck size={18} /></span>
              <h1>论文精读</h1>
              <span className="page-kicker">证据驱动</span>
            </div>
            <p>逐篇生成 What → Why → How → Experiment → Question 精读报告，每条结论附页码与段落证据；使用「设置 → 文献调研」的 LLM。</p>
          </div>
        </header>
        <div className="research-page-header research-page-header-right page-heading-actions">
          {notice && <span className="inline-notice research-inline-notice">{notice}</span>}
          {busy && <span className="inline-notice research-inline-notice"><LoaderCircle className="spin" size={14} />{busy}</span>}
          <button type="button" className="secondary" disabled={!!busy} onClick={() => void loadTasks().catch(showError)}>
            <RefreshCw size={16} />
            刷新
          </button>
        </div>

        {!ready && (
          <div className="info-card research-disabled-banner research-layout-full">
            <BookOpenCheck size={18} />
            <div>
              <strong>论文精读未就绪</strong>
              <p>请打开「设置 → 文献调研」，启用调研 LLM 并保存 API Key。</p>
            </div>
          </div>
        )}

        <aside className="research-sidebar">
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
          <section className="research-history" aria-labelledby="deepread-history-heading">
            <h3 id="deepread-history-heading">精读任务</h3>
            <ul className="research-session-list">
              {tasks.map(task => (
                <li key={task.id}>
                  <button type="button" className={`research-session-item${selectedId === task.id ? " active" : ""}`} onClick={() => setSelectedId(task.id)}>
                    <span className="research-session-item-top">
                      <strong>{task.title}</strong>
                      <span className={`research-session-status ${STATUS_CLASS[task.status]}`}>{STATUS_LABEL[task.status]}</span>
                    </span>
                    <small>
                      {task.sourceKind === "external" ? "外部 PDF" : "论文库"} · {formatTime(task.updatedAt)}
                      {task.status === "running" && task.stage ? ` · ${stageLabel(task.stage)}` : ""}
                    </small>
                  </button>
                  <button type="button" className="ghost icon-only research-session-delete" title="删除" onClick={() => void remove(task.id)}>
                    <Trash2 size={14} />
                  </button>
                </li>
              ))}
              {!tasks.length && <li className="research-session-empty">暂无精读任务，在上方选择论文开始。</li>}
            </ul>
          </section>
        </aside>

        <section className="research-main deepread-main">
          {selected ? (
            <>
              <header className="research-detail-header">
                <div>
                  <h2>{selected.title}</h2>
                  <p>{selected.sourceName}{selected.model ? ` · ${selected.model}` : ""}</p>
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
                      {stagesDone.length > 0 && (
                        <button type="button" className="secondary" disabled={!ready} onClick={() => void run(true)}><RotateCcw size={16} />重新生成</button>
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
                  {linkedPaper && (
                    <button type="button" className="secondary" onClick={() => onOpenPaper(linkedPaper)}><BookOpenText size={16} />阅读台打开</button>
                  )}
                  {selected.sourceKind === "external" && (
                    <button type="button" className="secondary" disabled={!!busy} onClick={() => void addToLibrary()}><Library size={16} />加入论文库</button>
                  )}
                  <button type="button" className="secondary" onClick={() => void backend.deepreadOpenWorkspace(selected.id).catch(showError)}><FolderOpen size={16} />打开文件夹</button>
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
                <button type="button" role="tab" aria-selected={tab === "report"} className={tab === "report" ? "active" : ""} onClick={() => setTab("report")}>报告</button>
                <button type="button" role="tab" aria-selected={tab === "chat"} className={tab === "chat" ? "active" : ""} onClick={() => setTab("chat")}>
                  追问
                  {!!detail?.messages.length && <span className="research-tab-badge">{detail.messages.length / 2}</span>}
                </button>
              </div>
              {detail?.task.id === selected.id && tab === "report" && <DeepReadReportTab detail={detail} />}
              {detail?.task.id === selected.id && tab === "chat" && (
                <DeepReadChatTab
                  messages={detail.messages}
                  canAsk={hasReport && ready}
                  answering={answering}
                  onAsk={ask}
                  onDeleteTurn={index => void deleteTurn(index)}
                />
              )}
            </>
          ) : (
            <div className="research-empty"><p>在左侧选择论文开始精读，或从「本地知识树」详情栏进入。</p></div>
          )}
        </section>
      </div>
    </main>
  );
}

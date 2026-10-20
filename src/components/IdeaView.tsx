import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, Copy, Lightbulb, LoaderCircle, Play, Plus, Search, Square, Trash2, X } from "lucide-react";
import { backend, isTauri } from "../services/backend";
import { useLibrary } from "../state/LibraryContext";
import { Modal } from "./Modal";
import { MarkdownLiveEditor } from "./MarkdownLiveEditor";
import { DeepReadMarkdown } from "./deepread/DeepReadMarkdown";
import "./deepread/DeepRead.css";
import type { DeepReadStatus, IdeaDetail, IdeaTask, Paper } from "../types";

const STAGES = [
  { key: "retrieve", label: "检索文献" },
  { key: "bottleneck", label: "瓶颈诊断" },
  { key: "select", label: "选择模式" },
  { key: "generate", label: "生成候选" },
  { key: "collision", label: "先验撞车" },
  { key: "audit", label: "审计" },
  { key: "revise", label: "修订" },
  { key: "card", label: "成稿" },
] as const;

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

const isActive = (task: IdeaTask) => task.status === "queued" || task.status === "running";
const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));
const formatTime = (iso: string) => new Date(iso).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });

export function IdeaView({ seed, onOpenResearch }: {
  seed?: { paperId: string; direction: string; nonce: number };
  onOpenResearch(): void;
}) {
  const { data } = useLibrary();
  const papers = useMemo(() => (data?.papers ?? []).filter(paper => !paper.deletedAt), [data]);
  const [tasks, setTasks] = useState<IdeaTask[]>([]);
  const [selectedId, setSelectedId] = useState<string>();
  const [detail, setDetail] = useState<IdeaDetail>();
  const [ready, setReady] = useState(false);
  const [creating, setCreating] = useState(false);
  const [direction, setDirection] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [filter, setFilter] = useState("");
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [copied, setCopied] = useState(false);
  const [openingResearch, setOpeningResearch] = useState(false);

  const showError = useCallback((error: unknown) => setNotice(messageOf(error)), []);
  const loadTasks = useCallback(async () => {
    const list = await backend.ideaList();
    setTasks(list);
    setSelectedId(current => current ?? list[0]?.id);
  }, []);

  useEffect(() => {
    if (!seed) return;
    setCreating(true);
    setDirection(seed.direction);
    setPicked(seed.paperId ? [seed.paperId] : []);
    setNotice("");
  }, [seed]);

  useEffect(() => {
    if (!isTauri()) return;
    void backend.researchGetSettings().then(settings => setReady(settings.enabled && settings.apiKeySaved)).catch(showError);
    void loadTasks().catch(showError);
  }, [loadTasks, showError]);

  const selected = tasks.find(task => task.id === selectedId);
  const hasActive = tasks.some(isActive);

  useEffect(() => {
    if (!hasActive) return;
    const timer = window.setInterval(() => void loadTasks().catch(showError), 2000);
    return () => window.clearInterval(timer);
  }, [hasActive, loadTasks, showError]);

  useEffect(() => {
    if (!selectedId) {
      setDetail(undefined);
      return;
    }
    let current = true;
    void backend.ideaGet(selectedId).then(next => {
      if (current) setDetail(next);
    }).catch(error => { if (current) showError(error); });
    return () => { current = false; };
  }, [selectedId, selected?.updatedAt, showError]);

  const visiblePapers = papers.filter(paper => {
    const needle = filter.trim().toLowerCase();
    if (!needle) return true;
    return paper.titleEn.toLowerCase().includes(needle) || (paper.titleZh ?? "").toLowerCase().includes(needle);
  }).slice(0, 80);

  const create = async () => {
    setBusy("正在创建构思…");
    setNotice("");
    try {
      const task = await backend.ideaCreate({ direction, paperIds: picked });
      await backend.ideaRun(task.id, false);
      setCreating(false);
      setSelectedId(task.id);
      await loadTasks();
    } catch (error) {
      showError(error);
    } finally {
      setBusy("");
    }
  };

  const run = async (restart: boolean) => {
    if (!selected) return;
    setNotice("");
    try {
      await backend.ideaRun(selected.id, restart);
      await loadTasks();
    } catch (error) {
      showError(error);
    }
  };

  const cancel = async () => {
    if (!selected) return;
    try {
      await backend.ideaCancel(selected.id);
      setNotice("将在当前阶段结束后停止");
    } catch (error) {
      showError(error);
    }
  };

  const remove = async (task: IdeaTask) => {
    if (!window.confirm(`删除构思「${task.title}」及其工作区？`)) return;
    try {
      await backend.ideaDelete(task.id);
      if (selectedId === task.id) setSelectedId(undefined);
      await loadTasks();
    } catch (error) {
      showError(error);
    }
  };

  const openResearch = async () => {
    if (!detail?.report.trim() || !selected) return;
    setOpeningResearch(true);
    try {
      await backend.researchCreateSession({
        title: `构思：${selected.title}`,
        query: `请核对这条研究设想是否成立，并补充最近的相关工作。\n\n${detail.report.slice(0, 4000)}`,
      });
      onOpenResearch();
    } catch (error) {
      showError(error);
    } finally {
      setOpeningResearch(false);
    }
  };

  const togglePaper = (paper: Paper) => {
    setPicked(current => current.includes(paper.id) ? current.filter(id => id !== paper.id) : [...current, paper.id]);
  };

  if (!isTauri()) {
    return <main className="deepread-page"><header className="page-heading"><h1>研究构思</h1><p>请在桌面端使用此功能。</p></header></main>;
  }

  const currentDetail = detail?.task.id === selected?.id ? detail : undefined;
  const report = currentDetail?.report ?? "";
  const stagesDone = currentDetail?.stagesDone ?? [];
  const active = selected ? isActive(selected) : false;

  return <main className="deepread-page">
    <header className="deepread-heading page-heading">
      <div className="page-title-block">
        <div className="page-title-row">
          <span className="page-title-icon"><Lightbulb size={19} /></span>
          <h1>研究构思</h1>
          <span className="deepread-heading-count">{tasks.length} 个任务</span>
        </div>
      </div>
      <div className="page-heading-actions">
        <button type="button" className="primary" disabled={!!busy} onClick={() => { setNotice(""); setCreating(true); }}><Plus size={16} />新建构思</button>
      </div>
    </header>
    {notice && <div className="deepread-notice" role="status"><span>{notice}</span><button type="button" className="ghost icon-only" aria-label="关闭提示" onClick={() => setNotice("")}><X size={15} /></button></div>}
    {!ready && <div className="info-card research-disabled-banner research-layout-full"><Lightbulb size={18} /><div><strong>研究构思未就绪</strong><p>请打开「设置 → 文献调研」，启用调研 LLM 并保存 API Key。构思与调研共用这一套配置。</p></div></div>}
    {creating && <Modal title="新建构思" wide onClose={() => { if (!busy) setCreating(false); }}>
      <div className="paper-editor">
        <label>研究方向<textarea value={direction} rows={5} onChange={event => setDirection(event.target.value)} placeholder="例如：长上下文模型的 KV cache 压缩，希望少改训练、可证伪。" /></label>
        <label>种子论文（可选）<input value={filter} onChange={event => setFilter(event.target.value)} placeholder="按标题筛选论文库" /></label>
        <ul className="research-session-list">
          {visiblePapers.map(paper => (
            <li key={paper.id}>
              <label className="research-session-item">
                <input type="checkbox" checked={picked.includes(paper.id)} onChange={() => togglePaper(paper)} />
                <strong>{paper.titleZh || paper.titleEn}</strong>
              </label>
            </li>
          ))}
          {!visiblePapers.length && <li className="research-session-empty">论文库里没有可勾选的论文。</li>}
        </ul>
        <footer>
          <button type="button" className="secondary" disabled={!!busy} onClick={() => setCreating(false)}>取消</button>
          <button type="button" className="primary" disabled={!!busy || !ready || direction.trim().length < 8} onClick={() => void create()}>{busy ? "创建中…" : "开始构思"}</button>
        </footer>
      </div>
    </Modal>}
    <div className="research-layout deepread-layout">
      <aside className="research-sidebar">
        <section className="research-history">
          <div className="deepread-history-head"><h3>构思任务</h3><span>{tasks.length} 条</span></div>
          <ul className="research-session-list">
            {tasks.map(task => (
              <li key={task.id}>
                <button type="button" className={`research-session-item${selectedId === task.id ? " active" : ""}`} aria-current={selectedId === task.id ? "true" : undefined} onClick={() => { setSelectedId(task.id); setCopied(false); }}>
                  <span className="research-session-item-top">
                    <strong>{task.title}</strong>
                    <span className={`research-session-status ${STATUS_CLASS[task.status]}`}>{STATUS_LABEL[task.status]}</span>
                  </span>
                  <small>{formatTime(task.updatedAt)}{task.status === "running" && task.stage ? ` · ${STAGES.find(stage => stage.key === task.stage)?.label ?? task.stage}` : ""}</small>
                </button>
                <button type="button" className="ghost icon-only research-session-delete" disabled={isActive(task)} aria-label={`删除构思：${task.title}`} onClick={() => void remove(task)}><Trash2 size={14} /></button>
              </li>
            ))}
            {!tasks.length && <li className="research-session-empty">还没有构思。点击「新建构思」，写一个研究方向。</li>}
          </ul>
        </section>
      </aside>
      <section className="research-main deepread-main">
        {selected ? <>
          <header className="research-detail-header">
            <div>
              <div className="deepread-document-meta"><span className={`research-session-status ${STATUS_CLASS[selected.status]}`}>{STATUS_LABEL[selected.status]}</span><span>{formatTime(selected.updatedAt)}</span></div>
              <h2>{selected.title}</h2>
              <p>{selected.model || "尚未生成"}</p>
            </div>
            <div className="research-detail-actions">
              {active ? <button type="button" className="secondary" onClick={() => void cancel()}><Square size={16} />停止</button> : (
                !report && <button type="button" className="primary" disabled={!ready} onClick={() => void run(false)}><Play size={16} />{stagesDone.length ? "继续生成" : "开始生成"}</button>
              )}
              {!!report && <button type="button" className="secondary" onClick={() => { void navigator.clipboard.writeText(report); setCopied(true); }}>{copied ? <Check size={16} /> : <Copy size={16} />}{copied ? "已复制" : "复制全文"}</button>}
              {!!report && <button type="button" className="secondary" disabled={openingResearch} onClick={() => void openResearch()}><Search size={16} />开文献调研</button>}
              {!active && stagesDone.length > 0 && <button type="button" className="secondary" disabled={!ready} onClick={() => void run(true)}>重新生成</button>}
            </div>
          </header>
          {selected.error && <p className="inline-notice">{selected.error}</p>}
          {active && <div className="research-progress-banner"><LoaderCircle className="spin" size={16} /><div><strong>{selected.status === "queued" ? "排队中" : `生成中 · ${STAGES.find(stage => stage.key === selected.stage)?.label ?? ""}`}</strong><p>每个阶段完成后保存。停止在当前阶段结束后生效。</p></div></div>}
          <div className="research-report-shell deepread-report">
            <details className="deepread-progress" open={active || !report.trim()}>
              <summary><span className="deepread-progress-title">{active ? <LoaderCircle className="spin" size={14} /> : <Lightbulb size={14} />} 生成进度</span><span className="deepread-progress-count">{stagesDone.length} / {STAGES.length} 步骤</span></summary>
              <ol className="deepread-stages" aria-label="生成进度">
                {STAGES.map((stage, index) => {
                  const state = stagesDone.includes(stage.key) ? "done" : active && selected.stage === stage.key ? "active" : "pending";
                  return <li key={stage.key} className={state}><span className="deepread-stage-index">{state === "done" ? <Check size={13} /> : index + 1}</span><span className="deepread-stage-copy">{stage.label}</span></li>;
                })}
              </ol>
            </details>
            {!!selected.validation.length && <div className="deepread-validation" role="status"><div><ul>{selected.validation.map(item => <li key={item}>{item}</li>)}</ul></div></div>}
            {report.trim() ? <article className="research-report-document" aria-label={selected.title}>
              <MarkdownLiveEditor text={report} editable={!active} onSave={async next => { await backend.ideaSaveReport(selected.id, next); setDetail(current => current ? { ...current, report: next } : current); }} render={source => <DeepReadMarkdown text={source} />} />
            </article> : !active && <div className="deepread-welcome"><h2>还没有 idea 卡</h2><p>写一个研究方向，可选论文库里的种子论文。生成完成后可以改卡片，或拿去开文献调研。</p></div>}
          </div>
        </> : <div className="deepread-welcome"><h2>从研究方向到一张 idea 卡</h2><p>检索文献、诊断瓶颈、选择构思模式、生成候选、核对先验撞车，再审计和修订。</p><button type="button" className="primary" onClick={() => setCreating(true)}><Plus size={16} />新建构思</button></div>}
      </section>
    </div>
  </main>;
}

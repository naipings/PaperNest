import { useCallback, useEffect, useState } from "react";
import {
  Check,
  ExternalLink,
  FolderOpen,
  LoaderCircle,
  Play,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { backend, isTauri } from "../services/backend";
import { useLibrary } from "../state/LibraryContext";
import type { ResearchProposal, ResearchSession, ResearchSource, ResearchStepSummary } from "../types";

const STATUS_LABEL: Record<string, string> = {
  draft: "草稿",
  running: "运行中",
  completed: "已完成",
  failed: "失败",
};

const PROPOSAL_STATUS: Record<string, string> = {
  pending: "待审批",
  approved: "已入库",
  rejected: "已拒绝",
};

function renderMarkdownLite(text: string) {
  return text
    .replace(/^### (.*$)/gim, "<h3>$1</h3>")
    .replace(/^## (.*$)/gim, "<h2>$1</h2>")
    .replace(/^# (.*$)/gim, "<h1>$1</h1>")
    .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
    .replace(/\n/g, "<br />");
}

export function ResearchView() {
  const { researchBusy, setResearchBusy, setResearchNotice } = useLibrary();
  const [sessions, setSessions] = useState<ResearchSession[]>([]);
  const [selectedId, setSelectedId] = useState<string>();
  const [settingsEnabled, setSettingsEnabled] = useState(false);
  const [query, setQuery] = useState("");
  const [outputRequirements, setOutputRequirements] = useState("中文综述，含引用标注 [src-xxx]");
  const [workspacePath, setWorkspacePath] = useState("");
  const [report, setReport] = useState("");
  const [sources, setSources] = useState<ResearchSource[]>([]);
  const [steps, setSteps] = useState<ResearchStepSummary[]>([]);
  const [proposals, setProposals] = useState<ResearchProposal[]>([]);
  const [notice, setNotice] = useState("");
  const [showProcess, setShowProcess] = useState(false);

  const selected = sessions.find(item => item.id === selectedId);
  const isRunning = selected?.status === "running" || !!researchBusy;

  const loadSessions = useCallback(async () => {
    if (!isTauri()) return;
    const list = await backend.researchListSessions();
    setSessions(list);
    setSelectedId(current => current ?? list[0]?.id);
  }, []);

  const loadDetail = useCallback(async (id: string) => {
    if (!isTauri()) return;
    const [reportText, sourceList, stepList, proposalList] = await Promise.all([
      backend.researchReadReport(id).catch(() => ""),
      backend.researchReadSources(id),
      backend.researchListSteps(id),
      backend.researchListProposals(id),
    ]);
    setReport(reportText);
    setSources(sourceList);
    setSteps(stepList);
    setProposals(proposalList);
  }, []);

  useEffect(() => {
    if (!isTauri()) return;
    void backend.researchGetSettings()
      .then(s => setSettingsEnabled(s.enabled))
      .catch(error => setNotice(error instanceof Error ? error.message : String(error)));
    void loadSessions();
  }, [loadSessions]);

  useEffect(() => {
    if (!selectedId) {
      setReport("");
      setSources([]);
      setSteps([]);
      setProposals([]);
      return;
    }
    void loadDetail(selectedId).catch(error => setNotice(error instanceof Error ? error.message : String(error)));
  }, [selectedId, loadDetail]);

  useEffect(() => {
    if (!selectedId || !isRunning) return;
    setShowProcess(true);
    const timer = window.setInterval(() => {
      void loadDetail(selectedId).catch(() => undefined);
      void loadSessions().catch(() => undefined);
    }, 1500);
    return () => window.clearInterval(timer);
  }, [selectedId, isRunning, loadDetail, loadSessions]);

  const refreshSelected = async () => {
    await loadSessions();
    if (selectedId) await loadDetail(selectedId);
  };

  const createSession = async () => {
    if (!query.trim()) {
      setNotice("请填写研究问题");
      return;
    }
    setResearchBusy("正在创建调研任务…");
    try {
      const session = await backend.researchCreateSession({
        query: query.trim(),
        outputRequirements: outputRequirements.trim(),
        workspacePath: workspacePath.trim() || undefined,
      });
      setQuery("");
      await loadSessions();
      setSelectedId(session.id);
      setNotice("任务已创建，点击「开始调研」运行。");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setResearchBusy("");
    }
  };

  const runSession = async () => {
    if (!selectedId) return;
    setResearchBusy("调研进行中，请稍候…");
    setResearchNotice("");
    setShowProcess(true);
    try {
      const session = await backend.researchRunSession(selectedId);
      await loadSessions();
      await loadDetail(selectedId);
      if (session.status === "failed") {
        setNotice(session.error || "调研失败");
      } else {
        setNotice("调研完成，报告已写入 report.md。");
      }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
      await refreshSelected();
    } finally {
      setResearchBusy("");
    }
  };

  const pickWorkspace = async () => {
    const path = await backend.researchChooseWorkspace();
    if (path) setWorkspacePath(path);
  };

  const deleteSession = async (id: string) => {
    if (!confirm("删除该调研记录？默认工作区文件夹将一并删除。")) return;
    await backend.researchDeleteSession(id);
    if (selectedId === id) setSelectedId(undefined);
    await loadSessions();
  };

  const approveProposal = async (proposalId: string, downloadPdf: boolean) => {
    if (!selectedId) return;
    setResearchBusy(downloadPdf ? "正在下载 PDF 并入库…" : "正在入库…");
    try {
      const result = await backend.researchApproveProposal(selectedId, proposalId, downloadPdf);
      await loadDetail(selectedId);
      setNotice(`已入库：${result.title}${result.downloadedPdf ? "（含 PDF）" : ""}`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setResearchBusy("");
    }
  };

  const rejectProposal = async (proposalId: string) => {
    if (!selectedId) return;
    await backend.researchRejectProposal(selectedId, proposalId);
    await loadDetail(selectedId);
    setNotice("已拒绝该入库提案。");
  };

  if (!isTauri()) {
    return (
      <main className="content-page research-page">
        <header className="page-heading"><h1>文献调研</h1><p>请在桌面端使用此功能。</p></header>
      </main>
    );
  }

  return (
    <main className="content-page research-page">
      <header className="page-heading">
        <div className="page-title-block">
          <div className="page-title-row">
            <span className="page-title-icon"><Search size={18} /></span>
            <h1>文献调研</h1>
            <span className="page-kicker">主题深潜</span>
          </div>
          <p>产出 report.md；过程文件保存在项目文件夹。默认关闭，需在设置中启用调研 LLM。</p>
        </div>
        <div className="page-heading-actions">
          {notice && <span className="inline-notice">{notice}</span>}
          {researchBusy && <span className="inline-notice"><LoaderCircle className="spin" size={14} />{researchBusy}</span>}
          <button type="button" className="secondary" disabled={!!researchBusy} onClick={() => void refreshSelected()}><RefreshCw size={16} />刷新</button>
        </div>
      </header>

      {!settingsEnabled && (
        <div className="info-card research-disabled-banner">
          <Search size={18} />
          <div><strong>文献调研未启用</strong><p>请打开「设置 → 文献调研」，启用并配置调研 LLM。</p></div>
        </div>
      )}

      <div className="research-layout">
        <aside className="research-sidebar">
          <div className="research-new-card">
            <h3>新建调研</h3>
            <label>研究问题<textarea rows={3} value={query} onChange={e => setQuery(e.target.value)} placeholder="例如：Agent memory 在 LLM 应用中的方法对比" /></label>
            <label>输出要求<textarea rows={2} value={outputRequirements} onChange={e => setOutputRequirements(e.target.value)} /></label>
            <label>项目文件夹（可选）<div className="research-path-row"><input value={workspacePath} onChange={e => setWorkspacePath(e.target.value)} placeholder="默认：资料库/research/&lt;id&gt;/" /><button type="button" className="secondary" onClick={() => void pickWorkspace()}>选择</button></div></label>
            <button type="button" className="primary" disabled={!settingsEnabled || !!researchBusy} onClick={() => void createSession()}><Plus size={16} />创建任务</button>
          </div>
          <h3>历史任务</h3>
          <ul className="research-session-list">
            {sessions.map(item => (
              <li key={item.id}>
                <button type="button" className={selectedId === item.id ? "active" : ""} onClick={() => setSelectedId(item.id)}>
                  <strong>{item.title}</strong>
                  <small>{STATUS_LABEL[item.status] ?? item.status} · {item.updatedAt.slice(0, 16).replace("T", " ")}</small>
                </button>
                <button type="button" className="ghost icon-only" title="删除" onClick={() => void deleteSession(item.id)}><Trash2 size={14} /></button>
              </li>
            ))}
            {!sessions.length && <li className="muted">暂无任务</li>}
          </ul>
        </aside>

        <section className="research-main">
          {selected ? (
            <>
              <header className="research-detail-header">
                <div>
                  <h2>{selected.title}</h2>
                  <p>{selected.query}</p>
                </div>
                <div className="research-detail-actions">
                  <button type="button" className="primary" disabled={!!researchBusy || selected.status === "running" || !settingsEnabled} onClick={() => void runSession()}><Play size={16} />开始调研</button>
                  <button type="button" className="secondary" onClick={() => void backend.researchOpenWorkspace(selected.id)}><FolderOpen size={16} />打开文件夹</button>
                </div>
              </header>
              {selected.error && <p className="inline-notice">{selected.error}</p>}
              {isRunning && (
                <div className="research-progress-banner">
                  <LoaderCircle className="spin" size={16} />
                  <div>
                    <strong>调研进行中</strong>
                    <p>
                      {steps.length
                        ? `已记录 ${steps.length} 个步骤${steps[steps.length - 1]?.label ? ` · 最新：${steps[steps.length - 1].label}` : ""}`
                        : "正在启动 Agent…"}
                    </p>
                  </div>
                </div>
              )}
              {proposals.length > 0 && (
                <div className="research-proposals-panel">
                  <h3>入库提案 ({proposals.filter(item => item.status === "pending").length} 待审批)</h3>
                  <ul className="research-proposals-list">
                    {proposals.map(item => (
                      <li key={item.id} className={item.status}>
                        <div className="research-proposal-head">
                          <strong>{item.title}</strong>
                          <span className="research-proposal-status">{PROPOSAL_STATUS[item.status] ?? item.status}</span>
                        </div>
                        {item.arxivId && <small>arXiv: {item.arxivId}</small>}
                        {item.url && (
                          <button type="button" className="ghost linkish" onClick={() => void backend.openExternalUrl(item.url!)}><ExternalLink size={13} />打开链接</button>
                        )}
                        {item.status === "pending" && (
                          <div className="research-proposal-actions">
                            <button type="button" className="secondary" disabled={!!researchBusy} onClick={() => void approveProposal(item.id, false)}><Check size={14} />仅元数据</button>
                            <button type="button" className="primary" disabled={!!researchBusy} onClick={() => void approveProposal(item.id, true)}><Check size={14} />下载 PDF 入库</button>
                            <button type="button" className="ghost" disabled={!!researchBusy} onClick={() => void rejectProposal(item.id)}><X size={14} />拒绝</button>
                          </div>
                        )}
                        {item.resolvedPaperId && <small>论文 ID：{item.resolvedPaperId}</small>}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <div className="research-report-panel">
                <h3>report.md</h3>
                {report.trim() ? (
                  <article className="research-report-body" dangerouslySetInnerHTML={{ __html: renderMarkdownLite(report) }} />
                ) : (
                  <p className="muted">尚无报告。创建后点击「开始调研」。</p>
                )}
              </div>
              <button type="button" className="ghost research-process-toggle" onClick={() => setShowProcess(v => !v)}>
                {showProcess ? "收起过程" : "查看过程与来源"}
                {isRunning && <LoaderCircle className="spin" size={14} />}
              </button>
              {showProcess && (
                <div className="research-process-grid">
                  <div>
                    <h4>引用来源 ({sources.length})</h4>
                    <ul className="research-sources-list">
                      {sources.map(source => (
                        <li key={source.id}>
                          <strong>{source.id}</strong> {source.title}
                          {source.url && (
                            <button type="button" className="ghost linkish" onClick={() => void backend.openExternalUrl(source.url!)}><ExternalLink size={13} />打开链接</button>
                          )}
                          <p>{source.excerpt.slice(0, 200)}{source.excerpt.length > 200 ? "…" : ""}</p>
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <h4>步骤日志 ({steps.length})</h4>
                    <ul className="research-steps-list">
                      {steps.map(step => (
                        <li key={step.fileName} className={step.kind.startsWith("react-tool-") ? "react-tool-step" : undefined}>
                          <div className="research-step-head">
                            <span className="research-step-label">{step.label ?? step.kind}</span>
                            <time>{step.createdAt.slice(11, 19)}</time>
                          </div>
                          {step.detail && <p className="research-step-detail">{step.detail}</p>}
                          <code className="research-step-file">{step.fileName}</code>
                        </li>
                      ))}
                      {!steps.length && isRunning && <li className="muted">等待首个步骤…</li>}
                    </ul>
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="research-empty"><p>创建或选择左侧任务。</p></div>
          )}
        </section>
      </div>
    </main>
  );
}

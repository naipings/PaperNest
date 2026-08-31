import { useCallback, useEffect, useRef, useState } from "react";
import {
  FileDown,
  FolderOpen,
  LoaderCircle,
  Play,
  RefreshCw,
  Search,
  Square,
} from "lucide-react";
import { backend, isTauri } from "../services/backend";
import { linkAttachments, readAttachment, type AttachmentDraft } from "../lib/researchAttachments";
import { useResearchHarness } from "../research-harness/ResearchHarnessProvider";
import { ResearchTrajectoryPanel } from "../research-harness/ResearchTrajectoryPanel";
import { useResearchPageLayout } from "../research-harness/useResearchPageLayout";
import { ResearchConversationTab } from "./research/ResearchConversationTab";
import { ResearchNewSessionCard } from "./research/ResearchNewSessionCard";
import { ResearchProposalsTab } from "./research/ResearchProposalsTab";
import { ResearchSessionList } from "./research/ResearchSessionList";
import { useLibrary } from "../state/LibraryContext";
import type {
  ResearchAttachmentInput,
  ResearchProposal,
  ResearchSession,
  ResearchSource,
  ResearchStepSummary,
  ResearchTurnView,
} from "../types";

type DetailTab = "conversation" | "trajectory" | "proposals";

export function ResearchView() {
  const { researchBusy, setResearchBusy, setResearchNotice } = useLibrary();
  const { reload: reloadHarness, eventCount, loading: dshLoading } = useResearchHarness();
  const [sessions, setSessions] = useState<ResearchSession[]>([]);
  const [selectedId, setSelectedId] = useState<string>();
  const [settingsEnabled, setSettingsEnabled] = useState(false);
  const [query, setQuery] = useState("");
  const [outputRequirements, setOutputRequirements] = useState("中文综述，含引用标注 [src-xxx]");
  const [workspacePath, setWorkspacePath] = useState("");
  const [turns, setTurns] = useState<ResearchTurnView[]>([]);
  const [queryAttachments, setQueryAttachments] = useState<AttachmentDraft[]>([]);
  const [followUp, setFollowUp] = useState("");
  const [followUpAttachments, setFollowUpAttachments] = useState<AttachmentDraft[]>([]);
  const [runPending, setRunPending] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [sources, setSources] = useState<ResearchSource[]>([]);
  const [steps, setSteps] = useState<ResearchStepSummary[]>([]);
  const [proposals, setProposals] = useState<ResearchProposal[]>([]);
  const [notice, setNotice] = useState("");
  const [showProcess, setShowProcess] = useState(false);
  const [detailTab, setDetailTab] = useState<DetailTab>("trajectory");

  const selected = sessions.find(item => item.id === selectedId);
  const isRunning = selected?.status === "running" || runPending;

  const markSessionRunning = useCallback((id: string) => {
    setSessions(current =>
      current.map(session =>
        session.id === id ? { ...session, status: "running", error: undefined } : session,
      ),
    );
  }, []);
  const pendingProposals = proposals.filter(item => item.status === "pending").length;
  const trajectoryActive = detailTab === "trajectory" && !!selected;
  const hasResumeBar =
    trajectoryActive &&
    !isRunning &&
    eventCount > 0 &&
    !!selected &&
    (selected.status === "failed" || selected.status === "completed" || selected.status === "cancelled");
  const pageRef = useRef<HTMLElement>(null);
  useResearchPageLayout(pageRef, { trajectoryActive, hasResumeBar });

  const loadSessions = useCallback(async () => {
    if (!isTauri()) return;
    const list = await backend.researchListSessions();
    setSessions(list);
    setSelectedId(current => current ?? list[0]?.id);
  }, []);

  const loadDetail = useCallback(async (id: string) => {
    if (!isTauri()) return;
    const [turnList, sourceList, stepList, proposalList] = await Promise.all([
      backend.researchListTurns(id),
      backend.researchReadSources(id),
      backend.researchListSteps(id),
      backend.researchListProposals(id),
    ]);
    setTurns(turnList);
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
      setTurns([]);
      setSources([]);
      setSteps([]);
      setProposals([]);
      return;
    }
    setFollowUp("");
    setFollowUpAttachments([]);
    void loadDetail(selectedId).catch(error => setNotice(error instanceof Error ? error.message : String(error)));
    void reloadHarness(selectedId).catch(() => undefined);
  }, [selectedId, loadDetail, reloadHarness]);

  useEffect(() => {
    if (!selectedId || !isRunning) return;
    setShowProcess(true);
    setDetailTab("trajectory");
    const timer = window.setInterval(() => {
      void loadDetail(selectedId).catch(() => undefined);
      void loadSessions().catch(() => undefined);
      void reloadHarness(selectedId).catch(() => undefined);
    }, 1500);
    return () => window.clearInterval(timer);
  }, [selectedId, isRunning, loadDetail, loadSessions, reloadHarness]);

  const refreshSelected = async () => {
    await loadSessions();
    if (selectedId) await loadDetail(selectedId);
  };

  const collectFiles = async (
    files: File[],
    apply: (updater: (current: AttachmentDraft[]) => AttachmentDraft[]) => void,
  ) => {
    for (const file of files) {
      try {
        const draft = await readAttachment(file);
        apply(current => [...current, draft]);
      } catch (error) {
        setNotice(error instanceof Error ? error.message : String(error));
      }
    }
  };

  const toAttachmentInputs = (drafts: AttachmentDraft[], text: string): ResearchAttachmentInput[] => [
    ...drafts.map(({ id: _id, sizeLabel: _sizeLabel, ...rest }) => rest),
    ...linkAttachments(text),
  ];

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
        attachments: toAttachmentInputs(queryAttachments, query),
      });
      setQuery("");
      setQueryAttachments([]);
      await loadSessions();
      setSelectedId(session.id);
      setDetailTab("trajectory");
      await reloadHarness(session.id).catch(() => undefined);
      setNotice(
        settingsEnabled
          ? "任务已创建，点击「开始调研」运行。"
          : "任务已创建。请先在设置中启用并配置调研 LLM，再开始调研。",
      );
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setResearchBusy("");
    }
  };

  const runSession = async () => {
    if (!selectedId) return;
    setRunPending(true);
    markSessionRunning(selectedId);
    setResearchBusy("调研进行中，请稍候…");
    setResearchNotice("");
    setShowProcess(true);
    try {
      const session = await backend.researchRunSession(selectedId);
      await loadSessions();
      await loadDetail(selectedId);
      if (session.status === "failed") {
        setNotice(session.error || "调研失败");
      } else if (session.status === "cancelled") {
        setNotice("调研已停止，可从轨迹恢复点继续。");
      } else {
        setNotice("调研完成，报告已写入 report.md。");
      }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
      await refreshSelected();
    } finally {
      setRunPending(false);
      setResearchBusy("");
    }
  };

  const sendFollowUp = async () => {
    if (!selectedId) return;
    if (!followUp.trim()) {
      setNotice("请填写追问内容");
      return;
    }
    const question = followUp.trim();
    const attachments = toAttachmentInputs(followUpAttachments, followUp);
    setRunPending(true);
    markSessionRunning(selectedId);
    setResearchBusy("正在继续调研…");
    setResearchNotice("");
    setDetailTab("conversation");
    try {
      setFollowUp("");
      setFollowUpAttachments([]);
      const session = await backend.researchContinueSession(selectedId, question, attachments);
      await loadSessions();
      await loadDetail(selectedId);
      await reloadHarness(selectedId);
      setNotice(session.status === "failed" ? session.error || "追问失败" : "本轮追问已完成。");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
      await refreshSelected();
    } finally {
      setRunPending(false);
      setResearchBusy("");
    }
  };

  const exportReport = async () => {
    if (!selectedId) return;
    try {
      const path = await backend.researchExportReport(selectedId);
      setNotice(`已合并导出：${path}`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    }
  };

  const resumeSession = async (boundarySeq?: number) => {
    if (!selectedId) return;
    setRunPending(true);
    markSessionRunning(selectedId);
    setResearchBusy("正在从轨迹恢复点续跑…");
    setResearchNotice("");
    setShowProcess(true);
    setDetailTab("trajectory");
    try {
      const session = await backend.researchResumeSession(selectedId, boundarySeq);
      await loadSessions();
      await loadDetail(selectedId);
      await reloadHarness(selectedId);
      if (session.status === "failed") {
        setNotice(session.error || "恢复后续跑失败");
      } else if (session.status === "cancelled") {
        setNotice("调研已停止，可从轨迹恢复点继续。");
      } else {
        setNotice("已从选定事件点恢复并完成调研。");
      }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
      await refreshSelected();
    } finally {
      setRunPending(false);
      setResearchBusy("");
    }
  };

  const forkSession = async (boundarySeq?: number) => {
    if (!selectedId) return;
    setResearchBusy("正在分叉为新调研任务…");
    setResearchNotice("");
    try {
      const session = await backend.researchForkSession(selectedId, boundarySeq);
      await loadSessions();
      setSelectedId(session.id);
      setDetailTab("trajectory");
      await loadDetail(session.id);
      await reloadHarness(session.id);
      setNotice("已分叉为新任务，可点击「开始调研」从该边界继续。");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setResearchBusy("");
    }
  };

  const cancelSession = async () => {
    if (!selectedId || cancelling) return;
    setCancelling(true);
    try {
      const session = await backend.researchCancelSession(selectedId);
      await loadSessions();
      await loadDetail(selectedId);
      await reloadHarness(selectedId);
      setNotice(session.status === "cancelled" ? "调研已停止，可从轨迹恢复点继续。" : "已请求停止调研。");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
      await refreshSelected();
    } finally {
      setCancelling(false);
    }
  };

  const canResume = !!selected && (selected.status === "failed" || selected.status === "completed" || selected.status === "cancelled") && !isRunning;
  const canFork = !!selected && selected.status !== "running" && eventCount > 0 && !isRunning;
  const canFollowUp = !!selected && selected.status !== "draft" && !isRunning;

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
    <main
      ref={pageRef}
      className={`content-page research-page${trajectoryActive ? " research-page--trajectory" : ""}`}
    >
      <div className="research-layout">
        <header className="research-page-header research-page-header-left page-heading">
          <div className="page-title-block">
            <div className="page-title-row">
              <span className="page-title-icon"><Search size={18} /></span>
              <h1>文献调研</h1>
              <span className="page-kicker">主题深潜</span>
            </div>
            <p>产出 report.md；过程文件保存在项目文件夹。默认关闭，需在设置中启用调研 LLM。</p>
          </div>
        </header>
        <div className="research-page-header research-page-header-right page-heading-actions">
          {notice && <span className="inline-notice research-inline-notice">{notice}</span>}
          {researchBusy && (
            <span className="inline-notice research-inline-notice">
              <LoaderCircle className="spin" size={14} />
              {researchBusy}
            </span>
          )}
          <button type="button" className="secondary" disabled={!!researchBusy} onClick={() => void refreshSelected()}>
            <RefreshCw size={16} />
            刷新
          </button>
        </div>

        {!settingsEnabled && (
          <div className="info-card research-disabled-banner research-layout-full">
            <Search size={18} />
            <div>
              <strong>文献调研未启用</strong>
              <p>请打开「设置 → 文献调研」，启用并配置调研 LLM。</p>
            </div>
          </div>
        )}

        <aside className="research-sidebar">
          <ResearchNewSessionCard
            query={query}
            attachments={queryAttachments}
            outputRequirements={outputRequirements}
            workspacePath={workspacePath}
            busy={!!researchBusy}
            onQueryChange={setQuery}
            onAddFiles={files => void collectFiles(files, setQueryAttachments)}
            onRemoveAttachment={id => setQueryAttachments(current => current.filter(item => item.id !== id))}
            onOutputChange={setOutputRequirements}
            onWorkspaceChange={setWorkspacePath}
            onPickWorkspace={() => void pickWorkspace()}
            onCreate={() => void createSession()}
          />
          <ResearchSessionList
            sessions={sessions}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onDelete={id => void deleteSession(id)}
          />
        </aside>

        <section className={`research-main${detailTab === "trajectory" ? " research-main--trajectory" : ""}`}>
          {selected ? (
            <>
              <header className="research-detail-header">
                <div>
                  <h2>{selected.title}</h2>
                  <p>{selected.query}</p>
                </div>
                <div className="research-detail-actions">
                  {isRunning ? (
                    <button type="button" className="secondary" disabled={cancelling} onClick={() => void cancelSession()}>
                      <Square size={16} />
                      {cancelling ? "正在停止…" : "停止调研"}
                    </button>
                  ) : (
                    <button type="button" className="primary" disabled={!!researchBusy || !settingsEnabled} onClick={() => void runSession()}>
                      <Play size={16} />
                      开始调研
                    </button>
                  )}
                  {turns.length > 1 && (
                    <button type="button" className="secondary" onClick={() => void exportReport()}>
                      <FileDown size={16} />
                      合并导出
                    </button>
                  )}
                  <button type="button" className="secondary" onClick={() => void backend.researchOpenWorkspace(selected.id)}><FolderOpen size={16} />打开文件夹</button>
                </div>
              </header>
              {selected.error && selected.status !== "running" && <p className="inline-notice">{selected.error}</p>}
              {isRunning && (
                <div className="research-progress-banner">
                  <LoaderCircle className="spin" size={16} />
                  <div>
                    <strong>调研进行中</strong>
                    <p>
                      {steps.length
                        ? `已记录 ${steps.length} 个步骤${steps[steps.length - 1]?.label ? ` · 最新：${steps[steps.length - 1].label}` : ""}`
                        : "正在启动 Agent…"}
                      {eventCount > 0 ? ` · DSH 事件 ${eventCount}` : dshLoading ? " · 加载轨迹…" : ""}
                      {" · 可随时点击「停止调研」（当前 LLM/工具步骤完成后生效）"}
                    </p>
                  </div>
                </div>
              )}
              <div className="research-detail-body">
              <div className="research-detail-tabs research-segmented-tabs" role="tablist" aria-label="调研详情">
                <button
                  type="button"
                  role="tab"
                  aria-selected={detailTab === "conversation"}
                  className={detailTab === "conversation" ? "active" : ""}
                  onClick={() => setDetailTab("conversation")}
                >
                  对话
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={detailTab === "trajectory"}
                  className={detailTab === "trajectory" ? "active" : ""}
                  onClick={() => setDetailTab("trajectory")}
                >
                  轨迹
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={detailTab === "proposals"}
                  className={detailTab === "proposals" ? "active" : ""}
                  onClick={() => setDetailTab("proposals")}
                >
                  候选论文
                  {pendingProposals > 0 && <span className="research-tab-badge">{pendingProposals}</span>}
                </button>
              </div>
              {detailTab === "trajectory" && (
                <ResearchTrajectoryPanel
                  researchSessionId={selected.id}
                  refreshKey={eventCount}
                  isRunning={isRunning}
                  canResume={canResume}
                  canFork={canFork}
                  resuming={!!researchBusy}
                  forking={!!researchBusy}
                  onResume={resumeSession}
                  onFork={forkSession}
                />
              )}
              {detailTab === "conversation" && (
                <ResearchConversationTab
                  sessionId={selectedId}
                  turns={turns}
                  sources={sources}
                  steps={steps}
                  isRunning={isRunning}
                  showProcess={showProcess}
                  followUp={followUp}
                  followUpAttachments={followUpAttachments}
                  canFollowUp={canFollowUp}
                  contextRefreshKey={`${turns.length}-${steps.length}-${isRunning}`}
                  onToggleProcess={() => setShowProcess(v => !v)}
                  onOpenUrl={url => void backend.openExternalUrl(url)}
                  onFollowUpChange={setFollowUp}
                  onAddFiles={files => void collectFiles(files, setFollowUpAttachments)}
                  onRemoveAttachment={id => setFollowUpAttachments(current => current.filter(item => item.id !== id))}
                  onSendFollowUp={() => void sendFollowUp()}
                />
              )}
              {detailTab === "proposals" && (
                <ResearchProposalsTab
                  proposals={proposals}
                  researchBusy={!!researchBusy}
                  onApprove={(id, downloadPdf) => void approveProposal(id, downloadPdf)}
                  onReject={id => void rejectProposal(id)}
                  onOpenUrl={url => void backend.openExternalUrl(url)}
                />
              )}
              </div>
            </>
          ) : (
            <div className="research-empty"><p>创建或选择左侧任务。</p></div>
          )}
        </section>
      </div>
    </main>
  );
}

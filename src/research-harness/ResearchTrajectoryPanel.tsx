import { useEffect, useRef, useState } from "react";
import { GitBranch, LoaderCircle, RotateCcw } from "lucide-react";
import { ensureTrajectoryRuntime, resetTrajectoryRuntime, syncTrajectorySession, trajectoryOwnerProps } from "./bootstrap";
import { loadDefaultResumeBoundary, loadDshSnapshot } from "./sessionBridge";
import "./dsh-trajectory-theme.css";

export function ResearchTrajectoryPanel({
  researchSessionId,
  refreshKey,
  isRunning,
  canResume,
  canFork,
  resuming,
  forking,
  onResume,
  onFork,
}: {
  researchSessionId: string;
  refreshKey: number;
  isRunning: boolean;
  canResume: boolean;
  canFork: boolean;
  resuming: boolean;
  forking: boolean;
  onResume: (boundarySeq?: number) => Promise<void>;
  onFork: (boundarySeq?: number) => Promise<void>;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const slotRef = useRef<ReturnType<Awaited<ReturnType<typeof ensureTrajectoryRuntime>>["renderSlot"]> | null>(null);
  const mountedSessionRef = useRef<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [eventCount, setEventCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [boundarySeq, setBoundarySeq] = useState("");
  const [maxSeq, setMaxSeq] = useState(0);
  const [retryKey, setRetryKey] = useState(0);

  // 会话切换 / 显式重试：重建运行时 + 首次 renderSlot
  useEffect(() => {
    let cancelled = false;
    const owner = trajectoryOwnerProps(researchSessionId);

    void (async () => {
      try {
        setLoading(true);
        setError(null);
        resetTrajectoryRuntime();
        slotRef.current = null;
        mountedSessionRef.current = null;

        const snapshot = await loadDshSnapshot(researchSessionId);
        if (cancelled) return;
        const lastSeq = snapshot.events.at(-1)?.seq;
        setMaxSeq(typeof lastSeq === "number" ? lastSeq : 0);
        setEventCount(snapshot.events.length);

        const host = hostRef.current;
        if (!host) return;

        const runtime = await ensureTrajectoryRuntime();
        const count = await syncTrajectorySession(researchSessionId, snapshot.events);
        if (cancelled) return;

        slotRef.current = runtime.renderSlot("conversation.view", owner, host);
        mountedSessionRef.current = researchSessionId;
        setEventCount(count);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [researchSessionId, retryKey]);

  // 调研进行中 eventCount 刷新：只增量同步，禁止 reset 运行时
  useEffect(() => {
    if (mountedSessionRef.current !== researchSessionId || !slotRef.current) return;

    let cancelled = false;
    const owner = trajectoryOwnerProps(researchSessionId);

    void (async () => {
      try {
        const snapshot = await loadDshSnapshot(researchSessionId);
        if (cancelled) return;
        const lastSeq = snapshot.events.at(-1)?.seq;
        setMaxSeq(typeof lastSeq === "number" ? lastSeq : 0);
        const count = await syncTrajectorySession(researchSessionId, snapshot.events);
        if (cancelled) return;
        slotRef.current?.update(owner);
        setEventCount(count);
        setError(null);
      } catch (e) {
        if (!cancelled && !isRunning) {
          setError(e instanceof Error ? e.message : String(e));
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [researchSessionId, refreshKey, isRunning]);

  useEffect(() => {
    if (!canResume && !canFork) return;
    void loadDefaultResumeBoundary(researchSessionId)
      .then(seq => setBoundarySeq(String(seq)))
      .catch(() => setBoundarySeq(""));
  }, [canResume, canFork, researchSessionId, refreshKey]);

  const parsedBoundary = boundarySeq.trim() ? Number(boundarySeq) : undefined;
  const boundaryInvalid =
    boundarySeq.trim() !== "" && (!Number.isFinite(parsedBoundary) || (parsedBoundary ?? 0) < 1);

  return (
    <div className="research-trajectory-shell">
      {!error && (
        <div className="research-trajectory-meta" aria-live="polite">
          {loading ? "同步 DSH 事件…" : `DSH 事件 ${eventCount}${maxSeq ? ` · 最大 seq ${maxSeq}` : ""}`}
        </div>
      )}
      <div
        ref={hostRef}
        className="research-trajectory-slot"
        hidden={!!error}
        style={canResume || canFork ? { ["--dsh-trajectory-bottom-clearance" as string]: "64px" } : undefined}
      />
      {error && (
        <p className="inline-notice research-trajectory-error">
          轨迹视图加载失败：{error}
          <button type="button" className="secondary" onClick={() => setRetryKey(k => k + 1)}>
            重试
          </button>
        </p>
      )}
      {(canResume || canFork) && eventCount > 0 && (
        <div className="research-trajectory-resume-bar">
          <div className="research-resume-field">
            <span className="research-resume-label">恢复边界</span>
            <span className="research-resume-hint">事件序号（seq）</span>
            <div className="research-resume-input-wrap">
              <input
                type="number"
                className="research-resume-input"
                min={1}
                max={maxSeq || undefined}
                value={boundarySeq}
                onChange={e => setBoundarySeq(e.target.value)}
                placeholder="自动"
                aria-label="恢复边界 seq"
              />
              {maxSeq > 0 && <span className="research-resume-max">/ {maxSeq}</span>}
            </div>
          </div>
          <div className="research-resume-actions">
            {canFork && (
              <button
                type="button"
                className="secondary"
                disabled={forking || resuming || boundaryInvalid}
                onClick={() => void onFork(parsedBoundary)}
              >
                {forking ? <LoaderCircle className="spin" size={14} /> : <GitBranch size={14} />}
                分叉为新任务
              </button>
            )}
            {canResume && (
              <button
                type="button"
                className="primary"
                disabled={resuming || forking || boundaryInvalid}
                onClick={() => void onResume(parsedBoundary)}
              >
                {resuming ? <LoaderCircle className="spin" size={14} /> : <RotateCcw size={14} />}
                从此处恢复
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

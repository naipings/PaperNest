import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { X } from "lucide-react";
import { backend } from "../../services/backend";
import type { ResearchContextUsage } from "../../types";
import { ResearchContextRing } from "./ResearchContextRing";

export const BUCKET_COLORS: Record<string, string> = {
  system: "var(--ctx-system, var(--accent))",
  tools: "var(--ctx-tools, var(--sky))",
  compacted: "var(--ctx-compacted, #a855f7)",
  conversation: "var(--ctx-conversation, var(--brand))",
  draft: "var(--ctx-draft, var(--muted))",
};

function formatTokenK(tokens: number) {
  if (tokens >= 1000) return `${(tokens / 1000).toFixed(tokens >= 10000 ? 0 : 1)}K`;
  return String(tokens);
}

type Options = {
  sessionId?: string;
  enabled: boolean;
  draftQuestion: string;
  draftAttachmentChars: number;
  refreshKey?: string | number;
};

export function useResearchContextUsage({
  sessionId,
  enabled,
  draftQuestion,
  draftAttachmentChars,
  refreshKey,
}: Options) {
  const [usage, setUsage] = useState<ResearchContextUsage | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const debounceRef = useRef<number>();

  const load = useCallback(async () => {
    if (!sessionId || !enabled) {
      setUsage(null);
      return;
    }
    try {
      const result = await backend.researchContextUsage({
        id: sessionId,
        draftQuestion: draftQuestion.trim() || undefined,
        draftAttachmentChars: draftAttachmentChars || undefined,
      });
      setUsage(result);
    } catch {
      setUsage(null);
    }
  }, [sessionId, enabled, draftQuestion, draftAttachmentChars]);

  useEffect(() => {
    window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => {
      void load();
    }, 300);
    return () => window.clearTimeout(debounceRef.current);
  }, [load, refreshKey]);

  if (!enabled || !usage) {
    return { ring: null as ReactNode, panel: null as ReactNode };
  }

  const activeBuckets = usage.buckets.filter(bucket => bucket.tokens > 0);

  const panel = panelOpen ? (
    <div className="research-context-panel" role="dialog" aria-label="上下文用量">
      <header className="research-context-panel-header">
        <span>上下文用量</span>
        <button type="button" className="ghost icon-button" aria-label="关闭" onClick={() => setPanelOpen(false)}>
          <X size={14} />
        </button>
      </header>
      <p className="research-context-panel-summary">
        {Math.round(usage.percentFull)}% · ~{formatTokenK(usage.usedTokens)} / {formatTokenK(usage.contextWindow)} tokens
      </p>
      <div className="research-context-bar" aria-hidden>
        {activeBuckets.map(bucket => (
          <span
            key={bucket.id}
            className="research-context-bar-segment"
            style={{
              flexGrow: bucket.tokens,
              background: BUCKET_COLORS[bucket.id] ?? "var(--muted)",
            }}
          />
        ))}
      </div>
      <ul className="research-context-buckets">
        {usage.buckets.map(bucket => (
          <li key={bucket.id}>
            <span className="research-context-bucket-dot" style={{ background: BUCKET_COLORS[bucket.id] }} />
            <span className="research-context-bucket-label">{bucket.label}</span>
            <span className="research-context-bucket-tokens">{formatTokenK(bucket.tokens)}</span>
          </li>
        ))}
      </ul>
      {usage.nearCompaction && (
        <p className="research-context-warning">接近压缩阈值，发送后将自动摘要旧对话。</p>
      )}
    </div>
  ) : null;

  const ring = (
    <ResearchContextRing
      percent={usage.percentFull}
      nearCompaction={usage.nearCompaction}
      title="上下文用量"
      onClick={() => setPanelOpen(open => !open)}
    />
  );

  return { ring, panel };
}

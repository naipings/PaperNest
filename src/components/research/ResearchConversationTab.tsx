import { FileText, Image, Link2, LoaderCircle } from "lucide-react";
import { ResearchComposer } from "./ResearchComposer";
import { ResearchMarkdown } from "./ResearchMarkdown";
import type { AttachmentDraft } from "../../lib/researchAttachments";
import type { ResearchAttachment, ResearchSource, ResearchStepSummary, ResearchTurnView } from "../../types";

const TURN_STATUS: Record<string, string> = {
  draft: "待运行",
  running: "进行中",
  completed: "已完成",
  failed: "失败",
  cancelled: "已停止",
};

type Props = {
  turns: ResearchTurnView[];
  sources: ResearchSource[];
  steps: ResearchStepSummary[];
  isRunning: boolean;
  showProcess: boolean;
  followUp: string;
  followUpAttachments: AttachmentDraft[];
  canFollowUp: boolean;
  onToggleProcess: () => void;
  onOpenUrl: (url: string) => void;
  onFollowUpChange: (value: string) => void;
  onAddFiles: (files: File[]) => void;
  onRemoveAttachment: (id: string) => void;
  onSendFollowUp: () => void;
};

function AttachmentChips({ items }: { items: ResearchAttachment[] }) {
  if (!items.length) return null;
  return (
    <div className="research-chip-row research-chip-row--readonly">
      {items.map(item => (
        <span key={`${item.kind}-${item.name}`} className={`research-chip research-chip--${item.kind}`} title={item.url ?? item.name}>
          {item.kind === "image" ? <Image size={13} /> : item.kind === "link" ? <Link2 size={13} /> : <FileText size={13} />}
          <span className="research-chip-name">{item.name}</span>
        </span>
      ))}
    </div>
  );
}

export function ResearchConversationTab({
  turns,
  sources,
  steps,
  isRunning,
  showProcess,
  followUp,
  followUpAttachments,
  canFollowUp,
  onToggleProcess,
  onOpenUrl,
  onFollowUpChange,
  onAddFiles,
  onRemoveAttachment,
  onSendFollowUp,
}: Props) {
  return (
    <div className="research-conversation">
      <div className="research-turn-flow">
        {turns.map(turn => (
          <article key={turn.turn} className="research-turn">
            <div className="research-turn-question">
              <header>
                <span className="research-turn-index">第 {turn.turn} 轮</span>
                <span className={`research-turn-status is-${turn.status}`}>{TURN_STATUS[turn.status] ?? turn.status}</span>
              </header>
              <p>{turn.question}</p>
              <AttachmentChips items={turn.attachments} />
            </div>
            {turn.answer.trim() ? (
              <div className="research-turn-answer">
                <ResearchMarkdown text={turn.answer} />
              </div>
            ) : turn.status === "running" ? (
              <p className="muted research-turn-pending">
                <LoaderCircle className="spin" size={14} />
                正在检索并撰写…
              </p>
            ) : turn.status === "draft" ? (
              <p className="muted research-turn-pending">点击「开始调研」运行本轮。</p>
            ) : (
              <p className="muted research-turn-pending">{turn.error ?? "本轮没有产出答复。"}</p>
            )}
          </article>
        ))}
        {!turns.length && <p className="muted">尚无对话记录。</p>}
      </div>

      <ResearchComposer
        value={followUp}
        attachments={followUpAttachments}
        busy={isRunning}
        disabled={!canFollowUp}
        placeholder={canFollowUp ? "继续追问，例如：把冷启动与长尾推荐的关系再展开" : "完成第一轮调研后即可继续追问"}
        submitLabel="继续调研"
        onChange={onFollowUpChange}
        onAddFiles={onAddFiles}
        onRemoveAttachment={onRemoveAttachment}
        onSubmit={onSendFollowUp}
      />

      <button type="button" className="ghost research-process-toggle" onClick={onToggleProcess}>
        {showProcess ? "收起过程与来源" : "查看过程与来源"}
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
                    <button type="button" className="ghost linkish" onClick={() => onOpenUrl(source.url!)}>
                      打开链接
                    </button>
                  )}
                  <p>{source.excerpt}</p>
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
    </div>
  );
}

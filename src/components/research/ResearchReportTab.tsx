import { useEffect, useMemo, useState } from "react";
import { BookOpen, Copy, Check } from "lucide-react";
import { ResearchMarkdown } from "./ResearchMarkdown";
import type { ResearchTurnView } from "../../types";

type Props = {
  turns: ResearchTurnView[];
  focusTurn?: number;
  onOpenConversation?: () => void;
};

function answerTitle(text: string, fallback: string) {
  const heading = text
    .split(/\r?\n/)
    .map(line => line.trim())
    .find(line => line.startsWith("# "));
  if (!heading) return fallback;
  return heading.replace(/^#\s+/, "").trim() || fallback;
}

function previewText(text: string, maxChars = 180) {
  const plain = text
    .replace(/^#+\s+/gm, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[*_`>/]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (plain.length <= maxChars) return plain;
  return `${plain.slice(0, maxChars)}…`;
}

export function ResearchReportTab({ turns, focusTurn, onOpenConversation }: Props) {
  const answered = useMemo(
    () => turns.filter(turn => turn.answer.trim().length > 0),
    [turns],
  );
  const [activeTurn, setActiveTurn] = useState<number>(() => focusTurn ?? answered.at(-1)?.turn ?? 1);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (focusTurn && answered.some(turn => turn.turn === focusTurn)) {
      setActiveTurn(focusTurn);
      return;
    }
    if (!answered.some(turn => turn.turn === activeTurn)) {
      setActiveTurn(answered.at(-1)?.turn ?? 1);
    }
  }, [answered, activeTurn, focusTurn]);

  const current = answered.find(turn => turn.turn === activeTurn) ?? answered.at(-1);
  const title = current
    ? answerTitle(current.answer, `第 ${current.turn} 轮调研报告`)
    : "调研报告";

  const copyReport = async () => {
    if (!current?.answer.trim()) return;
    await navigator.clipboard.writeText(current.answer);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };

  if (!answered.length) {
    return (
      <div className="research-report-empty">
        <BookOpen size={28} />
        <h3>尚未生成报告</h3>
        <p>完成调研写作后，全文会在此以独立阅读页展示；对话页只保留问题与报告入口。</p>
        {onOpenConversation && (
          <button type="button" className="secondary" onClick={onOpenConversation}>
            回到对话
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="research-report-shell">
      <header className="research-report-toolbar">
        <div className="research-report-toolbar-main">
          <span className="research-report-kicker">调研报告</span>
          <h3>{title}</h3>
          <p>
            第 {current!.turn} 轮 · {current!.answer.length.toLocaleString()} 字
            {answered.length > 1 ? ` · 共 ${answered.length} 份答复` : ""}
          </p>
        </div>
        <div className="research-report-toolbar-actions">
          {answered.length > 1 && (
            <label className="research-report-turn-select">
              <span>轮次</span>
              <select
                value={current!.turn}
                onChange={e => setActiveTurn(Number(e.target.value))}
                aria-label="选择报告轮次"
              >
                {answered.map(turn => (
                  <option key={turn.turn} value={turn.turn}>
                    第 {turn.turn} 轮
                  </option>
                ))}
              </select>
            </label>
          )}
          <button type="button" className="secondary" onClick={() => void copyReport()}>
            {copied ? <Check size={14} /> : <Copy size={14} />}
            {copied ? "已复制" : "复制全文"}
          </button>
        </div>
      </header>

      {answered.length > 1 && (
        <div className="research-report-turn-rail" role="tablist" aria-label="报告轮次">
          {answered.map(turn => (
            <button
              key={turn.turn}
              type="button"
              role="tab"
              aria-selected={turn.turn === current!.turn}
              className={turn.turn === current!.turn ? "active" : ""}
              onClick={() => setActiveTurn(turn.turn)}
              title={previewText(turn.answer, 80)}
            >
              <strong>第 {turn.turn} 轮</strong>
              <span>{answerTitle(turn.answer, turn.question.slice(0, 24) || "答复")}</span>
            </button>
          ))}
        </div>
      )}

      <article className="research-report-document" aria-label={title}>
        <ResearchMarkdown text={current!.answer} />
      </article>
    </div>
  );
}

export function reportCardPreview(answer: string) {
  return previewText(answer, 160);
}

export function reportCardTitle(answer: string, turn: number) {
  return answerTitle(answer, `第 ${turn} 轮调研报告`);
}

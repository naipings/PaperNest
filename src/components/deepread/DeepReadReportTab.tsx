import { AlertTriangle, BookOpen } from "lucide-react";
import type { DeepReadDetail } from "../../types";
import { DeepReadMarkdown } from "./DeepReadMarkdown";

export const DEEP_READ_STAGES = [
  { key: "what", label: "What 做了什么" },
  { key: "why", label: "Why 为什么做" },
  { key: "how", label: "How 如何实现" },
  { key: "experiment", label: "Experiment 如何证明" },
  { key: "question", label: "Question 评价与疑问" },
] as const;

export function stageLabel(key: string | null) {
  return DEEP_READ_STAGES.find(stage => stage.key === key)?.label ?? "";
}

export function DeepReadReportTab({ detail }: { detail: DeepReadDetail }) {
  const { task, report, stagesDone } = detail;
  const active = task.status === "running" || task.status === "queued";
  return (
    <div className="research-report-shell deepread-report">
      <ol className="deepread-stages" aria-label="生成进度">
        {DEEP_READ_STAGES.map(stage => {
          const state = stagesDone.includes(stage.key) ? "done" : active && task.stage === stage.key ? "active" : "pending";
          return <li key={stage.key} className={state}>{stage.label}</li>;
        })}
      </ol>
      {task.validation.length > 0 && (
        <div className="deepread-validation" role="status">
          <AlertTriangle size={16} />
          <div>
            <strong>报告校验发现 {task.validation.length} 个问题</strong>
            <ul>{task.validation.map(problem => <li key={problem}>{problem}</li>)}</ul>
          </div>
        </div>
      )}
      {report.trim() ? (
        <article className="research-report-document" aria-label={task.title}>
          <DeepReadMarkdown text={report} />
        </article>
      ) : (
        <div className="research-report-empty">
          <BookOpen size={28} />
          <h3>{active ? "正在生成报告" : "尚未生成报告"}</h3>
          <p>五个阶段依次生成；已完成的阶段会保存，停止或失败后可「继续生成」。</p>
        </div>
      )}
    </div>
  );
}

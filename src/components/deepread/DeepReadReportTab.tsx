import { AlertTriangle, BookOpen } from "lucide-react";
import type { DeepReadDetail } from "../../types";
import { DeepReadMarkdown } from "./DeepReadMarkdown";

export const DEEP_READ_STAGES = [
  { key: "figures", label: "图表提取" },
  { key: "visuals", label: "看图预读" },
  { key: "visual_plan", label: "选图计划" },
  { key: "what", label: "What 做了什么" },
  { key: "why", label: "Why 为什么做" },
  { key: "how", label: "How 如何实现" },
  { key: "experiment", label: "Experiment 如何证明" },
  { key: "question", label: "Question 评价与疑问" },
] as const;

/** 看图预读阶段的 stage 形如 `visuals:3/12`。 */
export function stageLabel(stage: string | null) {
  const [key, progress] = (stage ?? "").split(":");
  const label = DEEP_READ_STAGES.find(item => item.key === key)?.label ?? "";
  return progress ? `${label} ${progress}` : label;
}

export function DeepReadReportTab({ detail, onEvidence, onFigure }: { detail: DeepReadDetail; onEvidence?(segment: string): void; onFigure?(src: string): void }) {
  const { task, report, stagesDone } = detail;
  const active = task.status === "running" || task.status === "queued";
  const runningKey = task.stage?.split(":")[0];
  return (
    <div className="research-report-shell deepread-report">
      <ol className="deepread-stages" aria-label="生成进度">
        {DEEP_READ_STAGES.map(stage => {
          const state = stagesDone.includes(stage.key) ? "done" : active && runningKey === stage.key ? "active" : "pending";
          return <li key={stage.key} className={state}>{state === "active" ? stageLabel(task.stage) : stage.label}</li>;
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
          <DeepReadMarkdown text={report} taskId={task.id} onEvidence={onEvidence} onFigure={onFigure} />
        </article>
      ) : (
        <div className="research-report-empty">
          <BookOpen size={28} />
          <h3>{active ? "正在生成报告" : "尚未生成报告"}</h3>
          <p>先提取图表并逐张看图预读，再形成选图计划，然后依次生成五节正文；已完成的步骤会保存，停止或失败后可「继续生成」。</p>
        </div>
      )}
    </div>
  );
}

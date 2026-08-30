import { Trash2 } from "lucide-react";
import type { ResearchSession } from "../../types";

const STATUS_LABEL: Record<string, string> = {
  draft: "草稿",
  running: "运行中",
  completed: "已完成",
  failed: "失败",
  cancelled: "已取消",
};

const STATUS_CLASS: Record<string, string> = {
  draft: "status-draft",
  running: "status-running",
  completed: "status-completed",
  failed: "status-failed",
  cancelled: "status-cancelled",
};

function formatSessionTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso.slice(0, 16).replace("T", " ");
  return date.toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

type Props = {
  sessions: ResearchSession[];
  selectedId?: string;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
};

export function ResearchSessionList({ sessions, selectedId, onSelect, onDelete }: Props) {
  return (
    <section className="research-history" aria-labelledby="research-history-heading">
      <h3 id="research-history-heading">历史任务</h3>
      <ul className="research-session-list">
        {sessions.map(item => (
          <li key={item.id}>
            <button
              type="button"
              className={`research-session-item${selectedId === item.id ? " active" : ""}`}
              onClick={() => onSelect(item.id)}
            >
              <span className="research-session-item-top">
                <strong>{item.title}</strong>
                <span className={`research-session-status ${STATUS_CLASS[item.status] ?? ""}`}>
                  {STATUS_LABEL[item.status] ?? item.status}
                </span>
              </span>
              <small>{formatSessionTime(item.updatedAt)}</small>
            </button>
            <button
              type="button"
              className="ghost icon-only research-session-delete"
              title="删除"
              onClick={() => onDelete(item.id)}
            >
              <Trash2 size={14} />
            </button>
          </li>
        ))}
        {!sessions.length && <li className="research-session-empty">暂无任务，在上方创建第一个调研。</li>}
      </ul>
    </section>
  );
}

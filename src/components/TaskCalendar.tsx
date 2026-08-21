import { CalendarDays, CheckCircle2, ChevronLeft, ChevronRight, CircleAlert, Clock3, Plus, Trash2 } from "lucide-react";
import { useMemo, useRef, useState, type MouseEvent } from "react";
import { Modal } from "./Modal";
import { ReadingHeatmap } from "./ReadingHeatmap";
import { useLibrary } from "../state/LibraryContext";
import { partitionTasks } from "../lib/taskBuckets";
import type { Task, TaskPriority, TaskStatus } from "../types";

const statusLabel: Record<TaskStatus, string> = { todo: "待处理", in_progress: "进行中", done: "已完成" };
const priorityLabel: Record<TaskPriority, string> = { low: "低", medium: "中", high: "高" };
const isoDate = (date: Date) => date.getFullYear() + "-" + String(date.getMonth() + 1).padStart(2, "0") + "-" + String(date.getDate()).padStart(2, "0");
const dateLabel = (date?: string) => date ? new Intl.DateTimeFormat("zh-CN", { month: "long", day: "numeric", weekday: "short" }).format(new Date(date + "T12:00:00")) : "未安排日期";

function TaskForm({ task, defaultDate, onClose }: { task?: Task; defaultDate?: string; onClose(): void }) {
  const { data, saveTask } = useLibrary();
  const [title, setTitle] = useState(task?.title ?? "");
  const [notes, setNotes] = useState(task?.notes ?? "");
  const [dueDate, setDueDate] = useState(task?.dueDate ?? defaultDate ?? "");
  const [status, setStatus] = useState<TaskStatus>(task?.status ?? "todo");
  const [priority, setPriority] = useState<TaskPriority>(task?.priority ?? "medium");
  const [paperId, setPaperId] = useState(task?.paperId ?? "");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!title.trim()) return;
    const timestamp = new Date().toISOString();
    setBusy(true);
    try {
      await saveTask({
        id: task?.id ?? crypto.randomUUID(),
        title: title.trim(),
        notes: notes.trim() || undefined,
        dueDate: dueDate || undefined,
        status,
        priority,
        paperId: paperId || undefined,
        createdAt: task?.createdAt ?? timestamp,
        updatedAt: timestamp,
        completedAt: status === "done" ? task?.completedAt ?? timestamp : undefined
      });
      onClose();
    } catch (error) { setNotice(`保存任务失败：${error instanceof Error ? error.message : String(error)}`); }
    finally { setBusy(false); }
  };
  return <form className="task-editor" onSubmit={submit}>
    <label>任务名称<input autoFocus value={title} onChange={event => setTitle(event.target.value)} placeholder="例如：精读方法部分" /></label>
    <label>备注<textarea rows={3} value={notes} onChange={event => setNotes(event.target.value)} placeholder="可选：记录下一步或阅读目标" /></label>
    <div className="form-grid three">
      <label>截止日期<input type="date" value={dueDate} onChange={event => setDueDate(event.target.value)} /></label>
      <label>状态<select value={status} onChange={event => setStatus(event.target.value as TaskStatus)}>{Object.entries(statusLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label>优先级<select value={priority} onChange={event => setPriority(event.target.value as TaskPriority)}>{Object.entries(priorityLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
    </div>
    <label>关联论文<select value={paperId} onChange={event => setPaperId(event.target.value)}><option value="">不关联论文</option>{data?.papers.filter(paper => !paper.deletedAt).map(paper => <option key={paper.id} value={paper.id}>{paper.titleZh || paper.titleEn}</option>)}</select></label>
    {notice && <p className="inline-notice" role="alert">{notice}</p>}
    <footer><button type="button" className="secondary" disabled={busy} onClick={onClose}>取消</button><button className="primary" type="submit" disabled={busy}>{busy ? "正在保存…" : "保存任务"}</button></footer>
  </form>;
}

function TaskRow({
  task,
  meta,
  onToggle,
  onEdit,
  onDelete,
  onShowTip,
  onHideTip
}: {
  task: Task;
  meta: string;
  onToggle(): void;
  onEdit(): void;
  onDelete(): void;
  onShowTip(event: MouseEvent<HTMLElement>, text: string): void;
  onHideTip(): void;
}) {
  return <article className={"task-row " + (task.status === "done" ? "done" : "")}>
    <button className="task-check" aria-label={task.status === "done" ? "恢复任务" : "完成任务"} onClick={onToggle}>{task.status === "done" ? "✓" : ""}</button>
    <button className="task-main" onDoubleClick={onEdit} onMouseEnter={event => onShowTip(event, task.title + "\n" + meta)} onMouseLeave={onHideTip}>
      <strong>{task.title}</strong>
      <span>{meta}</span>
    </button>
    <i className={"priority-dot " + task.priority} title={priorityLabel[task.priority] + "优先级"} />
    <button className="task-delete" title="删除任务" onClick={onDelete}><Trash2 size={14} /></button>
  </article>;
}

export function TaskCalendar() {
  const { data, saveTask, deleteTask } = useLibrary();
  const [month, setMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [editing, setEditing] = useState<Task>();
  const [newDate, setNewDate] = useState<string>();
  const [bucket, setBucket] = useState<"overdue" | "done">();
  const [notice, setNotice] = useState("");
  const today = isoDate(new Date());
  const tasks = data?.tasks ?? [];
  const dates = useMemo(() => {
    const start = new Date(month.getFullYear(), month.getMonth(), 1);
    start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
    return Array.from({ length: 42 }, (_, index) => {
      const value = new Date(start);
      value.setDate(start.getDate() + index);
      return value;
    });
  }, [month]);
  const buckets = useMemo(() => partitionTasks(tasks, today), [tasks, today]);
  const bucketTasks = bucket === "overdue" ? buckets.overdue : bucket === "done" ? buckets.done : [];
  const toggle = async (task: Task) => {
    const done = task.status !== "done";
    const timestamp = new Date().toISOString();
    try {
      await saveTask({ ...task, status: done ? "done" : "todo", completedAt: done ? timestamp : undefined, updatedAt: timestamp });
    } catch (error) {
      setNotice(`更新任务状态失败：${error instanceof Error ? error.message : String(error)}`);
    }
  };
  const remove = async (id: string) => {
    try {
      await deleteTask(id);
    } catch (error) {
      setNotice(`删除任务失败：${error instanceof Error ? error.message : String(error)}`);
    }
  };
  const paperTitle = (paperId?: string) => {
    const paper = data?.papers.find(item => item.id === paperId);
    return paper?.titleZh || paper?.titleEn;
  };
  const taskMeta = (task: Task) => dateLabel(task.dueDate) + " · " + statusLabel[task.status] + (paperTitle(task.paperId) ? " · " + paperTitle(task.paperId) : "");
  const [hoverTip, setHoverTip] = useState<{ text: string; top: number; left: number }>();
  const hoverTimer = useRef<number>(0);
  const showTip = (event: MouseEvent<HTMLElement>, text: string) => {
    const rect = event.currentTarget.getBoundingClientRect();
    window.clearTimeout(hoverTimer.current);
    hoverTimer.current = window.setTimeout(() => setHoverTip({ text, top: rect.bottom + 6, left: rect.left }), 1000);
  };
  const hideTip = () => {
    window.clearTimeout(hoverTimer.current);
    setHoverTip(undefined);
  };
  const openEdit = (task: Task) => {
    hideTip();
    setBucket(undefined);
    setEditing(task);
    setNewDate(undefined);
  };
  return <main className="content-page tasks-page">
    <header className="page-heading">
      <div className="page-title-block">
        <div className="page-title-row"><span className="page-title-icon"><CalendarDays size={18} /></span><h1>任务与日历</h1><span className="page-kicker">研究计划</span></div>
        <p>清单只列今日与未来任务；逾期与已完成可从上方卡片打开。</p>
      </div>
      <div className="page-heading-actions"><button className="primary" onClick={() => { setEditing(undefined); setNewDate(today); }}><Plus size={15} />新建任务</button></div>
    </header>
    {notice && <p className="inline-notice" role="alert">{notice}</p>}
    <section className="task-summary" aria-label="任务概览">
      <article className="task-summary-card">
        <Clock3 size={18} />
        <div><strong>{buckets.todayDue.length}</strong><span>今天待办</span></div>
      </article>
      <button type="button" className={"task-summary-card task-summary-action" + (buckets.overdue.length ? " attention" : "")} onClick={() => setBucket("overdue")}>
        <CircleAlert size={18} />
        <div><strong>{buckets.overdue.length}</strong><span>已逾期</span></div>
      </button>
      <button type="button" className="task-summary-card task-summary-action" onClick={() => setBucket("done")}>
        <CheckCircle2 size={18} />
        <div><strong>{buckets.done.length}</strong><span>已完成</span></div>
      </button>
    </section>
    <div className="task-layout">
      <section className="task-list-panel">
        <header>
          <div><h2>任务清单</h2><small>今日与未来 · 按截止日期排序</small></div>
          <button className="ghost" onClick={() => { setEditing(undefined); setNewDate(today); }}><Plus size={16} /></button>
        </header>
        <div className="task-list">
          {buckets.agenda.length === 0
            ? <div className="task-empty">暂无今日或未来任务。逾期项请点上方「已逾期」查看。</div>
            : buckets.agenda.map(task => (
              <TaskRow
                key={task.id}
                task={task}
                meta={taskMeta(task)}
                onToggle={() => void toggle(task)}
                onEdit={() => openEdit(task)}
                onDelete={() => void remove(task.id)}
                onShowTip={showTip}
                onHideTip={hideTip}
              />
            ))}
        </div>
      </section>
      <section className="calendar-panel">
        <header>
          <button className="icon-button" aria-label="上个月" onClick={() => setMonth(value => new Date(value.getFullYear(), value.getMonth() - 1, 1))}><ChevronLeft size={17} /></button>
          <h2>{month.toLocaleDateString("zh-CN", { year: "numeric", month: "long" })}</h2>
          <button className="icon-button" aria-label="下个月" onClick={() => setMonth(value => new Date(value.getFullYear(), value.getMonth() + 1, 1))}><ChevronRight size={17} /></button>
        </header>
        <div className="calendar-weekdays">{["一", "二", "三", "四", "五", "六", "日"].map(day => <span key={day}>周{day}</span>)}</div>
        <div className="calendar-grid">{dates.map(date => {
          const dateKey = isoDate(date);
          const dayTasks = tasks.filter(task => task.dueDate === dateKey);
          const otherMonth = date.getMonth() !== month.getMonth();
          return <button key={dateKey} className={"calendar-day " + (otherMonth ? "other-month " : "") + (dateKey === today ? "today" : "")} onClick={() => { setEditing(undefined); setNewDate(dateKey); }}>
            <time>{date.getDate()}</time>
            {dayTasks.slice(0, 3).map(task => <span key={task.id} className={"calendar-task " + task.status + " " + task.priority}>{task.title}</span>)}
            {dayTasks.length > 3 && <small>+{dayTasks.length - 3} 项</small>}
          </button>;
        })}</div>
      </section>
    </div>
    {(editing || newDate) && <Modal title={editing ? "编辑任务" : "新建任务"} onClose={() => { setEditing(undefined); setNewDate(undefined); }}><TaskForm task={editing} defaultDate={newDate} onClose={() => { setEditing(undefined); setNewDate(undefined); }} /></Modal>}
    {bucket && <Modal title={bucket === "overdue" ? "已逾期任务" : "已完成任务"} onClose={() => setBucket(undefined)}>
      <div className="task-bucket-panel">
        {bucketTasks.length === 0
          ? <div className="task-empty">{bucket === "overdue" ? "当前没有逾期任务。" : "还没有已完成的任务。"}</div>
          : <div className="task-bucket-list">{bucketTasks.map(task => (
            <TaskRow
              key={task.id}
              task={task}
              meta={taskMeta(task)}
              onToggle={() => void toggle(task)}
              onEdit={() => openEdit(task)}
              onDelete={() => void remove(task.id)}
              onShowTip={showTip}
              onHideTip={hideTip}
            />
          ))}</div>}
      </div>
    </Modal>}
    {hoverTip && <div className="task-hover-tip" role="tooltip" style={{ top: hoverTip.top, left: hoverTip.left }}>{hoverTip.text}</div>}
    <ReadingHeatmap />
  </main>;
}

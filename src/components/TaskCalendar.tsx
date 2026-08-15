import { CalendarDays, ChevronLeft, ChevronRight, Circle, Clock3, Plus, Trash2 } from "lucide-react";
import { useMemo, useRef, useState, type MouseEvent } from "react";
import { Modal } from "./Modal";
import { useLibrary } from "../state/LibraryContext";
import type { Task, TaskPriority, TaskStatus } from "../types";

const statusLabel: Record<TaskStatus, string> = { todo: "待处理", in_progress: "进行中", done: "已完成" };
const priorityLabel: Record<TaskPriority, string> = { low: "低", medium: "中", high: "高" };
const isoDate = (date: Date) => date.getFullYear() + "-" + String(date.getMonth() + 1).padStart(2, "0") + "-" + String(date.getDate()).padStart(2, "0");
const dateLabel = (date?: string) => date ? new Intl.DateTimeFormat("zh-CN", { month: "long", day: "numeric", weekday: "short" }).format(new Date(date + "T12:00:00")) : "未安排日期";

function TaskForm({ task, defaultDate, onClose }: { task?: Task; defaultDate?: string; onClose(): void }) {
  const { data, saveTask } = useLibrary();
  const [title, setTitle] = useState(task?.title ?? ""); const [notes, setNotes] = useState(task?.notes ?? "");
  const [dueDate, setDueDate] = useState(task?.dueDate ?? defaultDate ?? ""); const [status, setStatus] = useState<TaskStatus>(task?.status ?? "todo");
  const [priority, setPriority] = useState<TaskPriority>(task?.priority ?? "medium"); const [paperId, setPaperId] = useState(task?.paperId ?? "");
  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); if (!title.trim()) return; const timestamp = new Date().toISOString();
    await saveTask({ id: task?.id ?? crypto.randomUUID(), title: title.trim(), notes: notes.trim() || undefined, dueDate: dueDate || undefined, status, priority, paperId: paperId || undefined, createdAt: task?.createdAt ?? timestamp, updatedAt: timestamp, completedAt: status === "done" ? task?.completedAt ?? timestamp : undefined });
    onClose();
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
    <footer><button type="button" className="secondary" onClick={onClose}>取消</button><button className="primary" type="submit">保存任务</button></footer>
  </form>;
}

export function TaskCalendar() {
  const { data, saveTask, deleteTask } = useLibrary(); const [month, setMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [editing, setEditing] = useState<Task>(); const [newDate, setNewDate] = useState<string>(); const today = isoDate(new Date()); const tasks = data?.tasks ?? [];
  const dates = useMemo(() => { const start = new Date(month.getFullYear(), month.getMonth(), 1); start.setDate(start.getDate() - ((start.getDay() + 6) % 7)); return Array.from({ length: 42 }, (_, index) => { const value = new Date(start); value.setDate(start.getDate() + index); return value; }); }, [month]);
  const visible = tasks.filter(task => task.status !== "done"); const todayTasks = visible.filter(task => task.dueDate === today); const overdue = visible.filter(task => task.dueDate && task.dueDate < today);
  const toggle = async (task: Task) => { const done = task.status !== "done"; const timestamp = new Date().toISOString(); await saveTask({ ...task, status: done ? "done" : "todo", completedAt: done ? timestamp : undefined, updatedAt: timestamp }); };
  const paperTitle = (paperId?: string) => { const paper = data?.papers.find(item => item.id === paperId); return paper?.titleZh || paper?.titleEn; };
  const [hoverTip, setHoverTip] = useState<{ text: string; top: number; left: number }>();
  const hoverTimer = useRef<number>(0);
  const showTip = (event: MouseEvent<HTMLElement>, text: string) => {
    const rect = event.currentTarget.getBoundingClientRect();
    window.clearTimeout(hoverTimer.current);
    hoverTimer.current = window.setTimeout(() => setHoverTip({ text, top: rect.bottom + 6, left: rect.left }), 1000);
  };
  const hideTip = () => { window.clearTimeout(hoverTimer.current); setHoverTip(undefined); };
  return <main className="content-page tasks-page">
    <header className="page-heading"><div><span className="eyebrow"><CalendarDays size={15} />RESEARCH PLANNING</span><h1>任务与日历</h1><p>本地保存任务、截止日期和论文关联；账户同步接入前不会上传任何内容。</p></div><button className="primary" onClick={() => { setEditing(undefined); setNewDate(today); }}><Plus size={15} />新建任务</button></header>
    <section className="task-summary"><article><Clock3 size={18} /><div><strong>{todayTasks.length}</strong><span>今天待办</span></div></article><article className={overdue.length ? "attention" : ""}><Circle size={18} /><div><strong>{overdue.length}</strong><span>已逾期</span></div></article><article><CalendarDays size={18} /><div><strong>{visible.length}</strong><span>未完成任务</span></div></article></section>
    <div className="task-layout">
      <section className="task-list-panel"><header><div><h2>任务清单</h2><small>按截止日期排序</small></div><button className="ghost" onClick={() => { setEditing(undefined); setNewDate(today); }}><Plus size={16} /></button></header>
        <div className="task-list">{tasks.length === 0 ? <div className="task-empty">还没有任务。可从阅读计划开始。</div> : tasks.map(task => {
          const meta = dateLabel(task.dueDate) + " · " + statusLabel[task.status] + (paperTitle(task.paperId) ? " · " + paperTitle(task.paperId) : "");
          return <article className={"task-row " + (task.status === "done" ? "done" : "")} key={task.id}>
          <button className="task-check" aria-label={task.status === "done" ? "恢复任务" : "完成任务"} onClick={() => void toggle(task)}>{task.status === "done" ? "✓" : ""}</button>
          <button className="task-main" onDoubleClick={() => { hideTip(); setEditing(task); }} onMouseEnter={event => showTip(event, task.title + "\n" + meta)} onMouseLeave={hideTip}><strong>{task.title}</strong><span>{meta}</span></button>
          <i className={"priority-dot " + task.priority} title={priorityLabel[task.priority] + "优先级"} /><button className="task-delete" title="删除任务" onClick={() => void deleteTask(task.id)}><Trash2 size={14} /></button>
        </article>; })}</div>
      </section>
      <section className="calendar-panel"><header><button className="icon-button" aria-label="上个月" onClick={() => setMonth(value => new Date(value.getFullYear(), value.getMonth() - 1, 1))}><ChevronLeft size={17} /></button><h2>{month.toLocaleDateString("zh-CN", { year: "numeric", month: "long" })}</h2><button className="icon-button" aria-label="下个月" onClick={() => setMonth(value => new Date(value.getFullYear(), value.getMonth() + 1, 1))}><ChevronRight size={17} /></button></header>
        <div className="calendar-weekdays">{["一", "二", "三", "四", "五", "六", "日"].map(day => <span key={day}>周{day}</span>)}</div>
        <div className="calendar-grid">{dates.map(date => { const dateKey = isoDate(date); const dayTasks = tasks.filter(task => task.dueDate === dateKey); const otherMonth = date.getMonth() !== month.getMonth(); return <button key={dateKey} className={"calendar-day " + (otherMonth ? "other-month " : "") + (dateKey === today ? "today" : "")} onClick={() => { setEditing(undefined); setNewDate(dateKey); }}><time>{date.getDate()}</time>{dayTasks.slice(0, 3).map(task => <span key={task.id} className={"calendar-task " + task.status + " " + task.priority}>{task.title}</span>)}{dayTasks.length > 3 && <small>+{dayTasks.length - 3} 项</small>}</button>; })}</div>
      </section>
    </div>
    {(editing || newDate) && <Modal title={editing ? "编辑任务" : "新建任务"} onClose={() => { setEditing(undefined); setNewDate(undefined); }}><TaskForm task={editing} defaultDate={newDate} onClose={() => { setEditing(undefined); setNewDate(undefined); }} /></Modal>}
    {hoverTip && <div className="task-hover-tip" role="tooltip" style={{ top: hoverTip.top, left: hoverTip.left }}>{hoverTip.text}</div>}
  </main>;
}


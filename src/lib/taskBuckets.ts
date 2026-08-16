import type { Task } from "../types";

/** 今天待办 / 已逾期 / 清单（今日+未来）/ 已完成 */
export function partitionTasks(tasks: Task[], today: string) {
  const open = tasks.filter(task => task.status !== "done");
  const done = tasks.filter(task => task.status === "done")
    .slice()
    .sort((left, right) => (right.completedAt ?? right.updatedAt).localeCompare(left.completedAt ?? left.updatedAt));
  const overdue = open
    .filter(task => Boolean(task.dueDate && task.dueDate < today))
    .sort((left, right) => (left.dueDate ?? "").localeCompare(right.dueDate ?? ""));
  const todayDue = open.filter(task => task.dueDate === today);
  const agenda = open
    .filter(task => !task.dueDate || task.dueDate >= today)
    .sort((left, right) => {
      if (!left.dueDate && right.dueDate) return 1;
      if (left.dueDate && !right.dueDate) return -1;
      return (left.dueDate ?? "").localeCompare(right.dueDate ?? "") || left.title.localeCompare(right.title, "zh-CN");
    });
  return { todayDue, overdue, agenda, done };
}

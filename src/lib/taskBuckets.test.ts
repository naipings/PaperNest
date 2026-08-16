import { describe, expect, it } from "vitest";
import { partitionTasks } from "./taskBuckets";
import type { Task } from "../types";

const task = (partial: Partial<Task> & Pick<Task, "id" | "title" | "status">): Task => ({
  priority: "medium",
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-01T00:00:00.000Z",
  ...partial
});

describe("partitionTasks", () => {
  const today = "2026-08-16";
  const sample = [
    task({ id: "1", title: "逾期", status: "todo", dueDate: "2026-08-15" }),
    task({ id: "2", title: "今天", status: "todo", dueDate: "2026-08-16" }),
    task({ id: "3", title: "未来", status: "in_progress", dueDate: "2026-08-20" }),
    task({ id: "4", title: "无日期", status: "todo" }),
    task({ id: "5", title: "完成", status: "done", dueDate: "2026-08-10", completedAt: "2026-08-12T00:00:00.000Z" })
  ];

  it("keeps overdue and done out of the agenda list", () => {
    const buckets = partitionTasks(sample, today);
    expect(buckets.overdue.map(item => item.id)).toEqual(["1"]);
    expect(buckets.todayDue.map(item => item.id)).toEqual(["2"]);
    expect(buckets.agenda.map(item => item.id)).toEqual(["2", "3", "4"]);
    expect(buckets.done.map(item => item.id)).toEqual(["5"]);
  });
});

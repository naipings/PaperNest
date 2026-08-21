import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TaskCalendar } from "./TaskCalendar";
import { backend } from "../services/backend";
import { LibraryProvider } from "../state/LibraryContext";
import type { Task } from "../types";

function sampleTask(): Task {
  const today = new Date();
  const dueDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  return { id: "task-1", title: "精读方法部分", dueDate, status: "todo", priority: "medium", createdAt: "2026-08-20T00:00:00.000Z", updatedAt: "2026-08-20T00:00:00.000Z" };
}

describe("task saving", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    backend.resetPreview();
  });

  it("keeps the task form open and shows a save error", async () => {
    vi.spyOn(backend, "saveTask").mockRejectedValue(new Error("数据库不可写"));
    render(<LibraryProvider><TaskCalendar /></LibraryProvider>);

    fireEvent.click(await screen.findByRole("button", { name: "新建任务" }));
    fireEvent.change(screen.getByLabelText("任务名称"), { target: { value: "精读方法部分" } });
    fireEvent.click(screen.getByRole("button", { name: "保存任务" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("保存任务失败：数据库不可写");
    expect(screen.getByLabelText("任务名称")).toHaveValue("精读方法部分");
  });

  it("shows an error and keeps the task open when status saving fails", async () => {
    await backend.saveTask(sampleTask());
    vi.spyOn(backend, "saveTask").mockRejectedValue(new Error("数据库不可写"));
    render(<LibraryProvider><TaskCalendar /></LibraryProvider>);

    fireEvent.click(await screen.findByRole("button", { name: "完成任务" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("更新任务状态失败：数据库不可写");
    expect(screen.getByRole("button", { name: "完成任务" })).toBeInTheDocument();
  });

  it("shows an error and keeps the task open when deletion fails", async () => {
    await backend.saveTask(sampleTask());
    vi.spyOn(backend, "deleteTask").mockRejectedValue(new Error("数据库不可写"));
    render(<LibraryProvider><TaskCalendar /></LibraryProvider>);

    fireEvent.click(await screen.findByTitle("删除任务"));

    expect(await screen.findByRole("alert")).toHaveTextContent("删除任务失败：数据库不可写");
    expect(screen.getAllByText("精读方法部分").length).toBeGreaterThan(0);
  });
});

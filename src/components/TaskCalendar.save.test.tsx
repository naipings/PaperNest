import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TaskCalendar } from "./TaskCalendar";
import { backend } from "../services/backend";
import { LibraryProvider } from "../state/LibraryContext";

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
});

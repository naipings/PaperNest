import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { DeepRead, DeepReadDetail } from "../types";

const { get, list } = vi.hoisted(() => ({ get: vi.fn(), list: vi.fn() }));
vi.mock("../services/backend", () => ({ isTauri: () => true, backend: {
  deepreadList: list, deepreadGet: get,
  researchGetSettings: async () => ({ enabled: true, apiKeySaved: true }),
} }));
vi.mock("../state/LibraryContext", () => ({ useLibrary: () => ({ data: { papers: [], folders: [] }, refresh: vi.fn() }) }));
vi.mock("./LlmTopbar", () => ({ fillFromPdf: vi.fn(), importPorts: {} }));
vi.mock("../lib/pdfParagraphs", () => ({ extractPdfParagraphs: vi.fn() }));
vi.mock("../lib/researchAttachments", () => ({ toBase64: vi.fn() }));
vi.mock("./deepread/DeepReadCompare", () => ({ DeepReadCompare: () => null }));
import { DeepReadView } from "./DeepReadView";

const task = (id: string): DeepRead => ({
  id, paperId: null, sourceKind: "external", title: `论文 ${id}`, sourceName: `${id}.pdf`,
  workspacePath: id, status: "completed", stage: null, error: null, validation: [], model: null,
  createdAt: "2026-10-15T01:00:00Z", updatedAt: "2026-10-15T01:00:00Z",
});
const detail = (id: string): DeepReadDetail => ({ task: task(id), report: `报告正文 ${id}`, messages: [], stagesDone: [], figures: [], paragraphs: [] });

describe("精读任务切换", () => {
  it("较慢的旧请求返回后仍显示新选任务", async () => {
    let resolveA!: (value: DeepReadDetail) => void;
    list.mockResolvedValue([task("A"), task("B")]);
    get.mockImplementation((id: string) => id === "A" ? new Promise(resolve => { resolveA = resolve; }) : Promise.resolve(detail("B")));
    render(<DeepReadView onOpenPaper={() => undefined} />);
    fireEvent.click(await screen.findByRole("button", { name: /论文 B 已完成/ }));
    expect(await screen.findByText("报告正文 B")).toBeInTheDocument();
    await act(async () => resolveA(detail("A")));
    expect(screen.getByText("报告正文 B")).toBeInTheDocument();
    expect(screen.queryByText("报告正文 A")).not.toBeInTheDocument();
  });

  it("closes the report actions menu with Escape or an outside click", async () => {
    list.mockResolvedValue([task("A")]);
    get.mockResolvedValue(detail("A"));
    render(<DeepReadView onOpenPaper={() => undefined} />);
    await screen.findByText("报告正文 A");
    const trigger = screen.getByRole("button", { name: "更多操作" });
    fireEvent.click(trigger);
    expect(screen.getByRole("menuitem", { name: "打开文件夹" })).toHaveFocus();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    fireEvent.click(trigger);
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });
});

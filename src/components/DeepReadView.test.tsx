import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { DeepRead, DeepReadDetail } from "../types";

const { get, list, remove } = vi.hoisted(() => ({ get: vi.fn(), list: vi.fn(), remove: vi.fn() }));
vi.mock("../services/backend", () => ({ isTauri: () => true, backend: {
  deepreadList: list, deepreadGet: get,
  deepreadDelete: remove,
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
  it("requires both confirmations before deleting and allows cancellation at either step", async () => {
    list.mockResolvedValue([task("A")]);
    get.mockResolvedValue(detail("A"));
    remove.mockReset().mockResolvedValue(undefined);
    render(<DeepReadView onOpenPaper={() => undefined} />);
    await screen.findByText("报告正文 A");
    fireEvent.click(screen.getByRole("button", { name: "删除任务", exact: true }));
    fireEvent.click(screen.getByRole("button", { name: "取消", exact: true }));
    fireEvent.click(screen.getByRole("button", { name: "删除任务", exact: true }));
    fireEvent.click(screen.getByRole("button", { name: "继续删除", exact: true }));
    expect(screen.getByRole("dialog", { name: "确认永久删除" })).toHaveTextContent("工作区");
    fireEvent.click(screen.getByRole("button", { name: "取消", exact: true }));
    expect(remove).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "删除任务", exact: true }));
    fireEvent.click(screen.getByRole("button", { name: "继续删除", exact: true }));
    list.mockResolvedValue([]);
    fireEvent.click(screen.getByRole("button", { name: "永久删除", exact: true }));
    expect(await screen.findByText("精读任务、报告与本地工作区已删除")).toBeInTheDocument();
    expect(remove).toHaveBeenCalledExactlyOnceWith("A");
  });
  it("shows refresh progress and completion", async () => {
    list.mockResolvedValue([task("A")]);
    get.mockResolvedValue(detail("A"));
    render(<DeepReadView onOpenPaper={() => undefined} />);
    await screen.findByText("报告正文 A");
    let finish!: (value: DeepRead[]) => void;
    list.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    fireEvent.click(screen.getByRole("button", { name: "刷新", exact: true }));
    expect(screen.getByRole("button", { name: "刷新中…" })).toBeDisabled();
    await act(async () => finish([task("A")]));
    expect(screen.getByRole("status")).toHaveTextContent("精读列表已刷新");
    expect(screen.getByRole("button", { name: "刷新", exact: true })).toBeEnabled();
  });

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

  it("切换已完成任务时复制全文保持显示", async () => {
    let resolveB!: (value: DeepReadDetail) => void;
    list.mockResolvedValue([task("A"), task("B")]);
    get.mockImplementation((id: string) => id === "A" ? Promise.resolve(detail("A")) : new Promise(resolve => { resolveB = resolve; }));
    render(<DeepReadView onOpenPaper={() => undefined} />);
    expect(await screen.findByRole("button", { name: "复制全文" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /论文 B 已完成/ }));
    expect(screen.getByRole("button", { name: "复制全文" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "开始生成" })).not.toBeInTheDocument();
    await act(async () => resolveB(detail("B")));
    expect(await screen.findByText("报告正文 B")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "复制全文" })).toBeInTheDocument();
  });

  it("报告下滚后收起标题，回到顶部后展开", async () => {
    list.mockResolvedValue([task("A")]);
    get.mockResolvedValue(detail("A"));
    const { container } = render(<DeepReadView onOpenPaper={() => undefined} />);
    await screen.findByText("报告正文 A");
    const report = container.querySelector(".deepread-report");
    expect(report).toBeInstanceOf(HTMLElement);
    report!.scrollTop = 120;
    fireEvent.scroll(report!);
    expect(container.querySelector(".deepread-main")).toHaveClass("is-reading");
    report!.scrollTop = 0;
    fireEvent.scroll(report!);
    expect(container.querySelector(".deepread-main")).not.toHaveClass("is-reading");
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

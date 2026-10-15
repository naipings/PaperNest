import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ResearchView } from "./ResearchView";

const mocks = vi.hoisted(() => ({ exportReport: vi.fn(), reload: vi.fn().mockResolvedValue(undefined), busy: vi.fn() }));
vi.mock("../lib/researchAttachments", () => ({ linkAttachments: () => [], readAttachment: vi.fn() }));
vi.mock("../services/backend", () => ({
  isTauri: () => true,
  backend: {
    researchGetSettings: async () => ({ enabled: true }),
    researchListSessions: async () => [{ id: "session-1", title: "记忆研究", query: "研究问题", workspacePath: "D:/Research/memory", status: "completed", createdAt: "2026-10-15T10:00:00", updatedAt: "2026-10-15T10:00:00" }],
    researchListTurns: async () => [1, 2].map(turn => ({ turn, question: "问题", answer: "回答", attachments: [], status: "completed" })),
    researchReadSources: async () => [], researchListSteps: async () => [], researchListProposals: async () => [],
    researchExportReport: mocks.exportReport,
  },
}));
vi.mock("../state/LibraryContext", () => ({ useLibrary: () => ({ researchBusy: "", setResearchBusy: mocks.busy, setResearchNotice: mocks.busy }) }));
vi.mock("../research-harness/ResearchHarnessProvider", () => ({ useResearchHarness: () => ({ reload: mocks.reload, eventCount: 0, loading: false }) }));
vi.mock("../research-harness/ResearchTrajectoryPanel", () => ({ ResearchTrajectoryPanel: () => null }));
vi.mock("./research/ResearchNewSessionCard", () => ({ ResearchNewSessionCard: () => null }));
vi.mock("./research/ResearchConversationTab", () => ({ ResearchConversationTab: () => null }));
vi.mock("./research/ResearchProposalsTab", () => ({ ResearchProposalsTab: () => null }));
vi.mock("./research/ResearchReportTab", () => ({ ResearchReportTab: () => null }));

describe("research export confirmation", () => {
  beforeEach(() => { mocks.exportReport.mockReset(); });

  it("does not write when opening, cancelling or dismissing the confirmation", async () => {
    render(<ResearchView />);
    fireEvent.click(await screen.findByRole("button", { name: "合并导出" }));
    expect(screen.getByRole("dialog")).toHaveTextContent("已有回答的 2 轮");
    expect(screen.getByRole("dialog")).toHaveTextContent("D:/Research/memory");
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "合并导出" }));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(mocks.exportReport).not.toHaveBeenCalled();
  });

  it("exports once after confirmation and disables the action while writing", async () => {
    let finish!: (path: string) => void;
    mocks.exportReport.mockImplementation(() => new Promise<string>(resolve => { finish = resolve; }));
    render(<ResearchView />);
    fireEvent.click(await screen.findByRole("button", { name: "合并导出" }));
    fireEvent.click(screen.getByRole("button", { name: "确认导出" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    const pending = screen.getByRole("button", { name: "导出中…" });
    expect(pending).toBeDisabled();
    fireEvent.click(pending);
    expect(mocks.exportReport).toHaveBeenCalledExactlyOnceWith("session-1");
    await act(async () => finish("D:/Research/memory/report-full.md"));
    expect(screen.getByText("已合并导出：D:/Research/memory/report-full.md")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "合并导出" })).toBeEnabled();
  });

  it("shows the write error and allows a retry", async () => {
    mocks.exportReport.mockRejectedValue(new Error("文件不可写"));
    render(<ResearchView />);
    fireEvent.click(await screen.findByRole("button", { name: "合并导出" }));
    fireEvent.click(screen.getByRole("button", { name: "确认导出" }));
    expect(await screen.findByText("文件不可写")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "合并导出" })).toBeEnabled();
  });
});


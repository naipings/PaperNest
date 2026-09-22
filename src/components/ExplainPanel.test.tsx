import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Paper, PaperExplainSession } from "../types";
import { resetExplainInflightForTests, trackExplainStart } from "../lib/paperExplainInflight";

const explainGet = vi.fn();
const explainStart = vi.fn();
const explainAsk = vi.fn();
const explainNewChat = vi.fn();
const explainSwitchChat = vi.fn();
const explainDeleteChat = vi.fn();
const explainDeleteTurn = vi.fn();
const explainReset = vi.fn();
const startPaperExplain = vi.fn();
const finishPaperExplain = vi.fn();
let paperExplaining: Record<string, string> = {};

vi.mock("../services/backend", () => ({
  backend: {
    explainGet: (...args: unknown[]) => explainGet(...args),
    explainStart: (...args: unknown[]) => explainStart(...args),
    explainAsk: (...args: unknown[]) => explainAsk(...args),
    explainNewChat: (...args: unknown[]) => explainNewChat(...args),
    explainSwitchChat: (...args: unknown[]) => explainSwitchChat(...args),
    explainDeleteChat: (...args: unknown[]) => explainDeleteChat(...args),
    explainDeleteTurn: (...args: unknown[]) => explainDeleteTurn(...args),
    explainReset: (...args: unknown[]) => explainReset(...args),
  },
}));

vi.mock("../state/LibraryContext", () => ({
  useLibrary: () => ({
    paperExplaining,
    startPaperExplain: (...args: unknown[]) => startPaperExplain(...args),
    finishPaperExplain: (...args: unknown[]) => finishPaperExplain(...args),
    paperExplainBusy: "",
  }),
}));

import { ExplainPanel } from "./ExplainPanel";

const paper: Paper = {
  id: "paper-1",
  titleEn: "Attention Is All You Need",
  titleZh: "注意力即一切",
  authors: [],
  tagIds: [],
  status: "reading",
  favorite: false,
  pageCount: 15,
  hasTextLayer: true,
  createdAt: "2026-09-19",
  updatedAt: "2026-09-19",
};

const emptySession: PaperExplainSession = {
  paperId: "paper-1",
  locale: "zh-CN",
  overview: null,
  chatId: null,
  messages: [],
  chats: [],
  model: null,
  updatedAt: null,
};

const readySession: PaperExplainSession = {
  paperId: "paper-1",
  locale: "zh-CN",
  overview: {
    summary: "提出 Transformer",
    problem: "序列建模依赖循环",
    method: "自注意力替代 RNN",
    findings: "机器翻译提升",
    limits: "算力需求",
    readingTips: "先读第 3 节",
  },
  chatId: "chat-1",
  messages: [],
  chats: [{ id: "chat-1", title: "新对话", updatedAt: "2026-09-20T00:00:00Z", messageCount: 0 }],
  model: "gpt-test",
  updatedAt: "2026-09-19T00:00:00Z",
};

function renderPanel(overrides: Partial<React.ComponentProps<typeof ExplainPanel>> = {}) {
  return render(
    <ExplainPanel
      paper={paper}
      pageTextReady
      llmReady
      onJumpPage={vi.fn()}
      {...overrides}
    />,
  );
}

describe("ExplainPanel", () => {
  afterEach(() => {
    vi.clearAllMocks();
    paperExplaining = {};
    resetExplainInflightForTests();
  });

  it("shows hydrating state then welcome", async () => {
    let resolveGet!: (value: PaperExplainSession) => void;
    explainGet.mockReturnValue(new Promise<PaperExplainSession>(resolve => { resolveGet = resolve; }));
    renderPanel();
    expect(screen.getByTestId("explain-hydrating")).toBeInTheDocument();
    resolveGet(emptySession);
    expect(await screen.findByRole("button", { name: "开始解读" })).toBeInTheDocument();
  });

  it("blocks start until page text is ready", async () => {
    explainGet.mockResolvedValue(emptySession);
    renderPanel({ pageTextReady: false });
    const button = await screen.findByRole("button", { name: "开始解读" });
    expect(button).toBeDisabled();
    expect(screen.getByText("正在抽取正文，请稍候…")).toBeInTheDocument();
  });

  it("starts explain and renders overview", async () => {
    explainGet.mockResolvedValue(emptySession);
    explainStart.mockResolvedValue(readySession);
    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: "开始解读" }));
    await waitFor(() => expect(explainStart).toHaveBeenCalledWith("paper-1", "zh-CN", true));
    expect(startPaperExplain).toHaveBeenCalled();
    expect(await screen.findByText("提出 Transformer")).toBeInTheDocument();
    expect(finishPaperExplain).toHaveBeenCalledWith("paper-1");
  });

  it("restores starting progress from inflight after remount", async () => {
    let resolveStart!: (value: PaperExplainSession) => void;
    const startPromise = new Promise<PaperExplainSession>(resolve => { resolveStart = resolve; });
    explainGet.mockResolvedValue(emptySession);
    paperExplaining = { "paper-1": "正在解读：注意力即一切" };
    trackExplainStart("paper-1", () => startPromise);

    const { unmount } = renderPanel();
    expect(await screen.findByTestId("explain-starting")).toBeInTheDocument();
    unmount();

    renderPanel();
    expect(await screen.findByTestId("explain-starting")).toBeInTheDocument();
    resolveStart(readySession);
    expect(await screen.findByText("提出 Transformer")).toBeInTheDocument();
  });

  it("asks a quick question", async () => {
    explainGet.mockResolvedValue(readySession);
    explainAsk.mockResolvedValue({
      ...readySession,
      messages: [
        { role: "user", content: "这篇的核心贡献是什么？", createdAt: "t1" },
        { role: "assistant", content: "见 P3。", cites: [3], createdAt: "t2" },
      ],
      chats: [{ id: "chat-1", title: "这篇的核心贡献是什么？", updatedAt: "t2", messageCount: 2 }],
    });
    const onJumpPage = vi.fn();
    renderPanel({ onJumpPage });
    fireEvent.click(await screen.findByRole("button", { name: "这篇的核心贡献是什么？" }));
    await waitFor(() => expect(explainAsk).toHaveBeenCalledWith("paper-1", "这篇的核心贡献是什么？"));
    fireEvent.click(await screen.findByRole("button", { name: "P3" }));
    expect(onJumpPage).toHaveBeenCalledWith(3);
  });

  it("creates a new chat without re-running overview", async () => {
    explainGet.mockResolvedValue(readySession);
    explainNewChat.mockResolvedValue({
      ...readySession,
      chatId: "chat-2",
      messages: [],
      chats: [
        { id: "chat-2", title: "新对话", updatedAt: "2026-09-20T01:00:00Z", messageCount: 0 },
        { id: "chat-1", title: "旧对话", updatedAt: "2026-09-20T00:00:00Z", messageCount: 2 },
      ],
    });
    renderPanel();
    fireEvent.click(await screen.findByTitle("新建对话（复用已有讲稿）"));
    await waitFor(() => expect(explainNewChat).toHaveBeenCalledWith("paper-1"));
    expect(screen.getByText("提出 Transformer")).toBeInTheDocument();
    expect(explainStart).not.toHaveBeenCalled();
  });

  it("switches chat from history menu", async () => {
    explainGet.mockResolvedValue({
      ...readySession,
      messages: [{ role: "user", content: "问1", createdAt: "t1" }, { role: "assistant", content: "答1", createdAt: "t2" }],
      chats: [
        { id: "chat-1", title: "问1", updatedAt: "t2", messageCount: 2 },
        { id: "chat-2", title: "问2", updatedAt: "t0", messageCount: 2 },
      ],
    });
    explainSwitchChat.mockResolvedValue({
      ...readySession,
      chatId: "chat-2",
      messages: [{ role: "user", content: "问2", createdAt: "t3" }, { role: "assistant", content: "答2", createdAt: "t4" }],
      chats: [
        { id: "chat-1", title: "问1", updatedAt: "t2", messageCount: 2 },
        { id: "chat-2", title: "问2", updatedAt: "t0", messageCount: 2 },
      ],
    });
    renderPanel();
    fireEvent.click(await screen.findByTitle("查看历史对话"));
    fireEvent.click(await screen.findByText("问2"));
    await waitFor(() => expect(explainSwitchChat).toHaveBeenCalledWith("paper-1", "chat-2"));
    expect(await screen.findByText("答2")).toBeInTheDocument();
  });

  it("deletes one Q&A turn from the assistant bubble", async () => {
    explainGet.mockResolvedValue({
      ...readySession,
      messages: [
        { role: "user", content: "问1", createdAt: "t1" },
        { role: "assistant", content: "答1", createdAt: "t2" },
        { role: "user", content: "问2", createdAt: "t3" },
        { role: "assistant", content: "答2", createdAt: "t4" },
      ],
    });
    explainDeleteTurn.mockResolvedValue({
      ...readySession,
      messages: [
        { role: "user", content: "问2", createdAt: "t3" },
        { role: "assistant", content: "答2", createdAt: "t4" },
      ],
    });
    vi.spyOn(window, "confirm").mockReturnValue(true);
    renderPanel();
    expect(await screen.findByText("答1")).toBeInTheDocument();
    const deleteButtons = await screen.findAllByRole("button", { name: /删除本轮/ });
    fireEvent.click(deleteButtons[0]);
    await waitFor(() => expect(explainDeleteTurn).toHaveBeenCalledWith("paper-1", 1));
    expect(screen.queryByText("答1")).not.toBeInTheDocument();
    expect(screen.getByText("答2")).toBeInTheDocument();
  });

  it("shows start error from backend", async () => {
    explainGet.mockResolvedValue(emptySession);
    explainStart.mockRejectedValue(new Error("尚无可用正文"));
    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: "开始解读" }));
    expect(await screen.findByText("尚无可用正文")).toBeInTheDocument();
    expect(finishPaperExplain).toHaveBeenCalledWith("paper-1");
  });
});

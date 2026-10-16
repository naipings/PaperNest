import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RadarView } from "./RadarView";

const mocks = vi.hoisted(() => ({ defaultFilter: true, total: 30, listFeed: vi.fn(), action: vi.fn() }));
vi.mock("../lib/radarImportLlm", () => ({ runRadarImportLlmFill: vi.fn() }));
vi.mock("../state/LibraryContext", () => ({ useLibrary: () => ({
  data: { papers: [] }, refresh: mocks.action, radarBusy: "", radarNotice: "", radarExplaining: {}, radarExplainBusy: "",
  setRadarBusy: mocks.action, setRadarNotice: mocks.action, startRadarExplain: mocks.action, finishRadarExplain: mocks.action,
}) }));
vi.mock("../services/backend", () => ({ isTauri: () => true, backend: {
  radarGetSettings: async () => ({ enabled: true, defaultFilterEnabled: mocks.defaultFilter, keywords: ["heart failure"], categories: ["cardiovascular medicine"] }),
  radarListDates: async () => ["2026-10-15"], radarListExplainedIds: async () => [], radarListFeed: mocks.listFeed,
} }));

describe("radar board filtering", () => {
  beforeEach(() => {
    mocks.defaultFilter = true;
    mocks.total = 30;
    mocks.listFeed.mockReset().mockImplementation(async (_date, feed, filtered) => ({
      cards: filtered || !mocks.total ? [] : [{ arxivId: "2601.12345", feed, title: "已采集的论文", categories: [], topics: [], authors: [], hidden: false }],
      totalCount: mocks.total,
      interestFilterApplied: filtered,
    }));
  });

  it("distinguishes collected papers from zero interest matches and opens the complete board", async () => {
    render(<RadarView />);
    fireEvent.click(await screen.findByRole("button", { name: "查看全部 30 篇" }));
    expect(await screen.findByText("已采集的论文")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "仅看兴趣匹配" })).not.toBeChecked();
    await waitFor(() => expect(mocks.listFeed).toHaveBeenLastCalledWith("2026-10-15", "hot", false, false));
    fireEvent.click(screen.getByRole("button", { name: "medRxiv 新稿榜" }));
    await waitFor(() => expect(mocks.listFeed).toHaveBeenLastCalledWith("2026-10-15", "new", false, false));
    expect(screen.getByText("已采集的论文")).toBeInTheDocument();
  });

  it("shows the actual filter state after enabling it with the default disabled", async () => {
    mocks.defaultFilter = false;
    render(<RadarView />);
    await screen.findByText("已采集的论文");
    fireEvent.click(screen.getByRole("checkbox", { name: "仅看兴趣匹配" }));
    expect(await screen.findByRole("button", { name: "查看全部 30 篇" })).toBeInTheDocument();
    expect(screen.getByText("兴趣匹配 0 篇 · 已采集 30 篇")).toBeInTheDocument();
  });

  it("shows a missing snapshot instead of a filter explanation when nothing was collected", async () => {
    mocks.total = 0;
    render(<RadarView />);
    expect(await screen.findByText("该日暂无medRxiv 近 7 日数据。")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /查看全部/ })).not.toBeInTheDocument();
  });
});

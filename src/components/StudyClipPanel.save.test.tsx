import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../services/translation", () => ({ translateEnglishToChineseWithFallback: vi.fn().mockResolvedValue("译文") }));

import { StudyClipPanel } from "./StudyClipPanel";

function renderPanel(overrides: Partial<React.ComponentProps<typeof StudyClipPanel>> = {}) {
  return render(<StudyClipPanel
    paperId="paper-1"
    page={1}
    seedKey={0}
    seedText=""
    llmReady={false}
    askPurpose={vi.fn().mockResolvedValue("相关工作")}
    onTerm={vi.fn().mockResolvedValue(undefined)}
    onExcerpt={vi.fn().mockResolvedValue(undefined)}
    {...overrides}
  />);
}

describe("study clip saving", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it("shows a vocabulary save error", async () => {
    vi.spyOn(window, "prompt").mockReturnValue("attention");
    renderPanel({ onTerm: vi.fn().mockRejectedValue(new Error("数据库不可写")) });

    fireEvent.change(screen.getByLabelText("原文（可编辑）"), { target: { value: "attention mechanism" } });
    fireEvent.click(screen.getByRole("button", { name: "收为术语" }));

    expect(await screen.findByText("收录术语失败：数据库不可写")).toBeInTheDocument();
  });

  it("shows a writing excerpt save error", async () => {
    renderPanel({ onExcerpt: vi.fn().mockRejectedValue(new Error("数据库不可写")) });

    fireEvent.change(screen.getByLabelText("原文（可编辑）"), { target: { value: "attention mechanism" } });
    fireEvent.click(screen.getByRole("button", { name: "加入写作库" }));

    expect(await screen.findByText("加入写作库失败：数据库不可写")).toBeInTheDocument();
  });
});

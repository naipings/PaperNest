import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ResearchReportTab } from "./ResearchReportTab";
import type { ResearchTurnView } from "../../types";

vi.mock("./ResearchMarkdown", () => ({ ResearchMarkdown: ({ text }: { text: string }) => <div>{text}</div> }));
const turns: ResearchTurnView[] = [1, 2].map(turn => ({ turn, question: `问题 ${turn}`, answer: `# 报告 ${turn}\n正文`, status: "completed", attachments: [], createdAt: "2026-10-15" }));

describe("report reading", () => {
  it("opens the latest answer and resets reading position when changing rounds", () => {
    render(<ResearchReportTab turns={turns} />);
    const document = screen.getByRole("article", { name: "报告 2" });
    expect(document).toHaveAttribute("tabindex", "0");
    document.scrollTop = 400;
    fireEvent.change(screen.getByRole("combobox", { name: "选择报告轮次" }), { target: { value: "1" } });
    expect(screen.getByRole("article", { name: "报告 1" })).toHaveTextContent("报告 1");
    expect(document.scrollTop).toBe(0);
  });

  it("opens a requested report from conversation and returns it to the top", () => {
    const { rerender } = render(<ResearchReportTab turns={turns} focusTurn={1} />);
    const document = screen.getByRole("article", { name: "报告 1" });
    document.scrollTop = 500;
    rerender(<ResearchReportTab turns={turns} focusTurn={2} />);
    expect(screen.getByRole("article", { name: "报告 2" })).toBeInTheDocument();
    expect(document.scrollTop).toBe(0);
    fireEvent.change(screen.getByRole("combobox", { name: "选择报告轮次" }), { target: { value: "1" } });
    expect(screen.getByRole("article", { name: "报告 1" })).toBeInTheDocument();
  });
});

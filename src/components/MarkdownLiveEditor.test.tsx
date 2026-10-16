import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MarkdownLiveEditor } from "./MarkdownLiveEditor";

describe("MarkdownLiveEditor", () => {
  it("edits one list item and saves the document", async () => {
    const save = vi.fn(async () => undefined);
    render(<MarkdownLiveEditor text={"# 标题\n\n- 甲\n- 乙\n"} render={text => <span>{text}</span>} onSave={save} />);
    fireEvent.click(screen.getByRole("button", { name: "编辑" }));
    fireEvent.click(screen.getByText("- 甲"));
    const field = screen.getByRole("textbox", { name: "编辑这段 Markdown" });
    fireEvent.change(field, { target: { value: "- 改" } });
    fireEvent.blur(field);
    expect(await screen.findByRole("status")).toHaveTextContent("已保存");
    expect(save).toHaveBeenCalledOnce();
    expect(save.mock.calls[0][0]).toContain("- 改\n- 乙");
  });
});

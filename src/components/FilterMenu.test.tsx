import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { FilterMenu } from "./FilterMenu";

const groups = [{ options: [{ id: "all", label: "全部状态" }, { id: "reading", label: "在读" }, { id: "read", label: "已读" }] }];

describe("FilterMenu keyboard interaction", () => {
  it("focuses the selected option and supports arrow selection with focus restored", () => {
    const onChange = vi.fn();
    render(<FilterMenu value="reading" groups={groups} onChange={onChange} />);
    const trigger = screen.getByRole("button", { name: "在读" });
    trigger.focus();
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    expect(screen.getByRole("option", { name: "在读" })).toHaveFocus();
    fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" });
    expect(screen.getByRole("option", { name: "已读" })).toHaveFocus();
    fireEvent.click(document.activeElement!);
    expect(onChange).toHaveBeenCalledWith("read");
    expect(trigger).toHaveFocus();
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("closes on Escape without closing its containing dialog", () => {
    const parentKeyDown = vi.fn();
    render(<div onKeyDown={parentKeyDown}><FilterMenu value="all" groups={groups} onChange={vi.fn()} /></div>);
    const trigger = screen.getByRole("button", { name: "全部状态" });
    fireEvent.click(trigger);
    fireEvent.keyDown(screen.getByRole("option", { name: "全部状态" }), { key: "Escape" });
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    expect(parentKeyDown).not.toHaveBeenCalled();
  });
});

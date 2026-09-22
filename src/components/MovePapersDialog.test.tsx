import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MovePapersDialog } from "./MovePapersDialog";
import type { Folder } from "../types";

const folders: Folder[] = [
  { id: "r1", name: "CS", position: 0, createdAt: "t", updatedAt: "t" },
  { id: "c1", name: "AAAI", parentId: "r1", position: 0, createdAt: "t", updatedAt: "t" },
];

describe("MovePapersDialog", () => {
  it("moves into a nested folder found by search", () => {
    const onMove = vi.fn();
    render(<MovePapersDialog folders={folders} count={2} onClose={() => undefined} onMove={onMove} onCreate={async () => undefined} />);
    fireEvent.change(screen.getByLabelText("搜索文件夹"), { target: { value: "aaai" } });
    expect(screen.getByRole("button", { name: /CS/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /AAAI/ }));
    fireEvent.click(screen.getByRole("button", { name: "移动" }));
    expect(onMove).toHaveBeenCalledWith("c1");
  });

  it("moves to unfiled", () => {
    const onMove = vi.fn();
    render(<MovePapersDialog folders={folders} count={1} onClose={() => undefined} onMove={onMove} onCreate={async () => undefined} />);
    fireEvent.click(screen.getByRole("button", { name: "未归档" }));
    fireEvent.click(screen.getByRole("button", { name: "移动" }));
    expect(onMove).toHaveBeenCalledWith(null);
  });
});

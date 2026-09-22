import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { FolderTree } from "./FolderTree";
import type { Folder, Paper } from "../types";

const papers: Paper[] = [
  { id: "p1", titleEn: "Paper", authors: [], tagIds: [], status: "unread", favorite: false, createdAt: "t", updatedAt: "t" },
];

describe("FolderTree", () => {
  it("creates a root folder from virtual row context menu", () => {
    const onCreateRoot = vi.fn();
    render(
      <FolderTree
        folders={[]}
        papers={papers}
        selection={{ kind: "all" }}
        onSelect={() => undefined}
        onCreateRoot={onCreateRoot}
        onCreateChild={() => undefined}
        onCreateSibling={() => undefined}
        onRename={() => undefined}
        onDelete={() => undefined}
        onDropPapers={() => undefined}
      />
    );
    fireEvent.contextMenu(screen.getByRole("button", { name: /全部论文/ }));
    const menu = document.querySelector(".folder-context-menu") as HTMLElement;
    fireEvent.click(within(menu).getByRole("button", { name: /^新建文件夹$/ }));
    expect(onCreateRoot).toHaveBeenCalledOnce();
  });

  it("creates a child folder from folder context menu", () => {
    const folder: Folder = { id: "f1", name: "CS", position: 0, createdAt: "t", updatedAt: "t" };
    const onCreateChild = vi.fn();
    render(
      <FolderTree
        folders={[folder]}
        papers={papers}
        selection={{ kind: "folder", id: "f1" }}
        onSelect={() => undefined}
        onCreateRoot={() => undefined}
        onCreateChild={onCreateChild}
        onCreateSibling={() => undefined}
        onRename={() => undefined}
        onDelete={() => undefined}
        onDropPapers={() => undefined}
      />
    );
    fireEvent.contextMenu(screen.getByRole("treeitem", { name: /CS/ }));
    const menu = document.querySelector(".folder-context-menu") as HTMLElement;
    fireEvent.click(within(menu).getByRole("button", { name: /新建子文件夹/ }));
    expect(onCreateChild).toHaveBeenCalledWith("f1");
  });

  it("opens the same menu from the single row action", () => {
    const folder: Folder = { id: "f1", name: "CS", position: 0, createdAt: "t", updatedAt: "t" };
    const onSelect = vi.fn();
    render(
      <FolderTree
        folders={[folder]}
        papers={papers}
        selection={{ kind: "all" }}
        onSelect={onSelect}
        onCreateRoot={() => undefined}
        onCreateChild={() => undefined}
        onCreateSibling={() => undefined}
        onRename={() => undefined}
        onDelete={() => undefined}
        onDropPapers={() => undefined}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "文件夹操作" }));
    expect(onSelect).not.toHaveBeenCalled();
    expect(document.querySelector(".folder-context-menu")).toBeTruthy();
    expect(screen.getByRole("button", { name: /重命名/ })).toBeTruthy();
  });

  it("clears folder selection when clicking blank area", () => {
    const onSelect = vi.fn();
    const folder: Folder = { id: "f1", name: "CS", position: 0, createdAt: "t", updatedAt: "t" };
    render(
      <FolderTree
        folders={[folder]}
        papers={papers}
        selection={{ kind: "folder", id: "f1" }}
        onSelect={onSelect}
        onCreateRoot={() => undefined}
        onCreateChild={() => undefined}
        onCreateSibling={() => undefined}
        onRename={() => undefined}
        onDelete={() => undefined}
        onDropPapers={() => undefined}
      />
    );
    fireEvent.click(document.querySelector(".folder-tree-body")!);
    expect(onSelect).toHaveBeenCalledWith({ kind: "all" });
  });

  it("drops dragged papers onto a folder", () => {
    const folder: Folder = { id: "f1", name: "CS", position: 0, createdAt: "t", updatedAt: "t" };
    const onDropPapers = vi.fn();
    render(
      <FolderTree
        folders={[folder]}
        papers={papers}
        selection={{ kind: "all" }}
        onSelect={() => undefined}
        onCreateRoot={() => undefined}
        onCreateChild={() => undefined}
        onCreateSibling={() => undefined}
        onRename={() => undefined}
        onDelete={() => undefined}
        onDropPapers={onDropPapers}
      />
    );
    const target = screen.getByRole("treeitem", { name: /CS/ });
    const dataTransfer = {
      types: ["application/x-papernest-papers", "text/plain"],
      dropEffect: "none",
      getData: (type: string) => type === "application/x-papernest-papers" || type === "text/plain" ? JSON.stringify(["p1", "p2"]) : "",
      setData: () => undefined,
    };
    fireEvent.dragOver(target, { dataTransfer });
    expect(target.className).toContain("drop-target");
    fireEvent.drop(target, { dataTransfer });
    expect(onDropPapers).toHaveBeenCalledWith("f1", ["p1", "p2"]);
  });

  it("shows the full folder name only when the label is truncated", () => {
    const folder: Folder = { id: "f1", name: "很长的课题文件夹名称", position: 0, createdAt: "t", updatedAt: "t" };
    render(
      <FolderTree
        folders={[folder]}
        papers={papers}
        selection={{ kind: "all" }}
        onSelect={() => undefined}
        onCreateRoot={() => undefined}
        onCreateChild={() => undefined}
        onCreateSibling={() => undefined}
        onRename={() => undefined}
        onDelete={() => undefined}
        onDropPapers={() => undefined}
      />
    );
    const name = screen.getByText("很长的课题文件夹名称");
    const row = screen.getByRole("treeitem", { name: /很长的课题文件夹名称/ });
    const box = () => ({ x: 0, y: 0, top: 0, left: 0, right: 40, bottom: 16, width: 40, height: 16, toJSON() { return {}; } });
    const wide = () => ({ ...box(), right: 180, width: 180 });
    name.getBoundingClientRect = box;
    const range = { selectNodeContents: () => undefined, getBoundingClientRect: wide } as unknown as Range;
    vi.spyOn(document, "createRange").mockReturnValue(range);
    fireEvent.mouseEnter(row);
    expect(row).toHaveAttribute("title", "很长的课题文件夹名称");

    name.getBoundingClientRect = wide;
    fireEvent.mouseEnter(row);
    expect(row).not.toHaveAttribute("title");
  });
});

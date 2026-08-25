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
});

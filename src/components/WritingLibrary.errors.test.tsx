import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { WritingLibrary } from "./WritingLibrary";
import { backend } from "../services/backend";
import { LibraryProvider } from "../state/LibraryContext";

function renderLibrary() {
  return render(<LibraryProvider><WritingLibrary onOpenPaper={() => undefined} /></LibraryProvider>);
}

async function excerptCard() {
  const rewrite = await screen.findByText("我的改写");
  const card = rewrite.closest("article");
  if (!card) throw new Error("Writing excerpt card missing");
  return within(card);
}

describe("writing library errors", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    backend.resetPreview();
  });

  it("shows an error when changing the writing purpose fails", async () => {
    vi.spyOn(backend, "saveExcerpt").mockRejectedValue(new Error("数据库不可写"));
    renderLibrary();
    const card = await excerptCard();

    fireEvent.click(card.getByRole("button", { name: "方法描述" }));
    fireEvent.click(card.getByRole("option", { name: "实验分析" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("更新写作用途失败：数据库不可写");
  });

  it("shows an error when deleting an excerpt fails", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    vi.spyOn(backend, "deleteExcerpt").mockRejectedValue(new Error("数据库不可写"));
    renderLibrary();
    const card = await excerptCard();

    fireEvent.click(card.getByTitle("删除"));

    expect(await screen.findByRole("alert")).toHaveTextContent("删除写作素材失败：数据库不可写");
    expect(screen.getByText("我的改写")).toBeInTheDocument();
  });

  it("shows an error when copying an excerpt fails", async () => {
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: vi.fn().mockRejectedValue(new Error("剪贴板不可用")) } });
    renderLibrary();
    const card = await excerptCard();

    fireEvent.click(card.getByTitle("复制"));

    expect(await screen.findByRole("alert")).toHaveTextContent("复制原文失败：剪贴板不可用");
  });
});

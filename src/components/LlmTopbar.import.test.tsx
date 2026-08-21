import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../services/llm", () => ({ dataUrlToBytes: () => [] }));

import { Topbar } from "./LlmTopbar";
import { backend } from "../services/backend";
import { LibraryProvider } from "../state/LibraryContext";

function renderTopbar(onRefresh = vi.fn().mockResolvedValue(undefined)) {
  render(<LibraryProvider><Topbar search="" onSearch={() => undefined} onCreate={() => undefined} onRefresh={onRefresh} /></LibraryProvider>);
  return onRefresh;
}

describe("imports", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    backend.resetPreview();
  });

  it("shows a PDF import error and refreshes the library", async () => {
    vi.spyOn(backend, "chooseAndImportPdfs").mockRejectedValue(new Error("文件读取失败"));
    const onRefresh = renderTopbar();

    fireEvent.click(screen.getByRole("button", { name: "导入 PDF" }));

    await waitFor(() => expect(screen.getByText("导入失败：文件读取失败")).toBeInTheDocument());
    expect(onRefresh).toHaveBeenCalledOnce();
  });

  it("locks import actions and reports a Bib/RIS import error", async () => {
    let rejectImport!: (reason: Error) => void;
    vi.spyOn(backend, "chooseAndImportCitations").mockImplementation(() => new Promise((_, reject) => { rejectImport = reject; }));
    const onRefresh = renderTopbar();

    fireEvent.click(screen.getByRole("button", { name: "导入 Bib/RIS" }));

    expect(screen.getByRole("button", { name: "导入 Bib/RIS" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "导入 PDF" })).toBeDisabled();
    rejectImport(new Error("文献格式无效"));

    await waitFor(() => expect(screen.getByText("导入失败：文献格式无效")).toBeInTheDocument());
    expect(onRefresh).toHaveBeenCalledOnce();
  });
});

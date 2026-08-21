import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./components/PdfReader", () => ({ PdfReader: () => null }));
vi.mock("./services/llm", () => ({ dataUrlToBytes: () => [] }));

import App from "./App";
import { backend } from "./services/backend";
import { LibraryProvider } from "./state/LibraryContext";

describe("global search errors", () => {
  beforeEach(() => {
    vi.stubGlobal("matchMedia", () => ({ matches: false, media: "", onchange: null, addListener: () => undefined, removeListener: () => undefined, addEventListener: () => undefined, removeEventListener: () => undefined, dispatchEvent: () => false }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    backend.resetPreview();
  });

  it("shows a full-text search failure while leaving the library open", async () => {
    vi.spyOn(backend, "search").mockRejectedValue(new Error("索引不可用"));
    render(<LibraryProvider><App /></LibraryProvider>);

    const input = await screen.findByPlaceholderText("搜索标题、作者、摘要、术语、批注或 PDF 正文…");
    fireEvent.change(input, { target: { value: "Transformer" } });

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("全文搜索失败：索引不可用"));
    expect(screen.getByRole("heading", { name: "今天，从一篇论文开始" })).toBeInTheDocument();
  });
});

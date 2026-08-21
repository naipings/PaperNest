import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./components/PdfReader", () => ({ PdfReader: () => null }));
vi.mock("./services/llm", () => ({ dataUrlToBytes: () => [] }));

import App from "./App";
import { backend } from "./services/backend";
import { LibraryProvider } from "./state/LibraryContext";

describe("library recovery notice", () => {
  beforeEach(() => {
    vi.stubGlobal("matchMedia", () => ({ matches: false, media: "", onchange: null, addListener: () => undefined, removeListener: () => undefined, addEventListener: () => undefined, removeEventListener: () => undefined, dispatchEvent: () => false }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    backend.resetPreview();
  });

  it("shows the recovered library path on the workspace", async () => {
    const snapshot = await backend.initialize();
    vi.spyOn(backend, "initialize").mockResolvedValue({
      ...snapshot,
      profile: { ...snapshot.profile, theme: "light" },
      libraryPath: "C:\\Users\\demo\\AppData\\Local\\PaperNest\\PaperNestLibrary-recovered-1",
      libraryNotice: "原资料库无法写入，已复制到本机并切换路径：C:\\Users\\demo\\AppData\\Local\\PaperNest\\PaperNestLibrary-recovered-1",
    });

    render(<LibraryProvider><App /></LibraryProvider>);

    expect(await screen.findByRole("status")).toHaveTextContent("原资料库无法写入，已复制到本机并切换路径");
  });
});

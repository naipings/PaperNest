import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DetailPanel } from "./DetailPanel";
import { backend } from "../services/backend";
import { seedSnapshot } from "../seed";
import { LibraryProvider } from "../state/LibraryContext";

describe("framework figure loading", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    backend.resetPreview();
  });

  it("shows a read error instead of an empty framework image placeholder", async () => {
    vi.spyOn(backend, "initialize").mockResolvedValue({
      ...structuredClone(seedSnapshot),
      figures: [{ id: "missing-figure", paperId: seedSnapshot.papers[0].id, imagePath: "figures/missing.png", title: "方法框架图", isPrimary: true }]
    });
    vi.spyOn(backend, "readPdf").mockRejectedValue(new Error("图片文件不存在"));

    render(<LibraryProvider><DetailPanel paper={seedSnapshot.papers[0]} onClose={() => undefined} onOpenPdf={() => undefined} onSelect={() => undefined} /></LibraryProvider>);

    fireEvent.click(await screen.findByRole("button", { name: "框架 1" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("框架图加载失败：图片文件不存在");
  });
});

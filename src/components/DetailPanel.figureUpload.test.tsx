import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DetailPanel } from "./DetailPanel";
import { backend } from "../services/backend";
import { seedSnapshot } from "../seed";
import { LibraryProvider } from "../state/LibraryContext";

describe("framework figure upload", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    backend.resetPreview();
  });

  it("reports a save error and clears the selected file", async () => {
    vi.spyOn(backend, "saveFigure").mockRejectedValue(new Error("磁盘不可写"));
    vi.spyOn(window, "prompt").mockReturnValueOnce("方法框架图").mockReturnValueOnce("中文解释").mockReturnValueOnce("1");
    render(<LibraryProvider><DetailPanel paper={seedSnapshot.papers[0]} onClose={() => undefined} onOpenPdf={() => undefined} onSelect={() => undefined} /></LibraryProvider>);

    fireEvent.click(await screen.findByRole("button", { name: /框架/ }));
    const input = screen.getByLabelText("上传方法框架图") as HTMLInputElement;
    const file = new File(["image"], "framework.png", { type: "image/png" });
    Object.defineProperty(file, "arrayBuffer", { value: async () => new TextEncoder().encode("image").buffer });
    fireEvent.change(input, { target: { files: [file] } });

    expect(await screen.findByRole("alert")).toHaveTextContent("保存框架图失败：磁盘不可写");
    expect(input.value).toBe("");
  });
});

import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DeepReadMarkdown } from "./DeepReadMarkdown";
import { backend } from "../../services/backend";

describe("deep-read report figures", () => {
  afterEach(() => vi.restoreAllMocks());

  it("loads workspace figures through the managed library path", async () => {
    const read = vi.spyOn(backend, "readPdf").mockResolvedValue(new Uint8Array([137, 80, 78, 71]));
    Object.assign(URL, { createObjectURL: vi.fn(() => "blob:figure"), revokeObjectURL: vi.fn() });

    render(<DeepReadMarkdown taskId="t1" text={"![图 2：方法流程](figures/paper-Figure2-1.png)"} />);

    expect(await screen.findByRole("img", { name: "图 2：方法流程" })).toHaveAttribute("src", "blob:figure");
    expect(read).toHaveBeenCalledWith("deepread/t1/figures/paper-Figure2-1.png");
  });

  it("shows the read error for a missing figure", async () => {
    vi.spyOn(backend, "readPdf").mockRejectedValue(new Error("文件不存在"));

    render(<DeepReadMarkdown taskId="t1" text={"![图 9](figures/x.png)"} />);

    expect(await screen.findByText("插图读取失败：figures/x.png（文件不存在）")).toBeInTheDocument();
  });

  it("makes evidence segments and figures clickable in compare mode", async () => {
    vi.spyOn(backend, "readPdf").mockResolvedValue(new Uint8Array([137, 80, 78, 71]));
    Object.assign(URL, { createObjectURL: vi.fn(() => "blob:figure"), revokeObjectURL: vi.fn() });
    const onEvidence = vi.fn();
    const onFigure = vi.fn();

    render(<DeepReadMarkdown
      taskId="t1"
      text={"结论 (Evidence: Page 1, P0005; Page 3, Fig. 2)\n\n![图 2](figures/paper-Figure2-1.png)"}
      onEvidence={onEvidence}
      onFigure={onFigure}
    />);

    fireEvent.click(screen.getByRole("link", { name: "Page 3, Fig. 2" }));
    expect(onEvidence).toHaveBeenCalledWith("Page 3, Fig. 2");
    fireEvent.click(await screen.findByRole("img", { name: "图 2" }));
    expect(onFigure).toHaveBeenCalledWith("figures/paper-Figure2-1.png");
  });

  it("keeps evidence as plain text outside compare mode", () => {
    render(<DeepReadMarkdown text={"结论 (Evidence: Page 1, P0005)"} />);

    expect(screen.queryByRole("link")).toBeNull();
  });
});

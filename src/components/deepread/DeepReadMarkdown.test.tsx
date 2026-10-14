import { render, screen } from "@testing-library/react";
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
});

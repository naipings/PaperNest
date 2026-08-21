import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { PaperEditor } from "./PaperEditor";
import { seedSnapshot } from "../seed";

describe("paper saving", () => {
  it("keeps the editor open and shows a save error", async () => {
    const onSave = vi.fn().mockRejectedValue(new Error("数据库不可写"));
    render(<PaperEditor initial={seedSnapshot.papers[0]} categories={[]} tags={[]} onSave={onSave} onCancel={() => undefined} modalTitle="编辑论文" />);

    fireEvent.change(screen.getByLabelText("英文标题"), { target: { value: "修改后的论文标题" } });
    fireEvent.click(screen.getByRole("button", { name: "保存论文" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("保存论文失败：数据库不可写");
    expect(screen.getByLabelText("英文标题")).toHaveValue("修改后的论文标题");
  });
});

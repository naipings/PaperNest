import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PaperEditor } from "./PaperEditor";
import { seedSnapshot } from "../seed";

describe("paper saving", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("keeps the editor open and shows a save error", async () => {
    const onSave = vi.fn().mockRejectedValue(new Error("数据库不可写"));
    render(<PaperEditor initial={seedSnapshot.papers[0]} categories={[]} tags={[]} onSave={onSave} onCancel={() => undefined} modalTitle="编辑论文" />);

    fireEvent.change(screen.getByLabelText("英文标题"), { target: { value: "修改后的论文标题" } });
    fireEvent.click(screen.getByRole("button", { name: "保存论文" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("保存论文失败：数据库不可写");
    expect(screen.getByLabelText("英文标题")).toHaveValue("修改后的论文标题");
  });

  it("discards edits immediately when Cancel is clicked", () => {
    const onSave = vi.fn();
    const onCancel = vi.fn();
    const confirmSpy = vi.fn();
    vi.stubGlobal("confirm", confirmSpy);
    render(<PaperEditor initial={seedSnapshot.papers[0]} categories={[]} tags={[]} onSave={onSave} onCancel={onCancel} modalTitle="编辑论文" />);

    fireEvent.change(screen.getByLabelText("英文标题"), { target: { value: "修改后的论文标题" } });
    fireEvent.click(screen.getByRole("button", { name: "取消" }));

    expect(confirmSpy).not.toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalled();
    expect(onSave).not.toHaveBeenCalled();
  });

  it("asks whether to save when the backdrop is clicked with unsaved edits", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const onCancel = vi.fn();
    vi.stubGlobal("confirm", vi.fn(() => true));
    render(<PaperEditor initial={seedSnapshot.papers[0]} categories={[]} tags={[]} onSave={onSave} onCancel={onCancel} modalTitle="编辑论文" />);

    fireEvent.change(screen.getByLabelText("英文标题"), { target: { value: "修改后的论文标题" } });
    fireEvent.click(screen.getByRole("presentation"));

    await waitFor(() => expect(confirm).toHaveBeenCalledWith("编辑信息未保存，是否保存？"));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave.mock.calls[0][0].titleEn).toBe("修改后的论文标题");
  });

  it("discards edits when the backdrop prompt is declined", async () => {
    const onSave = vi.fn();
    const onCancel = vi.fn();
    vi.stubGlobal("confirm", vi.fn(() => false));
    render(<PaperEditor initial={seedSnapshot.papers[0]} categories={[]} tags={[]} onSave={onSave} onCancel={onCancel} modalTitle="编辑论文" />);

    fireEvent.change(screen.getByLabelText("英文标题"), { target: { value: "修改后的论文标题" } });
    fireEvent.click(screen.getByRole("presentation"));

    await waitFor(() => expect(confirm).toHaveBeenCalledWith("编辑信息未保存，是否保存？"));
    await waitFor(() => expect(onCancel).toHaveBeenCalled());
    expect(onSave).not.toHaveBeenCalled();
  });
});

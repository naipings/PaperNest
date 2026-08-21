import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DetailPanel } from "./DetailPanel";
import { backend } from "../services/backend";
import { seedSnapshot } from "../seed";
import { LibraryProvider } from "../state/LibraryContext";

describe("manual vocabulary saving", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    backend.resetPreview();
  });

  it("keeps the term editor open and shows a save error", async () => {
    vi.spyOn(backend, "saveVocabulary").mockRejectedValue(new Error("数据库不可写"));
    render(<LibraryProvider><DetailPanel paper={seedSnapshot.papers[0]} onClose={() => undefined} onOpenPdf={() => undefined} onSelect={() => undefined} /></LibraryProvider>);

    fireEvent.click(await screen.findByRole("button", { name: /术语/ }));
    fireEvent.click(screen.getByRole("button", { name: "添加专业词汇或短语" }));
    fireEvent.change(screen.getByLabelText("英文词汇 / 短语"), { target: { value: "attention" } });
    fireEvent.change(screen.getByLabelText("中文释义"), { target: { value: "注意力机制" } });
    fireEvent.click(screen.getByRole("button", { name: "保存术语" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("保存术语失败：数据库不可写");
    expect(screen.getByLabelText("英文词汇 / 短语")).toHaveValue("attention");
  });
});

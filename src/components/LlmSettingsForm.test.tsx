import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LlmSettingsForm } from "./LlmSettingsForm";
import { backend } from "../services/backend";
import { LibraryProvider } from "../state/LibraryContext";

function renderSettings() {
  render(<LibraryProvider><LlmSettingsForm /></LibraryProvider>);
}

describe("LLM connection test", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    backend.resetPreview();
  });

  it("does not test a connection when saving settings fails", async () => {
    vi.spyOn(backend, "saveLlmSettings").mockRejectedValue(new Error("凭据保存失败"));
    const testConnection = vi.spyOn(backend, "testLlmConnection");
    renderSettings();

    fireEvent.click(await screen.findByRole("button", { name: "测试连接" }));

    expect(await screen.findByText("凭据保存失败")).toBeInTheDocument();
    expect(testConnection).not.toHaveBeenCalled();
  });

  it("keeps settings actions disabled until the connection test completes", async () => {
    let finishTest!: () => void;
    vi.spyOn(backend, "testLlmConnection").mockImplementation(() => new Promise(resolve => { finishTest = resolve; }));
    renderSettings();

    const testButton = await screen.findByRole("button", { name: "测试连接" });
    fireEvent.click(testButton);

    await waitFor(() => expect(backend.testLlmConnection).toHaveBeenCalledOnce());
    expect(testButton).toBeDisabled();
    expect(screen.getByRole("button", { name: "保存 LLM 设置" })).toBeDisabled();
    finishTest();

    await screen.findByText("连接成功，可以在导入 PDF 时自动整理。");
    expect(testButton).toBeEnabled();
  });
});

import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SettingsView } from "./SettingsView";
import { backend } from "../services/backend";
import { LibraryProvider } from "../state/LibraryContext";

function openDataSettings() {
  render(<LibraryProvider><SettingsView /></LibraryProvider>);
  return screen.findByRole("button", { name: "本地数据" }).then(button => fireEvent.click(button));
}

describe("data settings errors", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    backend.resetPreview();
  });

  it("shows a backup error", async () => {
    vi.spyOn(backend, "backup").mockRejectedValue(new Error("磁盘空间不足"));
    await openDataSettings();

    fireEvent.click(await screen.findByRole("button", { name: "创建完整备份" }));

    expect(await screen.findByText("创建备份失败：磁盘空间不足")).toBeInTheDocument();
  });

  it("shows a restore error", async () => {
    vi.spyOn(backend, "restore").mockRejectedValue(new Error("备份包无效"));
    await openDataSettings();

    fireEvent.click(await screen.findByRole("button", { name: "从备份恢复" }));

    expect(await screen.findByText("恢复备份失败：备份包无效")).toBeInTheDocument();
  });
});

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SettingsView } from "./SettingsView";
import { backend } from "../services/backend";
import { LibraryProvider } from "../state/LibraryContext";

describe("profile settings errors", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    backend.resetPreview();
  });

  it("shows a profile save error", async () => {
    vi.spyOn(backend, "saveProfile").mockRejectedValue(new Error("数据库不可写"));
    render(<LibraryProvider><SettingsView /></LibraryProvider>);

    fireEvent.click(await screen.findByRole("button", { name: "保存个人资料" }));

    expect(await screen.findByText("保存个人资料失败：数据库不可写")).toBeInTheDocument();
  });

  it("saves pure black and restores the selected theme when settings reopen", async () => {
    const { unmount } = render(<LibraryProvider><SettingsView /></LibraryProvider>);
    const picker = await screen.findByRole("combobox", { name: "主题" });
    fireEvent.change(picker, { target: { value: "black-dark" } });
    fireEvent.click(screen.getByRole("button", { name: "保存个人资料" }));
    await waitFor(async () => expect((await backend.initialize()).profile).toMatchObject({ theme: "dark", visualTheme: "black" }));
    unmount();
    render(<LibraryProvider><SettingsView /></LibraryProvider>);
    expect(await screen.findByRole("combobox", { name: "主题" })).toHaveValue("black-dark");
  });
});

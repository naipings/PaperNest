import { fireEvent, render, screen } from "@testing-library/react";
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
});

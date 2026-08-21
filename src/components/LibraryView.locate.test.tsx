import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LibraryView } from "./LibraryView";
import { backend } from "../services/backend";
import { LibraryProvider } from "../state/LibraryContext";
import { seedSnapshot } from "../seed";

describe("library locate selection", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    backend.resetPreview();
  });

  it("marks the located paper row as selected", async () => {
    const paper = seedSnapshot.papers[0];
    render(
      <LibraryProvider>
        <LibraryView search="" searchHitPaperIds={[]} selectedId={paper.id} onSelect={() => undefined} onOpenPdf={() => undefined} />
      </LibraryProvider>
    );

    const row = await screen.findByText(paper.titleZh!);
    await waitFor(() => expect(row.closest("tr")).toHaveClass("selected"));
  });
});

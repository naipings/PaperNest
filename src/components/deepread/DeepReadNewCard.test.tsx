import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DeepReadNewCard } from "./DeepReadNewCard";
import type { Paper } from "../../types";

const paper = (id: string, titleEn: string, extra: Partial<Paper> = {}): Paper => ({
  id, titleEn, authors: [], tagIds: [], status: "unread", favorite: false, createdAt: "t", updatedAt: "t", pdfPath: `papers/${id}.pdf`, ...extra,
});

const papers = [
  paper("a", "Dense passage retrieval for question answering"),
  paper("b", "Retrieval augmented generation for question answering"),
  paper("c", "Image segmentation networks", { pdfPath: undefined }),
];

function renderCard(overrides: Partial<Parameters<typeof DeepReadNewCard>[0]> = {}) {
  const onCreateFromLibrary = vi.fn(async () => undefined);
  render(
    <DeepReadNewCard
      papers={papers}
      folders={[]}
      readPaperIds={new Set(["b"])}
      busy={false}
      ready
      onCreateFromLibrary={onCreateFromLibrary}
      onCreateFromFiles={async () => undefined}
      {...overrides}
    />,
  );
  return { onCreateFromLibrary };
}

describe("DeepReadNewCard", () => {
  it("disables papers without PDF and marks finished ones", () => {
    renderCard();
    expect((screen.getByRole("checkbox", { name: /Image segmentation/ }) as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByText("无 PDF")).toBeTruthy();
    expect(screen.getByText("已精读")).toBeTruthy();
  });

  it("creates deep reads for the selected library papers and clears the selection", async () => {
    const { onCreateFromLibrary } = renderCard();
    fireEvent.click(screen.getByRole("checkbox", { name: /Dense passage/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: /Retrieval augmented/ }));
    fireEvent.click(screen.getByRole("button", { name: "开始精读" }));
    await waitFor(() => expect(onCreateFromLibrary).toHaveBeenCalledWith([papers[0], papers[1]]));
    await waitFor(() => expect(screen.getByText("已选 0 篇")).toBeTruthy());
  });

  it("seeds from the knowledge tree with the neighborhood scope and the paper preselected", () => {
    renderCard({ seed: { paperId: "b", nonce: 1 } });
    expect((screen.getByLabelText("范围") as HTMLSelectElement).value).toBe("neighborhood");
    expect((screen.getByLabelText("知识树原点") as HTMLSelectElement).value).toBe("b");
    expect((screen.getByRole("checkbox", { name: /Retrieval augmented/ }) as HTMLInputElement).checked).toBe(true);
  });

  it("blocks creation until the research LLM is ready", () => {
    renderCard({ ready: false });
    fireEvent.click(screen.getByRole("checkbox", { name: /Dense passage/ }));
    expect((screen.getByRole("button", { name: "开始精读" }) as HTMLButtonElement).disabled).toBe(true);
  });
});

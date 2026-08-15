import { afterEach, describe, expect, it } from "vitest";
import { backend } from "./backend";

describe("preview library deletes", () => {
  afterEach(() => backend.resetPreview());

  it("removes vocabulary and excerpts", async () => {
    backend.resetPreview();
    await backend.deleteVocabulary("voc-1");
    await backend.deleteExcerpt("ext-1");
    const data = await backend.initialize();
    expect(data.vocabulary.some(item => item.id === "voc-1")).toBe(false);
    expect(data.excerpts.some(item => item.id === "ext-1")).toBe(false);
  });

  it("purges a paper only after it is in the trash", async () => {
    backend.resetPreview();
    await expect(backend.purgePaper("paper-1")).rejects.toThrow("回收站");
    const current = await backend.initialize();
    const paper = current.papers.find(item => item.id === "paper-1")!;
    await backend.savePaper({ ...paper, deletedAt: "2026-08-14T00:00:00Z" });
    await backend.purgePaper("paper-1");
    const next = await backend.initialize();
    expect(next.papers.some(item => item.id === "paper-1")).toBe(false);
    expect(next.vocabulary.some(item => item.paperId === "paper-1")).toBe(false);
  });
});

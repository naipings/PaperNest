import { describe, expect, it, vi } from "vitest";
import { resolveImportedPaper } from "./importDecisions";
import type { Paper } from "../types";

function paper(partial: Partial<Paper> & Pick<Paper, "id" | "titleEn">): Paper {
  return { authors: [], tagIds: [], status: "unread", favorite: false, createdAt: "2026-08-15T00:00:00Z", updatedAt: "2026-08-15T00:00:00Z", ...partial };
}

function io(keep: boolean) {
  return { confirmKeep: vi.fn(() => keep), save: vi.fn(async () => undefined), discard: vi.fn(async () => undefined) };
}

describe("resolveImportedPaper", () => {
  it("asks and discards the copy when the same file is imported twice", async () => {
    const existing = paper({ id: "a", titleEn: "KuaiSim", pdfSha256: "hash-1" });
    const incoming = paper({ id: "b", titleEn: "KuaiSim", pdfSha256: "hash-1" });
    const ports = io(false);
    const decision = await resolveImportedPaper(incoming, [existing, incoming], ports, new Set());
    expect(ports.confirmKeep).toHaveBeenCalledWith(existing, incoming);
    expect(ports.discard).toHaveBeenCalledWith(incoming);
    expect(decision.paper).toBeUndefined();
    expect(decision.catalog.map(item => item.id)).toEqual(["a"]);
  });

  it("awaits an async confirm dialog before keeping a duplicate", async () => {
    const existing = paper({ id: "a", titleEn: "KuaiSim", pdfSha256: "hash-1" });
    const incoming = paper({ id: "b", titleEn: "KuaiSim", pdfSha256: "hash-1" });
    let resolveAsk!: (value: boolean) => void;
    const ports = {
      confirmKeep: vi.fn(() => new Promise<boolean>(resolve => { resolveAsk = resolve; })),
      save: vi.fn(async () => undefined),
      discard: vi.fn(async () => undefined)
    };
    const pending = resolveImportedPaper(incoming, [existing, incoming], ports, new Set());
    expect(ports.discard).not.toHaveBeenCalled();
    resolveAsk(false);
    const decision = await pending;
    expect(ports.discard).toHaveBeenCalledWith(incoming);
    expect(decision.paper).toBeUndefined();
  });

  it("keeps the copy and reports it when the user confirms", async () => {
    const existing = paper({ id: "a", titleEn: "KuaiSim", pdfSha256: "hash-1" });
    const incoming = paper({ id: "b", titleEn: "KuaiSim", pdfSha256: "hash-1" });
    const ports = io(true);
    const decision = await resolveImportedPaper(incoming, [existing, incoming], ports, new Set());
    expect(ports.discard).not.toHaveBeenCalled();
    expect(decision.paper?.id).toBe("b");
    expect(decision.note).toContain("KuaiSim");
  });

  it("asks only once per paper across the cover and LLM passes", async () => {
    const existing = paper({ id: "a", titleEn: "KuaiSim", pdfSha256: "hash-1" });
    const incoming = paper({ id: "b", titleEn: "KuaiSim", pdfSha256: "hash-1" });
    const ports = io(true);
    const accepted = new Set<string>();
    const first = await resolveImportedPaper(incoming, [existing, incoming], ports, accepted);
    await resolveImportedPaper(first.paper!, first.catalog, ports, accepted);
    expect(ports.confirmKeep).toHaveBeenCalledTimes(1);
  });

  it("links a different arXiv version without asking", async () => {
    const existing = paper({ id: "a", titleEn: "Attention", arxivId: "1706.03762v1" });
    const incoming = paper({ id: "b", titleEn: "Attention", arxivId: "1706.03762v7" });
    const ports = io(false);
    const decision = await resolveImportedPaper(incoming, [existing, incoming], ports, new Set());
    expect(ports.confirmKeep).not.toHaveBeenCalled();
    expect(decision.paper?.relatedPaperIds).toEqual(["a"]);
    expect(ports.save).toHaveBeenCalledTimes(2);
    expect(decision.catalog.find(item => item.id === "a")?.relatedPaperIds).toEqual(["b"]);
  });

  it("passes a brand new paper straight through", async () => {
    const incoming = paper({ id: "b", titleEn: "Something Entirely New", pdfSha256: "hash-2" });
    const ports = io(false);
    const decision = await resolveImportedPaper(incoming, [incoming], ports, new Set());
    expect(ports.confirmKeep).not.toHaveBeenCalled();
    expect(decision.paper?.id).toBe("b");
    expect(decision.note).toBeUndefined();
  });
});

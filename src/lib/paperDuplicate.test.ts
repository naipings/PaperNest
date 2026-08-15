import { describe, expect, it } from "vitest";
import { classifyDuplicate, mergeVersionCluster } from "./paperDuplicate";
import type { Paper } from "../types";

function paper(partial: Partial<Paper> & Pick<Paper, "id" | "titleEn">): Paper {
  return { authors: [], tagIds: [], status: "unread", favorite: false, createdAt: "2026-08-15T00:00:00Z", updatedAt: "2026-08-15T00:00:00Z", ...partial };
}

describe("classifyDuplicate", () => {
  it("treats the same arXiv version as a duplicate", () => {
    const existing = paper({ id: "a", titleEn: "Attention Is All You Need", arxivId: "1706.03762v7" });
    const incoming = paper({ id: "b", titleEn: "Attention Is All You Need", arxivId: "1706.03762v7" });
    expect(classifyDuplicate(incoming, [existing])).toEqual({ kind: "same", paper: existing });
  });

  it("treats a different arXiv version as a version, not a duplicate", () => {
    const existing = paper({ id: "a", titleEn: "Attention Is All You Need", arxivId: "1706.03762v1" });
    const incoming = paper({ id: "b", titleEn: "Attention Is All You Need", arxivId: "1706.03762v7" });
    expect(classifyDuplicate(incoming, [existing])).toEqual({ kind: "version", paper: existing });
  });

  it("reads an arXiv id out of a 10.48550 DOI", () => {
    const existing = paper({ id: "a", titleEn: "Attention Is All You Need", doi: "10.48550/arXiv.1706.03762v1" });
    const incoming = paper({ id: "b", titleEn: "Other Title", arxivId: "1706.03762v7" });
    expect(classifyDuplicate(incoming, [existing])).toEqual({ kind: "version", paper: existing });
  });

  it("treats the same DOI as a duplicate when versions are absent", () => {
    const existing = paper({ id: "a", titleEn: "A Paper", doi: "10.5555/3295222.3295349" });
    const incoming = paper({ id: "b", titleEn: "Different Filename", doi: "10.5555/3295222.3295349" });
    expect(classifyDuplicate(incoming, [existing])).toEqual({ kind: "same", paper: existing });
  });

  it("treats the same PDF hash as a duplicate even when titles differ", () => {
    const existing = paper({ id: "a", titleEn: "1706.03762", pdfSha256: "abc" });
    const incoming = paper({ id: "b", titleEn: "Attention Is All You Need", pdfSha256: "abc" });
    expect(classifyDuplicate(incoming, [existing])).toEqual({ kind: "same", paper: existing });
  });

  it("asks instead of guessing when only one side carries a version", () => {
    const existing = paper({ id: "a", titleEn: "Attention Is All You Need", arxivId: "1706.03762" });
    const incoming = paper({ id: "b", titleEn: "Attention Is All You Need", arxivId: "1706.03762v7" });
    expect(classifyDuplicate(incoming, [existing])).toEqual({ kind: "same", paper: existing });
  });

  it("treats an arXiv filename stem as the same paper", () => {
    const existing = paper({ id: "a", titleEn: "1706.03762" });
    const incoming = paper({ id: "b", titleEn: "1706.03762" });
    expect(classifyDuplicate(incoming, [existing])).toEqual({ kind: "same", paper: existing });
  });
});

describe("mergeVersionCluster", () => {
  it("links both papers and keeps an existing third version", () => {
    const first = paper({ id: "a", titleEn: "Attention", arxivId: "1706.03762v1", relatedPaperIds: ["c"] });
    const third = paper({ id: "c", titleEn: "Attention", arxivId: "1706.03762v2", relatedPaperIds: ["a"] });
    const incoming = paper({ id: "b", titleEn: "Attention", arxivId: "1706.03762v7" });
    const cluster = mergeVersionCluster(incoming, first, [first, third]);
    expect(cluster.find(item => item.id === "b")?.relatedPaperIds).toEqual(["a", "c"]);
    expect(cluster.find(item => item.id === "a")?.relatedPaperIds).toEqual(["b", "c"]);
    expect(cluster.find(item => item.id === "c")?.relatedPaperIds).toEqual(["a", "b"]);
  });
});

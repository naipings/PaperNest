import { describe, expect, it } from "vitest";
import type { Paper } from "../types";
import { deepReadCandidates } from "./deepReadCandidates";

const paper = (id: string, titleEn: string, extra: Partial<Paper> = {}): Paper => ({
  id, titleEn, authors: [], tagIds: [], status: "unread", favorite: false, createdAt: "t", updatedAt: "t", ...extra,
});

const papers = [
  paper("a", "Dense passage retrieval for open domain question answering"),
  paper("b", "Retrieval augmented generation for question answering", { folderId: "f1" }),
  paper("c", "Image segmentation with convolutional networks", { folderId: "f1" }),
  paper("d", "Deleted retrieval paper", { deletedAt: "t" }),
];

describe("deepReadCandidates", () => {
  it("lists active papers and filters by keyword", () => {
    expect(deepReadCandidates(papers, { kind: "all" }, "").map(p => p.id)).toEqual(["a", "b", "c"]);
    expect(deepReadCandidates(papers, { kind: "all" }, "RETRIEVAL").map(p => p.id)).toEqual(["a", "b"]);
  });

  it("limits to one folder", () => {
    expect(deepReadCandidates(papers, { kind: "folder", id: "f1" }, "").map(p => p.id)).toEqual(["b", "c"]);
  });

  it("orders the knowledge-tree neighborhood by similarity with the origin first", () => {
    expect(deepReadCandidates(papers, { kind: "neighborhood", originId: "a" }, "").map(p => p.id)).toEqual(["a", "b", "c"]);
    expect(deepReadCandidates(papers, { kind: "neighborhood", originId: "d" }, "")).toEqual([]);
  });
});

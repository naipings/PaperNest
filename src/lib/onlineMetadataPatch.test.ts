import { describe, expect, it } from "vitest";
import type { OnlineMetadataCandidate, Paper } from "../types";
import { applyMetadataPatch, buildMetadataFieldRows } from "./onlineMetadataPatch";

const paper: Paper = {
  id: "p1",
  titleEn: "draft title",
  authors: [],
  tagIds: [],
  status: "unread",
  favorite: false,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const candidate: OnlineMetadataCandidate = {
  titleEn: "Attention Is All You Need",
  authors: ["Ashish Vaswani"],
  abstractEn: "Abstract text",
  venue: "NeurIPS",
  publicationDate: "2017",
  doi: "10.5555/3295222.3295349",
  sourceUrl: "https://doi.org/10.5555/3295222.3295349",
};

describe("buildMetadataFieldRows", () => {
  it("prefills empty fields and keeps filled fields unchecked by default", () => {
    const rows = buildMetadataFieldRows(paper, candidate);
    expect(rows.find(row => row.key === "authors")?.defaultAccepted).toBe(true);
    expect(rows.find(row => row.key === "titleEn")?.defaultAccepted).toBe(false);
  });

  it("skips identical values", () => {
    const rows = buildMetadataFieldRows(
      { ...paper, titleEn: candidate.titleEn!, doi: candidate.doi },
      candidate
    );
    expect(rows.some(row => row.key === "titleEn")).toBe(false);
    expect(rows.some(row => row.key === "doi")).toBe(false);
  });
});

describe("applyMetadataPatch", () => {
  it("writes only accepted fields", () => {
    const next = applyMetadataPatch(paper, candidate, new Set(["authors", "doi", "venue"]));
    expect(next.titleEn).toBe("draft title");
    expect(next.authors.map(author => author.name)).toEqual(["Ashish Vaswani"]);
    expect(next.doi).toBe(candidate.doi);
    expect(next.venue).toBe(candidate.venue);
    expect(next.abstractEn).toBeUndefined();
  });
});

import { describe, expect, it } from "vitest";
import { seedSnapshot } from "../seed";
import { filterPapers, normalize, paperHaystack } from "./search";

const allView = { id: "all", name: "全部", filter: {}, sorting: [], columnVisibility: {}, density: "comfortable" as const };

describe("local bilingual search", () => {
  it("normalizes width, case and spaces", () => expect(normalize("  ＴransFormer   MODEL ")).toBe("transformer model"));
  it("finds Chinese titles", () => expect(filterPapers(seedSnapshot, "目标检测", allView).map(p => p.id)).toContain("paper-2"));
  it("finds vocabulary and example sentences", () => expect(paperHaystack(seedSnapshot.papers[0], seedSnapshot)).toContain("sequence transduction"));
  it("applies status views", () => expect(filterPapers(seedSnapshot, "", { ...allView, filter: { status: "reading" } }).map(p => p.id)).toEqual(["paper-2"]));
  it("filters favorited papers only", () => expect(filterPapers(seedSnapshot, "", { ...allView, filter: { favorite: true } }).map(p => p.id)).toEqual(["paper-1"]));
  it("keeps deleted papers out of normal views", () => { const data = structuredClone(seedSnapshot); data.papers[0].deletedAt = new Date().toISOString(); expect(filterPapers(data, "attention", allView)).toHaveLength(0); expect(filterPapers(data, "attention", allView, true)).toHaveLength(1); });
  it("filters by folder membership", () => {
    const data = structuredClone(seedSnapshot);
    data.folders = [{ id: "folder-cs", name: "CS", position: 0, createdAt: "2026-08-25T00:00:00Z", updatedAt: "2026-08-25T00:00:00Z" }];
    data.papers[0].folderId = "folder-cs";
    expect(filterPapers(data, "", { ...allView, filter: { folderId: "folder-cs" } }).map(p => p.id)).toEqual(["paper-1"]);
    expect(filterPapers(data, "", { ...allView, filter: { unfiledOnly: true } }).map(p => p.id)).toEqual(["paper-2", "paper-3"]);
  });
});

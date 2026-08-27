import { describe, expect, it } from "vitest";
import { analysisNeedsBackfill, applyAnalysisFillEmpty, liteAnalysisSeed, mergeAnalyses, mergeFrameworkFields } from "./importLlmFill";
import type { Paper } from "../types";

const paper = (overrides: Partial<Paper> = {}): Paper => ({
  id: "p1",
  titleEn: "Item-Ranking Promotion in Recommender Systems",
  authors: [],
  tagIds: [],
  status: "unread",
  favorite: false,
  createdAt: "",
  updatedAt: "",
  relatedPaperIds: [],
  ...overrides
});

describe("importLlmFill", () => {
  it("flags missing summary or vocabulary for backfill", () => {
    expect(analysisNeedsBackfill({ abstractEn: "x".repeat(100) }, paper())).toBe(true);
    expect(analysisNeedsBackfill({ summary: "一句话", vocabulary: [{ termEn: "IRP", meaningZh: "物品排序推广" }] }, paper())).toBe(false);
    expect(analysisNeedsBackfill({}, paper({ summary: "已有总结" }))).toBe(true);
  });

  it("builds a compact seed from title and abstract", () => {
    const seed = liteAnalysisSeed(paper({ abstractEn: "In this paper, we first define the item-ranking promotion problem for recommender systems and propose multi-objective optimization." }), undefined, "");
    expect(seed).toMatch(/Item-Ranking Promotion/);
    expect(seed).toMatch(/must|必须/);
    expect(seed).toMatch(/vocabulary/);
  });

  it("keeps primary summary and fills vocabulary from the backfill pass", () => {
    const merged = mergeAnalyses(
      { summary: "本文研究推荐系统中的物品排序推广。", abstractEn: "Abstract body." },
      { summary: "忽略", vocabulary: [{ termEn: "IRP", meaningZh: "物品排序推广" }] }
    );
    expect(merged.summary).toMatch(/物品排序推广/);
    expect(merged.vocabulary?.[0].termEn).toBe("IRP");
  });

  it("merges only framework fields from the vision pass", () => {
    const merged = mergeFrameworkFields(
      { summary: "总结", vocabulary: [{ termEn: "A", meaningZh: "甲" }] },
      { summary: "视觉摘要应被忽略", frameworkPage: 3, frameworkTitle: "方法框架" }
    );
    expect(merged.summary).toBe("总结");
    expect(merged.frameworkPage).toBe(3);
    expect(merged.frameworkTitle).toBe("方法框架");
  });

  it("fill-empty keeps cached zh fields and fills missing venue", () => {
    const current = paper({
      titleZh: "缓存中文标题",
      abstractZh: "缓存中文摘要",
      summary: "缓存一句话",
      abstractEn: "English abstract from arxiv.",
      authors: [{ id: "a1", name: "Alice" }],
    });
    const next = applyAnalysisFillEmpty(current, {
      titleZh: "LLM 想覆盖的标题",
      abstractZh: "LLM 想覆盖的摘要",
      summary: "LLM 总结",
      venue: "NeurIPS",
      authors: ["Ada Lovelace"],
    });
    expect(next.titleZh).toBe("缓存中文标题");
    expect(next.abstractZh).toBe("缓存中文摘要");
    expect(next.summary).toBe("缓存一句话");
    expect(next.venue).toBe("NeurIPS");
    expect(next.authors.map(a => a.name)).toEqual(["Alice"]);
  });

  it("fill-empty adds authors only when paper has none", () => {
    const next = applyAnalysisFillEmpty(paper(), {
      authors: ["Grace Hopper", "1"],
      summary: "一句话",
    });
    expect(next.authors.map(a => a.name)).toEqual(["Grace Hopper"]);
    expect(next.summary).toBe("一句话");
  });
});

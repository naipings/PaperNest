import { describe, expect, it } from "vitest";
import { analysisNeedsBackfill, liteAnalysisSeed, mergeAnalyses, mergeFrameworkFields } from "./importLlmFill";
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
});

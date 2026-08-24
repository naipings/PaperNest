import { describe, expect, it } from "vitest";
import { formatTaxonomyImportNote, mergeTaxonomyIntoPaper, taxonomyInputFromPaper } from "./taxonomyClassify";
import type { Category, LlmTaxonomyResult, Paper, Tag } from "../types";

function paper(partial: Partial<Paper> = {}): Paper {
  return {
    id: "p1",
    titleEn: "Attention Is All You Need",
    titleZh: "注意力机制就是你所需要的一切",
    authors: [],
    tagIds: [],
    status: "unread",
    favorite: false,
    createdAt: "2026-08-15T00:00:00Z",
    updatedAt: "2026-08-15T00:00:00Z",
    ...partial,
  };
}

const categories: Category[] = [{ id: "cat-nlp", name: "自然语言处理", color: "#3b8d89" }];
const tags: Tag[] = [
  { id: "tag-transformer", name: "Transformer", color: "#8b7bd6" },
  { id: "tag-llm", name: "大语言模型", color: "#6b7fd6" },
];

describe("taxonomyClassify", () => {
  it("builds taxonomy input from paper fields", () => {
    expect(taxonomyInputFromPaper(paper({ abstractEn: "abs", summary: "sum" }))).toEqual({
      titleEn: "Attention Is All You Need",
      titleZh: "注意力机制就是你所需要的一切",
      abstractEn: "abs",
      abstractZh: undefined,
      summary: "sum",
    });
  });

  it("writes category and tags only when paper has none", () => {
    const result: LlmTaxonomyResult = {
      categoryId: "cat-nlp",
      tagIds: ["tag-transformer", "tag-llm"],
      abstain: false,
    };
    const next = mergeTaxonomyIntoPaper(paper(), result);
    expect(next.categoryId).toBe("cat-nlp");
    expect(next.tagIds).toEqual(["tag-transformer", "tag-llm"]);
  });

  it("keeps existing category and tags", () => {
    const result: LlmTaxonomyResult = {
      categoryId: "cat-nlp",
      tagIds: ["tag-llm"],
      abstain: false,
    };
    const withCategory = mergeTaxonomyIntoPaper(paper({ categoryId: "cat-cv" }), result);
    expect(withCategory.categoryId).toBe("cat-cv");
    expect(withCategory.tagIds).toEqual([]);

    const withTags = mergeTaxonomyIntoPaper(paper({ tagIds: ["tag-beginner"] }), result);
    expect(withTags.categoryId).toBeUndefined();
    expect(withTags.tagIds).toEqual(["tag-beginner"]);
  });

  it("does not write when abstain", () => {
    const next = mergeTaxonomyIntoPaper(paper(), {
      categoryId: null,
      tagIds: [],
      abstain: true,
      reason: "域外",
    });
    expect(next.categoryId).toBeUndefined();
    expect(next.tagIds).toEqual([]);
  });

  it("formats import notes for classified and abstained papers", () => {
    expect(formatTaxonomyImportNote(paper(), {
      categoryId: "cat-nlp",
      tagIds: ["tag-transformer", "tag-llm"],
      abstain: false,
    }, categories, tags)).toBe("《注意力机制就是你所需要的一切》（主领域：自然语言处理；标签：Transformer、大语言模型）");

    expect(formatTaxonomyImportNote(paper({ titleZh: undefined }), {
      categoryId: null,
      tagIds: [],
      abstain: true,
    }, categories, tags)).toBe("《Attention Is All You Need》（未匹配现有主领域，保持未分类）");
  });
});

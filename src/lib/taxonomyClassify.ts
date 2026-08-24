import type { Category, LlmTaxonomyInput, LlmTaxonomyResult, Paper, Tag } from "../types";
import { now } from "../types";

export function taxonomyInputFromPaper(paper: Paper): LlmTaxonomyInput {
  return {
    titleEn: paper.titleEn,
    titleZh: paper.titleZh,
    abstractEn: paper.abstractEn,
    abstractZh: paper.abstractZh,
    summary: paper.summary,
  };
}

export function mergeTaxonomyIntoPaper(paper: Paper, result: LlmTaxonomyResult): Paper {
  if (paper.categoryId || paper.tagIds.length) return paper;
  if (result.abstain || !result.categoryId) return paper;
  return {
    ...paper,
    categoryId: result.categoryId,
    tagIds: [...result.tagIds],
    updatedAt: now(),
  };
}

export function formatTaxonomyImportNote(
  paper: Paper,
  result: LlmTaxonomyResult,
  categories: Category[],
  tags: Tag[],
): string {
  const title = paper.titleZh || paper.titleEn;
  if (result.abstain || !result.categoryId) {
    return `《${title}》（未匹配现有主领域，保持未分类）`;
  }
  const categoryName = categories.find(item => item.id === result.categoryId)?.name ?? result.categoryId;
  const tagNames = result.tagIds
    .map(id => tags.find(item => item.id === id)?.name)
    .filter((name): name is string => Boolean(name));
  const tagPart = tagNames.length ? `；标签：${tagNames.join("、")}` : "";
  return `《${title}》（主领域：${categoryName}${tagPart}）`;
}

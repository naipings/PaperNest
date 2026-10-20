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

export type TaxonomyAssignResult = {
  saved: number;
  abstained: number;
  failed: number;
  skipped: number;
  notes: string[];
};

export function uncategorizedPapers(papers: Paper[]) {
  return papers.filter(paper => !paper.categoryId && paper.tagIds.length === 0);
}

export function formatTaxonomyAssignResult(result: TaxonomyAssignResult) {
  const parts = [`已分配 ${result.saved} 篇`];
  if (result.abstained) parts.push(`未匹配 ${result.abstained} 篇`);
  if (result.failed) parts.push(`失败 ${result.failed} 篇`);
  if (result.skipped) parts.push(`跳过已分类 ${result.skipped} 篇`);
  const summary = parts.join("，");
  if (!result.notes.length || result.notes.length > 5) return summary;
  return `${summary}。${result.notes.join("；")}`;
}

/** 只给没有主领域、也没有子领域的论文写入词表分类。已有分类的论文不调用保存。 */
export async function assignTaxonomyToUncategorized(
  papers: Paper[],
  categories: Category[],
  tags: Tag[],
  ports: {
    classify(input: LlmTaxonomyInput): Promise<LlmTaxonomyResult>;
    save(paper: Paper): Promise<void>;
  },
  onProgress?: (done: number, total: number, paper: Paper) => void,
): Promise<TaxonomyAssignResult> {
  const pending = uncategorizedPapers(papers);
  const result: TaxonomyAssignResult = {
    saved: 0,
    abstained: 0,
    failed: 0,
    skipped: papers.length - pending.length,
    notes: [],
  };
  for (let index = 0; index < pending.length; index++) {
    const paper = pending[index];
    onProgress?.(index + 1, pending.length, paper);
    const title = paper.titleZh || paper.titleEn;
    try {
      const taxonomy = await ports.classify(taxonomyInputFromPaper(paper));
      const filled = mergeTaxonomyIntoPaper(paper, taxonomy);
      if (filled !== paper) {
        await ports.save(filled);
        result.saved += 1;
      } else {
        result.abstained += 1;
      }
      result.notes.push(formatTaxonomyImportNote(filled, taxonomy, categories, tags));
    } catch (error) {
      result.failed += 1;
      result.notes.push(`《${title}》（自动分类失败：${error instanceof Error ? error.message : String(error)}）`);
    }
  }
  return result;
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

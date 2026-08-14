import type { LibrarySnapshot, Paper, SavedView } from "../types";

export function normalize(value: string) {
  return value.normalize("NFKC").toLocaleLowerCase().replace(/\s+/g, " ").trim();
}

export function paperHaystack(paper: Paper, data: LibrarySnapshot) {
  const category = data.categories.find((item) => item.id === paper.categoryId)?.name ?? "";
  const tags = data.tags.filter((item) => paper.tagIds.includes(item.id)).map((item) => item.name);
  const vocab = data.vocabulary.filter((item) => item.paperId === paper.id).flatMap((item) => [item.termEn, item.meaningZh, item.sentenceEn, item.sentenceZh]);
  const excerpts = data.excerpts.filter((item) => item.paperId === paper.id).flatMap((item) => [item.sourceText, item.translationZh, item.personalRewrite]);
  const annotations = data.annotations.filter((item) => item.paperId === paper.id).flatMap((item) => [item.quote, item.comment]);
  return normalize([paper.titleEn, paper.titleZh, paper.summary, paper.abstractEn, paper.abstractZh, paper.venue, paper.doi, paper.arxivId, ...paper.authors.map(a => a.name), category, ...tags, ...vocab, ...excerpts, ...annotations].filter(Boolean).join(" "));
}

export function filterPapers(data: LibrarySnapshot, search: string, view: SavedView, includeDeleted = false) {
  const query = normalize(search);
  return data.papers.filter((paper) => {
    if (includeDeleted !== Boolean(paper.deletedAt)) return false;
    if (query && !paperHaystack(paper, data).includes(query)) return false;
    if (view.filter.status && paper.status !== view.filter.status) return false;
    if (view.filter.categoryId && paper.categoryId !== view.filter.categoryId) return false;
    if (view.filter.uncategorized && paper.categoryId) return false;
    if (view.filter.missingInfo && paper.titleEn && paper.authors.length && paper.venue) return false;
    return true;
  });
}

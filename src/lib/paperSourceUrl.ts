import type { Paper } from "../types";

/** Prefer sourceUrl; fall back to DOI / arXiv landing pages. */
export function resolvePaperSourceUrl(paper: Pick<Paper, "sourceUrl" | "doi" | "arxivId">) {
  const source = paper.sourceUrl?.trim();
  if (source) return source;
  const doi = paper.doi?.trim().replace(/^https?:\/\/(dx\.)?doi\.org\//i, "");
  if (doi) return `https://doi.org/${doi}`;
  const preprint = paper.arxivId?.trim().replace(/^arxiv:/i, "");
  if (preprint && /^10\.(1101|64898)\//i.test(preprint)) return `https://www.medrxiv.org/content/${preprint}`;
  if (preprint) return `https://arxiv.org/abs/${preprint}`;
  return undefined;
}

import type { Paper } from "../types";

/** Prefer sourceUrl; fall back to DOI / arXiv landing pages. */
export function resolvePaperSourceUrl(paper: Pick<Paper, "sourceUrl" | "doi" | "arxivId">) {
  const source = paper.sourceUrl?.trim();
  if (source) return source;
  const doi = paper.doi?.trim().replace(/^https?:\/\/(dx\.)?doi\.org\//i, "");
  if (doi) return `https://doi.org/${doi}`;
  const record = paper.arxivId?.trim().replace(/^arxiv:/i, "");
  if (record?.toLowerCase().startsWith("pmid:")) return `https://pubmed.ncbi.nlm.nih.gov/${record.slice(5)}/`;
  if (record && /^10\.(1101|64898)\//i.test(record)) return `https://www.medrxiv.org/content/${record}`;
  if (record) return `https://arxiv.org/abs/${record}`;
  return undefined;
}

import type { Paper } from "../types";
import { now } from "../types";

export type DuplicateMatch = { kind: "same" | "version"; paper: Paper };

export function arxivBase(id?: string) {
  if (!id) return "";
  return id.trim().toLowerCase().replace(/^arxiv:\s*/, "").replace(/v\d+$/i, "");
}

export function arxivVersion(id?: string) {
  const match = id?.trim().toLowerCase().match(/v(\d+)$/);
  return match ? Number(match[1]) : undefined;
}

export function arxivFromDoi(doi?: string) {
  return doi?.match(/10\.48550\/arxiv\.(\d{4}\.\d{4,5}(?:v\d+)?)/i)?.[1];
}

export function arxivFromText(value?: string) {
  return value?.match(/\b(\d{4}\.\d{4,5}(?:v\d+)?)\b/)?.[1];
}

export function paperArxivId(paper: Paper) {
  return paper.arxivId || arxivFromDoi(paper.doi) || arxivFromText(paper.titleEn);
}

export function normalizedTitle(value?: string) {
  return (value ?? "").normalize("NFKC").toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]/g, "");
}

export function classifyDuplicate(incoming: Paper, existing: Paper[]): DuplicateMatch | undefined {
  const live = existing.filter(paper => !paper.deletedAt && paper.id !== incoming.id);
  if (incoming.pdfSha256) {
    const hit = live.find(paper => paper.pdfSha256 && paper.pdfSha256 === incoming.pdfSha256);
    if (hit) return { kind: "same", paper: hit };
  }
  const incomingArxiv = paperArxivId(incoming);
  const incomingBase = arxivBase(incomingArxiv);
  if (incomingBase) {
    const hit = live.find(paper => arxivBase(paperArxivId(paper)) === incomingBase);
    if (hit) {
      const incomingVersion = arxivVersion(incomingArxiv);
      const hitVersion = arxivVersion(paperArxivId(hit));
      const bothVersioned = incomingVersion !== undefined && hitVersion !== undefined;
      if (bothVersioned && incomingVersion !== hitVersion) return { kind: "version", paper: hit };
      return { kind: "same", paper: hit };
    }
  }
  if (incoming.doi?.trim()) {
    const doi = incoming.doi.trim().toLowerCase();
    const hit = live.find(paper => paper.doi?.trim().toLowerCase() === doi);
    if (hit) return { kind: "same", paper: hit };
  }
  const title = normalizedTitle(incoming.titleEn);
  if (title.length >= 8) {
    const hit = live.find(paper => normalizedTitle(paper.titleEn) === title || normalizedTitle(paper.titleZh) === title);
    if (hit) return { kind: "same", paper: hit };
  }
}

export function mergeVersionCluster(incoming: Paper, match: Paper, library: Paper[]) {
  const byId = new Map(library.map(paper => [paper.id, paper]));
  byId.set(incoming.id, incoming);
  byId.set(match.id, match);
  const cluster = new Set<string>([incoming.id, match.id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const id of [...cluster]) {
      for (const related of byId.get(id)?.relatedPaperIds ?? []) {
        if (!cluster.has(related) && byId.has(related)) {
          cluster.add(related);
          grew = true;
        }
      }
    }
  }
  const ids = [...cluster];
  const timestamp = now();
  return ids.map(id => {
    const paper = byId.get(id)!;
    return { ...paper, relatedPaperIds: ids.filter(other => other !== id).sort(), updatedAt: timestamp };
  });
}

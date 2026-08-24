import type { OnlineMetadataCandidate, Paper } from "../types";
import { now, uuid } from "../types";

export type MetadataFieldKey =
  | "titleEn"
  | "authors"
  | "abstractEn"
  | "venue"
  | "publicationDate"
  | "doi"
  | "sourceUrl";

export type MetadataFieldRow = {
  key: MetadataFieldKey;
  label: string;
  current: string;
  next: string;
  defaultAccepted: boolean;
};

const FIELD_LABELS: Record<MetadataFieldKey, string> = {
  titleEn: "英文标题",
  authors: "作者",
  abstractEn: "英文摘要",
  venue: "期刊 / 会议",
  publicationDate: "发布日期",
  doi: "DOI",
  sourceUrl: "原文链接",
};

function displayAuthors(paper: Paper) {
  return paper.authors.map(author => author.name).join("、");
}

function displayCandidateAuthors(candidate: OnlineMetadataCandidate) {
  return candidate.authors.join("、");
}

function hasText(value?: string) {
  return Boolean(value?.trim());
}

export function buildMetadataFieldRows(paper: Paper, candidate: OnlineMetadataCandidate): MetadataFieldRow[] {
  const pairs: { key: MetadataFieldKey; current: string; next: string }[] = [
    { key: "titleEn", current: paper.titleEn, next: candidate.titleEn ?? "" },
    { key: "authors", current: displayAuthors(paper), next: displayCandidateAuthors(candidate) },
    { key: "abstractEn", current: paper.abstractEn ?? "", next: candidate.abstractEn ?? "" },
    { key: "venue", current: paper.venue ?? "", next: candidate.venue ?? "" },
    { key: "publicationDate", current: paper.publicationDate ?? "", next: candidate.publicationDate ?? "" },
    { key: "doi", current: paper.doi ?? "", next: candidate.doi ?? "" },
    { key: "sourceUrl", current: paper.sourceUrl ?? "", next: candidate.sourceUrl ?? "" },
  ];
  return pairs
    .filter(item => hasText(item.next) && item.current.trim() !== item.next.trim())
    .map(item => ({
      key: item.key,
      label: FIELD_LABELS[item.key],
      current: item.current.trim() || "—",
      next: item.next.trim(),
      defaultAccepted: !hasText(item.current),
    }));
}

export function applyMetadataPatch(
  paper: Paper,
  candidate: OnlineMetadataCandidate,
  accepted: Set<MetadataFieldKey>
): Paper {
  let next: Paper = { ...paper, updatedAt: now() };
  if (accepted.has("titleEn") && candidate.titleEn) next = { ...next, titleEn: candidate.titleEn };
  if (accepted.has("authors") && candidate.authors.length) {
    next = {
      ...next,
      authors: candidate.authors.map(name => ({ id: uuid(), name })),
    };
  }
  if (accepted.has("abstractEn") && candidate.abstractEn) next = { ...next, abstractEn: candidate.abstractEn };
  if (accepted.has("venue") && candidate.venue) next = { ...next, venue: candidate.venue };
  if (accepted.has("publicationDate") && candidate.publicationDate) {
    next = { ...next, publicationDate: candidate.publicationDate };
  }
  if (accepted.has("doi") && candidate.doi) next = { ...next, doi: candidate.doi };
  if (accepted.has("sourceUrl") && candidate.sourceUrl) next = { ...next, sourceUrl: candidate.sourceUrl };
  return next;
}

import type { LlmAnalysis, Paper } from "../types";
import { now, uuid } from "../types";

export function analysisNeedsBackfill(analysis: LlmAnalysis | undefined, paper: Paper) {
  const summary = analysis?.summary?.trim() || paper.summary?.trim();
  const vocab = analysis?.vocabulary?.filter(item => item.termEn?.trim() && item.meaningZh?.trim()) ?? [];
  return !summary || vocab.length === 0;
}

/** Compact prompt seed: title+abstract first; otherwise a short slice of extracted PDF text. */
export function liteAnalysisSeed(paper: Paper, analysis: LlmAnalysis | undefined, fullText: string) {
  const title = analysis?.titleEn?.trim() || paper.titleEn;
  const abs = analysis?.abstractEn?.trim() || paper.abstractEn?.trim() || "";
  if (abs.length >= 80) {
    return `Title: ${title}\n\nAbstract:\n${abs}\n\n根据标题与摘要填写 JSON。必须给出非空的中文 summary（一句话），以及至少 5 项 vocabulary（termEn、meaningZh、sentenceEn、sentenceZh；page 用数字或 null）。abstractEn 可保留或 refining；abstractZh 用计算机科学论文学术语体简体中文。`;
  }
  return fullText.slice(0, 12_000);
}

export function mergeAnalyses(primary: LlmAnalysis | undefined, extra: LlmAnalysis): LlmAnalysis {
  if (!primary) return extra;
  const pick = (left?: string, right?: string) => (left?.trim() ? left : right);
  const vocabulary = primary.vocabulary?.filter(item => item.termEn?.trim() && item.meaningZh?.trim()).length
    ? primary.vocabulary
    : extra.vocabulary;
  return {
    titleEn: pick(primary.titleEn, extra.titleEn),
    titleZh: pick(primary.titleZh, extra.titleZh),
    authors: primary.authors?.length ? primary.authors : extra.authors,
    abstractEn: pick(primary.abstractEn, extra.abstractEn),
    abstractZh: pick(primary.abstractZh, extra.abstractZh),
    summary: pick(primary.summary, extra.summary),
    venue: pick(primary.venue, extra.venue),
    publicationDate: pick(primary.publicationDate, extra.publicationDate),
    doi: pick(primary.doi, extra.doi),
    sourceUrl: pick(primary.sourceUrl, extra.sourceUrl),
    frameworkPage: primary.frameworkPage ?? extra.frameworkPage,
    frameworkTitle: pick(primary.frameworkTitle, extra.frameworkTitle),
    frameworkExplanationEn: pick(primary.frameworkExplanationEn, extra.frameworkExplanationEn),
    frameworkExplanationZh: pick(primary.frameworkExplanationZh, extra.frameworkExplanationZh),
    vocabulary
  };
}

/** Keep text-path metadata; take framework fields from a vision pass when present. */
export function mergeFrameworkFields(textAnalysis: LlmAnalysis, visionAnalysis: LlmAnalysis): LlmAnalysis {
  return {
    ...textAnalysis,
    frameworkPage: visionAnalysis.frameworkPage ?? textAnalysis.frameworkPage,
    frameworkTitle: visionAnalysis.frameworkTitle?.trim() ? visionAnalysis.frameworkTitle : textAnalysis.frameworkTitle,
    frameworkExplanationEn: visionAnalysis.frameworkExplanationEn?.trim() ? visionAnalysis.frameworkExplanationEn : textAnalysis.frameworkExplanationEn,
    frameworkExplanationZh: visionAnalysis.frameworkExplanationZh?.trim() ? visionAnalysis.frameworkExplanationZh : textAnalysis.frameworkExplanationZh
  };
}

/** 仅填补空字段；已有解读缓存 / arXiv 元数据不被 LLM 覆盖。 */
export function applyAnalysisFillEmpty(paper: Paper, analysis: LlmAnalysis): Paper {
  const blank = (value?: string | null) => !value?.trim();
  const fill = (current: string | undefined, next?: string) =>
    blank(current) && next?.trim() ? next.trim() : current;
  const llmAuthors = analysis.authors
    ?.map(name => name.trim())
    .filter(name => name && !/^[\d\s.+*†‡§¶,-]+$/.test(name))
    .map(name => ({ id: uuid(), name }));
  const authors = paper.authors.length
    ? paper.authors
    : (llmAuthors?.length ? llmAuthors : paper.authors);
  return {
    ...paper,
    titleEn: (!blank(paper.titleEn) ? paper.titleEn : (analysis.titleEn?.trim() || paper.titleEn)),
    titleZh: fill(paper.titleZh, analysis.titleZh),
    authors,
    abstractEn: fill(paper.abstractEn, analysis.abstractEn),
    abstractZh: fill(paper.abstractZh, analysis.abstractZh),
    summary: fill(paper.summary, analysis.summary),
    venue: fill(paper.venue, analysis.venue),
    publicationDate: fill(paper.publicationDate, analysis.publicationDate),
    doi: fill(paper.doi, analysis.doi),
    sourceUrl: fill(paper.sourceUrl, analysis.sourceUrl),
    updatedAt: now(),
  };
}

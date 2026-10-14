import type { Paper } from "../types";
import { neighborhoodIndices, similarityMatrix } from "./knowledgeGraph";

export type DeepReadScope =
  | { kind: "all" }
  | { kind: "folder"; id: string }
  | { kind: "neighborhood"; originId: string };

const NEIGHBORHOOD_SIZE = 40;
const GRAPH_PAPER_LIMIT = 200;

/** 精读候选：论文库范围（全部 / 文件夹 / 知识树邻域）+ 关键词过滤。邻域与「本地知识树」同一相似度和规模，按相似度排序。 */
export function deepReadCandidates(papers: Paper[], scope: DeepReadScope, query: string): Paper[] {
  const active = papers.filter(paper => !paper.deletedAt);
  let scoped: Paper[];
  if (scope.kind === "folder") {
    scoped = active.filter(paper => paper.folderId === scope.id);
  } else if (scope.kind === "neighborhood") {
    const graphPapers = active.slice(0, GRAPH_PAPER_LIMIT);
    const origin = graphPapers.findIndex(paper => paper.id === scope.originId);
    scoped = origin < 0
      ? []
      : neighborhoodIndices(similarityMatrix(graphPapers), origin, NEIGHBORHOOD_SIZE).map(index => graphPapers[index]);
  } else {
    scoped = active;
  }
  const needle = query.trim().toLowerCase();
  if (!needle) return scoped;
  return scoped.filter(paper =>
    `${paper.titleEn} ${paper.titleZh ?? ""} ${paper.authors.map(author => author.name).join(" ")}`.toLowerCase().includes(needle),
  );
}

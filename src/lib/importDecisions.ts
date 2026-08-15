import type { Paper } from "../types";
import { classifyDuplicate, mergeVersionCluster } from "./paperDuplicate";

export type ImportPorts = {
  confirmKeep(existing: Paper, incoming: Paper): boolean | Promise<boolean>;
  save(paper: Paper): Promise<void>;
  discard(paper: Paper): Promise<void>;
};

export type ImportDecision = { paper?: Paper; catalog: Paper[]; note?: string };

function label(paper: Paper) {
  return paper.titleZh || paper.titleEn;
}

function replaceInCatalog(catalog: Paper[], papers: Paper[]) {
  const byId = new Map(papers.map(paper => [paper.id, paper]));
  const merged = catalog.map(paper => byId.get(paper.id) ?? paper);
  const missing = papers.filter(paper => !catalog.some(item => item.id === paper.id));
  return [...merged, ...missing];
}

/** Decides what happens to a freshly imported paper: keep it, drop it, or link it as another version. */
export async function resolveImportedPaper(incoming: Paper, catalog: Paper[], ports: ImportPorts, accepted: Set<string>): Promise<ImportDecision> {
  const match = classifyDuplicate(incoming, catalog);
  if (!match) return { paper: incoming, catalog: replaceInCatalog(catalog, [incoming]) };
  if (match.kind === "same") {
    if (accepted.has(incoming.id)) return { paper: incoming, catalog: replaceInCatalog(catalog, [incoming]) };
    if (!(await ports.confirmKeep(match.paper, incoming))) {
      await ports.discard(incoming);
      return { catalog: catalog.filter(paper => paper.id !== incoming.id) };
    }
    accepted.add(incoming.id);
    return { paper: incoming, catalog: replaceInCatalog(catalog, [incoming]), note: `已保留与《${label(match.paper)}》重复的文献` };
  }
  if (incoming.relatedPaperIds?.includes(match.paper.id)) return { paper: incoming, catalog: replaceInCatalog(catalog, [incoming]) };
  const cluster = mergeVersionCluster(incoming, match.paper, catalog);
  for (const paper of cluster) await ports.save(paper);
  return {
    paper: cluster.find(paper => paper.id === incoming.id),
    catalog: replaceInCatalog(catalog, cluster),
    note: `已作为《${label(match.paper)}》的其他版本交叉引用`
  };
}

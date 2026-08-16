import { describe, expect, it } from "vitest";
import {
  bm25Pair,
  buildBm25Index,
  buildEdges,
  forceLayout,
  layoutWorldForCount,
  minPairDistance,
  neighborhoodIndices,
  pairScore,
  shortestPath,
  similarityMatrix,
  textSimilarity,
  tokenize,
  yearColor,
} from "./knowledgeGraph";
import type { Paper } from "../types";

const paper = (partial: Partial<Paper> & Pick<Paper, "id" | "titleEn">): Paper => ({
  authors: [],
  tagIds: [],
  status: "unread",
  favorite: false,
  createdAt: "2024-01-01",
  updatedAt: "2024-01-01",
  ...partial,
});

describe("knowledgeGraph L1 similarity", () => {
  it("tokenizes Chinese into overlapping bigrams", () => {
    const tokens = tokenize("推荐系统中的曝光约束");
    expect(tokens).toContain("推荐");
    expect(tokens).toContain("荐系");
    expect(tokens).toContain("曝光");
  });

  it("ranks related recommendation abstracts above unrelated ones via BM25 hybrid", () => {
    const docs = [
      tokenize("Learning with Exposure Constraints in Recommendation Systems ranking fairness"),
      tokenize("Exposure Bias in Recommender Systems learning to rank fairness"),
      tokenize("Quantum Error Correction superconducting qubits surface codes"),
    ];
    const text = textSimilarity(docs);
    expect(text[0][1]).toBeGreaterThan(text[0][2]);
    expect(text[0][1]).toBeGreaterThan(0.25);

    const index = buildBm25Index(docs);
    expect(bm25Pair(docs[0], docs[1], 0, 1, index)).toBeGreaterThan(bm25Pair(docs[0], docs[2], 0, 2, index));
  });

  it("builds a connected neighborhood with edges for related papers", () => {
    const papers = [
      paper({ id: "a", titleEn: "Learning with Exposure Constraints in Recommendation", abstractEn: "recommendation exposure constraints ranking fairness", abstractZh: "推荐系统曝光约束学习", tagIds: ["t1"], categoryId: "c1", publicationDate: "2024" }),
      paper({ id: "b", titleEn: "Exposure Bias in Recommender Systems", abstractEn: "recommendation exposure bias ranking fairness", abstractZh: "推荐系统曝光偏差", tagIds: ["t1"], categoryId: "c1", publicationDate: "2023" }),
      paper({ id: "c", titleEn: "Fair Ranking for Recommendation", abstractEn: "fairness ranking recommendation systems", tagIds: ["t1", "t2"], categoryId: "c1", publicationDate: "2022" }),
      paper({ id: "d", titleEn: "Quantum Error Correction Codes", abstractEn: "quantum superconducting qubits", tagIds: [], categoryId: "c2", publicationDate: "2020" }),
    ];
    const matrix = similarityMatrix(papers);
    expect(matrix[0][1]).toBeGreaterThan(matrix[0][3]);
    expect(pairScore(papers[0], papers[1], 0.5)).toBeGreaterThan(0.3);
    const indices = neighborhoodIndices(matrix, 0, 4);
    expect(indices[0]).toBe(0);
    expect(indices).toContain(1);
    const edges = buildEdges(matrix, indices, 3, 0.04);
    expect(edges.length).toBeGreaterThan(0);
    expect(shortestPath(edges, indices.indexOf(0), indices.indexOf(1))).not.toBeNull();
  });

  it("spreads nodes across small and large neighborhoods", () => {
    for (const n of [8, 19, 40]) {
      const edges: { from: number; to: number; score: number }[] = [];
      for (let i = 1; i < n; i++) edges.push({ from: 0, to: i, score: 0.4 - (i % 5) * 0.04 });
      for (let i = 1; i < n - 1; i++) {
        if (i % 3 === 0) edges.push({ from: i, to: i + 1, score: 0.25 });
      }
      const world = layoutWorldForCount(n);
      const points = forceLayout(n, edges, 0, world, undefined, Array.from({ length: n }, () => 12));
      expect(minPairDistance(points)).toBeGreaterThan(48);
      const mean = points.slice(1).reduce((a, p) => a + Math.hypot(p.x - world.width / 2, p.y - world.height / 2), 0) / (n - 1);
      expect(mean).toBeGreaterThan(120);
    }
  });

  it("maps newer years to darker colors", () => {
    const old = yearColor(2010, 2010, 2024);
    const neu = yearColor(2024, 2010, 2024);
    const oldBlue = Number(old.match(/\d+/g)![2]);
    const newBlue = Number(neu.match(/\d+/g)![2]);
    expect(newBlue).toBeLessThan(oldBlue);
  });
});

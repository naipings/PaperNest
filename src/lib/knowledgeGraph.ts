import type { Paper } from "../types";

export type GraphEdge = { from: number; to: number; score: number };
export type GraphPoint = { x: number; y: number };

const STOP = new Set([
  "the", "and", "for", "with", "from", "that", "this", "are", "was", "were", "been", "have", "has", "had",
  "into", "onto", "over", "under", "about", "above", "below", "between", "through", "during", "before", "after",
  "such", "than", "then", "also", "only", "both", "each", "other", "some", "any", "all", "most", "more", "very",
  "can", "may", "might", "will", "would", "could", "should", "shall", "not", "nor", "but", "yet", "via", "per",
  "using", "based", "paper", "study", "method", "methods", "model", "models", "approach", "approaches", "result",
  "results", "data", "system", "systems", "work", "works", "our", "we", "their", "its", "his", "her",
  "以及", "本文", "研究", "方法", "模型", "系统", "基于", "提出", "一个", "我们", "他们", "进行", "通过", "对于", "实验",
]);

const BM25_K1 = 1.2;
const BM25_B = 0.75;

export type Bm25Index = {
  n: number;
  avgdl: number;
  df: Map<string, number>;
  tfs: Map<string, number>[];
  lengths: number[];
};

export function paperText(paper: Paper) {
  return [paper.titleEn, paper.titleZh, paper.summary, paper.abstractEn, paper.abstractZh, paper.venue]
    .filter(Boolean)
    .join(" ");
}

/** English words + Chinese character bigrams (and full CJK runs as soft terms). */
export function tokenize(text: string) {
  const out: string[] = [];
  for (const match of text.toLowerCase().matchAll(/[a-z][a-z0-9-]{2,}|[\u4e00-\u9fff]+/g)) {
    const token = match[0];
    if (/^[a-z]/.test(token)) {
      if (!STOP.has(token)) out.push(token);
      continue;
    }
    if (token.length >= 2 && !STOP.has(token)) out.push(token);
    for (let i = 0; i < token.length - 1; i++) {
      const bigram = token.slice(i, i + 2);
      if (!STOP.has(bigram)) out.push(bigram);
    }
  }
  return out;
}

/** Title tokens repeated for BM25/TF-IDF field boost. */
export function paperTokens(paper: Paper) {
  const title = tokenize([paper.titleEn, paper.titleZh].filter(Boolean).join(" "));
  const body = tokenize([paper.summary, paper.abstractEn, paper.abstractZh, paper.venue].filter(Boolean).join(" "));
  return [...title, ...title, ...body];
}

export function buildBm25Index(docs: string[][]): Bm25Index {
  const df = new Map<string, number>();
  const tfs = docs.map(doc => {
    const tf = new Map<string, number>();
    for (const token of doc) tf.set(token, (tf.get(token) ?? 0) + 1);
    const seen = new Set(doc);
    seen.forEach(token => df.set(token, (df.get(token) ?? 0) + 1));
    return tf;
  });
  const lengths = docs.map(doc => Math.max(1, doc.length));
  const n = Math.max(1, docs.length);
  const avgdl = lengths.reduce((sum, len) => sum + len, 0) / n;
  return { n, avgdl, df, tfs, lengths };
}

export function bm25Score(query: string[], docIndex: number, index: Bm25Index) {
  let score = 0;
  const tf = index.tfs[docIndex];
  const dl = index.lengths[docIndex];
  const seen = new Set(query);
  for (const term of seen) {
    const freq = tf.get(term) ?? 0;
    if (!freq) continue;
    const df = index.df.get(term) ?? 0;
    const idf = Math.log(1 + (index.n - df + 0.5) / (df + 0.5));
    const denom = freq + BM25_K1 * (1 - BM25_B + BM25_B * (dl / index.avgdl));
    score += idf * ((freq * (BM25_K1 + 1)) / denom);
  }
  return score;
}

/** Symmetric BM25: each paper is query against the other. */
export function bm25Pair(left: string[], right: string[], leftIndex: number, rightIndex: number, index: Bm25Index) {
  return 0.5 * (bm25Score(left, rightIndex, index) + bm25Score(right, leftIndex, index));
}

export function tfidfVectors(docs: string[][]) {
  const df = new Map<string, number>();
  for (const doc of docs) {
    const seen = new Set(doc);
    seen.forEach(token => df.set(token, (df.get(token) ?? 0) + 1));
  }
  const n = Math.max(1, docs.length);
  return docs.map(doc => {
    const tf = new Map<string, number>();
    for (const token of doc) tf.set(token, (tf.get(token) ?? 0) + 1);
    const vector = new Map<string, number>();
    let norm = 0;
    tf.forEach((count, token) => {
      const weight = (count / Math.max(1, doc.length)) * Math.log((n + 1) / ((df.get(token) ?? 0) + 1)) + 1e-6;
      vector.set(token, weight);
      norm += weight * weight;
    });
    const scale = 1 / Math.sqrt(Math.max(norm, 1e-12));
    vector.forEach((weight, token) => vector.set(token, weight * scale));
    return vector;
  });
}

export function cosine(left: Map<string, number>, right: Map<string, number>) {
  let sum = 0;
  const [a, b] = left.size <= right.size ? [left, right] : [right, left];
  a.forEach((weight, token) => {
    const other = b.get(token);
    if (other) sum += weight * other;
  });
  return sum;
}

/** L1 text similarity: 0.65 BM25 (corpus-normalized) + 0.35 TF-IDF cosine. */
export function textSimilarity(docs: string[][]) {
  const n = docs.length;
  const matrix = Array.from({ length: n }, () => Array.from({ length: n }, () => 0));
  if (n < 2) return matrix;
  const index = buildBm25Index(docs);
  const vectors = tfidfVectors(docs);
  let maxBm25 = 0;
  const raw = Array.from({ length: n }, () => Array.from({ length: n }, () => 0));
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const value = bm25Pair(docs[i], docs[j], i, j, index);
      raw[i][j] = value;
      raw[j][i] = value;
      if (value > maxBm25) maxBm25 = value;
    }
  }
  const scale = maxBm25 > 0 ? maxBm25 : 1;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const bm25 = raw[i][j] / scale;
      const cos = cosine(vectors[i], vectors[j]);
      const value = Math.min(1, bm25 * 0.65 + cos * 0.35);
      matrix[i][j] = value;
      matrix[j][i] = value;
    }
  }
  return matrix;
}

export function pairScore(a: Paper, b: Paper, textSim: number) {
  const tagShared = a.tagIds.filter(id => b.tagIds.includes(id)).length;
  const tagUnion = new Set([...a.tagIds, ...b.tagIds]).size;
  const tagJaccard = tagUnion ? tagShared / tagUnion : 0;
  const sameCategory = a.categoryId && a.categoryId === b.categoryId ? 1 : 0;
  const related = (a.relatedPaperIds?.includes(b.id) || b.relatedPaperIds?.includes(a.id)) ? 1 : 0;
  return Math.min(1, textSim * 0.68 + tagJaccard * 0.18 + sameCategory * 0.08 + related * 0.16);
}

export function similarityMatrix(papers: Paper[]) {
  const docs = papers.map(paperTokens);
  const text = textSimilarity(docs);
  const matrix = papers.map(() => Array.from({ length: papers.length }, () => 0));
  for (let i = 0; i < papers.length; i++) {
    for (let j = i + 1; j < papers.length; j++) {
      const value = pairScore(papers[i], papers[j], text[i][j]);
      matrix[i][j] = value;
      matrix[j][i] = value;
    }
  }
  return matrix;
}

/** Pick the paper with strongest average similarity as default origin. */
export function defaultOriginIndex(matrix: number[][]) {
  let best = 0;
  let bestSum = -1;
  for (let i = 0; i < matrix.length; i++) {
    const sum = matrix[i].reduce((acc, value, j) => acc + (i === j ? 0 : value), 0);
    if (sum > bestSum) {
      bestSum = sum;
      best = i;
    }
  }
  return best;
}

/** Origin + top neighbors by similarity (Connected Papers style neighborhood). */
export function neighborhoodIndices(matrix: number[][], origin: number, maxNodes: number) {
  const ranked = matrix[origin]
    .map((score, index) => ({ score, index }))
    .filter(item => item.index !== origin)
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(0, maxNodes - 1))
    .map(item => item.index);
  return [origin, ...ranked];
}

/**
 * Build undirected edges: each node keeps top-k neighbors, then Kruskal MST on remaining
 * strong pairs so the graph stays connected like a CP-style similarity graph.
 */
export function buildEdges(matrix: number[][], indices: number[], k = 4, floor = 0.04) {
  const local = indices.map(i => indices.map(j => matrix[i][j]));
  const n = indices.length;
  const edgeMap = new Map<string, GraphEdge>();
  const add = (from: number, to: number, score: number) => {
    if (from === to || score < floor) return;
    const a = Math.min(from, to);
    const b = Math.max(from, to);
    const key = `${a}:${b}`;
    const prev = edgeMap.get(key);
    if (!prev || prev.score < score) edgeMap.set(key, { from: a, to: b, score });
  };

  for (let i = 0; i < n; i++) {
    local[i]
      .map((score, j) => ({ score, j }))
      .filter(item => item.j !== i)
      .sort((a, b) => b.score - a.score)
      .slice(0, k)
      .forEach(item => add(i, item.j, item.score));
  }

  const candidates: GraphEdge[] = [];
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (local[i][j] >= floor) candidates.push({ from: i, to: j, score: local[i][j] });
    }
  }
  candidates.sort((a, b) => b.score - a.score);
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (x: number): number => (parent[x] === x ? x : (parent[x] = find(parent[x])));
  for (const edge of candidates) {
    const a = find(edge.from);
    const b = find(edge.to);
    if (a === b) continue;
    parent[a] = b;
    add(edge.from, edge.to, edge.score);
  }

  return [...edgeMap.values()].sort((a, b) => b.score - a.score);
}

export function shortestPath(edges: GraphEdge[], start: number, goal: number) {
  if (start === goal) return [start];
  const adj = new Map<number, { to: number; score: number }[]>();
  for (const edge of edges) {
    if (!adj.has(edge.from)) adj.set(edge.from, []);
    if (!adj.has(edge.to)) adj.set(edge.to, []);
    adj.get(edge.from)!.push({ to: edge.to, score: edge.score });
    adj.get(edge.to)!.push({ to: edge.from, score: edge.score });
  }
  const dist = new Map<number, number>([[start, 0]]);
  const prev = new Map<number, number>();
  const queue = [start];
  while (queue.length) {
    queue.sort((a, b) => (dist.get(a) ?? Infinity) - (dist.get(b) ?? Infinity));
    const node = queue.shift()!;
    if (node === goal) break;
    for (const next of adj.get(node) ?? []) {
      const cost = (dist.get(node) ?? 0) + (1 - next.score + 0.05);
      if (cost < (dist.get(next.to) ?? Infinity)) {
        dist.set(next.to, cost);
        prev.set(next.to, node);
        queue.push(next.to);
      }
    }
  }
  if (!prev.has(goal) && start !== goal) return null;
  const path = [goal];
  for (let cur = goal; cur !== start; ) {
    const p = prev.get(cur);
    if (p === undefined) return null;
    path.push(p);
    cur = p;
  }
  return path.reverse();
}

export function yearOf(paper: Paper) {
  const match = paper.publicationDate?.match(/^\d{4}/);
  return match ? Number(match[0]) : null;
}

/** Connected Papers-like: lighter = older, darker = newer. */
export function yearColor(year: number | null, minYear: number, maxYear: number) {
  if (year == null || maxYear <= minYear) return "#9aa7c2";
  const t = Math.min(1, Math.max(0, (year - minYear) / (maxYear - minYear)));
  const r = Math.round(210 - t * 145);
  const g = Math.round(220 - t * 95);
  const b = Math.round(235 - t * 55);
  return `rgb(${r},${g},${b})`;
}

export function authorYearLabel(paper: Paper) {
  const first = paper.authors[0]?.name?.trim() || "Unknown";
  const author = first.split(/[\s,]+/).filter(Boolean).at(-1) || first;
  return `${author}, ${yearOf(paper) ?? "n.d."}`;
}

/** Canvas size that keeps roughly constant area-per-node (Connected Papers density). */
export function layoutWorldForCount(count: number) {
  const n = Math.max(2, count);
  const aspect = 1100 / 720;
  const area = Math.max(1100 * 720, n * 42_000);
  const height = Math.round(Math.sqrt(area / aspect));
  const width = Math.round(height * aspect);
  return { width, height };
}

/** Synchronous force layout (CP-like airy spread): adaptive charge/collide/ideal length by n. */
export function forceLayout(
  count: number,
  edges: GraphEdge[],
  origin: number,
  world = layoutWorldForCount(count),
  iterations?: number,
  radii?: number[],
): GraphPoint[] {
  const n = Math.max(1, count);
  const cx = world.width / 2;
  const cy = world.height / 2;
  const scale = Math.sqrt(n / 19);
  const spread = Math.min(world.width, world.height) * (0.36 + 0.08 * Math.min(1.3, scale));
  const points: GraphPoint[] = Array.from({ length: count }, (_, i) => {
    if (i === origin) return { x: cx, y: cy };
    const angle = (Math.PI * 2 * (i - (i > origin ? 1 : 0))) / Math.max(1, count - 1) + 0.2;
    const ring = spread * (0.55 + 0.35 * ((i * 17) % 10) / 10);
    return { x: cx + Math.cos(angle) * ring, y: cy + Math.sin(angle) * ring * 0.92 };
  });
  const vx = Array.from({ length: count }, () => 0);
  const vy = Array.from({ length: count }, () => 0);
  const radiusOf = (i: number) => radii?.[i] ?? 14;
  const charge = (4800 + n * 120) * Math.max(0.9, Math.min(1.55, scale));
  const linkStrength = 0.024 / Math.max(0.85, Math.min(1.25, scale));
  const centerPull = 0.0035 / Math.sqrt(Math.max(1, n / 12));
  const collidePad = 30 + Math.sqrt(n) * 2.4;
  const idealBase = 110 + Math.sqrt(n) * 10;
  const idealSpan = 130 + Math.sqrt(n) * 8;
  const damping = 0.86;
  const maxStep = 24 + Math.min(16, n * 0.35);
  const steps = iterations ?? Math.min(700, 420 + n * 7);

  for (let iter = 0; iter < steps; iter++) {
    const alpha = Math.pow(1 - iter / steps, 1.15);
    for (let i = 0; i < count; i++) {
      for (let j = i + 1; j < count; j++) {
        let dx = points[i].x - points[j].x;
        let dy = points[i].y - points[j].y;
        let dist = Math.hypot(dx, dy);
        if (dist < 0.01) {
          dx = ((i * 13 + j * 7) % 11) - 5 || 1;
          dy = ((i * 5 + j * 11) % 11) - 5 || 1;
          dist = Math.hypot(dx, dy);
        }
        const repulse = (charge * alpha) / (dist * dist);
        const fx = (dx / dist) * repulse;
        const fy = (dy / dist) * repulse;
        if (i !== origin) { vx[i] += fx; vy[i] += fy; }
        if (j !== origin) { vx[j] -= fx; vy[j] -= fy; }

        const minDist = radiusOf(i) + radiusOf(j) + collidePad;
        if (dist < minDist) {
          const push = ((minDist - dist) / dist) * 0.55 * alpha;
          const px = dx * push;
          const py = dy * push;
          if (i !== origin) { vx[i] += px; vy[i] += py; }
          if (j !== origin) { vx[j] -= px; vy[j] -= py; }
        }
      }
    }
    for (const edge of edges) {
      const a = edge.from;
      const b = edge.to;
      let dx = points[b].x - points[a].x;
      let dy = points[b].y - points[a].y;
      const dist = Math.hypot(dx, dy) || 0.01;
      const ideal = idealBase + (1 - edge.score) * idealSpan + (radiusOf(a) + radiusOf(b)) * 0.6;
      const force = ((dist - ideal) / dist) * linkStrength * (0.35 + edge.score) * alpha;
      const fx = dx * force;
      const fy = dy * force;
      if (a !== origin) { vx[a] += fx; vy[a] += fy; }
      if (b !== origin) { vx[b] -= fx; vy[b] -= fy; }
    }
    for (let i = 0; i < count; i++) {
      if (i === origin) {
        points[i].x = cx;
        points[i].y = cy;
        vx[i] = 0;
        vy[i] = 0;
        continue;
      }
      vx[i] += (cx - points[i].x) * centerPull * alpha;
      vy[i] += (cy - points[i].y) * centerPull * alpha;
      vx[i] *= damping;
      vy[i] *= damping;
      const speed = Math.hypot(vx[i], vy[i]);
      if (speed > maxStep) {
        vx[i] = (vx[i] / speed) * maxStep;
        vy[i] = (vy[i] / speed) * maxStep;
      }
      points[i].x += vx[i];
      points[i].y += vy[i];
      const pad = 48;
      points[i].x = Math.min(world.width - pad, Math.max(pad, points[i].x));
      points[i].y = Math.min(world.height - pad, Math.max(pad, points[i].y));
    }
  }
  return points;
}

/** Minimum pairwise distance among non-identical points (for layout QA). */
export function minPairDistance(points: GraphPoint[]) {
  let best = Infinity;
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      best = Math.min(best, Math.hypot(points[i].x - points[j].x, points[i].y - points[j].y));
    }
  }
  return best === Infinity ? 0 : best;
}

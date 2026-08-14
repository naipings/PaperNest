import { useMemo, useState } from "react";
import { Network, Search } from "lucide-react";
import { useLibrary } from "../state/LibraryContext";
import type { Paper } from "../types";

type Node = { paper: Paper; x: number; y: number; color: string };
type Edge = { from: number; to: number; score: number };

const tokens = (paper: Paper) => new Set((paper.titleEn + " " + (paper.titleZh ?? "") + " " + (paper.summary ?? "") + " " + (paper.abstractEn ?? "") + " " + (paper.abstractZh ?? "")).toLowerCase().match(/[a-z0-9]{3,}|[\u4e00-\u9fff]{2,}/g) ?? []);
const overlap = (left: Set<string>, right: Set<string>) => { let count = 0; left.forEach(value => { if (right.has(value)) count++; }); return count / Math.max(1, Math.min(left.size, right.size)); };

export function KnowledgeTree({ onOpenPaper }: { onOpenPaper(paper: Paper): void }) {
  const { data } = useLibrary(); const [query, setQuery] = useState(""); const [threshold, setThreshold] = useState(0.24);
  const graph = useMemo(() => {
    const papers = (data?.papers ?? []).filter(paper => !paper.deletedAt && ((paper.titleEn + " " + (paper.titleZh ?? "") + " " + (paper.summary ?? "")).toLowerCase().includes(query.toLowerCase()))).slice(0, 300);
    const categories = new Map((data?.categories ?? []).map(category => [category.id, category.color])); const wordSets = papers.map(tokens);
    const nodes: Node[] = papers.map((paper, index) => { const angle = Math.PI * 2 * index / Math.max(1, papers.length); const radius = papers.length < 2 ? 0 : 235 + (index % 4) * 21; return { paper, x: 500 + Math.cos(angle) * radius, y: 325 + Math.sin(angle) * radius, color: categories.get(paper.categoryId ?? "") ?? "#7867c6" }; });
    const edges: Edge[] = []; for (let from = 0; from < papers.length; from++) for (let to = from + 1; to < papers.length; to++) { const left = papers[from]; const right = papers[to]; const sharedTags = left.tagIds.filter(id => right.tagIds.includes(id)).length; const score = Math.min(.55, sharedTags * .24) + (left.categoryId && left.categoryId === right.categoryId ? .14 : 0) + overlap(wordSets[from], wordSets[to]) * .42; if (score >= threshold) edges.push({ from, to, score }); }
    return { nodes, edges: edges.sort((a, b) => b.score - a.score).slice(0, 700) };
  }, [data, query, threshold]);
  return <main className="knowledge-page"><header className="page-heading"><div><div className="eyebrow"><Network size={14} />LOCAL KNOWLEDGE TREE</div><h1>本地论文知识树</h1><p>根据已入库论文的标签、主领域和标题/摘要文本相似度建立关系；不联网，也不代表引用关系。</p></div></header><div className="knowledge-tools"><label><Search size={15} /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="筛选论文" /></label><label>关系阈值 <input type="range" min="0.12" max="0.62" step="0.02" value={threshold} onChange={event => setThreshold(Number(event.target.value))} /><strong>{Math.round(threshold * 100)}%</strong></label><small>显示 {graph.nodes.length} 篇论文 / {graph.edges.length} 条关联（上限 300 篇、700 条）</small></div><section className="knowledge-canvas"><svg viewBox="0 0 1000 650" role="img" aria-label="本地论文知识关系图">{graph.edges.map((edge, index) => <line key={index} x1={graph.nodes[edge.from].x} y1={graph.nodes[edge.from].y} x2={graph.nodes[edge.to].x} y2={graph.nodes[edge.to].y} style={{ strokeWidth: 1 + edge.score * 3, opacity: .16 + edge.score * .55 }} />)}{graph.nodes.map(node => <g className="knowledge-node" key={node.paper.id} transform={"translate(" + node.x + " " + node.y + ")"} onClick={() => onOpenPaper(node.paper)}><circle r="19" fill={node.color} /><text y="37">{(node.paper.titleZh || node.paper.titleEn).slice(0, 22)}</text><title>{node.paper.titleZh || node.paper.titleEn}</title></g>)}</svg>{!graph.nodes.length && <div className="knowledge-empty">尚无可显示的论文。导入论文并添加领域或标签后，这里会自动形成关联。</div>}</section></main>;
}

import { ExternalLink, Minus, Network, Plus, RotateCcw, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { useGraphViewport } from "../lib/useGraphViewport";
import { useLibrary } from "../state/LibraryContext";
import type { Paper } from "../types";

type Edge = { from: number; to: number; score: number };
type Node = { paper: Paper; x: number; y: number; color: string; radius: number; opacity: number; label: string; degree: number };
const ui = {
  title: "\u672c\u5730\u77e5\u8bc6\u6811", filter: "\u7b5b\u9009\u8bba\u6587", threshold: "\u5173\u7cfb\u9608\u503c", papers: "\u7bc7\u8bba\u6587", edges: "\u6761\u5173\u8054",
  description: "\u989c\u8272\u8868\u793a\u4e3b\u9886\u57df\uff1b\u8282\u70b9\u8d8a\u5927\u3001\u8d8a\u6df1\uff0c\u8868\u793a\u4e0e\u672c\u5730\u8bba\u6587\u7684\u5173\u8054\u8d8a\u591a\u3002\u8fd9\u662f\u672c\u5730\u76f8\u4f3c\u5ea6\u56fe\uff0c\u4e0d\u662f\u5f15\u7528\u7f51\u7edc\u3002",
  gestures: "\u6eda\u8f6e\u7f29\u653e \u00b7 \u7a7a\u767d\u5904\u62d6\u52a8", zoomOut: "\u7f29\u5c0f", zoomIn: "\u653e\u5927", reset: "\u91cd\u7f6e\u89c6\u56fe",
  local: "\u672c\u5730\u8bba\u6587", authors: "\u4f5c\u8005\u5f85\u8865\u5145", year: "\u5e74\u4efd\u5f85\u8865\u5145", strength: "\u5c40\u90e8\u5173\u8054\u5f3a\u5ea6",
  summary: "\u4e00\u53e5\u8bdd\u603b\u7ed3", abstract: "\u4e2d\u6587\u6458\u8981", pending: "\u5f85\u8865\u5145", noAbstract: "\u6682\u65e0\u4e2d\u6587\u6458\u8981",
  locate: "\u5728\u8bba\u6587\u8868\u683c\u4e2d\u5b9a\u4f4d", hint: "\u5355\u51fb\u8282\u70b9\u67e5\u770b\uff1b\u53cc\u51fb\u8282\u70b9\u76f4\u63a5\u5728\u8bba\u6587\u8868\u683c\u4e2d\u6253\u5f00\u3002",
  empty: "\u6ca1\u6709\u53ef\u663e\u793a\u7684\u8bba\u6587\u3002"
};
const tokens = (paper: Paper) => new Set((paper.titleEn + " " + (paper.titleZh ?? "") + " " + (paper.summary ?? "") + " " + (paper.abstractEn ?? "") + " " + (paper.abstractZh ?? "")).toLowerCase().match(/[a-z0-9]{3,}|[\u4e00-\u9fff]{2,}/g) ?? []);
const score = (left: Set<string>, right: Set<string>) => { let count = 0; left.forEach(token => { if (right.has(token)) count++; }); return count / Math.max(1, Math.min(left.size, right.size)); };
const authorYear = (paper: Paper) => { const first = paper.authors[0]?.name?.trim() || "Unknown"; const author = first.split(/[\s,]+/).filter(Boolean).at(-1) || first; return author + ", " + (paper.publicationDate?.match(/^\d{4}/)?.[0] || "n.d."); };

export function KnowledgeGraphInteractive({ onOpenPaper }: { onOpenPaper(paper: Paper): void }) {
  const { data } = useLibrary(); const [query, setQuery] = useState(""); const [threshold, setThreshold] = useState(.24); const [selectedId, setSelectedId] = useState<string>();
  const viewport = useGraphViewport({ world: { width: 1000, height: 650 } });
  const graph = useMemo(() => {
    const papers = (data?.papers ?? []).filter(paper => !paper.deletedAt && (paper.titleEn + " " + (paper.titleZh ?? "") + " " + (paper.summary ?? "")).toLowerCase().includes(query.toLowerCase())).slice(0, 300);
    const colors = new Map((data?.categories ?? []).map(category => [category.id, category.color])); const words = papers.map(tokens); const edges: Edge[] = [];
    for (let from = 0; from < papers.length; from++) for (let to = from + 1; to < papers.length; to++) { const shared = papers[from].tagIds.filter(id => papers[to].tagIds.includes(id)).length; const value = Math.min(.55, shared * .24) + (papers[from].categoryId && papers[from].categoryId === papers[to].categoryId ? .14 : 0) + score(words[from], words[to]) * .42; if (value >= threshold) edges.push({ from, to, score: value }); }
    const degree = Array.from({ length: papers.length }, () => 0); edges.forEach(edge => { degree[edge.from] += edge.score; degree[edge.to] += edge.score; });
    const groups = [...new Set(papers.map(paper => paper.categoryId || "unclassified"))];
    const nodes: Node[] = papers.map((paper, index) => {
      const key = paper.categoryId || "unclassified"; const peers = papers.filter(item => (item.categoryId || "unclassified") === key); const order = peers.findIndex(item => item.id === paper.id); const cluster = groups.indexOf(key);
      const density = degree[index]; const clusterAngle = Math.PI * 2 * cluster / Math.max(1, groups.length); const localAngle = Math.PI * 2 * order / Math.max(1, peers.length); const centerX = 500 + Math.cos(clusterAngle) * 170; const centerY = 330 + Math.sin(clusterAngle) * 125; const localRadius = 38 + (order % 4) * 27 + Math.max(0, 55 - density * 45);
      return { paper, x: centerX + Math.cos(localAngle) * localRadius, y: centerY + Math.sin(localAngle) * localRadius, color: colors.get(paper.categoryId || "") || "#7666b9", radius: Math.min(50, 14 + Math.sqrt(density + .2) * 19), opacity: Math.min(.96, .48 + density * .38), label: authorYear(paper), degree: density };
    });
    return { nodes, edges: edges.sort((left, right) => right.score - left.score).slice(0, 700) };
  }, [data, query, threshold]);
  const selected = graph.nodes.find(node => node.paper.id === selectedId) ?? graph.nodes[0];
  return <main className="knowledge-graph-page">
    <header className="page-heading knowledge-graph-header">
      <div className="page-title-block">
        <div className="page-title-row"><span className="page-title-icon"><Network size={18} /></span><h1>{ui.title}</h1><span className="page-kicker">论文关系图</span></div>
        <p>{ui.description}</p>
      </div>
      <div className="page-heading-actions"><label className="knowledge-search"><Search size={17} /><input value={query} onChange={event => setQuery(event.target.value)} placeholder={ui.filter} /></label></div>
    </header>
    <div className="knowledge-controls"><label>{ui.threshold} <input type="range" min=".12" max=".62" step=".02" value={threshold} onChange={event => setThreshold(Number(event.target.value))} /><strong>{Math.round(threshold * 100)}%</strong></label><span>{graph.nodes.length} {ui.papers} · {graph.edges.length} {ui.edges}</span><span className="knowledge-gesture-hint">{ui.gestures}</span></div>
    <div className="knowledge-map-layout"><section className={"knowledge-map " + (viewport.panning ? "panning" : "")}>
      <div className="knowledge-zoom" aria-label={ui.title}><button onClick={() => viewport.zoomBy(-.15)} title={ui.zoomOut} aria-label={ui.zoomOut}><Minus size={18} /></button><strong>{Math.round(viewport.camera.zoom * 100)}%</strong><button onClick={() => viewport.zoomBy(.15)} title={ui.zoomIn} aria-label={ui.zoomIn}><Plus size={18} /></button><button onClick={viewport.reset} title={ui.reset} aria-label={ui.reset}><RotateCcw size={16} /></button></div>
      <svg {...viewport.svgProps} role="img" aria-label={ui.title}>{graph.edges.map((edge, index) => <line key={index} x1={graph.nodes[edge.from].x} y1={graph.nodes[edge.from].y} x2={graph.nodes[edge.to].x} y2={graph.nodes[edge.to].y} style={{ strokeWidth: .6 + edge.score * 2.8, opacity: .1 + edge.score * .38 }} />)}{graph.nodes.map(node => <g className={"knowledge-map-node " + (selected?.paper.id === node.paper.id ? "selected" : "")} key={node.paper.id} transform={"translate(" + node.x + " " + node.y + ")"} onPointerDown={event => event.stopPropagation()} onClick={() => setSelectedId(node.paper.id)} onDoubleClick={() => onOpenPaper(node.paper)}><circle r={node.radius + 3} fill="transparent" stroke={node.color} strokeOpacity={selected?.paper.id === node.paper.id ? 1 : 0} strokeWidth="3" /><circle r={node.radius} fill={node.color} fillOpacity={node.opacity} /><text y={node.radius + 15}>{node.label}</text><title>{node.paper.titleZh || node.paper.titleEn}</title></g>)}</svg>
      {!graph.nodes.length && <div className="knowledge-empty">{ui.empty}</div>}
    </section><aside className="knowledge-inspector">{selected ? <><span className="status">{ui.local}</span><h2>{selected.paper.titleZh || selected.paper.titleEn}</h2>{selected.paper.titleZh && <p className="english-title">{selected.paper.titleEn}</p>}<p>{selected.paper.authors.map(author => author.name).join(", ") || ui.authors} · {selected.paper.publicationDate?.slice(0, 4) || ui.year}</p><dl><div><dt>{ui.strength}</dt><dd>{Math.round(selected.degree * 100)}%</dd></div><div><dt>{ui.summary}</dt><dd>{selected.paper.summary || ui.pending}</dd></div><div><dt>{ui.abstract}</dt><dd className="knowledge-abstract">{selected.paper.abstractZh || ui.noAbstract}</dd></div></dl><button className="primary" onClick={() => onOpenPaper(selected.paper)}><ExternalLink size={16} />{ui.locate}</button><small>{ui.hint}</small></> : <p>{ui.empty}</p>}</aside></div>
  </main>;
}

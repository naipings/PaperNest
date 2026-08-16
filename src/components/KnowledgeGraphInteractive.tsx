import { ExternalLink, Minus, Network, Plus, RotateCcw, Search, Sparkles } from "lucide-react";
import { useMemo, useState } from "react";
import {
  authorYearLabel,
  buildEdges,
  defaultOriginIndex,
  forceLayout,
  layoutWorldForCount,
  neighborhoodIndices,
  shortestPath,
  similarityMatrix,
  yearColor,
  yearOf,
  type GraphEdge,
} from "../lib/knowledgeGraph";
import { useGraphViewport } from "../lib/useGraphViewport";
import { useLibrary } from "../state/LibraryContext";
import type { Paper } from "../types";

type ViewMode = "graph" | "prior" | "derivative" | "list";

export function KnowledgeGraphInteractive({ onOpenPaper }: { onOpenPaper(paper: Paper): void }) {
  const { data } = useLibrary();
  const [query, setQuery] = useState("");
  const [threshold, setThreshold] = useState(0.12);
  const [originId, setOriginId] = useState<string>();
  const [selectedId, setSelectedId] = useState<string>();
  const [view, setView] = useState<ViewMode>("graph");

  const papers = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (data?.papers ?? [])
      .filter(paper => !paper.deletedAt)
      .filter(paper => !q || `${paper.titleEn} ${paper.titleZh ?? ""} ${paper.summary ?? ""}`.toLowerCase().includes(q))
      .slice(0, 200);
  }, [data, query]);

  const matrix = useMemo(() => (papers.length ? similarityMatrix(papers) : []), [papers]);

  const originIndex = useMemo(() => {
    if (!papers.length) return 0;
    const fromId = originId ? papers.findIndex(paper => paper.id === originId) : -1;
    if (fromId >= 0) return fromId;
    return defaultOriginIndex(matrix);
  }, [papers, originId, matrix]);

  const neighborhoodSize = Math.min(40, Math.max(2, papers.length || 12));
  const world = useMemo(() => layoutWorldForCount(neighborhoodSize), [neighborhoodSize]);
  const viewport = useGraphViewport({ world });
  const graph = useMemo(() => {
    if (!papers.length) {
      return {
        nodes: [] as Array<{
          local: number; paper: Paper; x: number; y: number; color: string; radius: number;
          label: string; toOrigin: number; isOrigin: boolean; year: number | null;
        }>,
        edges: [] as GraphEdge[],
        path: [] as number[],
        pathEdges: new Set<string>(),
        list: [] as Array<{
          local: number; paper: Paper; x: number; y: number; color: string; radius: number;
          label: string; toOrigin: number; isOrigin: boolean; year: number | null;
        }>,
        minYear: 2010,
        maxYear: 2026,
        edgesVisible: [] as GraphEdge[],
      };
    }
    const indices = neighborhoodIndices(matrix, originIndex, Math.min(40, papers.length));
    const localOrigin = 0;
    const layoutWorld = layoutWorldForCount(indices.length);
    // Sparse graph like Connected Papers: kNN=2 + MST, avoid dense springs that collapse the layout.
    const edgesAll = buildEdges(matrix, indices, 2, 0.05);
    const edges = edgesAll.filter(edge => edge.score >= threshold);
    const layoutEdges = edges.length ? edges : edgesAll.slice(0, Math.max(indices.length - 1, 1));
    const roughRadii = indices.map((_, local) => (local === localOrigin ? 18 : 12));
    const positions = forceLayout(indices.length, layoutEdges, localOrigin, layoutWorld, undefined, roughRadii);
    const years = indices.map(i => yearOf(papers[i])).filter((y): y is number => y != null);
    const minYear = years.length ? Math.min(...years) : 2000;
    const maxYear = years.length ? Math.max(...years) : 2026;
    const degree = Array.from({ length: indices.length }, () => 0);
    layoutEdges.forEach(edge => {
      degree[edge.from] += edge.score;
      degree[edge.to] += edge.score;
    });
    const nodes = indices.map((paperIndex, local) => {
      const paper = papers[paperIndex];
      const toOrigin = matrix[paperIndex][indices[localOrigin]];
      return {
        local,
        paper,
        x: positions[local].x,
        y: positions[local].y,
        color: yearColor(yearOf(paper), minYear, maxYear),
        radius: Math.min(18, 8 + Math.sqrt(degree[local] + 0.15) * 6.5 + (local === localOrigin ? 3 : 0)),
        label: authorYearLabel(paper),
        toOrigin: local === localOrigin ? 1 : toOrigin,
        isOrigin: local === localOrigin,
        year: yearOf(paper),
      };
    });
    const selectedLocal = nodes.findIndex(node => node.paper.id === (selectedId ?? nodes[0]?.paper.id));
    const path = selectedLocal >= 0
      ? (shortestPath(layoutEdges, selectedLocal, localOrigin) ?? [selectedLocal])
      : [];
    const pathEdges = new Set<string>();
    for (let i = 0; i < path.length - 1; i++) {
      const a = Math.min(path[i], path[i + 1]);
      const b = Math.max(path[i], path[i + 1]);
      pathEdges.add(`${a}:${b}`);
    }
    const list = nodes
      .slice()
      .sort((a, b) => b.toOrigin - a.toOrigin);
    return { nodes, edges: layoutEdges, path, pathEdges, list, minYear, maxYear, edgesVisible: edges };
  }, [papers, matrix, originIndex, threshold, selectedId]);

  const selected = graph.nodes.find(node => node.paper.id === selectedId) ?? graph.nodes[0];
  const originYear = yearOf(papers[originIndex] ?? selected?.paper);
  const filteredList = graph.list.filter(node => {
    if (view === "prior" && originYear != null) return (node.year ?? 0) < originYear;
    if (view === "derivative" && originYear != null) return (node.year ?? 9999) > originYear;
    return true;
  });

  const makeOrigin = (paper: Paper) => {
    setOriginId(paper.id);
    setSelectedId(paper.id);
    setView("graph");
  };

  return <main className="knowledge-graph-page cp-page">
    <header className="page-heading knowledge-graph-header">
      <div className="page-title-block">
        <div className="page-title-row">
          <span className="page-title-icon"><Network size={18} /></span>
          <h1>本地知识树</h1>
          <span className="page-kicker">Connected Papers 风格</span>
        </div>
        <p>
          以原点论文为中心的力导向邻域图。底层为本地 L1：BM25 + TF-IDF（标题加权、中文二字切分）与标签/领域；非 Semantic Scholar 共引。颜色越深越新；选中高亮到原点的最短相似路径。
        </p>
      </div>
      <div className="page-heading-actions">
        <label className="knowledge-search">
          <Search size={17} />
          <input value={query} onChange={event => setQuery(event.target.value)} placeholder="筛选论文…" />
        </label>
      </div>
    </header>

    <div className="cp-toolbar">
      <div className="cp-origin-title" title={papers[originIndex]?.titleEn}>
        <Sparkles size={14} />
        <strong>原点</strong>
        <span>{papers[originIndex] ? (papers[originIndex].titleZh || papers[originIndex].titleEn) : "—"}</span>
      </div>
      <div className="cp-view-tabs">
        {([["graph", "图谱"], ["prior", "先前工作"], ["derivative", "衍生工作"], ["list", "列表"]] as const).map(([id, label]) => (
          <button key={id} type="button" className={view === id ? "active" : ""} onClick={() => setView(id)}>{label}</button>
        ))}
      </div>
    </div>

    <div className="knowledge-controls">
      <label>关系阈值 <input type="range" min="0.04" max="0.45" step="0.02" value={threshold} onChange={event => setThreshold(Number(event.target.value))} /><strong>{Math.round(threshold * 100)}%</strong></label>
      <span>{graph.nodes.length} 篇邻域 · {graph.edgesVisible.length} 条可见关联</span>
      <span className="knowledge-gesture-hint">滚轮缩放 · 空白处拖动 · 双击打开论文</span>
    </div>

    <div className="cp-layout">
      <aside className="cp-list">
        <header>按与原点相似度</header>
        <ul>
          {filteredList.map(node => (
            <li key={node.paper.id} className={selected?.paper.id === node.paper.id ? "active" : ""}>
              <button type="button" onClick={() => setSelectedId(node.paper.id)}>
                <span className="cp-dot" style={{ background: node.color }} />
                <span className="cp-list-copy">
                  <strong>{node.paper.titleZh || node.paper.titleEn}</strong>
                  <small>{node.label} · {Math.round(node.toOrigin * 100)}%</small>
                </span>
              </button>
            </li>
          ))}
          {!filteredList.length && <li className="cp-list-empty">无匹配论文</li>}
        </ul>
      </aside>

      <section className={"knowledge-map " + (viewport.panning ? "panning" : "") + (view === "list" ? " is-list" : "")}>
        {view !== "list" && <>
          <div className="knowledge-zoom" aria-label="缩放">
            <button type="button" onClick={() => viewport.zoomBy(-0.15)} title="缩小"><Minus size={18} /></button>
            <strong>{Math.round(viewport.camera.zoom * 100)}%</strong>
            <button type="button" onClick={() => viewport.zoomBy(0.15)} title="放大"><Plus size={18} /></button>
            <button type="button" onClick={viewport.reset} title="重置视图"><RotateCcw size={16} /></button>
          </div>
          <div className="cp-legend">
            <span>旧</span>
            <i style={{ background: yearColor(graph.minYear ?? 2010, graph.minYear ?? 2010, graph.maxYear ?? 2026) }} />
            <i style={{ background: yearColor(Math.round(((graph.minYear ?? 2010) + (graph.maxYear ?? 2026)) / 2), graph.minYear ?? 2010, graph.maxYear ?? 2026) }} />
            <i style={{ background: yearColor(graph.maxYear ?? 2026, graph.minYear ?? 2010, graph.maxYear ?? 2026) }} />
            <span>新</span>
          </div>
          <svg {...viewport.svgProps} role="img" aria-label="本地知识树">
            {graph.edges.map((edge, index) => {
              const key = `${Math.min(edge.from, edge.to)}:${Math.max(edge.from, edge.to)}`;
              const onPath = graph.pathEdges.has(key);
              const dim = selected && graph.path.length > 1 && !onPath;
              return <line
                className={"knowledge-edge" + (onPath ? " on-path" : "") + (dim ? " dim" : "")}
                key={index}
                x1={graph.nodes[edge.from].x}
                y1={graph.nodes[edge.from].y}
                x2={graph.nodes[edge.to].x}
                y2={graph.nodes[edge.to].y}
                style={{ strokeWidth: (onPath ? 2.2 : 0.7) + edge.score * 1.4, opacity: dim ? 0.1 : (onPath ? 0.95 : 0.28 + edge.score * 0.35) }}
              />;
            })}
            {graph.nodes.map(node => {
              const onPath = graph.path.includes(node.local);
              const dim = selected && graph.path.length > 1 && !onPath && selected.paper.id !== node.paper.id;
              return <g
                className={"knowledge-map-node" + (selected?.paper.id === node.paper.id ? " selected" : "") + (node.isOrigin ? " origin" : "") + (dim ? " dim" : "")}
                key={node.paper.id}
                transform={`translate(${node.x} ${node.y})`}
                onPointerDown={event => event.stopPropagation()}
                onClick={() => setSelectedId(node.paper.id)}
                onDoubleClick={() => onOpenPaper(node.paper)}
              >
                {node.isOrigin && <circle className="cp-origin-ring" r={node.radius + 7} />}
                <circle r={node.radius + 3} fill="transparent" stroke={node.color} strokeOpacity={selected?.paper.id === node.paper.id ? 1 : 0} strokeWidth="3" />
                <circle r={node.radius} fill={node.color} fillOpacity={dim ? 0.35 : 0.92} />
                <text y={node.radius + 14}>{node.label}</text>
                <title>{node.paper.titleZh || node.paper.titleEn}</title>
              </g>;
            })}
          </svg>
        </>}
        {view === "list" && <div className="cp-list-panel">
          {filteredList.map(node => (
            <article key={node.paper.id} className={selected?.paper.id === node.paper.id ? "active" : ""} onClick={() => setSelectedId(node.paper.id)}>
              <strong>{node.paper.titleZh || node.paper.titleEn}</strong>
              <p>{node.label} · 与原点相似度 {Math.round(node.toOrigin * 100)}%</p>
            </article>
          ))}
        </div>}
        {!graph.nodes.length && <div className="knowledge-empty">没有可显示的论文。</div>}
      </section>

      <aside className="knowledge-inspector cp-inspector">
        {selected ? <>
          {selected.isOrigin ? <span className="status">原点论文</span> : <span className="status">邻域论文</span>}
          <h2>{selected.paper.titleZh || selected.paper.titleEn}</h2>
          {selected.paper.titleZh && <p className="english-title">{selected.paper.titleEn}</p>}
          <p>{selected.paper.authors.map(author => author.name).join(", ") || "作者待补充"} · {selected.year ?? "年份待补充"}</p>
          <dl>
            <div><dt>与原点相似度</dt><dd>{Math.round(selected.toOrigin * 100)}%</dd></div>
            <div><dt>一句话总结</dt><dd>{selected.paper.summary || "待补充"}</dd></div>
            <div><dt>中文摘要</dt><dd className="knowledge-abstract">{selected.paper.abstractZh || "暂无中文摘要"}</dd></div>
          </dl>
          <div className="cp-inspector-actions">
            {!selected.isOrigin && <button type="button" className="secondary" onClick={() => makeOrigin(selected.paper)}>设为原点重建图</button>}
            <button type="button" className="primary" onClick={() => onOpenPaper(selected.paper)}><ExternalLink size={16} />在论文表格中定位</button>
          </div>
          <small>单击查看；双击打开。选中非原点时高亮到原点的最短相似路径。相似度：本地 BM25+TF-IDF（L1），不是共引网络。</small>
        </> : <p>没有可显示的论文。</p>}
      </aside>
    </div>
  </main>;
}

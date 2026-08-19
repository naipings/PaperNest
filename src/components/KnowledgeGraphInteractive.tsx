import { ExternalLink, Minus, Network, Plus, RotateCcw, Search, Sparkles } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
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
type GraphNode = {
  local: number;
  paper: Paper;
  x: number;
  y: number;
  color: string;
  radius: number;
  label: string;
  toOrigin: number;
  isOrigin: boolean;
  year: number | null;
};

const paperMatch = (paper: Paper, q: string) => {
  if (!q) return true;
  return `${paper.titleEn} ${paper.titleZh ?? ""} ${paper.summary ?? ""} ${paper.authors.map(a => a.name).join(" ")}`
    .toLowerCase()
    .includes(q);
};

export function KnowledgeGraphInteractive({ onOpenPaper }: { onOpenPaper(paper: Paper): void }) {
  const { data } = useLibrary();
  const [listQuery, setListQuery] = useState("");
  const [originDraft, setOriginDraft] = useState("");
  const [originMenuOpen, setOriginMenuOpen] = useState(false);
  const [originMenuBox, setOriginMenuBox] = useState<{ left: number; top: number; width: number }>();
  const originInputRef = useRef<HTMLInputElement>(null);
  const [threshold, setThreshold] = useState(0.12);
  const [originId, setOriginId] = useState<string>();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [view, setView] = useState<ViewMode>("graph");

  const allPapers = useMemo(
    () => (data?.papers ?? []).filter(paper => !paper.deletedAt).slice(0, 200),
    [data],
  );

  const matrix = useMemo(() => (allPapers.length ? similarityMatrix(allPapers) : []), [allPapers]);

  useEffect(() => {
    if (originId || !allPapers.length || !matrix.length) return;
    setOriginId(allPapers[defaultOriginIndex(matrix)].id);
  }, [allPapers, matrix, originId]);

  const originIndex = useMemo(() => {
    if (!allPapers.length) return 0;
    const fromId = originId ? allPapers.findIndex(paper => paper.id === originId) : -1;
    return fromId >= 0 ? fromId : 0;
  }, [allPapers, originId]);

  const originPaper = allPapers[originIndex];
  const neighborhoodSize = Math.min(40, Math.max(2, allPapers.length || 12));
  const world = useMemo(() => layoutWorldForCount(neighborhoodSize), [neighborhoodSize]);
  const viewport = useGraphViewport({
    world,
    onBlankClick: () => setSelectedId(null),
  });

  const graph = useMemo(() => {
    if (!allPapers.length) {
      return {
        nodes: [] as GraphNode[],
        edges: [] as GraphEdge[],
        path: [] as number[],
        pathEdges: new Set<string>(),
        list: [] as GraphNode[],
        minYear: 2010,
        maxYear: 2026,
        edgesVisible: [] as GraphEdge[],
      };
    }
    const indices = neighborhoodIndices(matrix, originIndex, Math.min(40, allPapers.length));
    const localOrigin = 0;
    const layoutWorld = layoutWorldForCount(indices.length);
    const edgesAll = buildEdges(matrix, indices, 2, 0.05);
    const edges = edgesAll.filter(edge => edge.score >= threshold);
    const layoutEdges = edges.length ? edges : edgesAll.slice(0, Math.max(indices.length - 1, 1));
    const roughRadii = indices.map((_, local) => (local === localOrigin ? 18 : 12));
    const positions = forceLayout(indices.length, layoutEdges, localOrigin, layoutWorld, undefined, roughRadii);
    const years = indices.map(i => yearOf(allPapers[i])).filter((y): y is number => y != null);
    const minYear = years.length ? Math.min(...years) : 2000;
    const maxYear = years.length ? Math.max(...years) : 2026;
    const degree = Array.from({ length: indices.length }, () => 0);
    layoutEdges.forEach(edge => {
      degree[edge.from] += edge.score;
      degree[edge.to] += edge.score;
    });
    const nodes: GraphNode[] = indices.map((paperIndex, local) => {
      const paper = allPapers[paperIndex];
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
    const selectedLocal = selectedId == null ? -1 : nodes.findIndex(node => node.paper.id === selectedId);
    const path = selectedLocal >= 0
      ? (shortestPath(layoutEdges, selectedLocal, localOrigin) ?? [selectedLocal])
      : [];
    const pathEdges = new Set<string>();
    for (let i = 0; i < path.length - 1; i++) {
      const a = Math.min(path[i], path[i + 1]);
      const b = Math.max(path[i], path[i + 1]);
      pathEdges.add(`${a}:${b}`);
    }
    const list = nodes.slice().sort((a, b) => b.toOrigin - a.toOrigin);
    return { nodes, edges: layoutEdges, path, pathEdges, list, minYear, maxYear, edgesVisible: edges };
  }, [allPapers, matrix, originIndex, threshold, selectedId]);

  const selected = selectedId == null ? undefined : graph.nodes.find(node => node.paper.id === selectedId);
  const originYear = yearOf(originPaper);
  const listQ = listQuery.trim().toLowerCase();
  const filteredList = graph.list.filter(node => {
    if (!paperMatch(node.paper, listQ)) return false;
    if (view === "prior" && originYear != null) return (node.year ?? 0) < originYear;
    if (view === "derivative" && originYear != null) return (node.year ?? 9999) > originYear;
    return true;
  });

  const originQ = originDraft.trim().toLowerCase();
  const originCandidates = useMemo(() => {
    const ranked = originQ
      ? allPapers.filter(paper => paperMatch(paper, originQ))
      : allPapers;
    return ranked.slice(0, 14);
  }, [allPapers, originQ]);

  const makeOrigin = (paper: Paper) => {
    setOriginId(paper.id);
    setSelectedId(paper.id);
    setOriginDraft("");
    setOriginMenuOpen(false);
    setView("graph");
  };

  const syncOriginMenuBox = () => {
    const el = originInputRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setOriginMenuBox({ left: rect.left, top: rect.bottom + 4, width: Math.max(rect.width, 320) });
  };

  useLayoutEffect(() => {
    if (!originMenuOpen) return;
    syncOriginMenuBox();
    const onReposition = () => syncOriginMenuBox();
    window.addEventListener("resize", onReposition);
    window.addEventListener("scroll", onReposition, true);
    return () => {
      window.removeEventListener("resize", onReposition);
      window.removeEventListener("scroll", onReposition, true);
    };
  }, [originMenuOpen]);

  const originMenu = originMenuOpen && originMenuBox
    ? createPortal(
      <ul
        className="cp-origin-menu"
        style={{ left: originMenuBox.left, top: originMenuBox.top, width: originMenuBox.width }}
        onMouseDown={event => event.preventDefault()}
      >
        {originCandidates.map(paper => (
          <li key={paper.id}>
            <button
              type="button"
              className={paper.id === originId ? "active" : ""}
              onClick={() => makeOrigin(paper)}
            >
              <strong>{paper.titleZh || paper.titleEn}</strong>
              <small>{authorYearLabel(paper)}</small>
            </button>
          </li>
        ))}
        {!originCandidates.length && <li className="cp-origin-empty">无匹配论文</li>}
      </ul>,
      document.body,
    )
    : null;

  return <main className="knowledge-graph-page cp-page">
    <header className="page-heading knowledge-graph-header">
      <div className="page-title-block">
        <div className="page-title-row">
          <span className="page-title-icon"><Network size={18} /></span>
          <h1>本地知识树</h1>
          <span className="page-kicker">Connected Papers 风格</span>
        </div>
        <p>
          以原点论文为中心的力导向邻域图。可在「原点」栏本地搜索切换核心；初始默认一篇。单击节点查看，点空白取消选中。
        </p>
      </div>
      <div className="page-heading-actions">
        <label className="knowledge-search">
          <Search size={17} />
          <input value={listQuery} onChange={event => setListQuery(event.target.value)} placeholder="筛选左侧列表…" />
        </label>
      </div>
    </header>

    <div className={"cp-toolbar" + (originMenuOpen ? " is-picking" : "")}>
      <div className="cp-origin-picker">
        <Sparkles size={14} />
        <strong>原点</strong>
        <div className="cp-origin-field">
          <input
            ref={originInputRef}
            value={originMenuOpen ? originDraft : (originPaper ? (originPaper.titleZh || originPaper.titleEn) : "")}
            placeholder="搜索本地论文并设为原点…"
            onFocus={() => {
              setOriginMenuOpen(true);
              setOriginDraft("");
              requestAnimationFrame(syncOriginMenuBox);
            }}
            onChange={event => {
              setOriginDraft(event.target.value);
              setOriginMenuOpen(true);
              requestAnimationFrame(syncOriginMenuBox);
            }}
            onBlur={() => {
              window.setTimeout(() => setOriginMenuOpen(false), 150);
            }}
            aria-label="搜索并设定原点论文"
            aria-expanded={originMenuOpen}
          />
        </div>
      </div>
      <div className="cp-view-tabs">
        {([["graph", "图谱"], ["prior", "先前工作"], ["derivative", "衍生工作"], ["list", "列表"]] as const).map(([id, label]) => (
          <button key={id} type="button" className={view === id ? "active" : ""} onClick={() => setView(id)}>{label}</button>
        ))}
      </div>
    </div>
    {originMenu}

    <div className="knowledge-controls">
      <label>关系阈值 <input type="range" min="0.04" max="0.45" step="0.02" value={threshold} onChange={event => setThreshold(Number(event.target.value))} /><strong>{Math.round(threshold * 100)}%</strong></label>
      <span>{graph.nodes.length} 篇邻域 · {graph.edgesVisible.length} 条可见关联</span>
      <span className="knowledge-gesture-hint">滚轮缩放 · 拖动画布 · 点空白取消选中 · 双击打开</span>
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
              const dim = Boolean(selected && graph.path.length > 1 && !onPath);
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
              const dim = Boolean(selected && graph.path.length > 1 && !onPath && selected.paper.id !== node.paper.id);
              return <g
                className={"knowledge-map-node" + (selected?.paper.id === node.paper.id ? " selected" : "") + (node.isOrigin ? " origin" : "") + (dim ? " dim" : "")}
                key={node.paper.id}
                transform={`translate(${node.x} ${node.y})`}
                onPointerDown={event => event.stopPropagation()}
                onClick={event => {
                  event.stopPropagation();
                  setSelectedId(node.paper.id);
                }}
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
          <small>单击节点查看；点空白取消选中；双击打开。非原点可「设为原点重建图」，或在上方原点栏搜索切换。</small>
        </> : <p className="cp-inspector-idle">单击图中节点或左侧列表查看详情；点击画布空白处可取消选中。原点请用上方搜索框切换。</p>}
      </aside>
    </div>
  </main>;
}

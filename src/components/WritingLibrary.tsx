import { useMemo, useState } from "react";
import { BookOpen, Copy, Feather, Filter, Search } from "lucide-react";
import { useLibrary } from "../state/LibraryContext";
import type { Paper } from "../types";

const purposes = ["全部", "研究背景", "问题陈述", "方法描述", "实验分析", "对比", "局限", "待分类"];
export function WritingLibrary({ onOpenPaper }: { onOpenPaper(paper: Paper, page?: number): void }) {
  const { data } = useLibrary(); const [purpose, setPurpose] = useState("全部"); const [search, setSearch] = useState("");
  const excerpts = useMemo(() => data?.excerpts.filter(item => (purpose === "全部" || item.purpose === purpose) && [item.sourceText, item.translationZh, item.personalRewrite].join(" ").toLowerCase().includes(search.toLowerCase())) ?? [], [data, purpose, search]);
  if (!data) return null;
  return <main className="content-page"><header className="page-heading"><div><span className="eyebrow"><Feather size={15} />ACADEMIC WRITING</span><h1>写作资料库</h1><p>将阅读中的好句子沉淀为可追溯、可复用的写作素材。</p></div><div className="stat-card"><strong>{data.excerpts.length}</strong><small>已收藏佳句</small></div></header>
    <div className="writing-toolbar"><label className="search-box"><Search size={16} /><input placeholder="搜索佳句、译文或个人改写" value={search} onChange={e => setSearch(e.target.value)} /></label><label><Filter size={15} /><select value={purpose} onChange={e => setPurpose(e.target.value)}>{purposes.map(p => <option key={p}>{p}</option>)}</select></label></div>
    <div className="purpose-chips">{purposes.map(p => <button key={p} className={purpose === p ? "active" : ""} onClick={() => setPurpose(p)}>{p}{p !== "全部" && <small>{data.excerpts.filter(e => e.purpose === p).length}</small>}</button>)}</div>
    <div className="excerpt-grid">{excerpts.map(item => { const paper = data.papers.find(p => p.id === item.paperId); return <article className="excerpt-card" key={item.id}><header><span>{item.purpose}</span><button onClick={() => navigator.clipboard.writeText(item.sourceText)} title="复制"><Copy size={15} /></button></header><blockquote>“{item.sourceText}”</blockquote><p>{item.translationZh || "中文翻译待补充"}</p>{item.personalRewrite && <div className="rewrite"><small>我的改写</small>{item.personalRewrite}</div>}<footer><button disabled={!paper} onClick={() => paper && onOpenPaper(paper, item.page)}><BookOpen size={14} />{paper?.titleZh || paper?.titleEn || "来源论文"} · P{item.page ?? "?"}</button></footer></article>; })}</div>
  </main>;
}

import { useMemo, useState } from "react";
import { BookOpen, Copy, Feather, Filter, Search, Trash2 } from "lucide-react";
import { FilterMenu } from "./FilterMenu";
import { useLibrary } from "../state/LibraryContext";
import { writingPurposeLabels } from "../lib/writingPurposes";
import type { Paper } from "../types";

export function WritingLibrary({ onOpenPaper }: { onOpenPaper(paper: Paper, page?: number): void }) {
  const { data, saveExcerpt, deleteExcerpt } = useLibrary();
  const [purpose, setPurpose] = useState("全部");
  const [search, setSearch] = useState("");
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());
  const purposeLabels = useMemo(() => writingPurposeLabels(data?.excerpts ?? []), [data?.excerpts]);
  const purposes = useMemo(() => ["全部", ...purposeLabels], [purposeLabels]);
  const excerpts = useMemo(() => data?.excerpts.filter(item => (purpose === "全部" || item.purpose === purpose) && [item.sourceText, item.translationZh, item.personalRewrite].join(" ").toLowerCase().includes(search.toLowerCase())) ?? [], [data, purpose, search]);
  if (!data) return null;
  const toggle = (id: string) => setCheckedIds(current => { const next = new Set(current); next.has(id) ? next.delete(id) : next.add(id); return next; });
  const remove = async (ids: string[]) => {
    if (!ids.length || !confirm(ids.length === 1 ? "删除这条写作素材？" : `删除选中的 ${ids.length} 条写作素材？`)) return;
    for (const id of ids) await deleteExcerpt(id);
    setCheckedIds(new Set());
  };
  return <main className="content-page"><header className="page-heading"><div><span className="eyebrow"><Feather size={15} />ACADEMIC WRITING</span><h1>写作资料库</h1><p>将阅读中的好句子沉淀为可追溯、可复用的写作素材。</p></div><div className="stat-card"><strong>{data.excerpts.length}</strong><small>已收藏佳句</small></div></header>
    <div className="writing-toolbar"><label className="search-box"><Search size={16} /><input placeholder="搜索佳句、译文或个人改写" value={search} onChange={e => setSearch(e.target.value)} /></label><FilterMenu icon={<Filter size={15} />} value={purpose} onChange={setPurpose} groups={[{ title: "写作用途", options: purposes.map(item => ({ id: item, label: item })) }]} /></div>
    <div className="purpose-chips">{purposes.map(p => <button key={p} className={purpose === p ? "active" : ""} onClick={() => setPurpose(p)}>{p}{p !== "全部" && <small>{data.excerpts.filter(e => e.purpose === p).length}</small>}</button>)}</div>
    {checkedIds.size > 0 && <div className="table-bulk-actions writing-bulk"><strong>已选 {checkedIds.size} 条</strong><button className="secondary danger" onClick={() => void remove([...checkedIds])}><Trash2 size={15} />删除选中</button><button className="ghost" onClick={() => setCheckedIds(new Set())}>取消选择</button></div>}
    <div className="excerpt-grid">{excerpts.map(item => {
      const paper = data.papers.find(p => p.id === item.paperId);
      const labels = purposeLabels.includes(item.purpose) ? purposeLabels : [item.purpose, ...purposeLabels];
      return <article className={`excerpt-card ${checkedIds.has(item.id) ? "checked" : ""}`} key={item.id}><header><div className="excerpt-card-meta"><label className="excerpt-check"><input className="row-check" type="checkbox" checked={checkedIds.has(item.id)} onChange={() => toggle(item.id)} aria-label="选择写作素材" /></label><div className="excerpt-purpose"><FilterMenu value={item.purpose} onChange={next => { if (next !== item.purpose) void saveExcerpt({ ...item, purpose: next }); }} groups={[{ title: "写作用途", options: labels.map(label => ({ id: label, label })) }]} /></div></div><div className="excerpt-card-actions"><button type="button" title="复制" onClick={() => navigator.clipboard.writeText(item.sourceText)}><Copy size={15} /></button><button type="button" className="annotation-delete" title="删除" onClick={() => void remove([item.id])}><Trash2 size={15} /></button></div></header><blockquote>“{item.sourceText}”</blockquote><p>{item.translationZh || "中文翻译待补充"}</p>{item.personalRewrite && <div className="rewrite"><small>我的改写</small>{item.personalRewrite}</div>}<footer><button disabled={!paper} onClick={() => paper && onOpenPaper(paper, item.page)}><BookOpen size={14} />{paper?.titleZh || paper?.titleEn || "来源论文"} · P{item.page ?? "?"}</button></footer></article>;
    })}</div>
  </main>;
}

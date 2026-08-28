import { RotateCcw, Trash2 } from "lucide-react";
import { useLibrary } from "../state/LibraryContext";
import { EmptyState } from "./Sidebar";

export function TrashView() {
  const { data, savePaper, purgePaper } = useLibrary();
  if (!data) return null;
  const papers = data.papers.filter(p => p.deletedAt);
  const restore = (paper: typeof papers[number]) => savePaper({ ...paper, deletedAt: undefined });
  const purge = (paper: typeof papers[number]) => {
    if (!confirm(`永久删除「${paper.titleZh || paper.titleEn}」？将同时删除受管 PDF、批注、术语和写作素材，且无法恢复。`)) return;
    void purgePaper(paper.id);
  };
  return <main className="content-page">
    <header className="page-heading">
      <div className="page-title-block">
        <div className="page-title-row"><span className="page-title-icon"><Trash2 size={18} /></span><h1>回收站</h1><span className="page-kicker">资料清理</span></div>
        <p>删除的论文保留附件和批注，可随时恢复；永久删除才会清除本地文件。</p>
      </div>
      <div className="page-heading-actions"><div className="stat-card"><strong>{papers.length}</strong><small>待处理</small></div></div>
    </header>
    {!papers.length ? <EmptyState icon="trash" title="回收站是空的" description="删除的论文会移到这里，附件与批注保留，可随时恢复。" /> : <div className="trash-list">{papers.map(paper => <article key={paper.id}><Trash2 size={18} /><div><strong>{paper.titleZh || paper.titleEn}</strong><small>删除于 {new Date(paper.deletedAt!).toLocaleString("zh-CN")}</small></div><button className="secondary" onClick={() => void restore(paper)}><RotateCcw size={15} />恢复</button><button className="secondary danger" onClick={() => purge(paper)}><Trash2 size={15} />永久删除</button></article>)}</div>}
  </main>;
}

import { FilePlus2, FileText, Import, Plus, Search } from "lucide-react";
import { backend } from "../services/backend";

export function Topbar({ search, onSearch, onCreate, onRefresh }: { search: string; onSearch(value: string): void; onCreate(): void; onRefresh(): Promise<void> }) {
  const importPdfs = async () => { const imported = await backend.chooseAndImportPdfs(); if (imported.length) await onRefresh(); };
  const importCitations = async () => { const imported = await backend.chooseAndImportCitations(); if (imported.length) await onRefresh(); };
  return <header className="topbar">
    <label className="search-box"><Search size={17} /><input value={search} onChange={e => onSearch(e.target.value)} placeholder="搜索标题、作者、摘要、术语、批注或 PDF 正文…" /><kbd>Ctrl K</kbd></label>
    <div className="topbar-actions">
      <button className="secondary" onClick={importCitations}><Import size={16} />导入 Bib/RIS</button>
      <button className="secondary" onClick={importPdfs}><FilePlus2 size={16} />导入 PDF</button>
      <button className="primary" onClick={onCreate}><Plus size={16} />新建论文</button>
    </div>
  </header>;
}

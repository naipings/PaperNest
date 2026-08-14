import { useState } from "react";
import { FilePlus2, Import, LoaderCircle, Plus, Search } from "lucide-react";
import { backend } from "../services/backend";
import { dataUrlToBytes, preparePaperAnalysis } from "../services/llm";
import { useLibrary } from "../state/LibraryContext";
import type { LlmAnalysis, Paper } from "../types";
import { now, uuid } from "../types";

export function Topbar({ search, onSearch, onCreate, onRefresh }: { search: string; onSearch(value: string): void; onCreate(): void; onRefresh(): Promise<void> }) {
  const { data } = useLibrary(); const [busy, setBusy] = useState(""); const [notice, setNotice] = useState("");
  const importPdfs = async () => {
    try {
      const imported = await backend.chooseAndImportPdfs(); if (!imported.length) return;
      const papers = imported.map(item => item.paper);
      if (!data?.llm.autoAnalyzeOnImport || !data.llm.apiKeySaved) { await onRefresh(); setNotice(`已导入 ${papers.length} 篇；未配置 LLM，保留待补充状态。`); return; }
      const duplicateTitles: string[] = [];
      for (let index = 0; index < papers.length; index++) {
        const paper = papers[index]; setBusy(`正在用 LLM 分析 ${index + 1}/${papers.length}：${paper.titleEn}`);
        try { await analyzeAndFill(paper); const candidates = await backend.findDuplicateCandidates(paper.id); if (candidates.length) duplicateTitles.push(candidates[0].title); }
        catch (error) { duplicateTitles.push(`${paper.titleEn}（分析失败：${error instanceof Error ? error.message : String(error)}）`); }
      }
      await onRefresh(); setNotice(`已导入并自动整理 ${papers.length} 篇${duplicateTitles.length ? `；${duplicateTitles.length} 篇需要查看导入提示` : ""}。`);
    } finally { setBusy(""); }
  };
  const analyzeAndFill = async (paper: Paper) => {
    const prepared = await preparePaperAnalysis(paper); const analysis = await backend.analyzePaper(paper.id, prepared.input); const filled = applyAnalysis(paper, analysis);
    await backend.savePaper(filled);
    for (const item of analysis.vocabulary?.slice(0, 8) ?? []) await backend.saveVocabulary({ id: uuid(), paperId: paper.id, termEn: item.termEn, meaningZh: item.meaningZh, sentenceEn: item.sentenceEn, sentenceZh: item.sentenceZh, page: item.page });
    const page = analysis.frameworkPage; const image = page ? prepared.candidateImages.find(item => item.page === page) : undefined;
    if (image) await backend.saveFigure({ id: uuid(), paperId: paper.id, imagePath: "", title: analysis.frameworkTitle || "LLM 识别的方法框架", explanationEn: analysis.frameworkExplanationEn, explanationZh: analysis.frameworkExplanationZh, page, isPrimary: true }, dataUrlToBytes(image.dataUrl));
  };
  const importCitations = async () => { const imported = await backend.chooseAndImportCitations(); if (imported.length) await onRefresh(); };
  return <header className="topbar">
    <label className="search-box"><Search size={17} /><input value={search} onChange={e => onSearch(e.target.value)} placeholder="搜索标题、作者、摘要、术语、批注或 PDF 正文…" /><kbd>Ctrl K</kbd></label>
    {busy && <span className="import-status"><LoaderCircle className="spin" size={15} />{busy}</span>}{notice && !busy && <span className="import-status">{notice}</span>}
    <div className="topbar-actions">
      <button className="secondary" disabled={Boolean(busy)} onClick={importCitations}><Import size={16} />导入 Bib/RIS</button>
      <button className="secondary" disabled={Boolean(busy)} onClick={importPdfs}>{busy ? <LoaderCircle className="spin" size={16} /> : <FilePlus2 size={16} />}导入 PDF</button>
      <button className="primary" disabled={Boolean(busy)} onClick={onCreate}><Plus size={16} />新建论文</button>
    </div>
  </header>;
}

function applyAnalysis(paper: Paper, analysis: LlmAnalysis): Paper {
  const value = <T,>(candidate: T | undefined, current: T | undefined) => typeof candidate === "string" && !candidate.trim() ? current : candidate ?? current;
  return { ...paper, titleEn: value(analysis.titleEn, paper.titleEn) || paper.titleEn, titleZh: value(analysis.titleZh, paper.titleZh), authors: analysis.authors?.filter(Boolean).map(name => ({ id: uuid(), name })) || paper.authors, abstractEn: value(analysis.abstractEn, paper.abstractEn), abstractZh: value(analysis.abstractZh, paper.abstractZh), summary: value(analysis.summary, paper.summary), venue: value(analysis.venue, paper.venue), publicationDate: value(analysis.publicationDate, paper.publicationDate), doi: value(analysis.doi, paper.doi), sourceUrl: value(analysis.sourceUrl, paper.sourceUrl), updatedAt: now() };
}

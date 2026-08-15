import { useState } from "react";
import { ask } from "@tauri-apps/plugin-dialog";
import { FilePlus2, Import, LoaderCircle, Plus, Search } from "lucide-react";
import { backend } from "../services/backend";
import { applyCoverMeta, extractForImport } from "../lib/extractPdfCover";
import { arxivFromText } from "../lib/paperDuplicate";
import { resolveImportedPaper } from "../lib/importDecisions";
import { dataUrlToBytes } from "../services/llm";
import { hasTranslationEndpoint, translateEnglishToChinese } from "../services/translation";
import { useLibrary } from "../state/LibraryContext";
import type { LlmAnalysis, LlmAnalysisInput, Paper } from "../types";
import { now, uuid } from "../types";

export function Topbar({ search, onSearch, onCreate, onRefresh }: { search: string; onSearch(value: string): void; onCreate(): void; onRefresh(): Promise<void> }) {
  const { data } = useLibrary(); const [busy, setBusy] = useState(""); const [notice, setNotice] = useState("");
  const importPdfs = async () => {
    try {
      const imported = await backend.chooseAndImportPdfs(); if (!imported.length) return;
      let catalog = (await backend.initialize()).papers.filter(paper => !paper.deletedAt);
      const acceptedSame = new Set<string>();
      const kept: { paper: Paper; analysisInput?: LlmAnalysisInput; candidateImages: { page: number; dataUrl: string }[] }[] = [];
      const notes: string[] = [];
      const visionEnabled = Boolean(data?.llm.visionEnabled);
      for (let index = 0; index < imported.length; index++) {
        catalog = mergeCatalog(catalog, (await backend.initialize()).papers.filter(paper => !paper.deletedAt));
        const early = await resolveImportedPaper(imported[index].paper, catalog, importPorts, acceptedSame);
        catalog = early.catalog;
        if (early.note) notes.push(early.note);
        if (!early.paper) continue;
        setBusy(`正在读取 PDF 信息 ${index + 1}/${imported.length}`);
        const filled = await fillFromPdf(early.paper, visionEnabled);
        if (filled.failure) notes.push(`${filled.paper.titleEn}（读取 PDF 失败：${filled.failure}）`);
        catalog = mergeCatalog(catalog, (await backend.initialize()).papers.filter(paper => !paper.deletedAt));
        const decided = await resolveImportedPaper(filled.paper, catalog, importPorts, acceptedSame);
        catalog = decided.catalog;
        if (decided.note) notes.push(decided.note);
        if (decided.paper) kept.push({ paper: decided.paper, analysisInput: filled.analysisInput, candidateImages: filled.candidateImages });
      }
      if (!data?.llm.autoAnalyzeOnImport || !data.llm.apiKeySaved) {
        await onRefresh();
        setNotice(importNotice(kept.length, notes));
        return;
      }
      const remaining: Paper[] = [];
      for (let index = 0; index < kept.length; index++) {
        const item = kept[index]; setBusy(`正在用 LLM 分析 ${index + 1}/${kept.length}：${item.paper.titleEn}`);
        try {
          const analyzed = await analyzeAndFill(item.paper, item.analysisInput, item.candidateImages);
          const decided = await resolveImportedPaper(analyzed, catalog, importPorts, acceptedSame);
          catalog = decided.catalog;
          if (decided.note) notes.push(decided.note);
          if (decided.paper) remaining.push(decided.paper);
        }
        catch (error) { notes.push(`${item.paper.titleEn}（分析失败：${error instanceof Error ? error.message : String(error)}）`); remaining.push(item.paper); }
      }
      await onRefresh(); setNotice(importNotice(remaining.length, notes));
    } finally { setBusy(""); }
  };
  const analyzeAndFill = async (paper: Paper, analysisInput: LlmAnalysisInput | undefined, candidateImages: { page: number; dataUrl: string }[]) => {
    const input = analysisInput ?? { text: "", candidateImages: [] };
    if (input.text.trim().length < 80) throw new Error("PDF 没有足够的可提取文本，无法自动分析");
    let analysis: LlmAnalysis;
    try {
      analysis = await backend.analyzePaper(paper.id, input);
    } catch (error) {
      if (!input.candidateImages.length) throw error;
      analysis = await backend.analyzePaper(paper.id, { text: input.text, candidateImages: [] });
    }
    let filled = applyAnalysis(paper, analysis);
    if (filled.abstractEn && !filled.abstractZh && hasTranslationEndpoint()) {
      try { filled = { ...filled, abstractZh: await translateEnglishToChinese(filled.abstractEn), updatedAt: now() }; }
      catch { /* 翻译服务不可用时仍保留英文摘要 */ }
    }
    await backend.savePaper(filled);
    for (const item of analysis.vocabulary?.slice(0, 8) ?? []) await backend.saveVocabulary({ id: uuid(), paperId: paper.id, termEn: item.termEn, meaningZh: item.meaningZh, sentenceEn: item.sentenceEn, sentenceZh: item.sentenceZh, page: item.page });
    const page = analysis.frameworkPage; const image = page ? candidateImages.find(item => item.page === page) : undefined;
    if (image) await backend.saveFigure({ id: uuid(), paperId: paper.id, imagePath: "", title: analysis.frameworkTitle || "LLM 识别的方法框架", explanationEn: analysis.frameworkExplanationEn, explanationZh: analysis.frameworkExplanationZh, page, isPrimary: true }, dataUrlToBytes(image.dataUrl));
    return filled;
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

const importPorts = {
  confirmKeep: async (existing: Paper, incoming: Paper) => {
    const message = `库中已有相同文献《${existing.titleZh || existing.titleEn}》。仍要导入《${incoming.titleZh || incoming.titleEn}》吗？`;
    try {
      return await ask(message, { title: "重复文献", kind: "warning", okLabel: "仍要导入", cancelLabel: "取消导入" });
    } catch {
      return window.confirm(message);
    }
  },
  save: (paper: Paper) => backend.savePaper(paper),
  discard: async (paper: Paper) => {
    const timestamp = now();
    await backend.savePaper({ ...paper, deletedAt: timestamp, updatedAt: timestamp });
    await backend.purgePaper(paper.id);
  }
};

function mergeCatalog(current: Paper[], fresh: Paper[]) {
  const byId = new Map(current.map(paper => [paper.id, paper]));
  for (const paper of fresh) byId.set(paper.id, paper);
  return [...byId.values()];
}

function importNotice(count: number, notes: string[]) {
  const extra = notes.length ? `；${notes.join("；")}` : "";
  return `已导入 ${count} 篇，已从 PDF 填写能识别的标题、作者、摘要和日期${extra}。`;
}

async function fillFromPdf(paper: Paper, visionEnabled: boolean): Promise<{ paper: Paper; analysisInput?: LlmAnalysisInput; candidateImages: { page: number; dataUrl: string }[]; failure?: string }> {
  if (!paper.pdfPath) return { paper, candidateImages: [] };
  const bytes = await backend.readPdf(paper.pdfPath);
  let next: Paper = { ...paper, arxivId: paper.arxivId || arxivFromText(paper.titleEn), updatedAt: now() };
  try {
    const extracted = await extractForImport(bytes, visionEnabled);
    next = applyCoverMeta(next, extracted.cover);
    if (next.abstractEn && !next.abstractZh && hasTranslationEndpoint()) {
      try { next = { ...next, abstractZh: await translateEnglishToChinese(next.abstractEn), updatedAt: now() }; }
      catch { /* 未配置或翻译服务不可用时仍保留英文摘要 */ }
    }
    await backend.savePaper(next);
    return {
      paper: next,
      analysisInput: { text: extracted.text, candidateImages: extracted.candidateImages },
      candidateImages: extracted.candidateImages
    };
  } catch (error) {
    await backend.savePaper(next);
    return { paper: next, candidateImages: [], failure: error instanceof Error ? error.message : String(error) };
  }
}

function applyAnalysis(paper: Paper, analysis: LlmAnalysis): Paper {
  const value = <T,>(candidate: T | undefined, current: T | undefined) => typeof candidate === "string" && !candidate.trim() ? current : candidate ?? current;
  const llmAuthors = analysis.authors?.map(name => name.trim()).filter(name => name && !/^[\d\s.+*†‡§¶,-]+$/.test(name)).map(name => ({ id: uuid(), name }));
  const authors = llmAuthors?.length ? llmAuthors : paper.authors.filter(author => !/^[\d\s.+*†‡§¶,-]+$/.test(author.name));
  return {
    ...paper,
    titleEn: value(analysis.titleEn, paper.titleEn) || paper.titleEn,
    titleZh: value(analysis.titleZh, paper.titleZh),
    authors,
    abstractEn: value(analysis.abstractEn, paper.abstractEn),
    abstractZh: value(analysis.abstractZh, paper.abstractZh),
    summary: value(analysis.summary, paper.summary),
    venue: value(analysis.venue, paper.venue),
    publicationDate: value(analysis.publicationDate, paper.publicationDate),
    doi: value(analysis.doi, paper.doi),
    sourceUrl: value(analysis.sourceUrl, paper.sourceUrl),
    updatedAt: now()
  };
}

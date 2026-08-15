import { type PDFDocumentProxy } from "pdfjs-dist";
import { backend } from "./backend";
import type { LlmAnalysisInput, Paper } from "../types";
import { withPdfDocument } from "../lib/pdfSession";

type CandidateImage = { page: number; dataUrl: string };
export type PreparedPaperAnalysis = { input: LlmAnalysisInput; candidateImages: CandidateImage[] };

const FIGURE_WORDS = /\b(fig(?:ure)?\.?|architecture|framework|overview|pipeline|our model|proposed method|methodology)\b/i;

/** Extracts text locally. Only the selected candidate page thumbnails leave the machine when vision is enabled. */
export async function preparePaperAnalysis(paper: Paper, visionEnabled = true): Promise<PreparedPaperAnalysis> {
  if (!paper.pdfPath) throw new Error("这篇论文没有关联 PDF");
  const bytes = await backend.readPdf(paper.pdfPath);
  return withPdfDocument(bytes, async document => {
    const texts: { page: number; text: string; score: number }[] = [];
    let size = 0;
    for (let page = 1; page <= Math.min(document.numPages, 40) && size < 85_000; page++) {
      const content = await (await document.getPage(page)).getTextContent();
      const text = content.items.map(item => "str" in item ? item.str : "").join(" ").replace(/\s+/g, " ").trim();
      size += text.length;
      const score = (page <= 3 ? 2 : 0) + (FIGURE_WORDS.test(text) ? 5 : 0) + (text.match(/fig(?:ure)?\.?/gi)?.length ?? 0);
      texts.push({ page, text, score });
    }
    const candidateImages: CandidateImage[] = [];
    if (visionEnabled) {
      const candidatePages = texts.filter(item => item.score > 0).sort((a, b) => b.score - a.score || a.page - b.page).slice(0, 3);
      for (const candidate of candidatePages) {
        try { candidateImages.push({ page: candidate.page, dataUrl: await renderPagePreview(document, candidate.page) }); }
        catch { /* Text-only analysis remains available. */ }
      }
    }
    return { input: { text: texts.map(item => `【第 ${item.page} 页】\n${item.text}`).join("\n\n"), candidateImages }, candidateImages };
  });
}

async function renderPagePreview(pdf: PDFDocumentProxy, pageNo: number): Promise<string> {
  const page = await pdf.getPage(pageNo); const base = page.getViewport({ scale: 1 }); const scale = Math.min(1.25, 920 / base.width); const viewport = page.getViewport({ scale });
  const canvas = window.document.createElement("canvas"); canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
  await page.render({ canvasContext: canvas.getContext("2d")!, viewport, canvas }).promise;
  return canvas.toDataURL("image/jpeg", .72);
}

export function dataUrlToBytes(dataUrl: string): number[] { const encoded = dataUrl.split(",", 2)[1] ?? ""; const binary = atob(encoded); return Array.from(binary, char => char.charCodeAt(0)); }

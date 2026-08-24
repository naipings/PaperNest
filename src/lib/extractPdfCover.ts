import type { PDFDocumentProxy } from "pdfjs-dist";
import type { Paper } from "../types";
import { now, uuid } from "../types";
import { arxivFromText } from "./paperDuplicate";
import { inferCoverMeta, looksBetterTitle, type PdfInfoMeta, type PdfTextRun } from "./pdfCoverMeta";
import { withPdfDocument } from "./pdfSession";

export type ImportPdfExtract = {
  cover: ReturnType<typeof inferCoverMeta>;
  text: string;
  candidateImages: { page: number; dataUrl: string }[];
};

/** One PDF.js session for cover metadata and LLM text. Avoids destroy→getDocument races that drop the first import's analysis. */
export async function extractForImport(bytes: Uint8Array, visionEnabled: boolean): Promise<ImportPdfExtract> {
  return withPdfDocument(bytes, async document => {
    const cover = await readCover(document);
    const { text, candidateImages } = await readAnalysisText(document, visionEnabled);
    return { cover, text, candidateImages };
  });
}

export async function extractPdfCover(bytes: Uint8Array) {
  return withPdfDocument(bytes, readCover);
}

async function readCover(document: PDFDocumentProxy) {
  const meta = await document.getMetadata();
  const info = (meta.info ?? {}) as PdfInfoMeta;
  const runs: PdfTextRun[] = [];
  const rawParts: string[] = [];
  for (let pageNumber = 1; pageNumber <= Math.min(document.numPages, 2); pageNumber++) {
    const page = await document.getPage(pageNumber);
    const content = await page.getTextContent();
    const pageTop = pageNumber === 1 ? 0 : 10000;
    for (const item of content.items) {
      if (!("str" in item) || !item.str) continue;
      rawParts.push(item.str);
      if ("hasEOL" in item && item.hasEOL) rawParts.push("\n");
      const fontSize = Math.hypot(item.transform[0], item.transform[1]) || item.height || 10;
      runs.push({ str: item.str, fontSize, x: item.transform[4], y: item.transform[5] - pageTop, width: item.width, hasEOL: "hasEOL" in item ? Boolean(item.hasEOL) : false });
    }
  }
  return { ...inferCoverMeta(runs, info, rawParts.join("")), pageCount: document.numPages };
}

async function readAnalysisText(document: PDFDocumentProxy, visionEnabled: boolean) {
  const figureWords = /\b(fig(?:ure)?\.?|architecture|framework|overview|pipeline|our model|proposed method|methodology)\b/i;
  const texts: { page: number; text: string; score: number }[] = [];
  let size = 0;
  for (let page = 1; page <= Math.min(document.numPages, 40) && size < 85_000; page++) {
    const content = await (await document.getPage(page)).getTextContent();
    const text = content.items.map(item => "str" in item ? item.str : "").join(" ").replace(/\s+/g, " ").trim();
    size += text.length;
    const score = (page <= 3 ? 2 : 0) + (figureWords.test(text) ? 5 : 0) + (text.match(/fig(?:ure)?\.?/gi)?.length ?? 0);
    texts.push({ page, text, score });
  }
  const candidateImages: { page: number; dataUrl: string }[] = [];
  if (visionEnabled) {
    const candidatePages = texts.filter(item => item.score > 0).sort((a, b) => b.score - a.score || a.page - b.page).slice(0, 3);
    for (const candidate of candidatePages) {
      try { candidateImages.push({ page: candidate.page, dataUrl: await renderPagePreview(document, candidate.page) }); }
      catch { /* text-only analysis remains available */ }
    }
  }
  return { text: texts.map(item => `【第 ${item.page} 页】\n${item.text}`).join("\n\n"), candidateImages };
}

async function renderPagePreview(pdf: PDFDocumentProxy, pageNo: number): Promise<string> {
  const page = await pdf.getPage(pageNo);
  const base = page.getViewport({ scale: 1 });
  const scale = Math.min(1.25, 920 / base.width);
  const viewport = page.getViewport({ scale });
  const canvas = window.document.createElement("canvas");
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  await page.render({ canvasContext: canvas.getContext("2d")!, viewport, canvas }).promise;
  return canvas.toDataURL("image/jpeg", 0.72);
}

export function applyCoverMeta(paper: Paper, meta: ReturnType<typeof inferCoverMeta>): Paper {
  const titleEn = meta.titleEn && looksBetterTitle(meta.titleEn, paper.titleEn) ? meta.titleEn : paper.titleEn;
  const authors = paper.authors.length ? paper.authors : meta.authors.map(name => ({ id: uuid(), name }));
  return {
    ...paper,
    titleEn,
    titleZh: paper.titleZh || meta.titleZh,
    authors,
    publicationDate: paper.publicationDate || meta.publicationDate,
    doi: paper.doi || meta.doi,
    arxivId: paper.arxivId || meta.arxivId || arxivFromText(paper.titleEn) || arxivFromText(titleEn),
    abstractEn: paper.abstractEn || meta.abstractEn,
    venue: paper.venue || meta.venue,
    pageCount: paper.pageCount || meta.pageCount,
    updatedAt: now()
  };
}

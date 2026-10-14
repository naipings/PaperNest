import type { DeepReadPage, Rect } from "../types";

export type PdfTextRun = { str: string; x: number; y: number; width: number; fontSize: number };

/** PDF 用户空间（y 轴向上）中的行框。 */
export type LineBox = { left: number; bottom: number; right: number; top: number };

export type PdfParagraph = { text: string; lines: LineBox[] };

type PageViewport = { width: number; height: number; convertToViewportRectangle(rect: number[]): number[] };

type Line = { text: string; x: number; y: number; right: number; fontSize: number };

function toLines(runs: PdfTextRun[]): Line[] {
  const lines: Line[] = [];
  for (const run of runs) {
    if (!run.str) continue;
    const current = lines.at(-1);
    const sameLine = current
      && Math.abs(run.y - current.y) <= current.fontSize * 0.5
      && run.x >= current.right - current.fontSize;
    if (sameLine) {
      const gap = run.x - current.right > current.fontSize * 0.15 ? " " : "";
      current.text += gap + run.str;
      current.fontSize = Math.max(current.fontSize, run.fontSize);
      current.right = Math.max(current.right, run.x + run.width);
    } else {
      lines.push({ text: run.str, x: run.x, y: run.y, right: run.x + run.width, fontSize: run.fontSize });
    }
  }
  return lines
    .map(line => ({ ...line, text: line.text.replace(/\s+/g, " ").trim() }))
    .filter(line => line.text);
}

function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function joinLine(paragraph: string, line: string) {
  if (/[A-Za-z]-$/.test(paragraph) && /^[a-z]/.test(line)) return paragraph.slice(0, -1) + line;
  return `${paragraph} ${line}`;
}

const lineBox = (line: Line): LineBox => ({
  left: line.x,
  bottom: line.y - line.fontSize * 0.2,
  right: line.right,
  top: line.y + line.fontSize * 0.8,
});

/** 一页文本项 → 段落：行距明显变大、换栏（y 回跳）、首行缩进或字号变化时断段，并拼回行尾连字符。 */
export function splitParagraphs(runs: PdfTextRun[]): PdfParagraph[] {
  const lines = toLines(runs);
  if (!lines.length) return [];
  const steps = lines
    .slice(1)
    .map((line, index) => lines[index].y - line.y)
    .filter((step, index) => step > 0 && step < lines[index].fontSize * 3);
  const paragraphs: PdfParagraph[] = [{ text: lines[0].text, lines: [lineBox(lines[0])] }];
  for (let index = 1; index < lines.length; index++) {
    const previous = lines[index - 1];
    const line = lines[index];
    const step = previous.y - line.y;
    const lineStep = steps.length ? median(steps) : previous.fontSize * 1.2;
    const indent = line.x - previous.x;
    const breaks = step > lineStep * 1.6
      || step < -previous.fontSize
      || Math.abs(line.fontSize - previous.fontSize) > previous.fontSize * 0.15
      || (indent > previous.fontSize * 0.8 && indent < previous.fontSize * 4);
    const current = paragraphs[paragraphs.length - 1];
    if (breaks) paragraphs.push({ text: line.text, lines: [lineBox(line)] });
    else {
      current.text = joinLine(current.text, line.text);
      current.lines.push(lineBox(line));
    }
  }
  return paragraphs;
}

/** PDF 行框 → 页面视口内 0–1 矩形（视口已含页面旋转）。 */
export function toPageRect(box: LineBox, viewport: PageViewport): Rect {
  const [x1, y1, x2, y2] = viewport.convertToViewportRectangle([box.left, box.bottom, box.right, box.top]);
  return {
    x: Math.min(x1, x2) / viewport.width,
    y: Math.min(y1, y2) / viewport.height,
    width: Math.abs(x2 - x1) / viewport.width,
    height: Math.abs(y2 - y1) / viewport.height,
  };
}

export async function extractPdfParagraphs(bytes: Uint8Array): Promise<DeepReadPage[]> {
  const { withPdfDocument } = await import("./pdfSession");
  return withPdfDocument(bytes, async document => {
    const pages: DeepReadPage[] = [];
    for (let page = 1; page <= document.numPages; page++) {
      const source = await document.getPage(page);
      const viewport = source.getViewport({ scale: 1 });
      const content = await source.getTextContent();
      const runs: PdfTextRun[] = [];
      for (const item of content.items) {
        if (!("str" in item)) continue;
        runs.push({
          str: item.str,
          x: item.transform[4],
          y: item.transform[5],
          width: item.width,
          fontSize: Math.hypot(item.transform[0], item.transform[1]) || item.height || 10,
        });
      }
      pages.push({
        page,
        paragraphs: splitParagraphs(runs).map(paragraph => ({
          text: paragraph.text,
          rects: paragraph.lines.map(line => toPageRect(line, viewport)),
        })),
      });
    }
    return pages;
  });
}

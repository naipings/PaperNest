import type { DeepReadPage } from "../types";

export type PdfTextRun = { str: string; x: number; y: number; width: number; fontSize: number };

type Line = { text: string; x: number; y: number; fontSize: number };

function toLines(runs: PdfTextRun[]): Line[] {
  const lines: Line[] = [];
  let endX = 0;
  for (const run of runs) {
    if (!run.str) continue;
    const current = lines.at(-1);
    const sameLine = current
      && Math.abs(run.y - current.y) <= current.fontSize * 0.5
      && run.x >= endX - current.fontSize;
    if (sameLine) {
      const gap = run.x - endX > current.fontSize * 0.15 ? " " : "";
      current.text += gap + run.str;
      current.fontSize = Math.max(current.fontSize, run.fontSize);
    } else {
      lines.push({ text: run.str, x: run.x, y: run.y, fontSize: run.fontSize });
    }
    endX = run.x + run.width;
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

/** 一页文本项 → 段落：行距明显变大、换栏（y 回跳）、首行缩进或字号变化时断段，并拼回行尾连字符。 */
export function splitParagraphs(runs: PdfTextRun[]): string[] {
  const lines = toLines(runs);
  if (!lines.length) return [];
  const steps = lines
    .slice(1)
    .map((line, index) => lines[index].y - line.y)
    .filter((step, index) => step > 0 && step < lines[index].fontSize * 3);
  const paragraphs: string[] = [lines[0].text];
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
    if (breaks) paragraphs.push(line.text);
    else paragraphs[paragraphs.length - 1] = joinLine(paragraphs[paragraphs.length - 1], line.text);
  }
  return paragraphs;
}

export async function extractPdfParagraphs(bytes: Uint8Array): Promise<DeepReadPage[]> {
  const { withPdfDocument } = await import("./pdfSession");
  return withPdfDocument(bytes, async document => {
    const pages: DeepReadPage[] = [];
    for (let page = 1; page <= document.numPages; page++) {
      const content = await (await document.getPage(page)).getTextContent();
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
      pages.push({ page, paragraphs: splitParagraphs(runs) });
    }
    return pages;
  });
}

import type { DeepReadFigure, DeepReadParagraphLocation, FigureBoundary, Rect } from "../types";

export const EVIDENCE_SCHEME = "evidence:";

export type Evidence = { page?: number; ids: string[]; figure?: { figType: "Figure" | "Table"; name: string } };

export type PageMark = { page: number; rects: Rect[] };

export type EvidenceTarget = { page: number; marks: PageMark[] };

/**
 * `(Evidence: A; B)` → 每个分号段落一个 `evidence:` 链接，供报告渲染为可点击锚点。
 * 提示词示例把锚点写在行内代码里，模型照此输出，转换时一并去掉成对反引号。
 */
export function linkEvidence(markdown: string) {
  return markdown.replace(/(`?)\(Evidence:\s*([^()`]*)\)\1/g, (_, _tick: string, body: string) => {
    const links = body
      .split(";")
      .map(segment => segment.trim())
      .filter(Boolean)
      .map(segment => `[${segment.replace(/[[\]]/g, "\\$&")}](${EVIDENCE_SCHEME}${encodeURIComponent(segment)})`);
    return `(Evidence: ${links.join("; ")})`;
  });
}

export function parseEvidence(segment: string): Evidence {
  const ids: string[] = [];
  for (const match of segment.matchAll(/P(\d{4,})(?:\s*[–—-]\s*P?(\d{4,}))?/g)) {
    const first = Number(match[1]);
    const last = match[2] ? Number(match[2]) : first;
    for (let id = first; id <= last; id++) ids.push(`P${String(id).padStart(4, "0")}`);
  }
  const page = segment.match(/\b(?:pp?\.|pages?)\s*(\d+)/i);
  const figure = segment.match(/\b(Fig(?:ure)?s?\.?|Tables?)\s*(\d+)/i);
  return {
    page: page ? Number(page[1]) : undefined,
    ids,
    figure: figure ? { figType: /^t/i.test(figure[1]) ? "Table" : "Figure", name: figure[2] } : undefined,
  };
}

/** pdffigures2 的 72 DPI 页面坐标（原点左上）→ 0–1 矩形；页面尺寸为 PDF 点。 */
export function figureRect(boundary: FigureBoundary, pageSize: { width: number; height: number }): Rect {
  return {
    x: boundary.x1 / pageSize.width,
    y: boundary.y1 / pageSize.height,
    width: (boundary.x2 - boundary.x1) / pageSize.width,
    height: (boundary.y2 - boundary.y1) / pageSize.height,
  };
}

/** 段落 ID 优先（高亮段落），其次图表区域，最后只跳页码；都无法定位时返回 undefined。 */
export function resolveEvidence(
  evidence: Evidence,
  paragraphs: DeepReadParagraphLocation[],
  figures: DeepReadFigure[],
  pageSize: { width: number; height: number },
): EvidenceTarget | undefined {
  const located = evidence.ids
    .map(id => paragraphs.find(paragraph => paragraph.id === id))
    .filter((paragraph): paragraph is DeepReadParagraphLocation => !!paragraph);
  if (located.length) {
    return { page: located[0].page, marks: located.map(paragraph => ({ page: paragraph.page, rects: paragraph.rects })) };
  }
  const figure = evidence.figure && figures.find(item => item.figType === evidence.figure!.figType && item.name === evidence.figure!.name);
  if (figure) return { page: figure.page, marks: [{ page: figure.page, rects: [figureRect(figure.regionBoundary, pageSize)] }] };
  if (evidence.page) return { page: evidence.page, marks: [] };
  return undefined;
}

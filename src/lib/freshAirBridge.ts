import type { Annotation as PaperAnnotation, Rect } from "../types";
import type { Annotation as FapAnnotation, Quad, Rect as FapRect } from "fresh-air-pdf";
import { AnnotationType as FapType } from "fresh-air-pdf";

export type PageSize = { width: number; height: number };

export function normalizedRectToPdfRect(rect: Rect, page: PageSize): FapRect {
  return {
    x: rect.x * page.width,
    y: rect.y * page.height,
    width: rect.width * page.width,
    height: rect.height * page.height,
  };
}

export function pdfRectToNormalized(rect: FapRect, page: PageSize): Rect {
  return {
    x: rect.x / page.width,
    y: rect.y / page.height,
    width: rect.width / page.width,
    height: rect.height / page.height,
  };
}

export function rectToQuad(rect: Rect, page: PageSize): Quad {
  const pdfRect = normalizedRectToPdfRect(rect, page);
  return {
    topLeft: { x: pdfRect.x, y: pdfRect.y },
    topRight: { x: pdfRect.x + pdfRect.width, y: pdfRect.y },
    bottomLeft: { x: pdfRect.x, y: pdfRect.y + pdfRect.height },
    bottomRight: { x: pdfRect.x + pdfRect.width, y: pdfRect.y + pdfRect.height },
  };
}

function isoDate(value: Date | string | undefined): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string" && value) return value;
  return new Date().toISOString();
}

export function paperToFreshAir(annotation: PaperAnnotation, pageSizes: Map<number, PageSize>): FapAnnotation | null {
  const page = pageSizes.get(annotation.page);
  if (!page) return null;
  const base = {
    id: annotation.id,
    pageNumber: annotation.page,
    color: annotation.color,
    opacity: annotation.type === "highlight" ? 0.35 : 1,
    createdAt: new Date(annotation.createdAt),
    modifiedAt: new Date(annotation.updatedAt),
  };

  if (annotation.type === "highlight" && annotation.geometry.rects?.[0]) {
    return {
      ...base,
      type: FapType.Rectangle,
      rect: normalizedRectToPdfRect(annotation.geometry.rects[0], page),
      fillColor: annotation.color,
      borderWidth: 0,
      borderColor: annotation.color,
      text: annotation.quote,
    } as FapAnnotation;
  }

  if (annotation.type === "underline" && annotation.geometry.rects?.length) {
    return {
      ...base,
      type: FapType.Underline,
      quads: annotation.geometry.rects.map(rect => rectToQuad(rect, page)),
      text: annotation.quote,
    } as FapAnnotation;
  }

  if (annotation.type === "text" && annotation.geometry.rects?.[0]) {
    return {
      ...base,
      type: FapType.FreeText,
      rect: normalizedRectToPdfRect(annotation.geometry.rects[0], page),
      content: annotation.comment || annotation.quote || "",
      fontSize: 12,
      fontFamily: "Helvetica",
      textAlign: "left",
    } as FapAnnotation;
  }

  if (annotation.type === "ink" && annotation.geometry.points?.length) {
    return {
      ...base,
      type: FapType.Ink,
      paths: [annotation.geometry.points.map(point => ({ x: point.x * page.width, y: point.y * page.height }))],
      width: 2,
      inkColor: annotation.color,
    } as FapAnnotation;
  }

  return null;
}

export function freshAirToPaper(annotation: FapAnnotation, paperId: string, pageSizes: Map<number, PageSize>): PaperAnnotation | null {
  const page = pageSizes.get(annotation.pageNumber);
  if (!page) return null;
  const timestamps = { createdAt: isoDate(annotation.createdAt), updatedAt: isoDate(annotation.modifiedAt) };

  if (annotation.type === FapType.Rectangle && "rect" in annotation) {
    return {
      id: annotation.id,
      paperId,
      page: annotation.pageNumber,
      type: "highlight",
      geometry: { rects: [pdfRectToNormalized(annotation.rect, page)] },
      quote: (annotation as { text?: string }).text,
      color: annotation.fillColor || annotation.color || "#f2ce67",
      ...timestamps,
    };
  }

  if ((annotation.type === FapType.Underline || annotation.type === FapType.Strikeout) && "quads" in annotation) {
    const rects = annotation.quads.map(quad => pdfRectToNormalized({
      x: quad.topLeft.x,
      y: quad.topLeft.y,
      width: quad.topRight.x - quad.topLeft.x,
      height: quad.bottomLeft.y - quad.topLeft.y,
    }, page));
    return {
      id: annotation.id,
      paperId,
      page: annotation.pageNumber,
      type: "underline",
      geometry: { rects },
      quote: annotation.text,
      color: annotation.color || "#7eb6ff",
      ...timestamps,
    };
  }

  if (annotation.type === FapType.FreeText && "rect" in annotation) {
    return {
      id: annotation.id,
      paperId,
      page: annotation.pageNumber,
      type: "text",
      geometry: { rects: [pdfRectToNormalized(annotation.rect, page)] },
      comment: annotation.content,
      color: annotation.color || "#7867c6",
      ...timestamps,
    };
  }

  if (annotation.type === FapType.Ink && "paths" in annotation) {
    const points = (annotation.paths[0] ?? []).map(point => ({ x: point.x / page.width, y: point.y / page.height }));
    return {
      id: annotation.id,
      paperId,
      page: annotation.pageNumber,
      type: "ink",
      geometry: { points },
      color: annotation.inkColor || annotation.color || "#d15d4a",
      ...timestamps,
    };
  }

  if ((annotation.type === FapType.Line || annotation.type === FapType.Arrow) && "start" in annotation && "end" in annotation) {
    return {
      id: annotation.id,
      paperId,
      page: annotation.pageNumber,
      type: "ink",
      geometry: {
        points: [
          { x: annotation.start.x / page.width, y: annotation.start.y / page.height },
          { x: annotation.end.x / page.width, y: annotation.end.y / page.height },
        ],
      },
      color: annotation.lineColor || annotation.color || "#d15d4a",
      ...timestamps,
    };
  }

  return null;
}

export function paperAnnotationsToFreshAirJson(annotations: PaperAnnotation[], pageSizes: Map<number, PageSize>): string {
  return JSON.stringify(annotations.map(annotation => paperToFreshAir(annotation, pageSizes)).filter((item): item is FapAnnotation => item !== null));
}

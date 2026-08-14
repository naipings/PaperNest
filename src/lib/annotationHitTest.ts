import type { Annotation, Rect } from "../types";

export function annotationAnchor(annotation: Annotation): Rect | undefined {
  const rect = annotation.geometry.rects?.[0];
  if (rect) return rect;
  const point = annotation.geometry.points?.[0];
  if (!point) return undefined;
  return { x: point.x, y: point.y, width: 0.02, height: 0.02 };
}

export function toolbarPosition(pageWidth: number, pageHeight: number, rect: Rect) {
  return {
    x: rect.x * pageWidth,
    y: rect.y * pageHeight - 42,
  };
}

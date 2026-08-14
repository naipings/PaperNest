import type { Annotation, AnnotationType, Rect } from "../types";

export function rectsOverlap(a: Rect, b: Rect) {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

export function findOverlappingAnnotation(annotations: Annotation[], page: number, type: AnnotationType, rects: Rect[]) {
  return annotations.find(item =>
    item.page === page
    && item.type === type
    && item.geometry.rects?.some(existing => rects.some(rect => rectsOverlap(existing, rect)))
  );
}

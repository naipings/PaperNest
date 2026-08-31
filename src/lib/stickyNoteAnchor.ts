import type { Annotation, Point } from "../types";

export function stickyNoteAnchor(annotation: Annotation): Point {
  if (annotation.geometry.anchor) return annotation.geometry.anchor;
  const first = annotation.geometry.rects?.[0];
  if (first) return { x: first.x, y: Math.max(0, first.y - 0.02) };
  return { x: 0.5, y: 0.5 };
}

export function isStickyAnnotation(annotation: Annotation) {
  return annotation.type === "sticky" || annotation.type === "text";
}

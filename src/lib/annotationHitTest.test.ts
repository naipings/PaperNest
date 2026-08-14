import { describe, expect, it } from "vitest";
import { annotationAnchor, toolbarPosition } from "./annotationHitTest";
import type { Annotation } from "../types";

describe("annotationHitTest", () => {
  it("uses the first rect as the toolbar anchor", () => {
    const annotation: Annotation = {
      id: "a1",
      paperId: "p1",
      page: 2,
      type: "highlight",
      geometry: { rects: [{ x: 0.1, y: 0.2, width: 0.4, height: 0.05 }] },
      color: "#f2ce67",
      createdAt: "2026-01-01",
      updatedAt: "2026-01-01",
    };
    expect(annotationAnchor(annotation)).toEqual(annotation.geometry.rects?.[0]);
    expect(toolbarPosition(800, 1000, annotationAnchor(annotation)!)).toEqual({ x: 80, y: 158 });
  });
});

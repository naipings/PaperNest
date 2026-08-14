import { describe, expect, it } from "vitest";
import { findOverlappingAnnotation, rectsOverlap } from "./annotationHit";
import type { Annotation } from "../types";

describe("annotationHit", () => {
  it("treats overlapping highlight rects as already highlighted", () => {
    expect(rectsOverlap(
      { x: 0.1, y: 0.2, width: 0.4, height: 0.03 },
      { x: 0.3, y: 0.21, width: 0.3, height: 0.03 },
    )).toBe(true);
    expect(rectsOverlap(
      { x: 0.1, y: 0.2, width: 0.2, height: 0.03 },
      { x: 0.5, y: 0.2, width: 0.2, height: 0.03 },
    )).toBe(false);

    const highlight: Annotation = {
      id: "h1",
      paperId: "p",
      page: 2,
      type: "highlight",
      geometry: { rects: [{ x: 0.12, y: 0.28, width: 0.64, height: 0.025 }] },
      color: "#f2ce67",
      createdAt: "",
      updatedAt: "",
    };
    expect(findOverlappingAnnotation([highlight], 2, "highlight", [{ x: 0.2, y: 0.28, width: 0.1, height: 0.02 }])?.id).toBe("h1");
    expect(findOverlappingAnnotation([highlight], 2, "highlight", [{ x: 0.8, y: 0.5, width: 0.1, height: 0.02 }])).toBeUndefined();
    expect(findOverlappingAnnotation([highlight], 2, "underline", [{ x: 0.2, y: 0.28, width: 0.1, height: 0.02 }])).toBeUndefined();
  });
});

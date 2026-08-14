import { describe, expect, it } from "vitest";
import { freshAirToPaper, paperToFreshAir, rectToQuad } from "./freshAirBridge";
import type { Annotation } from "../types";
import { AnnotationType as FapType } from "fresh-air-pdf";

const page = { width: 600, height: 800 };
const pageSizes = new Map([[1, page]]);

describe("freshAirBridge", () => {
  it("round-trips underline annotations through PDF page coordinates", () => {
    const paper: Annotation = {
      id: "a1",
      paperId: "p1",
      page: 1,
      type: "underline",
      geometry: { rects: [{ x: 0.1, y: 0.2, width: 0.4, height: 0.05 }] },
      quote: "sample",
      color: "#7eb6ff",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
    const fresh = paperToFreshAir(paper, pageSizes)!;
    expect(fresh.type).toBe(FapType.Underline);
    const restored = freshAirToPaper(fresh, "p1", pageSizes)!;
    expect(restored.type).toBe("underline");
    expect(restored.geometry.rects?.[0].x).toBeCloseTo(0.1);
    expect(restored.quote).toBe("sample");
  });

  it("builds quads from normalized rects", () => {
    const quad = rectToQuad({ x: 0.1, y: 0.2, width: 0.3, height: 0.04 }, page);
    expect(quad.topLeft).toEqual({ x: 60, y: 160 });
    expect(quad.bottomRight).toEqual({ x: 240, y: 192 });
  });
});

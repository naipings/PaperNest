import { describe, expect, it } from "vitest";
import { AnnotationHistory } from "./annotationHistory";
import type { Annotation } from "../types";

const sample = (id: string): Annotation => ({
  id,
  paperId: "p1",
  page: 1,
  type: "highlight",
  geometry: { rects: [{ x: 0.1, y: 0.2, width: 0.3, height: 0.04 }] },
  color: "#f2ce67",
  createdAt: "2026-01-01",
  updatedAt: "2026-01-01",
});

describe("AnnotationHistory", () => {
  it("tracks undo and redo for add/delete entries", () => {
    const history = new AnnotationHistory();
    history.push({ kind: "add", annotation: sample("a1") });
    expect(history.canUndo()).toBe(true);
    expect(history.popUndo()?.kind).toBe("add");
    expect(history.canRedo()).toBe(true);
    expect(history.popRedo()?.annotation.id).toBe("a1");
  });
});

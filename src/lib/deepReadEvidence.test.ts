import { describe, expect, it } from "vitest";
import { figureRect, linkEvidence, parseEvidence, resolveEvidence } from "./deepReadEvidence";
import type { DeepReadFigure } from "../types";

const box = { x1: 61.2, y1: 79.2, x2: 306, y2: 237.6 };
const figure: DeepReadFigure = { name: "2", figType: "Figure", page: 3, caption: "", image: "figures/paper-Figure2-1.png", regionBoundary: box, captionBoundary: box };
const letter = { width: 612, height: 792 };

describe("linkEvidence", () => {
  it("turns each semicolon segment into an evidence link", () => {
    expect(linkEvidence("结论成立 (Evidence: Page 1, P0005; Page 14, P0132)。"))
      .toBe("结论成立 (Evidence: [Page 1, P0005](evidence:Page%201%2C%20P0005); [Page 14, P0132](evidence:Page%2014%2C%20P0132))。");
  });

  it("unwraps evidence written as inline code", () => {
    expect(linkEvidence("问题 `(Evidence: Sec. 2, P0026)`。")).toBe("问题 (Evidence: [Sec. 2, P0026](evidence:Sec.%202%2C%20P0026))。");
  });

  it("leaves other parentheses untouched", () => {
    expect(linkEvidence("见公式 (1) 与 (Evidence) 字样")).toBe("见公式 (1) 与 (Evidence) 字样");
  });
});

describe("parseEvidence", () => {
  it("expands paragraph ranges and reads the page", () => {
    expect(parseEvidence("p. 1–2, P0017–P0019")).toEqual({ page: 1, ids: ["P0017", "P0018", "P0019"], figure: undefined });
  });

  it("reads figure and table references", () => {
    expect(parseEvidence("Fig. 1 caption, p. 3, P0054")).toEqual({ page: 3, ids: ["P0054"], figure: { figType: "Figure", name: "1" } });
    expect(parseEvidence("Page 6, Table 2")).toEqual({ page: 6, ids: [], figure: { figType: "Table", name: "2" } });
  });
});

describe("figureRect", () => {
  it("normalizes 72 DPI boundaries by the page size in points", () => {
    const rect = figureRect(box, letter);
    expect(rect.x).toBeCloseTo(0.1);
    expect(rect.y).toBeCloseTo(0.1);
    expect(rect.width).toBeCloseTo(0.4);
    expect(rect.height).toBeCloseTo(0.2);
  });
});

describe("resolveEvidence", () => {
  const paragraphs = [
    { id: "P0017", page: 1, rects: [{ x: 0.1, y: 0.8, width: 0.4, height: 0.02 }] },
    { id: "P0018", page: 2, rects: [{ x: 0.1, y: 0.1, width: 0.4, height: 0.02 }] },
  ];

  it("prefers paragraph rects and jumps to the first paragraph page", () => {
    expect(resolveEvidence(parseEvidence("p. 1–2, P0017–P0018"), paragraphs, [figure], letter)).toEqual({
      page: 1,
      marks: [{ page: 1, rects: paragraphs[0].rects }, { page: 2, rects: paragraphs[1].rects }],
    });
  });

  it("falls back to the figure region, then to the page", () => {
    expect(resolveEvidence(parseEvidence("Page 3, Fig. 2"), [], [figure], letter)?.marks[0].page).toBe(3);
    expect(resolveEvidence(parseEvidence("Page 9"), paragraphs, [figure], letter)).toEqual({ page: 9, marks: [] });
    expect(resolveEvidence(parseEvidence("Section 3"), paragraphs, [figure], letter)).toBeUndefined();
  });
});

import { describe, expect, it } from "vitest";
import { mergeSelectionRects } from "./mergeSelectionRects";

describe("mergeSelectionRects", () => {
  it("merges fragments on the same line", () => {
    const merged = mergeSelectionRects([
      { x: 0.1, y: 0.2, width: 0.15, height: 0.02 },
      { x: 0.26, y: 0.2, width: 0.2, height: 0.02 },
      { x: 0.1, y: 0.24, width: 0.3, height: 0.02 },
    ]);
    expect(merged).toHaveLength(2);
    expect(merged[0].width).toBeCloseTo(0.36, 2);
    expect(merged[1].width).toBeCloseTo(0.3, 2);
  });

  it("drops zero-width rects", () => {
    expect(mergeSelectionRects([{ x: 0.1, y: 0.2, width: 0, height: 0.02 }])).toEqual([]);
  });
});

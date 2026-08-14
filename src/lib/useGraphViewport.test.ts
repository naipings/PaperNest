import { describe, expect, it } from "vitest";
import { graphViewBox } from "./useGraphViewport";

describe("knowledge graph viewport", () => {
  it("keeps the view centered while applying zoom", () => {
    expect(graphViewBox({ centerX: 500, centerY: 325, zoom: 1 }, { width: 1000, height: 650 })).toBe("0 0 1000 650");
    expect(graphViewBox({ centerX: 500, centerY: 325, zoom: 2 }, { width: 1000, height: 650 })).toBe("250 162.5 500 325");
  });
});


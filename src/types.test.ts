import { describe, expect, it } from "vitest";
import type { Rect } from "./types";

function toPdfRect(rect: Rect, width: number, height: number) { return { x: rect.x * width, y: height - (rect.y + rect.height) * height, width: rect.width * width, height: rect.height * height }; }
describe("normalized PDF geometry", () => {
  it("survives viewport scaling", () => { const rect = { x: .1, y: .2, width: .3, height: .04 }; expect(toPdfRect(rect, 600, 800)).toEqual({ x: 60, y: 608, width: 180, height: 32 }); expect(toPdfRect(rect, 1200, 1600)).toEqual({ x: 120, y: 1216, width: 360, height: 64 }); });
});

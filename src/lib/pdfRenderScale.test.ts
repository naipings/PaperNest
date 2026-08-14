import { describe, expect, it } from "vitest";
import { pdfRenderScale } from "./pdfRenderScale";

describe("pdfRenderScale", () => {
  it("keeps continuous PDF pages sharp on ordinary Windows displays", () => {
    expect(pdfRenderScale(1)).toBe(2);
    expect(pdfRenderScale(1.5)).toBe(2);
    expect(pdfRenderScale(2.5)).toBe(2.5);
  });
});

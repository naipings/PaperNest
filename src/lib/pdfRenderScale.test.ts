import { describe, expect, it } from "vitest";
import { PDF_TO_CSS_UNITS, fitPdfScale, pageCssSize, pdfRenderScale } from "./pdfRenderScale";

describe("pdfRenderScale", () => {
  it("keeps continuous PDF pages sharp on ordinary Windows displays", () => {
    expect(pdfRenderScale(1)).toBe(2);
    expect(pdfRenderScale(1.5)).toBe(2);
    expect(pdfRenderScale(2.5)).toBe(2.5);
  });

  it("accounts for PDF.js CSS unit conversion so fit-width matches the canvas", () => {
    expect(PDF_TO_CSS_UNITS).toBeCloseTo(96 / 72);
    expect(fitPdfScale(800, 612)).toBeCloseTo(800 / 612 / (96 / 72));
    expect(pageCssSize(612, 792, 1).height).toBeCloseTo(792 * (96 / 72));
  });
});

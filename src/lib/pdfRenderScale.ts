/** PDF.js standalone PDFPageView multiplies user scale by 96/72. */
export const PDF_TO_CSS_UNITS = 96 / 72;

export function pdfRenderScale(devicePixelRatio: number): number {
  return Math.max(2, Number.isFinite(devicePixelRatio) ? devicePixelRatio : 1);
}

export function fitPdfScale(availablePx: number, pageSizePx: number) {
  return Math.max(0.55, Math.min(availablePx / pageSizePx / PDF_TO_CSS_UNITS, 2.5));
}

export function pageCssSize(pageWidth: number, pageHeight: number, scale: number) {
  return {
    width: pageWidth * scale * PDF_TO_CSS_UNITS,
    height: pageHeight * scale * PDF_TO_CSS_UNITS,
  };
}

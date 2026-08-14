export function pdfRenderScale(devicePixelRatio: number): number {
  return Math.max(2, Number.isFinite(devicePixelRatio) ? devicePixelRatio : 1);
}

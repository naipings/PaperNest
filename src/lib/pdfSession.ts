import { GlobalWorkerOptions, getDocument, type PDFDocumentProxy } from "pdfjs-dist";

GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();

/** Serialize all PDF.js opens. Consecutive getDocument after destroy races the shared worker (mozilla/pdf.js#16777). */
let pdfChain: Promise<unknown> = Promise.resolve();

export function enqueuePdfWork<T>(work: () => Promise<T>): Promise<T> {
  const run = pdfChain.then(work, work);
  pdfChain = run.then(() => undefined, () => undefined);
  return run;
}

/** Open one document, run work, always await loadingTask.destroy before the next open. */
export function withPdfDocument<T>(bytes: Uint8Array, work: (document: PDFDocumentProxy) => Promise<T>): Promise<T> {
  return enqueuePdfWork(async () => {
    const task = getDocument({ data: bytes.slice() });
    const document = await task.promise;
    try {
      return await work(document);
    } finally {
      await task.destroy();
    }
  });
}

import { useEffect, useRef } from "react";
import { FAPDFViewer, type AnnotationChangedEvent, type ViewerAPI } from "fresh-air-pdf";
import "fresh-air-pdf/style.css";
import type { Annotation } from "../types";
import { paperAnnotationsToFreshAirJson, type PageSize } from "../lib/freshAirBridge";

const freshAirWorker = `${import.meta.env.BASE_URL}fresh-air-worker.mjs`;

export function FreshAirPdfPane({ bytes, initialPage, annotations, pageSizes, ready, syncLock, onReady, onPageChange, onAnnotationChanged }: {
  bytes: Uint8Array;
  initialPage: number;
  annotations: Annotation[];
  pageSizes: Map<number, PageSize>;
  ready: boolean;
  syncLock: React.MutableRefObject<boolean>;
  onReady(): void;
  onPageChange(page: number): void;
  onAnnotationChanged(event: AnnotationChangedEvent): void;
}) {
  const viewerRef = useRef<ViewerAPI>(null);
  const importedKey = useRef("");

  useEffect(() => {
    if (!ready || !pageSizes.size) return;
    const key = `${bytes.byteLength}:${annotations.map(item => `${item.id}:${item.updatedAt}`).join(",")}`;
    if (importedKey.current === key) return;
    importedKey.current = key;
    syncLock.current = true;
    viewerRef.current?.importAnnotations(paperAnnotationsToFreshAirJson(annotations, pageSizes));
    syncLock.current = false;
  }, [annotations, bytes, pageSizes, ready, syncLock]);

  useEffect(() => {
    if (!ready || initialPage <= 1) return;
    viewerRef.current?.goToPage(initialPage);
  }, [ready, initialPage]);

  return <FAPDFViewer
    ref={viewerRef}
    document={bytes}
    config={{
      workerUrl: freshAirWorker,
      enableAnnotations: true,
      readOnly: false,
      showToolbar: true,
      showThumbnails: true,
      showOutline: true,
      showSearch: true,
      enableTextSelection: true,
      initialZoom: 1.15,
      virtualizePages: true,
    }}
    className="fresh-air-viewer"
    onDocumentLoaded={() => {
      onReady();
      if (initialPage > 1) viewerRef.current?.goToPage(initialPage);
    }}
    onAnnotationChanged={onAnnotationChanged}
    onPageChanged={onPageChange}
  />;
}

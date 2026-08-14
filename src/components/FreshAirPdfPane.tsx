import { useCallback, useEffect, useRef } from "react";
import { FAPDFViewer, ToolMode, type AnnotationChangedEvent, type ViewerAPI } from "fresh-air-pdf";
import "fresh-air-pdf/style.css";
import "@fortawesome/fontawesome-free/css/all.min.css";
import type { Annotation } from "../types";
import { paperAnnotationsToFreshAirJson, type PageSize } from "../lib/freshAirBridge";
import { setupFreshAirLocale } from "../lib/freshAirLocale";

function findDocumentArea(root: HTMLElement | null) {
  if (!root) return null;
  let best: HTMLElement | null = null;
  let bestWidth = 0;
  for (const node of root.querySelectorAll<HTMLElement>(".inhouse-viewer div")) {
    if (node.style.overflow !== "auto") continue;
    if (node.clientWidth > bestWidth) {
      best = node;
      bestWidth = node.clientWidth;
    }
  }
  return best;
}

import type { ReaderTool } from "../lib/readerTools";

export function FreshAirPdfPane({ bytes, initialPage, annotations, pageSizes, ready, syncLock, layoutRevision, readerTool = "select", onReady, onViewerReady, onPageChange, onAnnotationChanged }: {
  bytes: Uint8Array;
  initialPage: number;
  annotations: Annotation[];
  pageSizes: Map<number, PageSize>;
  ready: boolean;
  syncLock: React.MutableRefObject<boolean>;
  layoutRevision?: boolean;
  readerTool?: ReaderTool;
  onReady(): void;
  onViewerReady?(api: ViewerAPI): void;
  onPageChange(page: number): void;
  onAnnotationChanged(event: AnnotationChangedEvent): void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<ViewerAPI>(null);
  const importedKey = useRef("");
  const userZoomed = useRef(false);
  const documentKey = useRef("");

  const fitWidth = useCallback(() => {
    if (userZoomed.current) return;
    const page = pageSizes.get(initialPage) ?? pageSizes.get(1) ?? pageSizes.values().next().value;
    const scroll = findDocumentArea(hostRef.current);
    if (!page || !scroll?.clientWidth) return;
    const scale = Math.max(0.55, Math.min((scroll.clientWidth - 64) / page.width, 2.5));
    viewerRef.current?.setZoom(scale);
  }, [initialPage, pageSizes]);

  useEffect(() => {
    const key = `${bytes.byteLength}`;
    if (documentKey.current === key) return;
    documentKey.current = key;
    userZoomed.current = false;
  }, [bytes]);

  useEffect(() => {
    if (!ready || !pageSizes.size || userZoomed.current) return;
    fitWidth();
    const retry = window.setTimeout(fitWidth, 180);
    return () => window.clearTimeout(retry);
  }, [ready, layoutRevision, pageSizes, fitWidth]);

  useEffect(() => {
    if (!ready || !hostRef.current) return;
    return setupFreshAirLocale(hostRef.current, {
      onZoomInteraction: () => { userZoomed.current = true; },
    });
  }, [ready, bytes]);

  useEffect(() => {
    if (!ready || !viewerRef.current) return;
    onViewerReady?.(viewerRef.current);
  }, [ready, onViewerReady]);

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

  return <div ref={hostRef} className="fresh-air-viewer-host paper-reading-mode" data-tool={readerTool}>
    <FAPDFViewer
      ref={viewerRef}
      document={bytes}
      config={{
        enableAnnotations: true,
        readOnly: false,
        showToolbar: true,
        showThumbnails: true,
        showOutline: false,
        showSearch: true,
        enableTextSelection: true,
        initialZoom: 1,
        virtualizePages: true,
        defaultTool: ToolMode.TextSelect,
      }}
      className="fresh-air-viewer"
      onDocumentLoaded={() => {
        onReady();
        fitWidth();
        onViewerReady?.(viewerRef.current!);
        if (initialPage > 1) viewerRef.current?.goToPage(initialPage);
      }}
      onAnnotationChanged={onAnnotationChanged}
      onPageChanged={onPageChange}
    />
  </div>;
}

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { EventBus, PDFPageView } from "pdfjs-dist/web/pdf_viewer.mjs";
import type { Annotation, Rect } from "../types";
import { AnnotationOverlay, type CapturedSelection } from "./PdfReader";

export function ContinuousAnnotatablePdf({ pdf, scale, annotations, captured, onPage, onCapture, onAnnotate, onDeleteAnnotation, onClearSelection }: {
  pdf?: PDFDocumentProxy;
  scale: number;
  annotations: Annotation[];
  captured?: CapturedSelection;
  onPage(page: number): void;
  onCapture(selection: CapturedSelection): void;
  onAnnotate(type: "highlight" | "underline"): void;
  onDeleteAnnotation(id: string): void;
  onClearSelection(): void;
}) {
  if (!pdf) return null;
  return <div className="continuous-pdf">{Array.from({ length: pdf.numPages }, (_, index) => <ContinuousAnnotatablePage key={index + 1} pdf={pdf} page={index + 1} scale={scale} annotations={annotations.filter(annotation => annotation.page === index + 1)} captured={captured?.page === index + 1 ? captured : undefined} onPage={onPage} onCapture={onCapture} onAnnotate={onAnnotate} onDeleteAnnotation={onDeleteAnnotation} onClearSelection={onClearSelection} />)}</div>;
}

function ContinuousAnnotatablePage({ pdf, page, scale, annotations, captured, onPage, onCapture, onAnnotate, onDeleteAnnotation, onClearSelection }: {
  pdf: PDFDocumentProxy;
  page: number;
  scale: number;
  annotations: Annotation[];
  captured?: CapturedSelection;
  onPage(page: number): void;
  onCapture(selection: CapturedSelection): void;
  onAnnotate(type: "highlight" | "underline"): void;
  onDeleteAnnotation(id: string): void;
  onClearSelection(): void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const viewerHost = useRef<HTMLDivElement>(null);
  const pageViewRef = useRef<PDFPageView | undefined>(undefined);
  const drawTimer = useRef<number | undefined>(undefined);
  const [visible, setVisible] = useState(page === 1);
  const [pageElement, setPageElement] = useState<HTMLDivElement>();

  useEffect(() => {
    const target = host.current;
    if (!target) return;
    const observer = new IntersectionObserver(entries => entries.forEach(entry => {
      if (entry.isIntersecting) {
        setVisible(true);
        onPage(page);
      }
    }), { rootMargin: "420px 0px" });
    observer.observe(target);
    return () => observer.disconnect();
  }, [page, onPage]);

  useEffect(() => {
    const container = viewerHost.current;
    if (!visible || !container) {
      pageViewRef.current?.destroy();
      pageViewRef.current = undefined;
      setPageElement(undefined);
      container?.replaceChildren();
      return;
    }
    let cancelled = false;
    void (async () => {
      const source = await pdf.getPage(page);
      if (cancelled) return;
      container.replaceChildren();
      const pageView = new PDFPageView({ container, eventBus: new EventBus(), id: page, scale, defaultViewport: source.getViewport({ scale: 1 }), annotationMode: 0, enableDetailCanvas: true });
      pageView.setPdfPage(source);
      if (cancelled) { pageView.destroy(); return; }
      pageViewRef.current = pageView;
      setPageElement(pageView.div);
      await pageView.draw();
    })();
    return () => {
      cancelled = true;
      if (drawTimer.current !== undefined) window.clearTimeout(drawTimer.current);
      pageViewRef.current?.destroy();
      pageViewRef.current = undefined;
      setPageElement(undefined);
      container.replaceChildren();
    };
  }, [pdf, page, visible]);

  useEffect(() => {
    const pageView = pageViewRef.current;
    if (!pageView || !visible) return;
    pageView.update({ scale, drawingDelay: 300 });
    if (drawTimer.current !== undefined) window.clearTimeout(drawTimer.current);
    drawTimer.current = window.setTimeout(() => {
      drawTimer.current = undefined;
      void pageView.draw().catch(() => undefined);
    }, 350);
    return () => { if (drawTimer.current !== undefined) window.clearTimeout(drawTimer.current); };
  }, [scale, visible, pageElement]);

  useEffect(() => {
    if (!pageElement) return;
    const capture = () => {
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed || !selection.toString().trim()) return;
      const pageRect = pageElement.getBoundingClientRect();
      const clientRects = Array.from(selection.getRangeAt(0).getClientRects());
      const rects: Rect[] = clientRects.map(rect => ({ x: (rect.left - pageRect.left) / pageRect.width, y: (rect.top - pageRect.top) / pageRect.height, width: rect.width / pageRect.width, height: rect.height / pageRect.height })).filter(rect => rect.width > 0 && rect.height > 0);
      if (!rects.length) return;
      const first = clientRects[0];
      onCapture({ text: selection.toString().trim(), rects, x: first.left - pageRect.left, y: first.top - pageRect.top - 42, page });
    };
    pageElement.addEventListener("mouseup", capture);
    return () => pageElement.removeEventListener("mouseup", capture);
  }, [pageElement, onCapture, page]);

  const overlay = pageElement && createPortal(<div className="annotation-layer continuous-annotation-layer">{annotations.map(annotation => <AnnotationOverlay key={annotation.id} annotation={annotation} onDelete={() => onDeleteAnnotation(annotation.id)} />)}{captured && <div className="selection-toolbar" onMouseDown={event => event.preventDefault()} style={{ left: captured.x, top: Math.max(4, captured.y) }}><button onClick={() => void onAnnotate("highlight")}>高亮</button><button onClick={() => void onAnnotate("underline")}>下划线</button><button>收为术语</button><button>加入写作库</button><button onClick={onClearSelection}>×</button></div>}</div>, pageElement);
  return <article ref={host} className="continuous-page-host"><div ref={viewerHost} className="pdfViewer continuous-page-viewer" />{overlay}<small>{page}</small></article>;
}

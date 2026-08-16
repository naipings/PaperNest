import { useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { EventBus, PDFPageView } from "pdfjs-dist/web/pdf_viewer.mjs";
import "pdfjs-dist/web/pdf_viewer.css";
import type { Annotation, Point, Rect } from "../types";
import type { ReaderTool } from "../lib/readerTools";
import { pageCssSize } from "../lib/pdfRenderScale";
import { SelectionToolbar } from "./SelectionToolbar";

export type CapturedSelection = { text: string; rects: Rect[]; x: number; y: number; page: number; highlightId?: string; underlineId?: string; noteId?: string };

const silentL10n = {
  translate: async () => undefined,
  pause() {},
  resume() {},
  getLanguage: async () => "en-US",
  getDirection: async () => "ltr",
};

export function pageNumberAtStageTop(stage: HTMLElement) {
  const line = stage.getBoundingClientRect().top + 80;
  const hosts = stage.querySelectorAll<HTMLElement>("[data-page]");
  for (const host of hosts) {
    const rect = host.getBoundingClientRect();
    if (rect.bottom > line) return Number(host.dataset.page);
  }
  return 1;
}

export function AnnotationOverlay({ annotation, selected, onSelect }: {
  annotation: Annotation;
  selected?: boolean;
  onSelect?(event: React.MouseEvent, annotation: Annotation): void;
}) {
  return <>
    {annotation.geometry.rects?.map((rect, index) => (
      <div
        key={index}
        title={annotation.quote || annotation.type}
        className={`annotation-shape ${annotation.type}${selected ? " selected" : ""}`}
        style={{
          left: `${rect.x * 100}%`,
          top: `${rect.y * 100}%`,
          width: `${rect.width * 100}%`,
          height: `${rect.height * 100}%`,
          "--annotation-color": annotation.color,
        } as React.CSSProperties}
        onClick={onSelect ? event => onSelect(event, annotation) : undefined}
      />
    ))}
    {annotation.geometry.points && (
      <svg className="ink-overlay">
        <polyline style={{ stroke: annotation.color }} points={annotation.geometry.points.map(p => `${p.x * 100}%,${p.y * 100}%`).join(" ")} />
      </svg>
    )}
  </>;
}

export function ContinuousAnnotatablePdf({ pdf, scale, pageWidth, pageHeight, tool, annotations, captured, selectedAnnotation, highlightColor, onCapture, onAnnotate, onRemoveAnnotation, onNote, onInkStroke, onSelectAnnotation, onHighlightColor, onTerm, onExcerpt, onClip, onClearSelection }: {
  pdf?: PDFDocumentProxy;
  scale: number;
  pageWidth: number;
  pageHeight: number;
  tool: ReaderTool;
  annotations: Annotation[];
  captured?: CapturedSelection;
  selectedAnnotation?: { id: string; page: number; x: number; y: number };
  highlightColor: string;
  onCapture(selection: CapturedSelection): void;
  onAnnotate(type: "highlight" | "underline"): void;
  onRemoveAnnotation(id: string): void;
  onNote?(selection: CapturedSelection): void;
  onInkStroke?(page: number, points: Point[]): void;
  onSelectAnnotation(id: string | undefined, anchor?: { page: number; x: number; y: number }): void;
  onHighlightColor(color: string): void;
  onTerm(): void;
  onExcerpt(): void;
  onClip?(): void;
  onClearSelection(): void;
}) {
  if (!pdf) return null;
  return <div className="continuous-pdf">
    {Array.from({ length: pdf.numPages }, (_, index) => (
      <ContinuousAnnotatablePage
        key={index + 1}
        pdf={pdf}
        page={index + 1}
        scale={scale}
        pageWidth={pageWidth}
        pageHeight={pageHeight}
        tool={tool}
        annotations={annotations.filter(item => item.page === index + 1)}
        captured={captured?.page === index + 1 ? captured : undefined}
        selectedAnnotation={selectedAnnotation?.page === index + 1 ? selectedAnnotation : undefined}
        highlightColor={highlightColor}
        onCapture={onCapture}
        onAnnotate={onAnnotate}
        onRemoveAnnotation={onRemoveAnnotation}
        onNote={onNote}
        onInkStroke={onInkStroke}
        onSelectAnnotation={onSelectAnnotation}
        onHighlightColor={onHighlightColor}
        onTerm={onTerm}
        onExcerpt={onExcerpt}
        onClip={onClip}
        onClearSelection={onClearSelection}
      />
    ))}
  </div>;
}

function ContinuousAnnotatablePage({ pdf, page, scale, pageWidth, pageHeight, tool, annotations, captured, selectedAnnotation, highlightColor, onCapture, onAnnotate, onRemoveAnnotation, onNote, onInkStroke, onSelectAnnotation, onHighlightColor, onTerm, onExcerpt, onClip, onClearSelection }: {
  pdf: PDFDocumentProxy;
  page: number;
  scale: number;
  pageWidth: number;
  pageHeight: number;
  tool: ReaderTool;
  annotations: Annotation[];
  captured?: CapturedSelection;
  selectedAnnotation?: { id: string; page: number; x: number; y: number };
  highlightColor: string;
  onCapture(selection: CapturedSelection): void;
  onAnnotate(type: "highlight" | "underline"): void;
  onRemoveAnnotation(id: string): void;
  onNote?(selection: CapturedSelection): void;
  onInkStroke?(page: number, points: Point[]): void;
  onSelectAnnotation(id: string | undefined, anchor?: { page: number; x: number; y: number }): void;
  onHighlightColor(color: string): void;
  onTerm(): void;
  onExcerpt(): void;
  onClip?(): void;
  onClearSelection(): void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const viewerHost = useRef<HTMLDivElement>(null);
  const pageViewRef = useRef<PDFPageView | undefined>(undefined);
  const scaleRef = useRef(scale);
  const inkPoints = useRef<Point[]>([]);
  const [draftPoints, setDraftPoints] = useState<Point[]>([]);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; text: string }>();
  const css = pageCssSize(pageWidth, pageHeight, scale);
  scaleRef.current = scale;
  const selected = selectedAnnotation && annotations.find(item => item.id === selectedAnnotation.id);

  const copyText = async (text: string) => {
    await navigator.clipboard.writeText(text);
    setContextMenu(undefined);
  };

  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(undefined);
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [contextMenu]);

  useEffect(() => {
    const container = viewerHost.current;
    if (!container) return;
    let cancelled = false;
    void (async () => {
      const source = await pdf.getPage(page);
      if (cancelled) return;
      const pageView = new PDFPageView({
        container,
        eventBus: new EventBus(),
        id: page,
        scale: scaleRef.current,
        defaultViewport: source.getViewport({ scale: 1 }),
        annotationMode: 0,
        enableDetailCanvas: false,
        l10n: silentL10n as never,
      });
      pageView.setPdfPage(source);
      if (cancelled) {
        pageView.destroy();
        return;
      }
      pageViewRef.current = pageView;
      await pageView.draw();
    })();
    return () => {
      cancelled = true;
      const view = pageViewRef.current;
      pageViewRef.current = undefined;
      try { view?.destroy(); } catch { /* PDF.js teardown after React unmount */ }
    };
  }, [pdf, page]);

  useEffect(() => {
    const pageView = pageViewRef.current;
    if (!pageView) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      if (cancelled) return;
      pageView.update({ scale });
      void pageView.draw();
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [scale]);

  useEffect(() => {
    const target = host.current;
    if (!target) return;
    const capture = () => {
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed || !selection.toString().trim()) return;
      if (!selection.anchorNode || !target.contains(selection.anchorNode)) return;
      const pageRect = target.getBoundingClientRect();
      const clientRects = Array.from(selection.getRangeAt(0).getClientRects());
      const rects: Rect[] = clientRects
        .map(rect => ({
          x: (rect.left - pageRect.left) / pageRect.width,
          y: (rect.top - pageRect.top) / pageRect.height,
          width: rect.width / pageRect.width,
          height: rect.height / pageRect.height,
        }))
        .filter(rect => rect.width > 0 && rect.height > 0);
      if (!rects.length) return;
      const first = clientRects[0];
      onCapture({
        text: selection.toString().trim(),
        rects,
        x: first.left - pageRect.left,
        y: first.top - pageRect.top - 42,
        page,
      });
    };
    target.addEventListener("mouseup", capture);
    return () => target.removeEventListener("mouseup", capture);
  }, [onCapture, page]);

  const norm = (event: React.PointerEvent): Point => {
    const rect = host.current!.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height)),
    };
  };

  return <article
    ref={host}
    className="continuous-page-host"
    data-page={page}
    style={{ width: css.width, height: css.height }}
    onContextMenu={event => {
      const text = (captured?.text || window.getSelection()?.toString() || "").trim();
      if (!text) return;
      event.preventDefault();
      setContextMenu({ x: event.clientX, y: event.clientY, text });
    }}
  >
    <div ref={viewerHost} className="pdfViewer continuous-page-viewer" />
    <div
      className={`annotation-layer continuous-annotation-layer tool-${tool}`}
      onPointerDown={tool === "ink" ? event => {
        event.currentTarget.setPointerCapture(event.pointerId);
        const point = norm(event);
        inkPoints.current = [point];
        setDraftPoints([point]);
      } : undefined}
      onPointerMove={tool === "ink" ? event => {
        if (!inkPoints.current.length) return;
        const point = norm(event);
        inkPoints.current.push(point);
        setDraftPoints([...inkPoints.current]);
      } : undefined}
      onPointerUp={tool === "ink" ? () => {
        if (inkPoints.current.length < 2) {
          inkPoints.current = [];
          setDraftPoints([]);
          return;
        }
        onInkStroke?.(page, inkPoints.current);
        inkPoints.current = [];
        setDraftPoints([]);
      } : undefined}
    >
      {annotations.map(annotation => (
        <AnnotationOverlay
          key={annotation.id}
          annotation={annotation}
          selected={selectedAnnotation?.id === annotation.id}
          onSelect={(event, item) => {
            if (tool === "ink") return;
            event.stopPropagation();
            const pageRect = host.current!.getBoundingClientRect();
            onSelectAnnotation(item.id, { page, x: event.clientX - pageRect.left, y: event.clientY - pageRect.top - 42 });
          }}
        />
      ))}
      {tool === "ink" && draftPoints.length > 1 && (
        <svg className="ink-overlay"><polyline points={draftPoints.map(p => `${p.x * 100}%,${p.y * 100}%`).join(" ")} /></svg>
      )}
      {captured && (
        <SelectionToolbar
          mode="text"
          x={captured.x}
          y={captured.y}
          highlightAction={captured.highlightId ? "remove" : "add"}
          underlineAction={captured.underlineId ? "remove" : "add"}
          noteAction={captured.noteId ? "remove" : "add"}
          color={highlightColor}
          onColor={onHighlightColor}
          onHighlight={() => captured.highlightId ? onRemoveAnnotation(captured.highlightId) : onAnnotate("highlight")}
          onUnderline={() => captured.underlineId ? onRemoveAnnotation(captured.underlineId) : onAnnotate("underline")}
          onNote={captured.noteId ? () => onRemoveAnnotation(captured.noteId!) : onNote ? () => onNote(captured) : undefined}
          onCopy={() => void copyText(captured.text)}
          onTerm={onTerm}
          onExcerpt={onExcerpt}
          onClip={onClip}
          onClose={onClearSelection}
        />
      )}
      {selected && selectedAnnotation && !captured && (
        <SelectionToolbar
          mode="annotation"
          x={selectedAnnotation.x}
          y={selectedAnnotation.y}
          highlightAction={selected.type === "highlight" ? "remove" : undefined}
          underlineAction={selected.type === "underline" ? "remove" : undefined}
          noteAction={selected.type === "text" ? "remove" : undefined}
          onHighlight={() => onRemoveAnnotation(selected.id)}
          onUnderline={() => onRemoveAnnotation(selected.id)}
          onNote={() => onRemoveAnnotation(selected.id)}
          onDelete={selected.type === "ink" ? () => onRemoveAnnotation(selected.id) : undefined}
          onClose={() => onSelectAnnotation(undefined)}
        />
      )}
    </div>
    {contextMenu && (
      <div
        className="pdf-context-menu"
        style={{ left: contextMenu.x, top: contextMenu.y }}
        onPointerDown={event => event.stopPropagation()}
      >
        <button type="button" onClick={() => void copyText(contextMenu.text)}>复制</button>
      </div>
    )}
    <small>{page}</small>
  </article>;
}

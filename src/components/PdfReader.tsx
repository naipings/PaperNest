import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, BookOpen, Download, FileText, Highlighter, MessageSquarePlus, MousePointer2, PanelRightOpen, Pencil, Plus, Redo2, SidebarClose, Trash2, Underline, Undo2, ZoomIn, ZoomOut } from "lucide-react";
import { GlobalWorkerOptions, getDocument, type PDFDocumentProxy } from "pdfjs-dist";
import { PDFDocument, rgb } from "pdf-lib";
import { backend } from "../services/backend";
import { translateEnglishToChineseWithFallback } from "../services/translation";
import { writingPurposeLabels } from "../lib/writingPurposes";
import { useLibrary } from "../state/LibraryContext";
import type { Annotation, Paper, Point, VocabularyEntry, WritingExcerpt } from "../types";
import { now, uuid } from "../types";
import { ContinuousAnnotatablePdf, pageNumberAtStageTop, type CapturedSelection } from "./ContinuousAnnotatablePdf";
import { NOTE_COLORS } from "./StickyNote";
import { AnnotationHistory } from "../lib/annotationHistory";
import type { ReaderTool } from "../lib/readerTools";
import { readerToolLabel } from "../lib/readerTools";
import { findOverlappingAnnotation, findOverlappingNote } from "../lib/annotationHit";
import { fitPdfScale } from "../lib/pdfRenderScale";
import { PurposePickerDialog } from "./PurposePickerDialog";
import { StudyClipPanel } from "./StudyClipPanel";
import "./PdfReader.css";

GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
type SideTab = "overview" | "annotations" | "vocabulary" | "framework" | "clip";
type ZoomPreset = "fit-width" | "fit-page" | "custom";

const ZOOM_STEPS = [50, 75, 100, 125, 150, 200];

export type PdfReaderHandle = { isDirty(): boolean; discard(): Promise<void> };

export const PdfReader = forwardRef<PdfReaderHandle, { paper: Paper; onBack(): void; embedded?: boolean }>(function PdfReader({ paper, onBack, embedded = false }, ref) {
  const { data, savePaper, saveAnnotation, deleteAnnotation, saveVocabulary, deleteVocabulary, saveExcerpt, deleteExcerpt, deleteFigure, addReadingSeconds } = useLibrary();
  const stageRef = useRef<HTMLElement>(null);
  const pageSizeRef = useRef({ width: 612, height: 792 });
  const pendingScale = useRef(1.15);
  const scaleTimer = useRef<number | undefined>(undefined);
  const fitTimer = useRef<number | undefined>(undefined);
  const keepTop = useRef(true);
  const history = useRef(new AnnotationHistory());
  const historyLock = useRef(false);

  const [bytes, setBytes] = useState<Uint8Array>();
  const [pdf, setPdf] = useState<PDFDocumentProxy>();
  const [page, setPage] = useState(1);
  const [scale, setScale] = useState(1);
  const [zoomPreset, setZoomPreset] = useState<ZoomPreset>("fit-width");
  const [tab, setTab] = useState<SideTab>("annotations");
  const [busy, setBusy] = useState(true);
  const [message, setMessage] = useState("正在打开 PDF…");
  const [pageText, setPageText] = useState<Record<number, string>>({});
  const [rightOpen, setRightOpen] = useState(true);
  const [readerTool, setReaderToolState] = useState<ReaderTool>("select");
  const [toolHint, setToolHint] = useState("");
  const [captured, setCaptured] = useState<CapturedSelection>();
  const [selectedAnnotation, setSelectedAnnotation] = useState<{ id: string; page: number; x: number; y: number }>();
  const [editingNoteId, setEditingNoteId] = useState<string>();
  const [highlightColor, setHighlightColor] = useState("#f2ce67");
  const [canUndo, setCanUndo] = useState(false);
  const [purposeAsk, setPurposeAsk] = useState<{ resolve(value: string | null): void }>();
  const [clipSeed, setClipSeed] = useState<{ key: number; text: string }>({ key: 0, text: "" });
  const purposeOptions = useMemo(() => writingPurposeLabels(data?.excerpts ?? []), [data?.excerpts]);
  const llmReady = Boolean(data?.llm.apiKeySaved);
  const [canRedo, setCanRedo] = useState(false);

  const annotations = useMemo(() => data?.annotations.filter(item => item.paperId === paper.id) ?? [], [data, paper.id]);
  const vocab = data?.vocabulary.filter(item => item.paperId === paper.id) ?? [];
  const excerpts = data?.excerpts.filter(item => item.paperId === paper.id) ?? [];
  const figures = data?.figures.filter(item => item.paperId === paper.id) ?? [];
  const snapshotPaperId = useRef(paper.id);
  const snapshot = useRef<{ annotations: Annotation[]; vocab: VocabularyEntry[]; excerpts: WritingExcerpt[] } | undefined>(undefined);
  const dirtyRef = useRef(false);
  if (snapshotPaperId.current !== paper.id) {
    snapshotPaperId.current = paper.id;
    snapshot.current = undefined;
  }
  if (data && !snapshot.current) {
    snapshot.current = { annotations: annotations.map(item => ({ ...item })), vocab: vocab.map(item => ({ ...item })), excerpts: excerpts.map(item => ({ ...item })) };
  }
  const sameIds = (left: { id: string }[], right: { id: string }[]) => left.length === right.length && left.every(item => right.some(other => other.id === item.id));
  dirtyRef.current = Boolean(snapshot.current) && (!sameIds(annotations, snapshot.current!.annotations) || !sameIds(vocab, snapshot.current!.vocab) || !sameIds(excerpts, snapshot.current!.excerpts));
  useImperativeHandle(ref, () => ({
    isDirty: () => dirtyRef.current,
    discard: async () => {
      const origin = snapshot.current;
      if (!origin) return;
      for (const item of annotations) if (!origin.annotations.some(entry => entry.id === item.id)) await deleteAnnotation(item.id);
      for (const item of origin.annotations) if (!annotations.some(entry => entry.id === item.id)) await saveAnnotation(item);
      for (const item of vocab) if (!origin.vocab.some(entry => entry.id === item.id)) await deleteVocabulary(item.id);
      for (const item of origin.vocab) if (!vocab.some(entry => entry.id === item.id)) await saveVocabulary(item);
      for (const item of excerpts) if (!origin.excerpts.some(entry => entry.id === item.id)) await deleteExcerpt(item.id);
      for (const item of origin.excerpts) if (!excerpts.some(entry => entry.id === item.id)) await saveExcerpt(item);
    },
  }), [annotations, deleteAnnotation, deleteExcerpt, deleteVocabulary, excerpts, saveAnnotation, saveExcerpt, saveVocabulary, vocab]);

  const touchHistory = () => {
    setCanUndo(history.current.canUndo());
    setCanRedo(history.current.canRedo());
  };

  const recomputeFitScale = useCallback(() => {
    const stage = stageRef.current;
    if (!stage || zoomPreset === "custom") return;
    const { width, height } = pageSizeRef.current;
    const pad = 50;
    const availW = Math.max(200, stage.clientWidth - pad);
    const availH = Math.max(200, stage.clientHeight - pad);
    setScale(zoomPreset === "fit-page"
      ? Math.min(fitPdfScale(availW, width), fitPdfScale(availH, height))
      : fitPdfScale(availW, width));
  }, [zoomPreset]);

  useLayoutEffect(() => {
    if (!pdf) return;
    recomputeFitScale();
    const stage = stageRef.current;
    if (!stage) return;
    const observer = new ResizeObserver(() => {
      if (fitTimer.current !== undefined) window.clearTimeout(fitTimer.current);
      fitTimer.current = window.setTimeout(() => {
        fitTimer.current = undefined;
        recomputeFitScale();
        if (keepTop.current) stage.scrollTop = 0;
      }, 80);
    });
    observer.observe(stage);
    return () => {
      observer.disconnect();
      if (fitTimer.current !== undefined) window.clearTimeout(fitTimer.current);
    };
  }, [recomputeFitScale, pdf]);

  useLayoutEffect(() => {
    if (keepTop.current && stageRef.current) stageRef.current.scrollTop = 0;
  }, [pdf, scale]);

  useEffect(() => {
    pendingScale.current = scale;
  }, [scale]);

  useEffect(() => () => {
    if (scaleTimer.current !== undefined) window.clearTimeout(scaleTimer.current);
  }, []);

  const bumpScale = (delta: number) => {
    pendingScale.current = Math.max(0.55, Math.min(2.5, pendingScale.current + delta));
    if (scaleTimer.current !== undefined) window.clearTimeout(scaleTimer.current);
    scaleTimer.current = window.setTimeout(() => {
      scaleTimer.current = undefined;
      setZoomPreset("custom");
      setScale(pendingScale.current);
    }, 50);
  };

  useEffect(() => {
    let active = true;
    let loaded: PDFDocumentProxy | undefined;
    void (async () => {
      try {
        if (!paper.pdfPath) throw new Error("这篇论文还没有关联 PDF");
        const file = await backend.readPdf(paper.pdfPath);
        const document = await getDocument({ data: file.slice() }).promise;
        if (!active) {
          void document.destroy();
          return;
        }
        loaded = document;
        setBytes(file);
        setPdf(document);
        const firstPage = await document.getPage(1);
        const viewport = firstPage.getViewport({ scale: 1 });
        pageSizeRef.current = { width: viewport.width, height: viewport.height };
        setBusy(false);
        setMessage("");
        setPage(1);
        setZoomPreset("fit-width");
        keepTop.current = true;
      } catch (error) {
        if (active) {
          setBusy(false);
          setMessage(error instanceof Error ? error.message : String(error));
        }
      }
    })();
    return () => {
      active = false;
      try { void loaded?.destroy(); } catch { /* worker already torn down */ }
    };
  }, [paper.id, paper.pdfPath]);

  useEffect(() => {
    if (!pdf) return;
    let active = true;
    const timer = window.setTimeout(() => {
      void (async () => {
        const texts: Record<number, string> = {};
        const indexPages: { page: number; text: string }[] = [];
        for (let number = 1; number <= pdf.numPages; number++) {
          if (!active) return;
          const pdfPage = await pdf.getPage(number);
          const content = await pdfPage.getTextContent();
          const text = content.items.map(item => "str" in item ? item.str : "").join(" ");
          texts[number] = text;
          indexPages.push({ page: number, text });
        }
        if (!active) return;
        const sourceHasText = indexPages.some(item => item.text.trim());
        if (sourceHasText) {
          setPageText(texts);
          void backend.indexPdf(paper.id, indexPages);
        } else {
          const stored = await backend.indexedPdfPages(paper.id);
          if (!active) return;
          setPageText(Object.fromEntries(stored.map(item => [item.page, item.text])));
        }
        if (paper.pageCount !== pdf.numPages || paper.hasTextLayer !== sourceHasText) {
          void savePaper({ ...paper, pageCount: pdf.numPages, hasTextLayer: sourceHasText, updatedAt: now() });
        }
      })();
    }, 1200);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [pdf, paper.id]);

  useEffect(() => {
    if (!pdf) return;
    const timer = window.setTimeout(() => {
      void savePaper({ ...paper, readingPage: page, updatedAt: now() });
    }, 800);
    return () => window.clearTimeout(timer);
  }, [pdf, page]);

  useEffect(() => {
    let active = document.visibilityState === "visible";
    let last = Date.now();
    const flush = () => {
      const elapsed = Math.floor((Date.now() - last) / 1000);
      last = Date.now();
      if (elapsed <= 0 || !active) return;
      const local = new Date();
      const day = `${local.getFullYear()}-${String(local.getMonth() + 1).padStart(2, "0")}-${String(local.getDate()).padStart(2, "0")}`;
      void addReadingSeconds(paper.id, day, elapsed);
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        flush();
        active = false;
      } else {
        active = true;
        last = Date.now();
      }
    };
    const timer = window.setInterval(flush, 30_000);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      flush();
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [paper.id, addReadingSeconds]);

  useEffect(() => {
    const stage = stageRef.current;
    const zoomWithCtrl = (event: WheelEvent) => {
      if (!event.ctrlKey) return;
      event.preventDefault();
      event.stopPropagation();
      bumpScale(event.deltaY < 0 ? 0.08 : -0.08);
    };
    const onScroll = () => {
      if (!stage) return;
      if (keepTop.current && stage.scrollTop <= 1) {
        setPage(1);
        return;
      }
      keepTop.current = false;
      setPage(pageNumberAtStageTop(stage));
    };
    stage?.addEventListener("wheel", zoomWithCtrl, { passive: false });
    stage?.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      stage?.removeEventListener("wheel", zoomWithCtrl);
      stage?.removeEventListener("scroll", onScroll);
    };
  }, [pdf]);

  const setReaderTool = useCallback((tool: ReaderTool) => {
    setReaderToolState(tool);
    if (tool === "note") setToolHint("已切换到「批注」模式：单击页面放置一条批注");
    else if (tool !== "select") setToolHint(`已切换到「${readerToolLabel(tool)}」模式：拖选文字即可标注`);
    else setToolHint("");
  }, []);

  const toggleReaderTool = useCallback((tool: ReaderTool) => {
    setReaderTool(tool === readerTool && tool !== "select" ? "select" : tool);
  }, [readerTool, setReaderTool]);

  const clearSelection = () => {
    window.getSelection()?.removeAllRanges();
    setCaptured(undefined);
    setSelectedAnnotation(undefined);
    setEditingNoteId(undefined);
  };

  const trackAdd = async (annotation: Annotation) => {
    await saveAnnotation(annotation);
    if (!historyLock.current) history.current.push({ kind: "add", annotation });
    touchHistory();
  };

  const trackDelete = async (annotation: Annotation) => {
    await deleteAnnotation(annotation.id);
    if (!historyLock.current) history.current.push({ kind: "delete", annotation });
    touchHistory();
    if (selectedAnnotation?.id === annotation.id) setSelectedAnnotation(undefined);
    if (editingNoteId === annotation.id) setEditingNoteId(undefined);
  };

  const addTextAnnotation = async (type: "highlight" | "underline", selection: CapturedSelection) => {
    if (findOverlappingAnnotation(annotations, selection.page, type, selection.rects)) return;
    await trackAdd({
      id: uuid(),
      paperId: paper.id,
      page: selection.page,
      type,
      geometry: { rects: selection.rects },
      quote: selection.text,
      color: type === "underline" ? "#4b8df8" : highlightColor,
      createdAt: now(),
      updatedAt: now(),
    });
    window.getSelection()?.removeAllRanges();
    setCaptured(undefined);
  };

  const addStickyNote = async (pageNumber: number, anchor: Point, selection?: CapturedSelection) => {
    const mergedRects = selection?.rects;
    if (mergedRects?.length && findOverlappingNote(annotations, pageNumber, mergedRects)) return;
    const annotation: Annotation = {
      id: uuid(),
      paperId: paper.id,
      page: pageNumber,
      type: "sticky",
      geometry: {
        anchor,
        rects: mergedRects,
        fontSize: "md",
      },
      quote: selection?.text,
      comment: "",
      color: NOTE_COLORS[2],
      createdAt: now(),
      updatedAt: now(),
    };
    await trackAdd(annotation);
    setEditingNoteId(annotation.id);
    setSelectedAnnotation({ id: annotation.id, page: pageNumber, x: anchor.x, y: anchor.y });
    window.getSelection()?.removeAllRanges();
    setCaptured(undefined);
    if (readerTool === "note") {
      setReaderToolState("select");
      setToolHint("");
    }
  };

  const duplicateStickyNote = async (id: string) => {
    const source = annotations.find(item => item.id === id);
    if (!source) return;
    const anchor = source.geometry.anchor ?? { x: 0.5, y: 0.5 };
    await trackAdd({
      ...source,
      id: uuid(),
      geometry: {
        ...source.geometry,
        anchor: { x: Math.min(0.95, anchor.x + 0.03), y: Math.min(0.95, anchor.y + 0.03) },
      },
      createdAt: now(),
      updatedAt: now(),
    });
  };

  const updateStickyNote = async (id: string, patch: Partial<Pick<Annotation, "comment" | "geometry" | "color">>) => {
    const current = annotations.find(item => item.id === id);
    if (!current) return;
    await saveAnnotation({ ...current, ...patch, geometry: { ...current.geometry, ...patch.geometry }, updatedAt: now() });
  };

  const handleCapture = (selection: CapturedSelection) => {
    const next = {
      ...selection,
      highlightId: findOverlappingAnnotation(annotations, selection.page, "highlight", selection.rects)?.id,
      underlineId: findOverlappingAnnotation(annotations, selection.page, "underline", selection.rects)?.id,
      noteId: findOverlappingNote(annotations, selection.page, selection.rects)?.id,
    };
    setSelectedAnnotation(undefined);
    if (readerTool === "highlight") {
      if (next.highlightId) { setCaptured(next); return; }
      void addTextAnnotation("highlight", next);
      return;
    }
    if (readerTool === "underline") {
      if (next.underlineId) { setCaptured(next); return; }
      void addTextAnnotation("underline", next);
      return;
    }
    if (readerTool === "note") {
      if (next.noteId) { setCaptured(next); return; }
      const anchor = { x: next.rects[0].x, y: Math.max(0, next.rects[0].y - 0.02) };
      void addStickyNote(next.page, anchor, next);
      return;
    }
    if (readerTool !== "select") return;
    setCaptured(next);
  };

  const removeAnnotation = async (id: string) => {
    const target = annotations.find(item => item.id === id);
    if (!target) return;
    await trackDelete(target);
    setCaptured(undefined);
    setSelectedAnnotation(undefined);
    window.getSelection()?.removeAllRanges();
  };

  const annotateCaptured = (type: "highlight" | "underline") => {
    if (!captured) return;
    void addTextAnnotation(type, captured);
  };

  const handleInkStroke = async (pageNumber: number, points: Point[]) => {
    await trackAdd({
      id: uuid(),
      paperId: paper.id,
      page: pageNumber,
      type: "ink",
      geometry: { points },
      color: "#d15d4a",
      createdAt: now(),
      updatedAt: now(),
    });
  };

  const undoAnnotation = async () => {
    const entry = history.current.popUndo();
    if (!entry) return;
    historyLock.current = true;
    try {
      if (entry.kind === "add") await deleteAnnotation(entry.annotation.id);
      else await saveAnnotation(entry.annotation);
    } finally {
      historyLock.current = false;
      touchHistory();
    }
  };

  const redoAnnotation = async () => {
    const entry = history.current.popRedo();
    if (!entry) return;
    historyLock.current = true;
    try {
      if (entry.kind === "add") await saveAnnotation(entry.annotation);
      else await deleteAnnotation(entry.annotation.id);
    } finally {
      historyLock.current = false;
      touchHistory();
    }
  };

  const deleteSelectedAnnotation = async () => {
    if (!selectedAnnotation) return;
    await removeAnnotation(selectedAnnotation.id);
  };

  useEffect(() => {
    const dismissIfIdle = () => {
      const selection = window.getSelection();
      if (selection && !selection.isCollapsed && selection.toString().trim()) return;
      setCaptured(undefined);
    };
    const onPointerDown = (event: PointerEvent) => {
      if (event.button === 2) return;
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (
        target.closest(".selection-toolbar")
        || target.closest(".annotation-shape")
        ||         target.closest(".sticky-note-root")
        || target.closest(".sticky-note-marker")
        || target.closest(".sticky-note-preview")
        || target.closest(".sticky-note-card")
        || target.closest(".study-sidebar")
        || target.closest(".pdf-context-menu")
        || target.closest(".sticky-note-menu")
      ) return;
      window.getSelection()?.removeAllRanges();
      setCaptured(undefined);
      if (!(target instanceof Element) || !target.closest(".sticky-note-root, .sticky-note-card")) {
        setSelectedAnnotation(undefined);
        setEditingNoteId(undefined);
      }
    };
    document.addEventListener("selectionchange", dismissIfIdle);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("selectionchange", dismissIfIdle);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      if (target instanceof HTMLElement && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
      if (event.ctrlKey && !event.shiftKey && event.key.toLowerCase() === "z") {
        event.preventDefault();
        void undoAnnotation();
      }
      if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === "z") {
        event.preventDefault();
        void redoAnnotation();
      }
      if (event.key.toLowerCase() === "v") setReaderTool("select");
      if (event.key.toLowerCase() === "h") toggleReaderTool("highlight");
      if (event.key.toLowerCase() === "u") toggleReaderTool("underline");
      if (event.key.toLowerCase() === "n") toggleReaderTool("note");
      if (event.key.toLowerCase() === "d") setReaderTool("ink");
      if (event.key === "Delete" && selectedAnnotation) {
        event.preventDefault();
        void deleteSelectedAnnotation();
      }
      if (event.key === "Escape") clearSelection();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectedAnnotation, setReaderTool, toggleReaderTool]);

  const askPurpose = () => new Promise<string | null>(resolve => setPurposeAsk({ resolve }));

  const sendSelectionToClip = () => {
    if (!captured?.text.trim()) return;
    setClipSeed({ key: Date.now(), text: captured.text });
    setRightOpen(true);
    setTab("clip");
    setMessage("已送入右侧编辑框，可整理后再翻译或收录");
  };

  const termFromSelection = async () => {
    if (!captured) return;
    const termEn = window.prompt("要收录的英文词汇 / 短语", captured.text);
    if (!termEn) return;
    setMessage("正在翻译术语…");
    const sentenceEn = representativeSentence(pageText[captured.page], termEn, captured.text);
    const [meaningZh, sentenceZh] = await Promise.all([
      translateEnglishToChineseWithFallback(termEn, llmReady, { mode: "term", context: sentenceEn }),
      translateEnglishToChineseWithFallback(sentenceEn, llmReady, { mode: "sentence", context: surroundingContext(pageText[captured.page], sentenceEn) })
    ]);
    await saveVocabulary({
      id: uuid(),
      paperId: paper.id,
      termEn,
      meaningZh: meaningZh || "待补充",
      sentenceEn,
      sentenceZh,
      page: captured.page,
    });
    clearSelection();
    setTab("vocabulary");
    setMessage(meaningZh ? "已收录术语" : "已收录术语（未配置 LLM/翻译服务，释义待补充）");
  };

  const excerptFromSelection = async () => {
    if (!captured) return;
    const purpose = await askPurpose();
    if (!purpose) return;
    setMessage("正在翻译写作句…");
    const translationZh = await translateEnglishToChineseWithFallback(captured.text, llmReady, {
      mode: "sentence",
      context: surroundingContext(pageText[captured.page], captured.text)
    });
    await saveExcerpt({
      id: uuid(),
      paperId: paper.id,
      sourceText: captured.text,
      translationZh,
      purpose,
      page: captured.page,
      tags: [],
      createdAt: now(),
    });
    clearSelection();
    setMessage(translationZh ? "已加入写作库" : "已加入写作库（未配置 LLM/翻译服务，译文待补充）");
  };

  const runOcr = async () => {
    if (!pdf) return;
    setBusy(true);
    setMessage("正在使用本机 Tesseract 识别英文文本…");
    try {
      const pages: { page: number; text: string }[] = [];
      for (let number = 1; number <= pdf.numPages; number++) {
        setMessage(`正在本地 OCR：第 ${number}/${pdf.numPages} 页…`);
        const source = await pdf.getPage(number);
        const viewport = source.getViewport({ scale: 2 });
        const raster = document.createElement("canvas");
        raster.width = Math.ceil(viewport.width);
        raster.height = Math.ceil(viewport.height);
        const context = raster.getContext("2d")!;
        await source.render({ canvasContext: context, viewport, canvas: raster }).promise;
        const blob = await new Promise<Blob | null>(resolve => raster.toBlob(resolve, "image/png"));
        if (!blob) throw new Error("无法生成 OCR 图像");
        pages.push({ page: number, text: await backend.ocrPage(paper.id, number, new Uint8Array(await blob.arrayBuffer())) });
      }
      await backend.indexPdf(paper.id, pages);
      setPageText(Object.fromEntries(pages.map(item => [item.page, item.text])));
      setMessage("OCR 完成，全文检索已建立");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const exportAnnotated = async () => {
    if (!bytes || !pdf) return;
    setMessage("正在生成带批注副本…");
    try {
      const document = await PDFDocument.load(bytes.slice());
      for (const annotation of annotations) {
        const target = document.getPage(annotation.page - 1);
        const pdfPage = await pdf.getPage(annotation.page);
        const { width, height } = pdfPage.getViewport({ scale: 1 });
        const color = hexColor(annotation.color);
        for (const rect of annotation.geometry.rects ?? []) {
          const x = rect.x * width;
          const y = height - (rect.y + rect.height) * height;
          const w = rect.width * width;
          const h = rect.height * height;
          if (annotation.type === "highlight") target.drawRectangle({ x, y, width: w, height: h, color, opacity: 0.32 });
          else if (annotation.type === "underline") target.drawLine({ start: { x, y }, end: { x: x + w, y }, color, thickness: 1.6 });
          else if (annotation.type === "text" || annotation.type === "sticky") {
            const anchor = annotation.geometry.anchor ?? (annotation.geometry.rects?.[0]
              ? { x: annotation.geometry.rects[0].x, y: annotation.geometry.rects[0].y }
              : { x: 0.1, y: 0.1 });
            const ax = anchor.x * width;
            const ay = height - anchor.y * height;
            target.drawCircle({ x: ax + 6, y: ay - 6, size: 4, color, opacity: 0.9 });
            if (annotation.comment) target.drawText(annotation.comment.slice(0, 120), { x: ax + 14, y: ay - 8, size: 8, color, maxWidth: 180 });
          }
        }
        const points = annotation.geometry.points ?? [];
        for (let index = 1; index < points.length; index++) {
          target.drawLine({
            start: { x: points[index - 1].x * width, y: height - points[index - 1].y * height },
            end: { x: points[index].x * width, y: height - points[index].y * height },
            color,
            thickness: 1.8,
          });
        }
      }
      await backend.exportBytes(`${safeName(paper.titleEn)}-annotated.pdf`, await document.save());
      setMessage("已导出，原始 PDF 未修改");
      setTimeout(() => setMessage(""), 2500);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  };

  const zoomSelectValue = zoomPreset === "fit-width" ? "fit-width" : zoomPreset === "fit-page" ? "fit-page" : String(Math.round(scale * 100));
  const onZoomSelect = (value: string) => {
    if (value === "fit-width") { setZoomPreset("fit-width"); return; }
    if (value === "fit-page") { setZoomPreset("fit-page"); return; }
    setZoomPreset("custom");
    setScale(Number(value) / 100);
  };

  if (!data || !bytes) {
    return <main className={"reader-screen" + (embedded ? " embedded" : "")}>
      <header className="reader-toolbar"><button className="reader-back" onClick={onBack}><ArrowLeft size={17} />返回论文库</button><div className="reader-title"><strong>{paper.titleZh || paper.titleEn}</strong></div></header>
      {busy && <div className="reader-message busy">正在打开 PDF…</div>}
    </main>;
  }

  return <main className={"reader-screen pdfjs-reader" + (embedded ? " embedded" : "")}>
    <header className="reader-toolbar">
      <button className="reader-back" onClick={onBack}><ArrowLeft size={17} />返回论文库</button>
      <div className="reader-title"><strong>{paper.titleZh || paper.titleEn}</strong><small>{paper.venue || "本地论文"} · P{page}{pdf ? ` / ${pdf.numPages}` : ""}</small></div>
      <div className="reader-zoom-tools">
        <button title="缩小" onClick={() => bumpScale(-0.08)}><ZoomOut size={16} /></button>
        <select aria-label="缩放级别" title="缩放级别" value={zoomSelectValue} onChange={event => onZoomSelect(event.target.value)}>
          <option value="fit-width">适应宽度</option>
          <option value="fit-page">适应页面</option>
          {ZOOM_STEPS.map(step => <option key={step} value={String(step)}>{step}%</option>)}
        </select>
        <button title="放大" onClick={() => bumpScale(0.08)}><ZoomIn size={16} /></button>
      </div>
      <div className="reader-annotate-tools" data-locale-skip>
        <button className={readerTool === "select" ? "active" : ""} title="选择文本（V）" onClick={() => setReaderTool("select")}><MousePointer2 size={16} /><span>选择</span></button>
        <button className={readerTool === "highlight" ? "active" : ""} title="高亮模式：拖选文字（H）" onClick={() => toggleReaderTool("highlight")}><Highlighter size={16} /><span>高亮</span></button>
        <button className={readerTool === "underline" ? "active" : ""} title="下划线模式：拖选文字（U）" onClick={() => toggleReaderTool("underline")}><Underline size={16} /><span>下划线</span></button>
        <button className={readerTool === "note" ? "active" : ""} title="批注：单击放置或拖选文字（N）" onClick={() => toggleReaderTool("note")}><MessageSquarePlus size={16} /><span>批注</span></button>
        <button className={readerTool === "ink" ? "active" : ""} title="手绘批注（D）" onClick={() => setReaderTool("ink")}><Pencil size={16} /><span>手绘</span></button>
        <button title="撤销（Ctrl+Z）" disabled={!canUndo} onClick={() => void undoAnnotation()}><Undo2 size={16} /></button>
        <button title="重做（Ctrl+Shift+Z）" disabled={!canRedo} onClick={() => void redoAnnotation()}><Redo2 size={16} /></button>
      </div>
      <div className="reader-tools">
        {!paper.hasTextLayer && <button disabled={busy} onClick={() => void runOcr()} title="对扫描版执行本地 OCR"><FileText size={17} /></button>}
        <button onClick={() => void exportAnnotated()} title="导出带批注副本"><Download size={17} /></button>
        <button className={rightOpen ? "active" : ""} onClick={() => setRightOpen(value => !value)} title={rightOpen ? "收起学习侧栏" : "展开学习侧栏"}>
          {rightOpen ? <SidebarClose size={17} /> : <PanelRightOpen size={17} />}
        </button>
      </div>
    </header>
    <div className={`reader-layout pdfjs-layout ${rightOpen ? "" : "right-closed"}`}>
      <section className="pdf-stage" ref={stageRef}>
        <ContinuousAnnotatablePdf
          pdf={pdf}
          scale={scale}
          pageWidth={pageSizeRef.current.width}
          pageHeight={pageSizeRef.current.height}
          tool={readerTool}
          annotations={annotations}
          captured={captured}
          selectedAnnotation={selectedAnnotation}
          editingNoteId={editingNoteId}
          highlightColor={highlightColor}
          onCapture={handleCapture}
          onAnnotate={annotateCaptured}
          onRemoveAnnotation={id => void removeAnnotation(id)}
          onNote={selection => {
            const anchor = { x: selection.rects[0].x, y: Math.max(0, selection.rects[0].y - 0.02) };
            void addStickyNote(selection.page, anchor, selection);
          }}
          onPlaceNote={(pageNumber, anchor) => void addStickyNote(pageNumber, anchor)}
          onNoteMove={(id, anchor) => void updateStickyNote(id, { geometry: { anchor } })}
          onNoteSave={(id, comment, color, fontSize) => {
            const current = annotations.find(item => item.id === id);
            void updateStickyNote(id, {
              comment,
              color,
              geometry: { ...current?.geometry, fontSize },
            });
            setEditingNoteId(undefined);
          }}
          onNoteEdit={id => setEditingNoteId(id)}
          onNoteCopy={async id => {
            const item = annotations.find(entry => entry.id === id);
            if (item?.comment) await navigator.clipboard.writeText(item.comment);
          }}
          onNoteDuplicate={id => void duplicateStickyNote(id)}
          onInkStroke={(pageNumber, points) => void handleInkStroke(pageNumber, points)}
          onSelectAnnotation={(id, anchor) => {
            window.getSelection()?.removeAllRanges();
            setCaptured(undefined);
            setSelectedAnnotation(id && anchor ? { id, page: anchor.page, x: anchor.x, y: anchor.y } : undefined);
          }}
          onHighlightColor={setHighlightColor}
          onTerm={() => void termFromSelection()}
          onExcerpt={() => void excerptFromSelection()}
          onClip={sendSelectionToClip}
          onClearSelection={clearSelection}
        />
        {(message || toolHint) && <div className={`reader-message ${busy ? "busy" : ""}`}>{message || toolHint}</div>}
      </section>
      <aside className={`study-sidebar${rightOpen ? "" : " is-closed"}`} aria-hidden={!rightOpen}>
        <nav>{([["overview", "速览"], ["annotations", `批注 ${annotations.length}`], ["vocabulary", `术语 ${vocab.length}`], ["framework", `框架 ${figures.length}`], ["clip", "编辑"]] as [SideTab, string][]).map(([id, label]) => (
          <button className={tab === id ? "active" : ""} onClick={() => setTab(id)} key={id}>{label}</button>
        ))}</nav>
        <div className="study-body">
          {tab === "overview" && <>
            <section className="summary-card"><label>一句话总结</label><p>{paper.summary || "待补充"}</p></section>
            <h3>中文摘要</h3><p>{paper.abstractZh || "待补充"}</p>
            <h3>English abstract</h3><p>{paper.abstractEn || "Not available."}</p>
          </>}
          {tab === "annotations" && <>
            {annotations.sort((a, b) => a.page - b.page).map(annotation => (
              <article className="annotation-card" key={annotation.id} onClick={() => {
                setPage(annotation.page);
                if (annotation.type === "sticky" || annotation.type === "text") setEditingNoteId(annotation.id);
              }}>
                <span style={{ background: annotation.color }} />
                <div>
                  <strong>{annotation.type === "highlight" ? "高亮" : annotation.type === "underline" ? "下划线" : annotation.type === "sticky" || annotation.type === "text" ? "批注" : "手绘"} · P{annotation.page}</strong>
                  <p>{annotation.comment || annotation.quote || "无附加文字"}</p>
                </div>
                <button className="annotation-delete" title="删除批注" onClick={event => { event.stopPropagation(); if (confirm("删除这条批注？")) void trackDelete(annotation); }}><Trash2 size={14} /></button>
              </article>
            ))}
            {!annotations.length && <p className="muted centered">点顶栏「批注」后单击页面放置批注，或拖选文字后标注；扫描版需先 OCR。</p>}
          </>}
          {tab === "vocabulary" && <>
            {vocab.map(item => (
              <article className="vocab-card" key={item.id}>
                <header>
                  <div className="vocab-card-copy"><strong>{item.termEn}</strong><span>{item.meaningZh}</span></div>
                  <button className="annotation-delete" title="删除术语" onClick={() => { if (confirm("删除这条术语？")) void deleteVocabulary(item.id); }}><Trash2 size={14} /></button>
                </header>
                <p>{item.sentenceZh}</p>
              </article>
            ))}
            <QuickCapture paperId={paper.id} page={page} pageText={pageText[page]} llmReady={llmReady} askPurpose={askPurpose} onTerm={saveVocabulary} onExcerpt={saveExcerpt} />
          </>}
          {tab === "framework" && <>
            {figures.map(item => (
              <article className="figure-card" key={item.id}>
                <header>
                  <div className="vocab-card-copy"><strong>{item.title || "方法框架"}</strong></div>
                  <button className="annotation-delete" title="删除框架图" onClick={() => { if (confirm("删除这张框架图？")) void deleteFigure(item.id); }}><Trash2 size={14} /></button>
                </header>
                <p>{item.explanationZh}</p>
                <small>第 {item.page} 页</small>
              </article>
            ))}
            {!figures.length && <p className="muted centered">可在论文详情上传框架图</p>}
          </>}
          {tab === "clip" && <StudyClipPanel
            paperId={paper.id}
            page={captured?.page ?? page}
            pageText={pageText[captured?.page ?? page]}
            selectionText={captured?.text}
            seedKey={clipSeed.key}
            seedText={clipSeed.text}
            llmReady={llmReady}
            askPurpose={askPurpose}
            onTerm={async entry => { await saveVocabulary(entry); setTab("vocabulary"); }}
            onExcerpt={async entry => { await saveExcerpt(entry); }}
          />}
        </div>
      </aside>
    </div>
    {purposeAsk && <PurposePickerDialog options={purposeOptions} onCancel={() => { purposeAsk.resolve(null); setPurposeAsk(undefined); }} onConfirm={purpose => { purposeAsk.resolve(purpose); setPurposeAsk(undefined); }} />}
  </main>;
});

function QuickCapture({ paperId, page, pageText, llmReady, askPurpose, onTerm, onExcerpt }: {
  paperId: string;
  page: number;
  pageText?: string;
  llmReady: boolean;
  askPurpose(): Promise<string | null>;
  onTerm(v: VocabularyEntry): Promise<void>;
  onExcerpt(v: WritingExcerpt): Promise<void>;
}) {
  const term = async () => {
    const termEn = prompt("英文词汇 / 短语");
    if (!termEn) return;
    const sentenceEn = pageText?.slice(0, 240);
    const [meaningZh, sentenceZh] = await Promise.all([
      translateEnglishToChineseWithFallback(termEn, llmReady, { mode: "term", context: sentenceEn }),
      sentenceEn ? translateEnglishToChineseWithFallback(sentenceEn, llmReady, { mode: "sentence" }) : Promise.resolve(undefined)
    ]);
    await onTerm({ id: uuid(), paperId, termEn, meaningZh: meaningZh || "待补充", sentenceEn, sentenceZh, page });
  };
  const excerpt = async () => {
    const sourceText = prompt("粘贴要收藏的英文佳句");
    if (!sourceText) return;
    const purpose = await askPurpose();
    if (!purpose) return;
    const translationZh = await translateEnglishToChineseWithFallback(sourceText, llmReady, {
      mode: "sentence",
      context: surroundingContext(pageText, sourceText)
    });
    await onExcerpt({ id: uuid(), paperId, sourceText, translationZh, purpose, page, tags: [], createdAt: now() });
  };
  return <div className="quick-capture"><button onClick={() => void term()}><Plus size={14} />收录术语</button><button onClick={() => void excerpt()}><BookOpen size={14} />加入写作库</button></div>;
}

function hexColor(hex: string) {
  const value = hex.replace("#", "");
  return rgb(parseInt(value.slice(0, 2), 16) / 255, parseInt(value.slice(2, 4), 16) / 255, parseInt(value.slice(4, 6), 16) / 255);
}

function safeName(name: string) {
  return name.replace(/[<>:"/\\|?*]+/g, "_").slice(0, 90);
}

function representativeSentence(pageText: string | undefined, phrase: string, fallback: string) {
  if (!pageText) return fallback;
  const at = pageText.toLowerCase().indexOf(phrase.toLowerCase());
  if (at < 0) return fallback;
  const left = Math.max(pageText.lastIndexOf(".", at) + 1, pageText.lastIndexOf("?", at) + 1, pageText.lastIndexOf("!", at) + 1);
  const next = [pageText.indexOf(".", at + phrase.length), pageText.indexOf("?", at + phrase.length), pageText.indexOf("!", at + phrase.length)].filter(value => value >= 0);
  const right = next.length ? Math.min(...next) + 1 : Math.min(pageText.length, left + 360);
  return pageText.slice(left, right).trim() || fallback;
}

/** Nearby paragraph window for disambiguation (Zotero PDF Translate style). */
function surroundingContext(pageText: string | undefined, focus: string, max = 900) {
  if (!pageText?.trim()) return undefined;
  const needle = focus.trim();
  if (!needle) return undefined;
  const at = pageText.toLowerCase().indexOf(needle.toLowerCase());
  if (at < 0) return pageText.slice(0, max).trim() || undefined;
  const half = Math.floor((max - needle.length) / 2);
  const start = Math.max(0, at - half);
  const end = Math.min(pageText.length, at + needle.length + half);
  return pageText.slice(start, end).replace(/\s+/g, " ").trim() || undefined;
}

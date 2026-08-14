import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, BookOpen, ChevronLeft, ChevronRight, ClipboardPaste, Download, FileImage, FileText, Highlighter, MessageSquareText, MousePointer2, PenLine, Plus, Redo2, Search, SidebarClose, Trash2, Underline, Undo2, ZoomIn, ZoomOut } from "lucide-react";
import { GlobalWorkerOptions, TextLayer, getDocument, type PDFDocumentProxy } from "pdfjs-dist";
import { PDFDocument, rgb } from "pdf-lib";
import { backend } from "../services/backend";
import { useLibrary } from "../state/LibraryContext";
import type { Annotation, AnnotationType, Paper, Point, Rect, VocabularyEntry, WritingExcerpt } from "../types";
import "./PdfReader.css";
import { now, uuid } from "../types";
import { toolForCapturedSelection } from "../lib/annotationTools";
import { translateEnglishToChinese } from "../services/translation";
import { ContinuousAnnotatablePdf } from "./ContinuousAnnotatablePdf";
import { SelectionToolbar } from "./SelectionToolbar";
import { AnnotationHistory } from "../lib/annotationHistory";

GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
type Tool = "select" | AnnotationType | "figure";
type SideTab = "overview" | "annotations" | "vocabulary" | "framework";

export type CapturedSelection = { text: string; rects: Rect[]; x: number; y: number; page: number };
export function PdfReader({ paper, onBack, embedded = false }: { paper: Paper; onBack(): void; embedded?: boolean }) {
  const { data, savePaper, saveAnnotation, deleteAnnotation, saveVocabulary, saveExcerpt, saveFigure } = useLibrary();
  const canvasRef = useRef<HTMLCanvasElement>(null); const textLayerRef = useRef<HTMLDivElement>(null); const overlayRef = useRef<HTMLDivElement>(null); const dragStartRef = useRef<Point | undefined>(undefined); const stageRef = useRef<HTMLElement>(null);
  const [pdf, setPdf] = useState<PDFDocumentProxy>(); const [bytes, setBytes] = useState<Uint8Array>(); const [captured, setCaptured] = useState<CapturedSelection>();
  const pendingScale = useRef(1.15);
  const scaleRaf = useRef<number | undefined>(undefined);
  const bumpScale = (delta: number) => {
    pendingScale.current = Math.max(.55, Math.min(2.5, pendingScale.current + delta));
    if (scaleRaf.current !== undefined) return;
    scaleRaf.current = requestAnimationFrame(() => {
      scaleRaf.current = undefined;
      setScale(pendingScale.current);
    });
  };
  const [page, setPage] = useState(paper.readingPage || 1); const [scale, setScale] = useState(1.15); const [tool, setTool] = useState<Tool>("select"); const [tab, setTab] = useState<SideTab>("annotations");
  const [busy, setBusy] = useState(true); const [message, setMessage] = useState("正在打开 PDF…"); const [pageText, setPageText] = useState<Record<number, string>>({}); const [search, setSearch] = useState(""); const [ocrSaved, setOcrSaved] = useState(false);
  const [dragStart, setDragStart] = useState<Point>(); const [draftPoints, setDraftPoints] = useState<Point[]>([]); const [rightOpen, setRightOpen] = useState(true);
  const [selectedAnnotation, setSelectedAnnotation] = useState<{ id: string; page: number; x: number; y: number }>();
  const history = useRef(new AnnotationHistory());
  const historyLock = useRef(false);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const touchHistory = () => {
    setCanUndo(history.current.canUndo());
    setCanRedo(history.current.canRedo());
  };
  const continuous = true; const setContinuous = (_value: (value: boolean) => boolean) => undefined;
  const annotations = useMemo(() => data?.annotations.filter(a => a.paperId === paper.id) ?? [], [data, paper.id]);
  const pageAnnotations = annotations.filter(a => a.page === page); const vocab = data?.vocabulary.filter(v => v.paperId === paper.id) ?? []; const figures = data?.figures.filter(v => v.paperId === paper.id) ?? [];

  useEffect(() => { let active = true; (async () => { try { if (!paper.pdfPath) throw new Error("这篇论文还没有关联 PDF"); const file = await backend.readPdf(paper.pdfPath); const document = await getDocument({ data: file.slice() }).promise; if (!active) return; setBytes(file); setPdf(document); setBusy(false); setMessage("");
      const texts: Record<number, string> = {}; const indexPages: { page: number; text: string }[] = [];
      for (let n = 1; n <= document.numPages; n++) { const p = await document.getPage(n); const content = await p.getTextContent(); const text = content.items.map(item => "str" in item ? item.str : "").join(" "); texts[n] = text; indexPages.push({ page: n, text }); }
      if (active) { const sourceHasText=indexPages.some(item=>item.text.trim()); if(sourceHasText){setPageText(texts);await backend.indexPdf(paper.id,indexPages);}else{const stored=await backend.indexedPdfPages(paper.id);setPageText(Object.fromEntries(stored.map(item=>[item.page,item.text])));setOcrSaved(stored.length>0);} if (paper.pageCount !== document.numPages || paper.hasTextLayer !== sourceHasText) await savePaper({ ...paper, pageCount: document.numPages, hasTextLayer: sourceHasText, updatedAt: now() }); }
    } catch (e) { if (active) { setBusy(false); setMessage(e instanceof Error ? e.message : String(e)); } } })(); return () => { active = false; }; }, [paper.id, paper.pdfPath]);

  useEffect(() => { if (!pdf || continuous || !canvasRef.current || !textLayerRef.current) return; let cancelled = false; let textLayer: TextLayer | undefined; (async () => { const pdfPage = await pdf.getPage(page); const viewport = pdfPage.getViewport({ scale }); const canvas = canvasRef.current!; const context = canvas.getContext("2d")!; canvas.width = viewport.width * devicePixelRatio; canvas.height = viewport.height * devicePixelRatio; canvas.style.width = `${viewport.width}px`; canvas.style.height = `${viewport.height}px`; context.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0); const container=textLayerRef.current!; container.replaceChildren(); container.style.width=`${viewport.width}px`; container.style.height=`${viewport.height}px`; textLayer=new TextLayer({textContentSource:await pdfPage.getTextContent(),container,viewport}); if (!cancelled) { await pdfPage.render({ canvasContext: context, viewport, canvas }).promise; await textLayer.render(); } })(); setCaptured(undefined); void savePaper({ ...paper, readingPage: page, updatedAt: now() }); return () => { cancelled = true; textLayer?.cancel(); }; }, [pdf, page, scale, continuous]);
  useEffect(() => { if (pdf && continuous) void savePaper({ ...paper, readingPage: page, updatedAt: now() }); }, [pdf, continuous, page]);
  useEffect(() => {
    pendingScale.current = scale;
  }, [scale]);
  useEffect(() => {
    const stage = stageRef.current;
    const zoomWithCtrl = (event: WheelEvent) => {
      if (!event.ctrlKey) return;
      event.preventDefault();
      event.stopPropagation();
      bumpScale(event.deltaY < 0 ? .08 : -.08);
    };
    stage?.addEventListener("wheel", zoomWithCtrl, { passive: false });
    return () => stage?.removeEventListener("wheel", zoomWithCtrl);
  }, []);

  const norm = (event: React.PointerEvent): Point => { const rect = overlayRef.current!.getBoundingClientRect(); return { x: Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)), y: Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height)) }; };
  const saveFigureBytes = async (image: Uint8Array, geometry?: Annotation["geometry"]) => { const title=window.prompt("框架图标题", "方法框架图") || "方法框架图"; await saveFigure({id:uuid(),paperId:paper.id,imagePath:"",title,page,geometry,isPrimary:figures.length===0},Array.from(image)); setTab("framework"); setMessage("框架图已保存"); setTimeout(()=>setMessage(""),1800); };
  const captureFramework = async (rect: Rect) => { const source=canvasRef.current; if(!source)return; const crop=document.createElement("canvas"); crop.width=Math.max(1,Math.round(source.width*rect.width)); crop.height=Math.max(1,Math.round(source.height*rect.height)); const context=crop.getContext("2d"); if(!context)return; context.drawImage(source,source.width*rect.x,source.height*rect.y,crop.width,crop.height,0,0,crop.width,crop.height); const blob=await new Promise<Blob|null>(resolve=>crop.toBlob(resolve,"image/png")); if(blob)await saveFigureBytes(new Uint8Array(await blob.arrayBuffer()),{rects:[rect]}); };
  const pasteImage = async (file: Blob) => { await saveFigureBytes(new Uint8Array(await file.arrayBuffer())); };
  useEffect(() => { const onPaste=(event:ClipboardEvent)=>{const target=event.target as HTMLElement|null;if(target?.closest("input, textarea, [contenteditable=true]"))return;const image=Array.from(event.clipboardData?.items??[]).find(item=>item.type.startsWith("image/"));if(!image)return;event.preventDefault();const file=image.getAsFile();if(file)void pasteImage(file);}; window.addEventListener("paste",onPaste);return()=>window.removeEventListener("paste",onPaste); },[paper.id,page,figures.length]);
  const runOcr = async () => { if(!pdf)return; setBusy(true);setMessage("正在使用本机 Tesseract 识别英文文本…");try{const pages:{page:number;text:string}[]=[];for(let number=1;number<=pdf.numPages;number++){setMessage("正在本地 OCR：第 "+number+"/"+pdf.numPages+" 页…");const source=await pdf.getPage(number);const viewport=source.getViewport({scale:2});const raster=document.createElement("canvas");raster.width=Math.ceil(viewport.width);raster.height=Math.ceil(viewport.height);const context=raster.getContext("2d")!;await source.render({canvasContext:context,viewport,canvas:raster}).promise;const blob=await new Promise<Blob|null>(resolve=>raster.toBlob(resolve,"image/png"));if(!blob)throw new Error("无法生成 OCR 图像");pages.push({page:number,text:await backend.ocrPage(paper.id,number,new Uint8Array(await blob.arrayBuffer()))});}await backend.indexPdf(paper.id,pages);setPageText(Object.fromEntries(pages.map(item=>[item.page,item.text])));setOcrSaved(true);setMessage("OCR 完成，全文检索已建立");}catch(error){setMessage(error instanceof Error?error.message:String(error));}finally{setBusy(false);} };
  const pointerDown = (event: React.PointerEvent) => { if (tool === "select") return; event.currentTarget.setPointerCapture(event.pointerId); const p = norm(event); dragStartRef.current = p; setDragStart(p); if (tool === "ink") setDraftPoints([p]); };
  const pointerMove = (event: React.PointerEvent) => { if (tool === "ink" && (dragStartRef.current ?? dragStart)) setDraftPoints(points => [...points, norm(event)]); };
  const pointerUp = async (event: React.PointerEvent) => { const start = dragStartRef.current ?? dragStart; if (!start || tool === "select") return; const end = norm(event); let geometry: Annotation["geometry"];
    if (tool === "ink") geometry = { points: draftPoints.length > 1 ? draftPoints : [start, end] };
    else { const rect: Rect = { x: Math.min(start.x, end.x), y: Math.min(start.y, end.y), width: Math.max(.01, Math.abs(end.x - start.x)), height: Math.max(.01, Math.abs(end.y - start.y)) }; geometry = { rects: [rect] }; }
    if (tool === "figure") { setDragStart(undefined); setDraftPoints([]); const rect = geometry.rects?.[0]; if (!rect || rect.width < .025 || rect.height < .025) { setMessage("请框选更大的图像区域"); return; } await captureFramework(rect); return; }
    const comment = tool === "text" ? window.prompt("输入文本批注") ?? undefined : undefined; if (tool === "text" && !comment) { setDragStart(undefined); return; }
    await trackAdd({ id: uuid(), paperId: paper.id, page, type: tool, geometry, color: tool === "text" ? "#7867c6" : tool === "ink" ? "#d15d4a" : "#f2ce67", comment, createdAt: now(), updatedAt: now() }); dragStartRef.current = undefined; setDragStart(undefined); setDraftPoints([]);
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
  const clearReaderSelection = () => { window.getSelection()?.removeAllRanges(); setCaptured(undefined); setSelectedAnnotation(undefined); };
  const handleCapture = (selection: CapturedSelection) => {
    setSelectedAnnotation(undefined);
    if (tool === "highlight" || tool === "underline") {
      void addTextAnnotation(tool, selection);
      return;
    }
    if (tool !== "select") return;
    setCaptured(selection);
  };
  const addTextAnnotation = async (type: "highlight" | "underline", selection: CapturedSelection) => {
    await trackAdd({ id: uuid(), paperId: paper.id, page: selection.page, type, geometry: { rects: selection.rects }, quote: selection.text, color: type === "underline" ? "#7eb6ff" : "#f2ce67", createdAt: now(), updatedAt: now() });
    window.getSelection()?.removeAllRanges();
    setCaptured(undefined);
  };
  const captureTextSelection = () => {
    if (tool !== "select" && tool !== "highlight" && tool !== "underline") return;
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || !selection.toString().trim() || !overlayRef.current) return;
    const pageRect = overlayRef.current.getBoundingClientRect();
    const clientRects = Array.from(selection.getRangeAt(0).getClientRects());
    const rects = clientRects.map(rect => ({ x: (rect.left - pageRect.left) / pageRect.width, y: (rect.top - pageRect.top) / pageRect.height, width: rect.width / pageRect.width, height: rect.height / pageRect.height })).filter(rect => rect.width > 0 && rect.height > 0);
    if (!rects.length) return;
    const first = clientRects[0];
    handleCapture({ text: selection.toString().trim(), rects, x: first.left - pageRect.left, y: first.top - pageRect.top - 42, page });
  };
  const annotateCaptured = async (type: "highlight" | "underline") => { if (!captured) return; await addTextAnnotation(type, captured); };
  const deleteSelectedAnnotation = async () => {
    const target = annotations.find(item => item.id === selectedAnnotation?.id);
    if (!target) return;
    await trackDelete(target);
  };
  useEffect(() => {
    const applySelectedText = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target.closest<HTMLButtonElement>("button[title]") : null;
      const type = toolForCapturedSelection(target?.title, Boolean(captured));
      if (!type) return;
      event.preventDefault();
      event.stopPropagation();
      void annotateCaptured(type);
    };
    document.addEventListener("click", applySelectedText, true);
    return () => document.removeEventListener("click", applySelectedText, true);
  }, [captured, page, paper.id]);
  const termFromSelection = async () => { if(!captured)return; const termEn=window.prompt("要收录的英文词汇 / 短语",captured.text); if(!termEn)return; const meaningZh=window.prompt("中文释义")||"待补充"; await saveVocabulary({id:uuid(),paperId:paper.id,termEn,meaningZh,sentenceEn:representativeSentence(pageText[page],termEn,captured.text),page}); window.getSelection()?.removeAllRanges(); setCaptured(undefined); setTab("vocabulary"); };
  const translatedTermFromSelection = async () => {
    if (!captured) return;
    try {
      setMessage("Translating selected term...");
      const sentenceEn = representativeSentence(pageText[captured.page], captured.text, captured.text);
      const [meaningZh, sentenceZh] = await Promise.all([translateEnglishToChinese(captured.text), translateEnglishToChinese(sentenceEn)]);
      await saveVocabulary({ id: uuid(), paperId: paper.id, termEn: captured.text, meaningZh, sentenceEn, sentenceZh, page: captured.page });
      setTab("vocabulary");
      setMessage("Term saved with translation.");
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    finally { window.getSelection()?.removeAllRanges(); setCaptured(undefined); }
  };
  const translatedExcerptFromSelection = async () => {
    if (!captured) return;
    try {
      setMessage("Translating selected sentence...");
      const translationZh = await translateEnglishToChinese(captured.text);
      await saveExcerpt({ id: uuid(), paperId: paper.id, sourceText: captured.text, translationZh, purpose: "Unclassified", page: captured.page, tags: [], createdAt: now() });
      setMessage("Writing excerpt saved with translation.");
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    finally { window.getSelection()?.removeAllRanges(); setCaptured(undefined); }
  };
  useEffect(() => {
    const translateFromToolbar = (event: MouseEvent) => {
      const button = event.target instanceof Element ? event.target.closest<HTMLButtonElement>(".selection-toolbar button") : null;
      if (!button) return;
      const index = Array.from(button.parentElement?.querySelectorAll("button") ?? []).indexOf(button);
      if (index !== 2 && index !== 3) return;
      event.preventDefault(); event.stopPropagation();
      if (index === 2) void translatedTermFromSelection(); else void translatedExcerptFromSelection();
    };
    document.addEventListener("click", translateFromToolbar, true);
    return () => document.removeEventListener("click", translateFromToolbar, true);
  }, [captured, page, paper.id, pageText]);
  const excerptFromSelection = async () => { if(!captured)return; const purpose=window.prompt("写作用途", "待分类")||"待分类"; await saveExcerpt({id:uuid(),paperId:paper.id,sourceText:captured.text,purpose,page,tags:[],createdAt:now()}); window.getSelection()?.removeAllRanges(); setCaptured(undefined); };
  useEffect(() => { const shortcut = (event: KeyboardEvent) => { if (!captured || !(event.ctrlKey || event.metaKey) || !event.altKey || event.key.toLowerCase() !== "t") return; event.preventDefault(); void termFromSelection(); };
    window.addEventListener("keydown", shortcut); return () => window.removeEventListener("keydown", shortcut);
  // The shortcut is intentionally active only while an actual PDF selection is open.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [captured, page, paper.id]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, [contenteditable=true]")) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z" && !event.shiftKey) {
        event.preventDefault();
        void undoAnnotation();
        return;
      }
      if ((event.ctrlKey || event.metaKey) && (event.key.toLowerCase() === "y" || (event.key.toLowerCase() === "z" && event.shiftKey))) {
        event.preventDefault();
        void redoAnnotation();
        return;
      }
      if (event.key === "Delete" && selectedAnnotation) {
        event.preventDefault();
        void deleteSelectedAnnotation();
        return;
      }
      if (event.key === "Escape") clearReaderSelection();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedAnnotation]);
  const exportAnnotated = async () => { if (!bytes) return; setMessage("正在生成带批注副本…"); try { const document = await PDFDocument.load(bytes.slice()); for (const ann of annotations) { const target = document.getPage(ann.page - 1); const { width, height } = target.getSize(); const color = hexColor(ann.color); for (const rect of ann.geometry.rects ?? []) { const x = rect.x * width, y = height - (rect.y + rect.height) * height, w = rect.width * width, h = rect.height * height; if (ann.type === "highlight") target.drawRectangle({ x, y, width: w, height: h, color, opacity: .32 }); else if (ann.type === "underline") target.drawLine({ start: { x, y }, end: { x: x + w, y }, color, thickness: 1.6 }); else if (ann.type === "text") { target.drawRectangle({ x, y, width: Math.max(14, w), height: Math.max(14, h), color, opacity: .85 }); if (ann.comment) target.drawText(ann.comment.slice(0, 80), { x: x + 18, y, size: 8, color }); } }

      const points = ann.geometry.points ?? []; for (let i = 1; i < points.length; i++) target.drawLine({ start: { x: points[i - 1].x * width, y: height - points[i - 1].y * height }, end: { x: points[i].x * width, y: height - points[i].y * height }, color, thickness: 1.8 }); }
      const output = await document.save(); await backend.exportBytes(`${safeName(paper.titleEn)}-annotated.pdf`, output); setMessage("已导出，原始 PDF 未修改"); setTimeout(() => setMessage(""), 2500); } catch (e) { setMessage(e instanceof Error ? e.message : String(e)); } };
  const searchPages = search.trim() ? Object.entries(pageText).filter(([, text]) => text.toLowerCase().includes(search.toLowerCase())).map(([n]) => Number(n)) : [];
  if (!data) return null;
  return <main className={"reader-screen" + (embedded ? " embedded" : "")}>
    <header className="reader-toolbar"><button className="reader-back" onClick={onBack}><ArrowLeft size={17} />返回论文库</button><div className="reader-title"><strong>{paper.titleZh || paper.titleEn}</strong><small>{paper.venue || "本地论文"}</small></div><div className="reader-tools"><button onClick={() => { pendingScale.current = Math.max(.5, pendingScale.current - .1); setScale(pendingScale.current); }}><ZoomOut size={17} /></button><span>{Math.round(scale * 100)}%</span><button onClick={() => { pendingScale.current = Math.min(2.5, pendingScale.current + .1); setScale(pendingScale.current); }}><ZoomIn size={17} /></button><i /><button className={tool === "select" ? "active" : ""} onClick={() => { setTool("select"); clearReaderSelection(); }} title="选择"><MousePointer2 size={17} /></button><button className={tool === "highlight" ? "active" : ""} onClick={() => { setTool("highlight"); clearReaderSelection(); }} title="高亮"><Highlighter size={17} /></button><button className={tool === "underline" ? "active" : ""} onClick={() => { setTool("underline"); clearReaderSelection(); }} title="下划线"><Underline size={17} /></button><button className={tool === "text" ? "active" : ""} onClick={() => setTool("text")} title="文本批注"><MessageSquareText size={17} /></button><button className={tool === "ink" ? "active" : ""} onClick={() => setTool("ink")} title="手绘"><PenLine size={17} /></button><button className={tool === "figure" ? "active" : ""} onClick={() => setTool("figure")} title="框选框架图"><FileImage size={17} /></button><button onClick={() => setMessage("请使用 Ctrl+V 粘贴剪贴板图片")} title="粘贴框架图"><ClipboardPaste size={17} /></button>{!paper.hasTextLayer && <button disabled={busy} onClick={() => void runOcr()} title="对扫描版执行本地 OCR"><FileText size={17} /></button>}<i /><button disabled={!canUndo} onClick={() => void undoAnnotation()} title="撤销 Ctrl+Z"><Undo2 size={17} /></button><button disabled={!canRedo} onClick={() => void redoAnnotation()} title="重做 Ctrl+Shift+Z"><Redo2 size={17} /></button><button onClick={exportAnnotated} title="导出带批注副本"><Download size={17} /></button><button onClick={() => setRightOpen(v => !v)} title="学习侧栏"><SidebarClose size={17} /></button></div></header>
    <div className={`reader-layout ${rightOpen ? "" : "right-closed"}`}>
    <button className="reader-mode-switch" onClick={() => { setContinuous(value => !value); setCaptured(undefined); setTool("select"); }}>{continuous ? "连续阅读" : "单页批注"}</button>
      <aside className="page-sidebar"><div className="pdf-search"><Search size={15} /><input placeholder="在本文中查找" value={search} onChange={e => setSearch(e.target.value)} /></div>{search && <div className="search-pages">命中页面：{searchPages.length ? searchPages.map(n => <button key={n} onClick={() => setPage(n)}>P{n}</button>) : "无"}</div>}<div className="page-list">{Array.from({ length: pdf?.numPages ?? paper.pageCount ?? 0 }, (_, i) => i + 1).map(n => <button key={n} className={page === n ? "active" : ""} onClick={() => setPage(n)}><span><FileText size={20} /></span><small>{n}</small>{annotations.some(a => a.page === n) && <i />}</button>)}</div></aside>
      <section className="pdf-stage" ref={stageRef}><div className="page-controls"><button disabled={page <= 1} onClick={() => setPage(p => p - 1)}><ChevronLeft size={17} /></button><label><input type="number" min="1" max={pdf?.numPages} value={page} onChange={e => setPage(Math.max(1, Math.min(pdf?.numPages ?? 1, Number(e.target.value))))} /> / {pdf?.numPages ?? "—"}</label><button disabled={page >= (pdf?.numPages ?? 1)} onClick={() => setPage(p => p + 1)}><ChevronRight size={17} /></button></div>
        {continuous && <ContinuousAnnotatablePdf pdf={pdf} scale={scale} annotations={annotations} captured={captured} selectedAnnotation={selectedAnnotation} tool={tool} onPage={setPage} onCapture={handleCapture} onAnnotate={annotateCaptured} onSelectAnnotation={(id, anchor) => setSelectedAnnotation(id && anchor ? { id, page: anchor.page, x: anchor.x, y: anchor.y } : undefined)} onTerm={() => void termFromSelection()} onExcerpt={() => void excerptFromSelection()} onClearSelection={clearReaderSelection} onDeleteSelectedAnnotation={() => void deleteSelectedAnnotation()} />}
        {message && <div className={`reader-message ${busy ? "busy" : ""}`}>{message}</div>}<div className={`pdf-page-wrap tool-${tool}`}><canvas ref={canvasRef} /><div className="textLayer" ref={textLayerRef} onMouseUp={captureTextSelection} /><div className="annotation-layer" ref={overlayRef} onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp}>{pageAnnotations.map(ann => <AnnotationOverlay key={ann.id} annotation={ann} selected={selectedAnnotation?.id === ann.id} onSelect={(event, item) => { if (tool !== "select") return; event.stopPropagation(); const pageRect = overlayRef.current!.getBoundingClientRect(); setSelectedAnnotation({ id: item.id, page, x: event.clientX - pageRect.left, y: event.clientY - pageRect.top - 42 }); setCaptured(undefined); }} />)}{tool === "ink" && draftPoints.length > 1 && <svg><polyline points={draftPoints.map(p => `${p.x * 100}%,${p.y * 100}%`).join(" ")} /></svg>}</div>{captured && <SelectionToolbar mode="text" x={captured.x} y={captured.y} onHighlight={() => void annotateCaptured("highlight")} onUnderline={() => void annotateCaptured("underline")} onTerm={() => void termFromSelection()} onExcerpt={() => void excerptFromSelection()} onClose={clearReaderSelection} />}{selectedAnnotation?.page === page && <SelectionToolbar mode="annotation" x={selectedAnnotation.x} y={selectedAnnotation.y} onDelete={() => void deleteSelectedAnnotation()} onClose={() => setSelectedAnnotation(undefined)} />}</div></section>
      {rightOpen && <aside className="study-sidebar"><nav>{([['overview','速览'],['annotations',`批注 ${annotations.length}`],['vocabulary',`术语 ${vocab.length}`],['framework',`框架 ${figures.length}`]] as [SideTab,string][]).map(([id,label]) => <button className={tab === id ? "active" : ""} onClick={() => setTab(id)} key={id}>{label}</button>)}</nav><div className="study-body">
        {tab === "overview" && <><section className="summary-card"><label>一句话总结</label><p>{paper.summary || "待补充"}</p></section><h3>中文摘要</h3><p>{paper.abstractZh || "待补充"}</p><h3>English abstract</h3><p>{paper.abstractEn || "Not available."}</p></>}
        {tab === "annotations" && <>{annotations.sort((a,b) => a.page-b.page).map(ann => <article className="annotation-card" key={ann.id} onClick={() => setPage(ann.page)}><span style={{ background: ann.color }} /><div><strong>{ann.type === "highlight" ? "高亮" : ann.type === "underline" ? "下划线" : ann.type === "text" ? "文本批注" : "手绘"} · P{ann.page}</strong><p>{ann.comment || ann.quote || "无附加文字"}</p></div><button className="annotation-delete" title="删除批注" onClick={event => { event.stopPropagation(); if (confirm("删除这条批注？")) void trackDelete(ann); }}><Trash2 size={14} /></button></article>)}{!annotations.length && <p className="muted centered">选择模式用浮动工具栏批注；高亮/下划线工具选中即标注；点击已有批注可删除</p>}</>}
        {tab === "vocabulary" && <>{vocab.map(item => <article className="vocab-card" key={item.id} onClick={() => item.page && setPage(item.page)}><header><strong>{item.termEn}</strong><span>{item.meaningZh}</span></header><p>{item.sentenceZh}</p></article>)}<QuickCapture paperId={paper.id} page={page} pageText={pageText[page]} onTerm={saveVocabulary} onExcerpt={saveExcerpt} /></>}
        {tab === "framework" && <>{figures.map(item => <article className="figure-card" key={item.id}><h3>{item.title || "方法框架"}</h3><p>{item.explanationZh}</p><small>第 {item.page} 页</small></article>)}{!figures.length && <p className="muted centered">V1 可在论文详情上传框架图</p>}</>}
      </div></aside>}
    </div>
  </main>;
}

export function AnnotationOverlay({ annotation, selected, onSelect }: { annotation: Annotation; selected?: boolean; onSelect?(event: React.MouseEvent, annotation: Annotation): void }) { return <>{annotation.geometry.rects?.map((rect, index) => <div key={index} title={annotation.quote || annotation.type} className={`annotation-shape ${annotation.type}${selected ? " selected" : ""}`} style={{ left: `${rect.x * 100}%`, top: `${rect.y * 100}%`, width: `${rect.width * 100}%`, height: `${rect.height * 100}%`, "--annotation-color": annotation.color } as React.CSSProperties} onClick={onSelect ? event => onSelect(event, annotation) : undefined} />)}{annotation.geometry.points && <svg className="ink-overlay"><polyline style={{ stroke: annotation.color }} points={annotation.geometry.points.map(p => `${p.x * 100}%,${p.y * 100}%`).join(" ")} /></svg>}</>; }

function QuickCapture({ paperId, page, pageText, onTerm, onExcerpt }: { paperId: string; page: number; pageText?: string; onTerm(v: VocabularyEntry): Promise<void>; onExcerpt(v: WritingExcerpt): Promise<void> }) { const term = () => { const termEn = prompt("英文词汇 / 短语"); if (!termEn) return; const meaningZh = prompt("中文释义") || "待补充"; void onTerm({ id: uuid(), paperId, termEn, meaningZh, sentenceEn: pageText?.slice(0, 240), page }); }; const excerpt = () => { const sourceText = prompt("粘贴要收藏的英文佳句"); if (!sourceText) return; void onExcerpt({ id: uuid(), paperId, sourceText, purpose: "待分类", page, tags: [], createdAt: now() }); }; return <div className="quick-capture"><button onClick={term}><Plus size={14} />收录术语</button><button onClick={excerpt}><BookOpen size={14} />加入写作库</button></div>; }
function hexColor(hex: string) { const value = hex.replace("#", ""); return rgb(parseInt(value.slice(0,2),16)/255, parseInt(value.slice(2,4),16)/255, parseInt(value.slice(4,6),16)/255); }
function safeName(name: string) { return name.replace(/[<>:"/\\|?*]+/g, "_").slice(0, 90); }
function representativeSentence(pageText:string|undefined,phrase:string,fallback:string){if(!pageText)return fallback;const at=pageText.toLowerCase().indexOf(phrase.toLowerCase());if(at<0)return fallback;const left=Math.max(pageText.lastIndexOf(".",at)+1,pageText.lastIndexOf("?",at)+1,pageText.lastIndexOf("!",at)+1);const next=[pageText.indexOf(".",at+phrase.length),pageText.indexOf("?",at+phrase.length),pageText.indexOf("!",at+phrase.length)].filter(v=>v>=0);const right=next.length?Math.min(...next)+1:Math.min(pageText.length,left+360);return pageText.slice(left,right).trim()||fallback;}
function ContinuousPdf({ pdf, scale, onPage }: { pdf?: PDFDocumentProxy; scale: number; onPage(page: number): void }) {
  if (!pdf) return null;
  return <div className="continuous-pdf">{Array.from({ length: pdf.numPages }, (_, index) => <ContinuousPdfPage key={index + 1} pdf={pdf} page={index + 1} scale={scale} onPage={onPage} />)}</div>;
}
function ContinuousPdfPage({ pdf, page, scale, onPage }: { pdf: PDFDocumentProxy; page: number; scale: number; onPage(page: number): void }) {
  const host = useRef<HTMLDivElement>(null); const canvas = useRef<HTMLCanvasElement>(null); const [visible, setVisible] = useState(page === 1);
  useEffect(() => { const target = host.current; if (!target) return; const observer = new IntersectionObserver(entries => entries.forEach(entry => { if (entry.isIntersecting) { setVisible(true); onPage(page); } }), { rootMargin: "420px 0px" }); observer.observe(target); return () => observer.disconnect(); }, [page, onPage]);
  useEffect(() => { if (!visible || !canvas.current) return; let cancelled = false; void (async () => { const source = await pdf.getPage(page); const viewport = source.getViewport({ scale }); const target = canvas.current; if (!target || cancelled) return; const context = target.getContext("2d"); if (!context) return; target.width = viewport.width * devicePixelRatio; target.height = viewport.height * devicePixelRatio; target.style.width = viewport.width + "px"; target.style.height = viewport.height + "px"; context.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0); await source.render({ canvasContext: context, viewport, canvas: target }).promise; })(); return () => { cancelled = true; }; }, [pdf, page, scale, visible]);
  return <article ref={host} className="continuous-page"><small>第 {page} 页</small><canvas ref={canvas} /></article>;
}

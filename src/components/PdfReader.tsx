import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, BookOpen, Download, FileText, Plus, SidebarClose, Trash2 } from "lucide-react";
import { GlobalWorkerOptions, getDocument, type PDFDocumentProxy } from "pdfjs-dist";
import { PDFDocument, rgb } from "pdf-lib";
import type { AnnotationChangedEvent } from "fresh-air-pdf";
import { backend } from "../services/backend";
import { useLibrary } from "../state/LibraryContext";
import type { Annotation, Paper, VocabularyEntry, WritingExcerpt } from "../types";
import { now, uuid } from "../types";
import { translateEnglishToChinese } from "../services/translation";
import { FreshAirPdfPane } from "./FreshAirPdfPane";
import { SelectionToolbar } from "./SelectionToolbar";
import { freshAirToPaper, type PageSize } from "../lib/freshAirBridge";
import "./PdfReader.css";

GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
type SideTab = "overview" | "annotations" | "vocabulary" | "framework";
type CapturedSelection = { text: string; x: number; y: number; page: number };

export function PdfReader({ paper, onBack, embedded = false }: { paper: Paper; onBack(): void; embedded?: boolean }) {
  const { data, savePaper, saveAnnotation, deleteAnnotation, saveVocabulary, saveExcerpt } = useLibrary();
  const viewerHostRef = useRef<HTMLDivElement>(null);
  const syncLock = useRef(false);
  const [bytes, setBytes] = useState<Uint8Array>();
  const [pdf, setPdf] = useState<PDFDocumentProxy>();
  const [pageSizes, setPageSizes] = useState<Map<number, PageSize>>(new Map());
  const [page, setPage] = useState(paper.readingPage || 1);
  const [tab, setTab] = useState<SideTab>("annotations");
  const [busy, setBusy] = useState(true);
  const [message, setMessage] = useState("正在打开 PDF…");
  const [pageText, setPageText] = useState<Record<number, string>>({});
  const [rightOpen, setRightOpen] = useState(true);
  const [viewerReady, setViewerReady] = useState(false);
  const [captured, setCaptured] = useState<CapturedSelection>();

  const annotations = useMemo(() => data?.annotations.filter(item => item.paperId === paper.id) ?? [], [data, paper.id]);
  const vocab = data?.vocabulary.filter(item => item.paperId === paper.id) ?? [];
  const figures = data?.figures.filter(item => item.paperId === paper.id) ?? [];

  useEffect(() => {
    setViewerReady(false);
  }, [paper.id]);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        if (!paper.pdfPath) throw new Error("这篇论文还没有关联 PDF");
        const file = await backend.readPdf(paper.pdfPath);
        const document = await getDocument({ data: file.slice() }).promise;
        if (!active) return;
        setBytes(file);
        setPdf(document);
        const sizes = new Map<number, PageSize>();
        const texts: Record<number, string> = {};
        const indexPages: { page: number; text: string }[] = [];
        for (let number = 1; number <= document.numPages; number++) {
          const pdfPage = await document.getPage(number);
          const viewport = pdfPage.getViewport({ scale: 1 });
          sizes.set(number, { width: viewport.width, height: viewport.height });
          const content = await pdfPage.getTextContent();
          const text = content.items.map(item => "str" in item ? item.str : "").join(" ");
          texts[number] = text;
          indexPages.push({ page: number, text });
        }
        if (!active) return;
        setPageSizes(sizes);
        const sourceHasText = indexPages.some(item => item.text.trim());
        if (sourceHasText) {
          setPageText(texts);
          await backend.indexPdf(paper.id, indexPages);
        } else {
          const stored = await backend.indexedPdfPages(paper.id);
          setPageText(Object.fromEntries(stored.map(item => [item.page, item.text])));
        }
        if (paper.pageCount !== document.numPages || paper.hasTextLayer !== sourceHasText) {
          await savePaper({ ...paper, pageCount: document.numPages, hasTextLayer: sourceHasText, updatedAt: now() });
        }
        setBusy(false);
        setMessage("");
      } catch (error) {
        if (active) {
          setBusy(false);
          setMessage(error instanceof Error ? error.message : String(error));
        }
      }
    })();
    return () => { active = false; };
  }, [paper.id, paper.pdfPath]);

  useEffect(() => {
    if (!pdf) return;
    void savePaper({ ...paper, readingPage: page, updatedAt: now() });
  }, [pdf, page]);

  useEffect(() => {
    const host = viewerHostRef.current;
    if (!host) return;
    const captureSelection = () => {
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed || !selection.toString().trim()) return;
      const range = selection.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      const hostRect = host.getBoundingClientRect();
      if (!host.contains(range.commonAncestorContainer)) return;
      setCaptured({
        text: selection.toString().trim(),
        x: rect.left - hostRect.left,
        y: rect.top - hostRect.top - 42,
        page,
      });
    };
    host.addEventListener("mouseup", captureSelection);
    return () => host.removeEventListener("mouseup", captureSelection);
  }, [page]);

  const handleAnnotationChanged = useCallback(async (event: AnnotationChangedEvent) => {
    if (syncLock.current || !pageSizes.size) return;
    const mapped = freshAirToPaper(event.annotation, paper.id, pageSizes);
    if (!mapped) return;
    if (event.action === "deleted") await deleteAnnotation(event.annotation.id);
    else await saveAnnotation(mapped);
  }, [deleteAnnotation, pageSizes, paper.id, saveAnnotation]);

  const clearSelection = () => {
    window.getSelection()?.removeAllRanges();
    setCaptured(undefined);
  };

  const termFromSelection = async () => {
    if (!captured) return;
    const termEn = window.prompt("要收录的英文词汇 / 短语", captured.text);
    if (!termEn) return;
    const meaningZh = window.prompt("中文释义") || "待补充";
    await saveVocabulary({
      id: uuid(),
      paperId: paper.id,
      termEn,
      meaningZh,
      sentenceEn: representativeSentence(pageText[captured.page], termEn, captured.text),
      page: captured.page,
    });
    clearSelection();
    setTab("vocabulary");
  };

  const excerptFromSelection = async () => {
    if (!captured) return;
    const purpose = window.prompt("写作用途", "待分类") || "待分类";
    await saveExcerpt({
      id: uuid(),
      paperId: paper.id,
      sourceText: captured.text,
      purpose,
      page: captured.page,
      tags: [],
      createdAt: now(),
    });
    clearSelection();
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
    if (!bytes) return;
    setMessage("正在生成带批注副本…");
    try {
      const document = await PDFDocument.load(bytes.slice());
      for (const annotation of annotations) {
        const target = document.getPage(annotation.page - 1);
        const size = pageSizes.get(annotation.page);
        if (!size) continue;
        const color = hexColor(annotation.color);
        for (const rect of annotation.geometry.rects ?? []) {
          const x = rect.x * size.width;
          const y = size.height - (rect.y + rect.height) * size.height;
          const width = rect.width * size.width;
          const height = rect.height * size.height;
          if (annotation.type === "highlight") target.drawRectangle({ x, y, width, height, color, opacity: 0.32 });
          else if (annotation.type === "underline") target.drawLine({ start: { x, y }, end: { x: x + width, y }, color, thickness: 1.6 });
          else if (annotation.type === "text") {
            target.drawRectangle({ x, y, width: Math.max(14, width), height: Math.max(14, height), color, opacity: 0.85 });
            if (annotation.comment) target.drawText(annotation.comment.slice(0, 80), { x: x + 18, y, size: 8, color });
          }
        }
        const points = annotation.geometry.points ?? [];
        for (let index = 1; index < points.length; index++) {
          target.drawLine({
            start: { x: points[index - 1].x * size.width, y: size.height - points[index - 1].y * size.height },
            end: { x: points[index].x * size.width, y: size.height - points[index].y * size.height },
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

  if (!data || !bytes) {
    return <main className={"reader-screen" + (embedded ? " embedded" : "")}>
      <header className="reader-toolbar"><button className="reader-back" onClick={onBack}><ArrowLeft size={17} />返回论文库</button><div className="reader-title"><strong>{paper.titleZh || paper.titleEn}</strong></div></header>
      <div className={`reader-message ${busy ? "busy" : ""}`}>{message || "正在打开 PDF…"}</div>
    </main>;
  }

  return <main className={"reader-screen fresh-air-reader" + (embedded ? " embedded" : "")}>
    <header className="reader-toolbar">
      <button className="reader-back" onClick={onBack}><ArrowLeft size={17} />返回论文库</button>
      <div className="reader-title"><strong>{paper.titleZh || paper.titleEn}</strong><small>{paper.venue || "本地论文"} · P{page}{pdf ? ` / ${pdf.numPages}` : ""}</small></div>
      <div className="reader-tools">
        {!paper.hasTextLayer && <button disabled={busy} onClick={() => void runOcr()} title="对扫描版执行本地 OCR"><FileText size={17} /></button>}
        <button onClick={() => void exportAnnotated()} title="导出带批注副本"><Download size={17} /></button>
        <button onClick={() => setRightOpen(value => !value)} title="学习侧栏"><SidebarClose size={17} /></button>
      </div>
    </header>
    <div className={`reader-layout fresh-air-layout ${rightOpen ? "" : "right-closed"}`}>
      <section className="fresh-air-stage" ref={viewerHostRef}>
        <FreshAirPdfPane
          bytes={bytes}
          initialPage={paper.readingPage || 1}
          annotations={annotations}
          pageSizes={pageSizes}
          ready={viewerReady && pageSizes.size > 0}
          syncLock={syncLock}
          onReady={() => setViewerReady(true)}
          onPageChange={setPage}
          onAnnotationChanged={event => { void handleAnnotationChanged(event); }}
        />
        {captured && <SelectionToolbar
          mode="text"
          x={captured.x}
          y={captured.y}
          onTerm={() => void termFromSelection()}
          onExcerpt={() => void excerptFromSelection()}
          onClose={clearSelection}
        />}
        {message && <div className={`reader-message ${busy ? "busy" : ""}`}>{message}</div>}
      </section>
      {rightOpen && <aside className="study-sidebar">
        <nav>{([["overview", "速览"], ["annotations", `批注 ${annotations.length}`], ["vocabulary", `术语 ${vocab.length}`], ["framework", `框架 ${figures.length}`]] as [SideTab, string][]).map(([id, label]) => (
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
              <article className="annotation-card" key={annotation.id}>
                <span style={{ background: annotation.color }} />
                <div>
                  <strong>{annotation.type === "highlight" ? "高亮" : annotation.type === "underline" ? "下划线" : annotation.type === "text" ? "文本批注" : "手绘"} · P{annotation.page}</strong>
                  <p>{annotation.comment || annotation.quote || "无附加文字"}</p>
                </div>
                <button className="annotation-delete" title="删除批注" onClick={() => { if (confirm("删除这条批注？")) void deleteAnnotation(annotation.id); }}><Trash2 size={14} /></button>
              </article>
            ))}
            {!annotations.length && <p className="muted centered">使用 Fresh Air PDF 工具栏批注；选中文本可收录术语或写作句</p>}
          </>}
          {tab === "vocabulary" && <>
            {vocab.map(item => (
              <article className="vocab-card" key={item.id}><header><strong>{item.termEn}</strong><span>{item.meaningZh}</span></header><p>{item.sentenceZh}</p></article>
            ))}
            <QuickCapture paperId={paper.id} page={page} pageText={pageText[page]} onTerm={saveVocabulary} onExcerpt={saveExcerpt} />
          </>}
          {tab === "framework" && <>
            {figures.map(item => (
              <article className="figure-card" key={item.id}><h3>{item.title || "方法框架"}</h3><p>{item.explanationZh}</p><small>第 {item.page} 页</small></article>
            ))}
            {!figures.length && <p className="muted centered">可在论文详情上传框架图</p>}
          </>}
        </div>
      </aside>}
    </div>
  </main>;
}

function QuickCapture({ paperId, page, pageText, onTerm, onExcerpt }: { paperId: string; page: number; pageText?: string; onTerm(v: VocabularyEntry): Promise<void>; onExcerpt(v: WritingExcerpt): Promise<void> }) {
  const term = () => {
    const termEn = prompt("英文词汇 / 短语");
    if (!termEn) return;
    const meaningZh = prompt("中文释义") || "待补充";
    void onTerm({ id: uuid(), paperId, termEn, meaningZh, sentenceEn: pageText?.slice(0, 240), page });
  };
  const excerpt = () => {
    const sourceText = prompt("粘贴要收藏的英文佳句");
    if (!sourceText) return;
    void onExcerpt({ id: uuid(), paperId, sourceText, purpose: "待分类", page, tags: [], createdAt: now() });
  };
  return <div className="quick-capture"><button onClick={term}><Plus size={14} />收录术语</button><button onClick={excerpt}><BookOpen size={14} />加入写作库</button></div>;
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

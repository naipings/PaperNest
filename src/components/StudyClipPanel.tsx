import { ArrowDown, BookOpen, ClipboardPaste, Languages, Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { translateEnglishToChineseWithFallback } from "../services/translation";
import type { VocabularyEntry, WritingExcerpt } from "../types";
import { now, uuid } from "../types";

const FONT_KEY = "papernest.studyClipFontSize";
type FontSize = "sm" | "md" | "lg";

function readFontSize(): FontSize {
  const value = localStorage.getItem(FONT_KEY);
  return value === "sm" || value === "lg" ? value : "md";
}

export function StudyClipPanel({
  paperId,
  page,
  pageText,
  selectionText,
  seedKey,
  seedText,
  llmReady,
  askPurpose,
  onTerm,
  onExcerpt,
}: {
  paperId: string;
  page: number;
  pageText?: string;
  selectionText?: string;
  seedKey: number;
  seedText: string;
  llmReady: boolean;
  askPurpose(): Promise<string | null>;
  onTerm(entry: VocabularyEntry): Promise<void>;
  onExcerpt(entry: WritingExcerpt): Promise<void>;
}) {
  const [source, setSource] = useState("");
  const [translated, setTranslated] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [fontSize, setFontSize] = useState<FontSize>(readFontSize);

  useEffect(() => {
    if (!seedKey || !seedText.trim()) return;
    setSource(seedText);
    setTranslated("");
    setNotice("已填入选区文本，可整理后再翻译或收录");
  }, [seedKey, seedText]);

  const fillSelection = () => {
    const text = selectionText?.trim();
    if (!text) {
      setNotice("请先在 PDF 中拖选文字，保持选区后点此填入；也可手动粘贴");
      return;
    }
    setSource(text);
    setTranslated("");
    setNotice("已填入当前选区，可继续删改后再翻译或收录");
  };

  const changeFontSize = (next: FontSize) => {
    setFontSize(next);
    localStorage.setItem(FONT_KEY, next);
  };

  const translate = async () => {
    const value = source.trim();
    if (!value) {
      setNotice("请先粘贴或填入英文内容");
      return;
    }
    setBusy(true);
    setNotice(llmReady ? "正在调用 LLM 学术翻译…" : "正在翻译（优先 LLM，否则本地翻译）…");
    try {
      const result = await translateEnglishToChineseWithFallback(value, llmReady, {
        mode: "sentence",
        context: pageText?.slice(0, 400),
      });
      if (!result) {
        setNotice("翻译失败：请先在设置中配置 LLM，或启动 LibreTranslate");
        return;
      }
      setTranslated(result);
      setNotice("翻译完成，可继续修改后收为术语或加入写作库");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const saveTerm = async () => {
    const raw = source.trim();
    if (!raw) {
      setNotice("编辑框为空，无法收录术语");
      return;
    }
    const termEn = window.prompt("要收录的英文词汇 / 短语", raw.length > 80 ? raw.slice(0, 80) : raw);
    if (!termEn) return;
    setBusy(true);
    try {
      const meaningZh = translated.trim()
        || await translateEnglishToChineseWithFallback(termEn, llmReady, { mode: "term", context: raw })
        || "待补充";
      const sentenceZh = translated.trim()
        || await translateEnglishToChineseWithFallback(raw, llmReady, { mode: "sentence" });
      await onTerm({
        id: uuid(),
        paperId,
        termEn: termEn.trim(),
        meaningZh,
        sentenceEn: raw,
        sentenceZh,
        page,
      });
      setNotice("已收为术语");
    } catch (error) {
      setNotice(`收录术语失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
    }
  };

  const saveExcerpt = async () => {
    const raw = source.trim();
    if (!raw) {
      setNotice("编辑框为空，无法加入写作库");
      return;
    }
    const purpose = await askPurpose();
    if (!purpose) return;
    setBusy(true);
    try {
      const translationZh = translated.trim()
        || await translateEnglishToChineseWithFallback(raw, llmReady, { mode: "sentence", context: pageText?.slice(0, 400) });
      await onExcerpt({
        id: uuid(),
        paperId,
        sourceText: raw,
        translationZh,
        purpose,
        page,
        tags: [],
        createdAt: now(),
      });
      setNotice("已加入写作库");
    } catch (error) {
      setNotice(`加入写作库失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
    }
  };

  return <section className="study-clip" data-font={fontSize}>
    <header className="study-clip-head">
      <Languages size={15} />
      <div>
        <strong>编辑与翻译</strong>
        <small>「填入当前选区」把 PDF 拖选文本写入原文框；浮动条「送入编辑框」效果相同并自动切到本页</small>
      </div>
      <div className="study-clip-font" role="group" aria-label="编辑区字号">
        {([["sm", "小"], ["md", "中"], ["lg", "大"]] as const).map(([id, label]) => (
          <button
            key={id}
            type="button"
            className={fontSize === id ? "active" : ""}
            onClick={() => changeFontSize(id)}
          >{label}</button>
        ))}
      </div>
    </header>
    <label className="study-clip-label" htmlFor="study-clip-source">原文（可编辑）</label>
    <textarea
      id="study-clip-source"
      className="study-clip-input"
      rows={8}
      value={source}
      onChange={event => setSource(event.target.value)}
      placeholder="在此粘贴 PDF 选中文本，或点击下方「填入当前选区」…"
    />
    <div className="study-clip-toolbar">
      <button type="button" className="secondary" disabled={busy} onClick={fillSelection} title="将 PDF 当前拖选文本写入上方原文框">
        <ClipboardPaste size={14} />填入当前选区
      </button>
      <select aria-label="目标语言" defaultValue="zh-Hans" disabled>
        <option value="zh-Hans">简体中文</option>
      </select>
    </div>
    <div className="study-clip-transfer">
      <button type="button" className="study-clip-arrow" disabled={busy || !source.trim()} onClick={() => void translate()} title="学术翻译">
        <ArrowDown size={18} />
      </button>
    </div>
    <label className="study-clip-label" htmlFor="study-clip-translation">译文</label>
    <textarea
      id="study-clip-translation"
      className="study-clip-output"
      rows={12}
      value={translated}
      onChange={event => setTranslated(event.target.value)}
      placeholder="学术译文将显示在此处…"
    />
    <p className="study-clip-disclaimer">AI 生成内容，仅供参考。</p>
    <div className="study-clip-actions">
      <button type="button" className="secondary" disabled={busy || !source.trim()} onClick={() => void saveTerm()}>
        <Plus size={14} />收为术语
      </button>
      <button type="button" className="primary" disabled={busy || !source.trim()} onClick={() => void saveExcerpt()}>
        <BookOpen size={14} />加入写作库
      </button>
    </div>
    {notice && <p className="study-clip-notice">{notice}</p>}
  </section>;
}

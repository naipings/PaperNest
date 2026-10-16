import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Lock, Pencil } from "lucide-react";
import { replaceMarkdownBlock, splitMarkdownBlocks } from "../lib/markdownBlocks";
import "./MarkdownLiveEditor.css";

export function MarkdownLiveEditor({ text, render, onSave, editable = true }: {
  text: string;
  render(source: string): ReactNode;
  onSave?(next: string): Promise<void>;
  editable?: boolean;
}) {
  const [mode, setMode] = useState<"preview" | "edit">("preview");
  const [source, setSource] = useState(text);
  const [active, setActive] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  const draftRef = useRef("");
  const [status, setStatus] = useState("");
  const sourceRef = useRef(text);
  const seen = useRef(text);
  const skipCommit = useRef(false);
  const saving = useRef(Promise.resolve());
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const anchorRef = useRef<{
    top: number;
    scrollParent: HTMLElement;
    fontSize: string;
    lineHeight: string;
    fontWeight: string;
    fontFamily: string;
    marginTop: string;
    marginBottom: string;
    marginLeft: string;
    paddingLeft: string;
    width: string;
  } | null>(null);

  useEffect(() => {
    if (text === seen.current) return;
    seen.current = text;
    if (mode === "preview" && active === null) {
      sourceRef.current = text;
      setSource(text);
    }
  }, [text, mode, active]);

  useEffect(() => {
    if (!editable && mode === "edit") {
      setMode("preview");
      setActive(null);
    }
  }, [editable, mode]);

  const placeEditor = () => {
    const area = areaRef.current;
    const anchor = anchorRef.current;
    if (!area || !anchor) return;
    area.style.fontSize = anchor.fontSize;
    area.style.lineHeight = anchor.lineHeight;
    area.style.fontWeight = anchor.fontWeight;
    area.style.fontFamily = anchor.fontFamily;
    area.style.marginTop = anchor.marginTop;
    area.style.marginBottom = anchor.marginBottom;
    area.style.marginLeft = anchor.marginLeft;
    area.style.paddingLeft = anchor.paddingLeft;
    area.style.width = anchor.width;
    area.style.height = "auto";
    area.style.height = `${area.scrollHeight}px`;
    const delta = area.getBoundingClientRect().top - anchor.top;
    if (Math.abs(delta) > 1) anchor.scrollParent.scrollTop += delta;
  };

  useLayoutEffect(() => {
    if (active === null) return;
    placeEditor();
    areaRef.current?.focus({ preventScroll: true });
  }, [active]);

  useLayoutEffect(() => {
    const area = areaRef.current;
    if (!area || active === null) return;
    area.style.height = "auto";
    area.style.height = `${area.scrollHeight}px`;
  }, [draft, active]);

  const open = (index: number, blockEl: HTMLElement) => {
    const content = blockEl.querySelector<HTMLElement>(".markdown-body > *") ?? blockEl;
    const style = getComputedStyle(content);
    const box = content.getBoundingClientRect();
    const host = blockEl.getBoundingClientRect();
    let scrollParent: HTMLElement = document.documentElement;
    let parent = blockEl.parentElement;
    while (parent) {
      if (/(auto|scroll)/.test(getComputedStyle(parent).overflowY)) {
        scrollParent = parent;
        break;
      }
      parent = parent.parentElement;
    }
    anchorRef.current = {
      top: host.top,
      scrollParent,
      fontSize: style.fontSize,
      lineHeight: style.lineHeight,
      fontWeight: style.fontWeight,
      fontFamily: style.fontFamily,
      marginTop: style.marginTop,
      marginBottom: style.marginBottom,
      marginLeft: box.width > 0 ? `${Math.max(0, box.left - host.left)}px` : "0",
      paddingLeft: style.paddingLeft,
      width: box.width > 0 ? `${box.width}px` : "100%",
    };
    const block = splitMarkdownBlocks(sourceRef.current)[index];
    if (!block) return;
    const nextDraft = sourceRef.current.slice(block.start, block.end);
    draftRef.current = nextDraft;
    setDraft(nextDraft);
    setActive(index);
    setStatus("");
  };

  const commit = (index: number) => {
    const current = sourceRef.current;
    const block = splitMarkdownBlocks(current)[index];
    setActive(null);
    if (!block) return;
    const original = current.slice(block.start, block.end);
    const edited = draftRef.current;
    if (edited === original) return;
    const next = replaceMarkdownBlock(current, index, edited);
    sourceRef.current = next;
    setSource(next);
    if (!onSave) return;
    setStatus("保存中");
    saving.current = saving.current.then(async () => {
      try {
        await onSave(next);
        seen.current = next;
        setStatus("已保存");
      } catch (error) {
        setStatus(error instanceof Error ? error.message : String(error));
      }
    });
  };

  const blocks = splitMarkdownBlocks(source);
  return (
    <div className={`md-live${mode === "edit" ? " is-editing" : ""}`}>
      <div className="md-mode-bar">
        {status && <span className="md-mode-status" role="status">{status}</span>}
        <div className="md-mode-switch" role="group" aria-label="报告编辑">
          <button type="button" aria-label="预览" aria-pressed={mode === "preview"} onClick={() => { if (active !== null) commit(active); setMode("preview"); }}><Lock size={15} /></button>
          <button type="button" aria-label="编辑" aria-pressed={mode === "edit"} disabled={!editable} title={editable ? "编辑报告" : "生成中不能编辑"} onClick={() => setMode("edit")}><Pencil size={15} /></button>
        </div>
      </div>
      {mode === "preview" ? render(source) : blocks.map((block, index) => {
        const blockSource = source.slice(block.start, block.end);
        if (active === index) {
          return (
            <textarea
              key={index}
              ref={areaRef}
              className="md-live-source"
              aria-label="编辑这段 Markdown"
              value={draft}
              onChange={event => { draftRef.current = event.target.value; setDraft(event.target.value); }}
              onBlur={() => { if (skipCommit.current) { skipCommit.current = false; return; } commit(index); }}
              onKeyDown={event => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  skipCommit.current = true;
                  setActive(null);
                }
              }}
            />
          );
        }
        return (
          <div
            key={index}
            className="md-live-block"
            tabIndex={0}
            onClick={event => {
              const target = event.target as HTMLElement;
              if (target.closest("a, button, img, textarea")) return;
              open(index, event.currentTarget);
            }}
            onKeyDown={event => {
              if (event.key === "Enter" && event.target === event.currentTarget) {
                event.preventDefault();
                open(index, event.currentTarget);
              }
            }}
          >
            {render(blockSource)}
          </div>
        );
      })}
    </div>
  );
}

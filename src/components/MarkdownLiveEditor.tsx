import { useEffect, useLayoutEffect, useRef, useState, type MutableRefObject, type ReactNode } from "react";
import { Lock, Pencil } from "lucide-react";
import { replaceMarkdownBlock, splitMarkdownBlocks } from "../lib/markdownBlocks";
import "./MarkdownLiveEditor.css";

type Anchor = {
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
};

function ActiveSource({ initial, anchor, onCommit, onCancel, commitRef }: {
  initial: string;
  anchor: Anchor;
  onCommit(value: string): void;
  onCancel(): void;
  commitRef: MutableRefObject<(() => void) | null>;
}) {
  const [draft, setDraft] = useState(initial);
  const draftRef = useRef(initial);
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const skipCommit = useRef(false);
  useLayoutEffect(() => {
    const area = areaRef.current;
    if (!area) return;
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
    area.focus({ preventScroll: true });
  }, [anchor]);
  useLayoutEffect(() => {
    const area = areaRef.current;
    if (!area) return;
    area.style.height = "auto";
    area.style.height = `${area.scrollHeight}px`;
  }, [draft]);
  useEffect(() => {
    commitRef.current = () => onCommit(draftRef.current);
    return () => { commitRef.current = null; };
  });
  return (
    <textarea
      ref={areaRef}
      className="md-live-source"
      aria-label="编辑这段 Markdown"
      value={draft}
      onChange={event => { draftRef.current = event.target.value; setDraft(event.target.value); }}
      onBlur={() => { if (skipCommit.current) { skipCommit.current = false; return; } onCommit(draftRef.current); }}
      onKeyDown={event => {
        if (event.key === "Escape") {
          event.preventDefault();
          skipCommit.current = true;
          onCancel();
        }
      }}
    />
  );
}

export function MarkdownLiveEditor({ text, render, onSave, editable = true }: {
  text: string;
  render(source: string): ReactNode;
  onSave?(next: string): Promise<void>;
  editable?: boolean;
}) {
  const [mode, setMode] = useState<"preview" | "edit">("preview");
  const [source, setSource] = useState(text);
  const [active, setActive] = useState<number | null>(null);
  const [status, setStatus] = useState("");
  const sourceRef = useRef(text);
  const seen = useRef(text);
  const saving = useRef(Promise.resolve());
  const anchorRef = useRef<Anchor | null>(null);
  const commitRef = useRef<(() => void) | null>(null);

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
    if (!splitMarkdownBlocks(sourceRef.current)[index]) return;
    setActive(index);
    setStatus("");
  };

  const commit = (index: number, edited: string) => {
    const current = sourceRef.current;
    const block = splitMarkdownBlocks(current)[index];
    setActive(null);
    if (!block) return;
    const original = current.slice(block.start, block.end);
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
          <button type="button" aria-label="预览" aria-pressed={mode === "preview"} onClick={() => { commitRef.current?.(); setMode("preview"); }}><Lock size={15} /></button>
          <button type="button" aria-label="编辑" aria-pressed={mode === "edit"} disabled={!editable} title={editable ? "编辑报告" : "生成中不能编辑"} onClick={() => setMode("edit")}><Pencil size={15} /></button>
        </div>
      </div>
      {mode === "preview" ? render(source) : blocks.map((block, index) => {
        const blockSource = source.slice(block.start, block.end);
        if (active === index && anchorRef.current) {
          return (
            <ActiveSource
              key={index}
              initial={blockSource}
              anchor={anchorRef.current}
              commitRef={commitRef}
              onCommit={value => commit(index, value)}
              onCancel={() => setActive(null)}
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

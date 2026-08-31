import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Annotation, Point } from "../types";
import type { NoteFontSize } from "../types";
import { noteFontSize, NOTE_FONT_PX } from "../lib/noteFontSize";
import { stickyNoteAnchor } from "../lib/stickyNoteAnchor";

const DRAG_THRESHOLD = 4;
export const NOTE_COLORS = ["#fff3b0", "#d4f0d4", "#cce5ff", "#ffd6e8"];

function clamp01(value: number) {
  return Math.min(1, Math.max(0, value));
}

function noteIconColor(color: string) {
  return NOTE_COLORS.includes(color) ? color : NOTE_COLORS[2];
}

function NoteMarkerIcon() {
  return (
    <svg className="sticky-note-marker-icon" viewBox="0 0 36 36" aria-hidden>
      <circle cx="18" cy="15" r="13" fill="currentColor" />
      <rect x="10.5" y="10" width="15" height="1.6" rx=".8" fill="#fff" opacity=".9" />
      <rect x="10.5" y="14" width="11" height="1.6" rx=".8" fill="#fff" opacity=".9" />
      <rect x="10.5" y="18" width="13" height="1.6" rx=".8" fill="#fff" opacity=".9" />
      <path d="M21 26 L27 33 L23 26 Z" fill="currentColor" />
    </svg>
  );
}

function formatNoteTime(iso: string) {
  return new Date(iso).toLocaleString("zh-CN", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function StickyNote({ annotation, selected, editing, onSelect, onEdit, onMove, onSave, onDelete, onCopy, onDuplicate }: {
  annotation: Annotation;
  selected?: boolean;
  editing?: boolean;
  onSelect(event: React.MouseEvent): void;
  onEdit(): void;
  onMove(anchor: Point): void;
  onSave(comment: string, color: string, fontSize: NoteFontSize): void;
  onDelete(): void;
  onCopy(): void;
  onDuplicate(): void;
}) {
  const savedAnchor = stickyNoteAnchor(annotation);
  const iconDragRef = useRef<{ px: number; py: number; ax: number; ay: number; hostW: number; hostH: number }>();
  const cardDragRef = useRef<{ px: number; py: number; ox: number; oy: number }>();
  const draftRef = useRef({ comment: "", color: NOTE_COLORS[2], fontSize: "md" as NoteFontSize });
  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;
  const moved = useRef(false);
  const skipClick = useRef(false);
  const [dragAnchor, setDragAnchor] = useState<Point>();
  const [draggingIcon, setDraggingIcon] = useState(false);
  const [draggingCard, setDraggingCard] = useState(false);
  const [cardOffset, setCardOffset] = useState({ x: 0, y: 0 });
  const [draft, setDraft] = useState(annotation.comment ?? "");
  const [draftColor, setDraftColor] = useState(noteIconColor(annotation.color));
  const [draftFontSize, setDraftFontSize] = useState<NoteFontSize>(noteFontSize(annotation.geometry.fontSize));
  const [preview, setPreview] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number }>();
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const anchor = dragAnchor ?? savedAnchor;
  const pos = { left: `${anchor.x * 100}%`, top: `${anchor.y * 100}%` };
  const iconColor = editing ? draftColor : noteIconColor(annotation.color);
  const previewFontPx = NOTE_FONT_PX[noteFontSize(annotation.geometry.fontSize)].preview;
  const editFontPx = NOTE_FONT_PX[draftFontSize].edit;
  const hasComment = Boolean(annotation.comment?.trim());

  draftRef.current = { comment: draft, color: draftColor, fontSize: draftFontSize };

  useEffect(() => {
    if (!dragAnchor) return;
    if (Math.abs(dragAnchor.x - savedAnchor.x) < 0.002 && Math.abs(dragAnchor.y - savedAnchor.y) < 0.002) {
      setDragAnchor(undefined);
    }
  }, [savedAnchor, dragAnchor]);

  useEffect(() => {
    if (!editing) return;
    setCardOffset({ x: 0, y: 0 });
    setDraft(annotation.comment ?? "");
    setDraftColor(noteIconColor(annotation.color));
    setDraftFontSize(noteFontSize(annotation.geometry.fontSize));
    inputRef.current?.focus();
  }, [editing, annotation.id]);

  useEffect(() => {
    if (!editing) return;
    return () => {
      const { comment, color, fontSize } = draftRef.current;
      onSaveRef.current(comment, color, fontSize);
    };
  }, [editing]);

  useEffect(() => {
    if (!menu) return;
    const close = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Element && target.closest(".sticky-note-menu")) return;
      setMenu(undefined);
    };
    const timer = window.setTimeout(() => window.addEventListener("pointerdown", close), 0);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("pointerdown", close);
    };
  }, [menu]);

  const commit = () => onSave(draft, draftColor, draftFontSize);

  const cycleColor = () => {
    const index = NOTE_COLORS.indexOf(draftColor);
    setDraftColor(NOTE_COLORS[(index + 1) % NOTE_COLORS.length]);
  };

  const beginIconDrag = (event: React.PointerEvent, host: HTMLElement) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    event.preventDefault();
    const hostRect = host.getBoundingClientRect();
    event.currentTarget.setPointerCapture(event.pointerId);
    iconDragRef.current = { px: event.clientX, py: event.clientY, ax: anchor.x, ay: anchor.y, hostW: hostRect.width, hostH: hostRect.height };
    moved.current = false;
  };

  const iconDragMove = (event: React.PointerEvent) => {
    const drag = iconDragRef.current;
    if (!drag) return;
    const dx = event.clientX - drag.px;
    const dy = event.clientY - drag.py;
    if (!moved.current && (Math.abs(dx) > DRAG_THRESHOLD || Math.abs(dy) > DRAG_THRESHOLD)) moved.current = true;
    if (!moved.current) return;
    setDraggingIcon(true);
    setDragAnchor({
      x: clamp01(drag.ax + dx / drag.hostW),
      y: clamp01(drag.ay + dy / drag.hostH),
    });
  };

  const iconDragEnd = (event: React.PointerEvent) => {
    const drag = iconDragRef.current;
    if (!drag) return;
    iconDragRef.current = undefined;
    try { event.currentTarget.releasePointerCapture(event.pointerId); } catch { /* already released */ }
    const dx = event.clientX - drag.px;
    const dy = event.clientY - drag.py;
    const next = moved.current
      ? { x: clamp01(drag.ax + dx / drag.hostW), y: clamp01(drag.ay + dy / drag.hostH) }
      : undefined;
    setDraggingIcon(false);
    if (next) {
      skipClick.current = true;
      setDragAnchor(next);
      onMove(next);
    } else {
      setDragAnchor(undefined);
    }
    moved.current = false;
  };

  const beginCardDrag = (event: React.PointerEvent) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    cardDragRef.current = { px: event.clientX, py: event.clientY, ox: cardOffset.x, oy: cardOffset.y };
  };

  const cardDragMove = (event: React.PointerEvent) => {
    const drag = cardDragRef.current;
    if (!drag) return;
    setDraggingCard(true);
    setCardOffset({
      x: drag.ox + event.clientX - drag.px,
      y: drag.oy + event.clientY - drag.py,
    });
  };

  const cardDragEnd = (event: React.PointerEvent) => {
    if (!cardDragRef.current) return;
    cardDragRef.current = undefined;
    try { event.currentTarget.releasePointerCapture(event.pointerId); } catch { /* already released */ }
    setDraggingCard(false);
  };

  const contextMenu = menu ? createPortal(
    <div
      className="pdf-context-menu sticky-note-menu"
      style={{ left: menu.x, top: menu.y }}
      onPointerDown={event => event.stopPropagation()}
      onContextMenu={event => event.preventDefault()}
    >
      <button type="button" onClick={() => { onEdit(); setMenu(undefined); }}>编辑</button>
      <button type="button" onClick={() => { void onCopy(); setMenu(undefined); }}>复制内容</button>
      <button type="button" onClick={() => { onDuplicate(); setMenu(undefined); }}>复制批注</button>
      <button type="button" onClick={() => { onDelete(); setMenu(undefined); }}>删除</button>
    </div>,
    document.body,
  ) : null;

  return <>
    <div className="sticky-note-root" style={pos}>
      <div
        className={`sticky-note-marker${selected ? " selected" : ""}${draggingIcon ? " dragging" : ""}`}
        style={{ color: iconColor }}
        onMouseEnter={() => { if (!editing) setPreview(true); }}
        onMouseLeave={() => setPreview(false)}
        onClick={event => {
          event.stopPropagation();
          if (skipClick.current) { skipClick.current = false; return; }
          onSelect(event);
        }}
        onDoubleClick={event => { event.stopPropagation(); onEdit(); }}
        onContextMenu={event => {
          event.preventDefault();
          event.stopPropagation();
          setMenu({ x: event.clientX, y: event.clientY });
        }}
        onPointerDown={event => beginIconDrag(event, event.currentTarget.closest(".continuous-annotation-layer") as HTMLElement)}
        onPointerMove={iconDragMove}
        onPointerUp={iconDragEnd}
      >
        <NoteMarkerIcon />
      </div>
      {preview && !editing && hasComment && (
        <div className="sticky-note-preview" style={{ fontSize: previewFontPx }}>
          <p>{annotation.comment}</p>
          {annotation.quote && <blockquote>{annotation.quote}</blockquote>}
        </div>
      )}
      {editing && (
        <div
          className={`sticky-note-card${draggingCard ? " dragging" : ""}`}
          style={{ transform: `translate(${cardOffset.x}px, ${cardOffset.y}px)` }}
          onPointerDown={event => event.stopPropagation()}
        >
          <header
            className="sticky-note-card-head"
            onPointerDown={event => {
              if ((event.target as Element).closest(".sticky-note-close")) return;
              beginCardDrag(event);
            }}
            onPointerMove={cardDragMove}
            onPointerUp={cardDragEnd}
          >
            <div className="sticky-note-card-meta">
              <strong>批注</strong>
              <small>{formatNoteTime(annotation.updatedAt)}</small>
            </div>
            <button type="button" className="sticky-note-close" aria-label="关闭" onClick={commit}>×</button>
          </header>
          <textarea
            ref={inputRef}
            className="sticky-note-card-input"
            style={{ fontSize: editFontPx }}
            value={draft}
            onChange={event => setDraft(event.target.value)}
            placeholder="添加或编辑评论…"
            onKeyDown={event => {
              if (event.key === "Escape") commit();
              if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) commit();
            }}
          />
          {annotation.quote && <blockquote className="sticky-note-quote">{annotation.quote}</blockquote>}
          <footer className="sticky-note-card-foot">
            <button
              type="button"
              className="sticky-note-color-dot"
              style={{ background: draftColor }}
              title="切换图标颜色"
              aria-label="切换图标颜色"
              onClick={cycleColor}
            />
            <select
              className="sticky-note-font-select"
              value={draftFontSize}
              onChange={event => setDraftFontSize(event.target.value as NoteFontSize)}
              aria-label="字号"
            >
              <option value="sm">小</option>
              <option value="md">中</option>
              <option value="lg">大</option>
            </select>
            <div className="sticky-note-card-actions">
              <button type="button" className="sticky-note-delete-icon" aria-label="删除" onClick={() => onDelete()} />
              <button type="button" className="primary" onClick={commit}>发送</button>
            </div>
          </footer>
        </div>
      )}
    </div>
    {contextMenu}
  </>;
}

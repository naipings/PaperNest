/** Same-window paper row drag payload. WebView2/Chromium often fails custom MIME-only DnD. */
const MIME = "application/x-papernest-papers";
const DROP_TARGET_EVENT = "papernest-folder-drop-target";

let activeIds: string[] = [];

export type PaperDropTargetKey = string | "unfiled" | undefined;

export function paperDragMime() {
  return MIME;
}

export function beginPaperDrag(ids: string[]) {
  activeIds = [...ids];
}

export function endPaperDrag() {
  activeIds = [];
  publishDropTarget(undefined);
}

export function peekPaperDragIds() {
  return activeIds;
}

export function isPaperDragActive() {
  return activeIds.length > 0;
}

export function writePaperDragTransfer(dataTransfer: DataTransfer, ids: string[]) {
  beginPaperDrag(ids);
  const payload = JSON.stringify(ids);
  dataTransfer.setData(MIME, payload);
  dataTransfer.setData("text/plain", payload);
  dataTransfer.effectAllowed = "move";
}

export function readPaperDragIds(dataTransfer?: DataTransfer | null): string[] {
  if (dataTransfer) {
    const raw = dataTransfer.getData(MIME) || dataTransfer.getData("text/plain");
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as unknown;
        if (Array.isArray(parsed) && parsed.every(item => typeof item === "string")) {
          return parsed;
        }
      } catch {
        /* fall through to in-memory ids */
      }
    }
  }
  return [...activeIds];
}

export function resolveDraggedPaperIds(rowId: string, checkedIds: ReadonlySet<string>): string[] {
  if (checkedIds.has(rowId) && checkedIds.size > 0) return [...checkedIds];
  return [rowId];
}

export function publishDropTarget(key: PaperDropTargetKey) {
  window.dispatchEvent(new CustomEvent<PaperDropTargetKey>(DROP_TARGET_EVENT, { detail: key }));
}

export function subscribeDropTarget(listener: (key: PaperDropTargetKey) => void) {
  const handler = (event: Event) => listener((event as CustomEvent<PaperDropTargetKey>).detail);
  window.addEventListener(DROP_TARGET_EVENT, handler);
  return () => window.removeEventListener(DROP_TARGET_EVENT, handler);
}

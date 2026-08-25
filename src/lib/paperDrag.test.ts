import { describe, expect, it } from "vitest";
import {
  beginPaperDrag,
  endPaperDrag,
  peekPaperDragIds,
  readPaperDragIds,
  resolveDraggedPaperIds,
  writePaperDragTransfer,
} from "./paperDrag";

describe("paperDrag", () => {
  it("moves checked set when the dragged row is checked", () => {
    expect(resolveDraggedPaperIds("a", new Set(["a", "b"]))).toEqual(["a", "b"]);
  });

  it("moves only the row when it is not checked", () => {
    expect(resolveDraggedPaperIds("c", new Set(["a", "b"]))).toEqual(["c"]);
  });

  it("prefers transfer payload and falls back to in-memory ids", () => {
    beginPaperDrag(["mem"]);
    expect(peekPaperDragIds()).toEqual(["mem"]);
    const transfer = {
      getData: (type: string) => (type === "text/plain" ? JSON.stringify(["t1", "t2"]) : ""),
    } as DataTransfer;
    expect(readPaperDragIds(transfer)).toEqual(["t1", "t2"]);
    expect(readPaperDragIds(null)).toEqual(["mem"]);
    endPaperDrag();
    expect(peekPaperDragIds()).toEqual([]);
  });

  it("writes both mime and plain text for WebView2", () => {
    const stored: Record<string, string> = {};
    const transfer = {
      setData: (type: string, value: string) => { stored[type] = value; },
      effectAllowed: "none",
    } as DataTransfer;
    writePaperDragTransfer(transfer, ["p1"]);
    expect(stored["application/x-papernest-papers"]).toBe(JSON.stringify(["p1"]));
    expect(stored["text/plain"]).toBe(JSON.stringify(["p1"]));
    expect(transfer.effectAllowed).toBe("move");
    expect(peekPaperDragIds()).toEqual(["p1"]);
    endPaperDrag();
  });
});

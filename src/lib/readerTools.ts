export type ReaderTool = "select" | "highlight" | "underline" | "note" | "ink";

export function readerToolLabel(tool: ReaderTool) {
  switch (tool) {
    case "select": return "选择";
    case "highlight": return "高亮";
    case "underline": return "下划线";
    case "note": return "批注";
    case "ink": return "手绘";
  }
}

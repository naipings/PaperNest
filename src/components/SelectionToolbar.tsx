import { Trash2 } from "lucide-react";

export function SelectionToolbar({ x, y, mode, onHighlight, onUnderline, onTerm, onExcerpt, onDelete, onClose }: {
  x: number;
  y: number;
  mode: "text" | "annotation";
  onHighlight?(): void;
  onUnderline?(): void;
  onTerm?(): void;
  onExcerpt?(): void;
  onDelete?(): void;
  onClose(): void;
}) {
  return <div className="selection-toolbar" onMouseDown={event => event.preventDefault()} style={{ left: x, top: Math.max(4, y) }}>
    {mode === "annotation" ? <>
      <button title="删除批注" onClick={onDelete}><Trash2 size={14} /> 删除</button>
      <button title="关闭" onClick={onClose}>×</button>
    </> : <>
      <button title="高亮" onClick={onHighlight}>高亮</button>
      <button title="下划线" onClick={onUnderline}>下划线</button>
      <button title="Ctrl+Alt+T" onClick={onTerm}>收为术语</button>
      <button onClick={onExcerpt}>加入写作库</button>
      <button title="关闭" onClick={onClose}>×</button>
    </>}
  </div>;
}

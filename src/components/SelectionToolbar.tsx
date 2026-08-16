export const HIGHLIGHT_COLORS = ["#f2ce67", "#8bd17c", "#f4a4c0", "#7eb6ff", "#f0a05a"];

export function SelectionToolbar({ x, y, mode, highlightAction, underlineAction, noteAction, color, onColor, onHighlight, onUnderline, onNote, onDelete, onCopy, onTerm, onExcerpt, onClip, onClose }: {
  x: number;
  y: number;
  mode: "text" | "annotation";
  highlightAction?: "add" | "remove";
  underlineAction?: "add" | "remove";
  noteAction?: "add" | "remove";
  color?: string;
  onColor?(color: string): void;
  onHighlight?(): void;
  onUnderline?(): void;
  onNote?(): void;
  onDelete?(): void;
  onCopy?(): void;
  onTerm?(): void;
  onExcerpt?(): void;
  onClip?(): void;
  onClose(): void;
}) {
  return <div className="selection-toolbar" onMouseDown={event => event.preventDefault()} style={{ left: x, top: Math.max(4, y) }}>
    {highlightAction === "add" && <button title="高亮" onClick={onHighlight}>高亮</button>}
    {highlightAction === "remove" && <button title="取消高亮" onClick={onHighlight}>取消高亮</button>}
    {highlightAction === "add" && onColor && <span className="selection-colors">
      {HIGHLIGHT_COLORS.map(item => (
        <button key={item} className={item === color ? "active" : ""} title={item} style={{ background: item }} onClick={() => onColor(item)} />
      ))}
      <label title="自定义颜色"><input type="color" value={color ?? "#f2ce67"} onChange={event => onColor(event.target.value)} /></label>
    </span>}
    {underlineAction === "add" && <button title="下划线" onClick={onUnderline}>下划线</button>}
    {underlineAction === "remove" && <button title="取消下划线" onClick={onUnderline}>取消下划线</button>}
    {noteAction === "add" && <button title="添加文本批注" onClick={onNote}>批注</button>}
    {noteAction === "remove" && <button title="取消批注" onClick={onNote}>取消批注</button>}
    {onDelete && <button title="删除" onClick={onDelete}>删除</button>}
    {mode === "text" && onCopy && <button title="复制选区" onClick={onCopy}>复制</button>}
    {mode === "text" && onClip && <button title="送入右侧编辑框整理" onClick={onClip}>送入编辑框</button>}
    {mode === "text" && onTerm && <button title="Ctrl+Alt+T" onClick={onTerm}>收为术语</button>}
    {mode === "text" && onExcerpt && <button onClick={onExcerpt}>加入写作库</button>}
    <button title="关闭" onClick={onClose}>×</button>
  </div>;
}

import type { Rect } from "../types";

/** 将 getClientRects 的多段矩形按行合并，减少高亮碎块。 */
export function mergeSelectionRects(rects: Rect[]): Rect[] {
  const valid = rects.filter(rect => rect.width > 0.0005 && rect.height > 0.0005);
  if (!valid.length) return [];
  const sorted = [...valid].sort((a, b) => a.y - b.y || a.x - b.x);
  const lines: Rect[][] = [];
  for (const rect of sorted) {
    const midY = rect.y + rect.height / 2;
    const line = lines.find(group => {
      const base = group[0];
      const baseMid = base.y + base.height / 2;
      return Math.abs(baseMid - midY) <= Math.max(base.height, rect.height) * 0.6;
    });
    if (line) line.push(rect);
    else lines.push([rect]);
  }
  return lines.map(group => {
    const x = Math.min(...group.map(item => item.x));
    const y = Math.min(...group.map(item => item.y));
    const right = Math.max(...group.map(item => item.x + item.width));
    const bottom = Math.max(...group.map(item => item.y + item.height));
    return { x, y, width: right - x, height: bottom - y };
  });
}

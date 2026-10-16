export type MarkdownBlock = { start: number; end: number };

type Line = { text: string; start: number; end: number };

function linesOf(text: string): Line[] {
  const lines: Line[] = [];
  let start = 0;
  for (let index = 0; index <= text.length; index++) {
    if (index !== text.length && text[index] !== "\n") continue;
    const raw = text.slice(start, index);
    const content = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
    lines.push({ text: content, start, end: start + raw.length });
    start = index + 1;
    if (index === text.length) break;
  }
  return lines;
}

function isFence(line: string) {
  return /^(\s*)(`{3,}|~{3,})/.exec(line);
}

function closesFence(line: string, marker: string, length: number) {
  return new RegExp(`^\\s*${marker}{${length},}\\s*$`).test(line);
}

function listMarker(line: string) {
  return /^(\s*)(?:[-*+]|\d+[.)])\s+/.exec(line);
}

/** 按可独立编辑的片段切分，片段之间的空白保持原样。 */
export function splitMarkdownBlocks(text: string): MarkdownBlock[] {
  const lines = linesOf(text);
  const blocks: MarkdownBlock[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (!line.text.trim()) {
      index += 1;
      continue;
    }
    const start = line.start;
    const fence = isFence(line.text);
    if (fence) {
      const marker = fence[2][0];
      index += 1;
      while (index < lines.length && !closesFence(lines[index].text, marker, fence[2].length)) index += 1;
      if (index < lines.length) index += 1;
      blocks.push({ start, end: lines[index - 1].end });
      continue;
    }
    if (/^\s*\$\$\s*$/.test(line.text)) {
      index += 1;
      while (index < lines.length && !/^\s*\$\$\s*$/.test(lines[index].text)) index += 1;
      if (index < lines.length) index += 1;
      blocks.push({ start, end: lines[index - 1].end });
      continue;
    }
    if (/^\s*\|/.test(line.text)) {
      while (index < lines.length && /^\s*\|/.test(lines[index].text)) index += 1;
      blocks.push({ start, end: lines[index - 1].end });
      continue;
    }
    const item = listMarker(line.text);
    if (item) {
      const indent = item[1].length;
      index += 1;
      while (index < lines.length) {
        const next = lines[index].text;
        if (!next.trim()) break;
        const nextItem = listMarker(next);
        if (nextItem && nextItem[1].length <= indent) break;
        if (!nextItem && !/^\s/.test(next)) break;
        index += 1;
      }
      blocks.push({ start, end: lines[index - 1].end });
      continue;
    }
    if (/^#{1,6}\s/.test(line.text)) {
      blocks.push({ start, end: line.end });
      index += 1;
      continue;
    }
    index += 1;
    while (index < lines.length && lines[index].text.trim() && !isFence(lines[index].text) && !/^\s*\|/.test(lines[index].text) && !listMarker(lines[index].text) && !/^#{1,6}\s/.test(lines[index].text)) {
      index += 1;
    }
    blocks.push({ start, end: lines[index - 1].end });
  }
  return blocks;
}

export function replaceMarkdownBlock(text: string, index: number, nextSource: string) {
  const block = splitMarkdownBlocks(text)[index];
  if (!block) return text;
  return text.slice(0, block.start) + nextSource + text.slice(block.end);
}

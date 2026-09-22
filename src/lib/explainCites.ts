/** 与 ExplainPanel / 后端 extract_cites 对齐的页码抽取与 Markdown 链接化。 */

const PAGE_TOKEN = String.raw`P\.?\s*(\d+)`;
const RANGE = new RegExp(String.raw`\(?\b${PAGE_TOKEN}\s*[-–—~～到至]\s*P?\.?\s*(\d+)\)?`, "gi");
const PAREN_LIST = new RegExp(String.raw`\(\s*${PAGE_TOKEN}(?:\s*[,，、/]\s*${PAGE_TOKEN})+\s*\)`, "gi");
const SINGLE = new RegExp(String.raw`\b${PAGE_TOKEN}\b`, "gi");
const CHINESE = /第\s*(\d+)\s*页/g;
const ANY_CITE = new RegExp(
  String.raw`(?:\(?\b${PAGE_TOKEN}\s*[-–—~～到至]\s*P?\.?\s*(\d+)\)?)|(?:\(\s*${PAGE_TOKEN}(?:\s*[,，、/]\s*${PAGE_TOKEN})+\s*\))|(?:\b${PAGE_TOKEN}\b)|(?:第\s*(\d+)\s*页)`,
  "gi",
);

function pushPage(pages: number[], seen: Set<number>, page: number) {
  if (page > 0 && page < 10_000 && !seen.has(page)) {
    seen.add(page);
    pages.push(page);
  }
}

export function extractExplainCites(text: string): number[] {
  const pages: number[] = [];
  const seen = new Set<number>();
  const walker = new RegExp(ANY_CITE.source, "gi");
  let match: RegExpExecArray | null;
  while ((match = walker.exec(text))) {
    const nums = match[0].match(/\d+/g) ?? [];
    for (const raw of nums) pushPage(pages, seen, Number(raw));
  }
  return pages;
}

/** 把页码引用改成 Markdown 链接，供 react-markdown 渲染后点击跳转。 */
export function linkifyExplainPageRefs(text: string): string {
  const protectedChunks: string[] = [];
  let out = text.replace(/```[\s\S]*?```|`[^`]+`/g, chunk => {
    protectedChunks.push(chunk);
    return `\u0000MD${protectedChunks.length - 1}\u0000`;
  });

  out = out.replace(new RegExp(RANGE.source, "gi"), (_whole, a: string, b: string) => {
    const p1 = Number(a);
    const p2 = Number(b);
    return `[P${p1}](#pn-${p1})–[P${p2}](#pn-${p2})`;
  });

  out = out.replace(new RegExp(PAREN_LIST.source, "gi"), whole => {
    const num = new RegExp(PAGE_TOKEN, "gi");
    const links: string[] = [];
    let pageMatch: RegExpExecArray | null;
    while ((pageMatch = num.exec(whole))) {
      const page = Number(pageMatch[1]);
      links.push(`[P${page}](#pn-${page})`);
    }
    return `(${links.join(", ")})`;
  });

  out = out.replace(new RegExp(CHINESE.source, "g"), (_whole, page: string) => {
    const n = Number(page);
    return `[第 ${n} 页](#pn-${n})`;
  });

  out = out.replace(new RegExp(SINGLE.source, "gi"), (whole, page: string, offset: number, source: string) => {
    if (source.slice(Math.max(0, offset - 1), offset) === "[" && source.slice(offset + whole.length, offset + whole.length + 1) === "]") {
      return whole;
    }
    if (source.slice(offset + whole.length, offset + whole.length + 5).startsWith("](#pn")) {
      return whole;
    }
    const n = Number(page);
    return `[P${n}](#pn-${n})`;
  });

  out = out.replace(/\u0000MD(\d+)\u0000/g, (_whole, index: string) => protectedChunks[Number(index)] ?? "");
  return out;
}

export function parseExplainPageHref(href: string | undefined): number | undefined {
  if (!href) return undefined;
  const match = href.match(/^#pn-(\d+)$/i);
  if (!match) return undefined;
  const page = Number(match[1]);
  return page > 0 && page < 10_000 ? page : undefined;
}

/**
 * 收紧侧栏解读用 Markdown：
 * 1) 去掉多余空行（模型常在列表项之间插空行，会变成「松散列表」大留白）
 * 2) 把「1.\\n\\n正文」拼回同一列表项
 */
export function compactExplainMarkdown(text: string): string {
  let out = text.replace(/\r\n/g, "\n").trim();
  out = out.replace(/\n{3,}/g, "\n\n");
  // 孤立的「1.」/「-」后紧跟正文 → 合并到同一行（不用 \s，避免吃掉换行）
  out = out.replace(/^([ \t]*(?:\d+[.)]|[-*+])[ \t]*)\n+(?=\S)/gm, (_, marker: string) => `${marker.trimEnd()} `);
  // 标题 / 普通段落后紧跟列表时去掉空行
  out = out.replace(/^(#{1,6}[ \t].+|[^\n]+)\n\n(?=[ \t]*(?:[-*+]|\d+[.)])[ \t])/gm, "$1\n");
  // 相邻列表项之间不要空行（避免 loose list 每项包 <p>）
  out = out.replace(/^([ \t]*(?:[-*+]|\d+[.)]).+)\n\n(?=[ \t]*(?:[-*+]|\d+[.)])[ \t])/gm, "$1\n");
  return out;
}

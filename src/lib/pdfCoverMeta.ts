export type PdfInfoMeta = { Title?: string; Author?: string; CreationDate?: string; Subject?: string };
export type PdfTextRun = { str: string; fontSize: number; x: number; y: number; width?: number; hasEOL?: boolean };
export type PdfCoverMeta = {
  titleEn?: string;
  titleZh?: string;
  authors: string[];
  publicationDate?: string;
  doi?: string;
  arxivId?: string;
  abstractEn?: string;
  venue?: string;
  pageCount?: number;
};

const JUNK_TITLE = /^(untitled|microsoft word|document|unknown|null)$/i;
const JUNK_AUTHOR = /^(adobe|acrobat|microsoft|word|user|unknown|author)$/i;
const SKIP_LINE = /^(arxiv:|doi:|published as|under review|preprint|licensed under|copyright|abstract|keywords|introduction|university|department|institute|college)\b/i;
const AFFILIATION = /@|university|department|institute|college|laboratory|ltd\.|inc\.|google brain|deepmind|openai/i;
const CJK = /[\u4e00-\u9fff]/;

export function inferCoverMeta(runs: PdfTextRun[], info: PdfInfoMeta = {}, rawText = ""): PdfCoverMeta {
  const fromText = inferFromRuns(runs);
  const infoTitle = cleanTitle(info.Title);
  const infoAuthors = splitAuthors(info.Author).filter(name => !JUNK_AUTHOR.test(name));
  const runTitle = fromText.title && looksLikeTitleFragment(fromText.title) ? undefined : fromText.title;
  const title = runTitle || infoTitle;
  const authors = fromText.authors.length ? fromText.authors : infoAuthors;
  const publicationDate = fromText.publicationDate || parsePdfDate(info.CreationDate);
  const rawDoi = rawText.match(/\b10\.\d{4,9}\/[^\s]+/i)?.[0]?.replace(/[),.;]+$/, "");
  const doi = fromText.doi || rawDoi;
  return {
    titleEn: title && !isMostlyCjk(title) ? title : fromText.titleEn && !looksLikeTitleFragment(fromText.titleEn) ? fromText.titleEn : undefined,
    titleZh: title && isMostlyCjk(title) ? title : undefined,
    authors,
    publicationDate,
    doi,
    arxivId: fromText.arxivId,
    abstractEn: pickAbstract(fromText.abstractEn, extractAbstractFromRaw(rawText), subjectAsAbstract(info.Subject)),
    venue: fromText.venue || extractVenue(rawText) || venueFromDoi(doi)
  };
}

export function looksBetterTitle(candidate: string, current: string) {
  const next = candidate.trim();
  const prev = current.trim();
  if (!next || JUNK_TITLE.test(next)) return false;
  if (!prev || JUNK_TITLE.test(prev) || prev.length < 8) return true;
  if (next === prev) return false;
  const fileLike = /^[\w.-]+$/.test(prev) || prev.split(/\s+/).length <= 4 && !/[.:,]/.test(prev) && prev.length < 40;
  if (fileLike && next.length > prev.length) return true;
  return next.length >= 12 && next.length > prev.length * 0.8;
}

function inferFromRuns(runs: PdfTextRun[]) {
  const lines = clusterLines(runs);
  const blob = lines.map(line => line.text).join("\n");
  const doi = blob.match(/\b10\.\d{4,9}\/[^\s]+/i)?.[0]?.replace(/[),.;]+$/, "");
  const arxivId = blob.match(/\barxiv[:\s]+(\d{4}\.\d{4,5}(?:v\d+)?)/i)?.[1];
  const venue = extractVenue(blob) || venueFromDoi(doi);
  if (!lines.length) return { title: undefined, titleEn: undefined, authors: [] as string[], publicationDate: yearFromArxiv(arxivId), doi, arxivId, abstractEn: undefined, venue };
  const abstractAt = lines.findIndex(line => ABSTRACT_HEAD_LINE.test(line.text));
  const titleRegion = abstractAt >= 0 ? lines.slice(0, abstractAt) : lines;
  const titleSizes = titleRegion.length ? titleRegion.map(line => line.fontSize) : lines.map(line => line.fontSize);
  const maxSize = Math.max(...titleSizes.filter(size => size > 0), 0);
  const yMax = Math.max(...lines.map(line => line.y));
  const yMin = Math.min(...lines.map(line => line.y));
  const topCut = yMin + (yMax - yMin) * 0.45;
  const titleIndex = titleRegion.findIndex(line =>
    line.y >= topCut
    && line.fontSize >= maxSize * 0.86
    && !SKIP_LINE.test(line.text)
    && !isDropCapLine(line.text)
    && line.text.length > 6
  );
  const titleLines: string[] = [];
  if (titleIndex >= 0) {
    for (let index = titleIndex; index < titleRegion.length; index++) {
      const line = titleRegion[index];
      if (line.fontSize < maxSize * 0.78 || SKIP_LINE.test(line.text) || AFFILIATION.test(line.text) || isDropCapLine(line.text)) break;
      titleLines.push(line.text);
      if (titleLines.join(" ").length > 180) break;
    }
  }
  const title = cleanTitle(titleLines.join(" "));
  const after = titleIndex >= 0 ? lines.slice(titleIndex + titleLines.length) : lines;
  const authorLines: string[] = [];
  for (const line of after) {
    if (/^(abstract|摘要|keywords|introduction)\b/i.test(line.text)) break;
    if (AFFILIATION.test(line.text) && authorLines.length) break;
    if (SKIP_LINE.test(line.text) || AFFILIATION.test(line.text) || line.fontSize < maxSize * 0.42) continue;
    if (/^[\d\s,+*†‡§¶.-]+$/.test(line.text)) continue;
    if (line.text.length > 140) break;
    authorLines.push(line.text);
    if (authorLines.length >= 4) break;
  }
  const authors = authorLines.flatMap(splitAuthors).filter(name => isAuthorName(name)).slice(0, 12);
  const year = blob.match(/\b(19|20)\d{2}\b/)?.[0];
  return { title, titleEn: title && !isMostlyCjk(title) ? title : undefined, authors, publicationDate: yearFromArxiv(arxivId) || year, doi, arxivId, abstractEn: extractAbstract(lines, runs), venue };
}

function clusterLines(runs: PdfTextRun[]) {
  const sorted = [...runs].filter(run => run.str.length).sort((left, right) => right.y - left.y || left.x - right.x);
  const lines: { text: string; fontSize: number; y: number; endX: number; hasEOL: boolean }[] = [];
  for (const run of sorted) {
    const current = lines.at(-1);
    const width = run.width ?? run.str.length * run.fontSize * 0.5;
    const sameLine = current && !current.hasEOL && Math.abs(current.y - run.y) <= Math.max(2.4, run.fontSize * 0.28);
    if (sameLine) {
      const gap = run.x - current.endX;
      const tiny = run.fontSize < current.fontSize * 0.72 && /^[\d*†‡§¶]+$/.test(run.str.trim());
      if (tiny) {
        current.endX = run.x + width;
        current.hasEOL = Boolean(run.hasEOL);
        continue;
      }
      let sep = "";
      if (!/\s$/.test(current.text) && !/^\s/.test(run.str)) {
        const dropCap = /^[A-Z]$/.test(current.text.trim()) && current.fontSize >= run.fontSize * 1.45 && /^[a-z]/.test(run.str);
        if (dropCap) sep = "";
        else if (gap > run.fontSize * 6) sep = ", ";
        else if (gap > run.fontSize * 0.12) sep = " ";
      }
      if (current.text.endsWith("-") && /^[a-z]/.test(run.str)) current.text = current.text.slice(0, -1) + run.str;
      else current.text += sep + run.str;
      current.fontSize = Math.max(current.fontSize, run.fontSize);
      current.endX = run.x + width;
      current.hasEOL = Boolean(run.hasEOL);
    } else {
      lines.push({ text: run.str, fontSize: run.fontSize, y: run.y, endX: run.x + width, hasEOL: Boolean(run.hasEOL) });
    }
  }
  return lines.map(line => ({ ...line, text: tightenLine(line.text) })).filter(line => line.text);
}

function tightenLine(text: string) {
  return text.replace(/\s+/g, " ").trim().replace(/摘\s*要/g, "摘要").replace(/\b(?:[A-Za-z]\s+){2,}[A-Za-z]\b/g, chunk => chunk.replace(/\s+/g, ""));
}

function splitAuthors(value?: string) {
  if (!value?.trim()) return [];
  return value
    .replace(/,?\s*(?:(?:senior|life|student)\s+)?(?:member|fellow),?\s*ieee/gi, " ")
    .replace(/(?:^|[\s,;])(?:\d{1,2}|[*†‡§¶]+)(?=[\s,;]|$)/g, " ")
    .split(/\s*(?:,|;|&| and )\s*/i)
    .map(name => name.replace(/^[∗*†‡§¶\d\s]+|[∗*†‡§¶\d\s]+$/g, "").replace(/^and\s+/i, "").replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function isAuthorName(name: string) {
  if (name.length < 2 || JUNK_AUTHOR.test(name)) return false;
  if (/^[\d\s.+*†‡§¶,-]+$/.test(name)) return false;
  if (/^(?:(?:senior|life|student)\s+)?(?:member|fellow)(?:,?\s*ieee)?$|^ieee$/i.test(name)) return false;
  if ((name.match(/[A-Za-z\u4e00-\u9fff]/g) ?? []).length < 2) return false;
  return true;
}

function cleanTitle(value?: string) {
  const title = value?.replace(/\s+/g, " ").trim();
  if (!title || JUNK_TITLE.test(title) || title.length < 8) return undefined;
  if (/^microsoft word/i.test(title)) return undefined;
  if (looksLikeTitleFragment(title)) return undefined;
  return title;
}

function isDropCapLine(text: string) {
  return /^[A-Z]$/.test(text.trim()) || /^[A-Z]\s+[a-z]{2,}/.test(text.trim());
}

/** Drop-cap / mid-sentence scraps that IEEE text extraction sometimes promotes to titles. */
function looksLikeTitleFragment(value: string) {
  const title = value.trim();
  if (!title) return false;
  if (/^[A-Z]\s+[a-z]/.test(title)) return true;
  if (/-\s*$/.test(title)) return true;
  if (/^(both|while|however|therefore|moreover|furthermore)\b/i.test(title)) return true;
  return false;
}

function parsePdfDate(value?: string) {
  const match = value?.match(/D:(\d{4})(\d{2})?(\d{2})?/);
  if (!match) return undefined;
  const [, year, month, day] = match;
  if (month && day) return `${year}-${month}-${day}`;
  if (month) return `${year}-${month}`;
  return year;
}

function yearFromArxiv(arxivId?: string) {
  const match = arxivId?.match(/^(\d{2})(\d{2})\./);
  if (!match) return undefined;
  const year = Number(match[1]);
  const month = match[2];
  return `${year >= 90 ? "19" : "20"}${match[1]}-${month}`;
}

function isMostlyCjk(value: string) {
  const chars = value.replace(/\s/g, "");
  return [...chars].filter(char => CJK.test(char)).length >= chars.length * 0.4;
}

const SECTION_WORD = "keywords?|key words|index terms|ccs concepts|categories and subject descriptors|acm reference format|introduction|引言|简介";
const ABSTRACT_STOP = new RegExp(`^(?:(?:\\d{1,2}|[ivx]{1,4})[.)]?\\s*)?(?:${SECTION_WORD})\\b`, "i");
/** `\b` misses `KoreaABSTRACTIn…`; also allow Abstract glued to a following capital. */
const RAW_ABSTRACT_HEAD = /(?:^|[^A-Za-z])abstract(?:[:.\s—–-]+|(?=[A-Z]))|(?<=[a-z])abstract(?=[A-Z])|摘要[:.\s—–-]*/i;
/** Mid-text stop needs heading punctuation after Keywords — bare `keyword` appears inside abstracts. */
const RAW_SECTION_WORD = "keywords?\\s*[:.—–-]|key words\\s*[:.—–-]|index terms|ccs concepts|categories and subject descriptors|acm reference format|introduction|引言|简介";
const RAW_ABSTRACT_STOP = new RegExp(`(^|[\\s.;])(?:(?:\\d{1,2}|[IVX]{1,4})[.)]?\\s*)?(?:${RAW_SECTION_WORD})\\b`, "i");
const ABSTRACT_HEAD_LINE = /^[\s\d.)]*(?:a\s?b\s?s\s?t\s?r\s?a\s?c\s?t|摘\s?要)[\s:.—–-]*/i;
const CCS_SHAPE = /information systems\s*(?:→|->|\$\\rightarrow\$)|computing methodologies\s*(?:→|->|\$\\rightarrow\$)|\\textbullet/i;

/** PDF.js splits small-caps headings such as "1 INTRODUCTION" into "1 I NTRODUCTION". */
function unsplitSmallCaps(text: string) {
  return text.replace(/\b([A-Z])\s+([A-Z]{2,})/g, "$1$2");
}

function isAbstractStop(text: string) {
  return ABSTRACT_STOP.test(text) || ABSTRACT_STOP.test(unsplitSmallCaps(text));
}

export function cleanAbstractText(value?: string) {
  if (!value?.trim()) return undefined;
  if (CCS_SHAPE.test(value) && !/\b(we|this paper|this work|propose|present|study)\b/i.test(value)) return undefined;
  const paragraphs = value
    .split(/\n{2,}/)
    .map(part => part
      .replace(/\\textbullet\b/gi, " ")
      .replace(/\$\\(?:rightarrow|leftarrow|to)\$/gi, " → ")
      .replace(/\\(?:rightarrow|leftarrow|to)\b/gi, " → ")
      .replace(/\\[a-z]+\*?(\[[^\]]*\])?(\{[^}]*\})?/gi, " ")
      .replace(/\$[^$]*\$/g, " ")
      .replace(/\s+/g, " ")
      .trim())
    .filter(Boolean);
  let text = paragraphs.join("\n\n");
  const flatSource = unsplitSmallCaps(text.replace(/\n+/g, " "));
  const flat = ` ${flatSource}`;
  const stop = RAW_ABSTRACT_STOP.exec(flat);
  if (stop) text = flat.slice(1, stop.index + stop[1].length).trim();
  if (text.replace(/\s+/g, " ").trim().length < 40) return undefined;
  if (CCS_SHAPE.test(text)) return undefined;
  const letterCount = (text.match(/[A-Za-z\u4e00-\u9fff]/g) ?? []).length;
  if (letterCount < 40) return undefined;
  return text;
}

export function stitchPdfParagraphs(lines: { text: string; y: number }[]) {
  if (!lines.length) return "";
  const gaps = lines.slice(1).map((line, index) => lines[index].y - line.y).filter(gap => gap > 0).sort((left, right) => left - right);
  const typical = gaps[Math.floor(gaps.length / 2)] || 12;
  const paragraphs: string[] = [];
  let current = "";
  for (let index = 0; index < lines.length; index++) {
    let line = lines[index].text.replace(/\s+/g, " ").trim();
    if (!line) continue;
    // Rejoin IEEE drop-cap: "W" + "hile these..." → "While these..."
    if (/^[A-Z]$/.test(current) && /^[a-z]/.test(line)) {
      current = current + line;
      continue;
    }
    if (index > 0 && lines[index - 1].y - lines[index].y > typical * 1.75 && current) {
      paragraphs.push(current);
      current = line;
      continue;
    }
    if (!current) current = line;
    else if (current.endsWith("-") && /^[a-z]/.test(line)) current = current.slice(0, -1) + line;
    else if (CJK.test(current.slice(-1)) && CJK.test(line[0])) current += line;
    else current += " " + line;
  }
  if (current) paragraphs.push(current);
  return paragraphs.join("\n\n");
}

function extractAbstract(lines: { text: string; y: number }[], runs: PdfTextRun[] = []) {
  // Page-2 runs are shifted by -10000 in readCover; keep page 1 only for Abstract.
  const pageRuns = runs.filter(run => run.y > -100);
  if (pageRuns.length) {
    const usable = pageRuns.filter(run => run.str.length);
    const absY = abstractHeadingY(usable);
    const splitX = absY !== undefined
      ? columnGutterX(usable, { yMax: absY - 1, yMin: absY - 120, maxFont: 12 })
        ?? columnGutterX(usable, { yMax: absY - 1, maxFont: 12 })
        ?? columnGutterX(usable)
      : columnGutterX(usable);
    if (splitX !== undefined && absY !== undefined) {
      const layout = detectAbstractLayout(usable, splitX, absY);
      if (layout === "two-column-flow") {
        const text = extractTwoColumnFlowAbstract(usable, splitX, absY);
        if (text && !looksPollutedAbstract(text)) return text;
      }
    }
  }
  const scoped = pageRuns.length ? clusterLines(runsInAbstractColumn(pageRuns)) : lines;
  let start = -1;
  let first = "";
  for (let index = 0; index < scoped.length; index++) {
    const head = ABSTRACT_HEAD_LINE.exec(scoped[index].text);
    if (!head) continue;
    start = index;
    first = scoped[index].text.slice(head[0].length).trim();
    break;
  }
  if (start >= 0) {
    const body = first ? [{ text: first, y: scoped[start].y }] : [];
    for (let index = start + 1; index < scoped.length; index++) {
      if (isAbstractStop(scoped[index].text) || isAbstractFooter(scoped[index].text)) break;
      body.push(scoped[index]);
      if (stitchPdfParagraphs(body).length > 2800) break;
    }
    const text = cleanAbstractText(stitchPdfParagraphs(body));
    if (text && !looksPollutedAbstract(text)) return text;
  }
  return extractAbstractFromRaw(scoped.map(line => line.text).join("\n"));
}

/** IEEE journal: left column holds most of Abstract; right column above Index Terms holds the ending. */
function extractTwoColumnFlowAbstract(runs: PdfTextRun[], splitX: number, absY: number) {
  const leftLines = clusterLines(runs.filter(run => run.x < splitX));
  const rightLines = clusterLines(runs.filter(run => run.x >= splitX));
  const absIndex = leftLines.findIndex(line => ABSTRACT_HEAD_LINE.test(line.text) || line.y >= absY - 1 && line.y <= absY + 2 && /abstract/i.test(line.text));
  const start = absIndex >= 0 ? absIndex : leftLines.findIndex(line => line.y <= absY + 2 && line.y >= absY - 2);
  if (start < 0) return undefined;
  const leftBody = takeAbstractLines(leftLines, start);
  const rightBody: { text: string; y: number }[] = [];
  for (const line of rightLines) {
    if (line.y > absY + 3) continue;
    if (isAbstractStop(line.text) || isAbstractFooter(line.text)) break;
    if (SKIP_LINE.test(line.text) || AFFILIATION.test(line.text)) continue;
    if (line.fontSize >= 14) continue;
    rightBody.push(line);
  }
  return cleanAbstractText(`${stitchPdfParagraphs(leftBody)} ${stitchPdfParagraphs(rightBody)}`.trim());
}

function takeAbstractLines(lines: { text: string; y: number; fontSize?: number }[], start: number) {
  const head = ABSTRACT_HEAD_LINE.exec(lines[start].text);
  const first = head ? lines[start].text.slice(head[0].length).trim() : "";
  const body = first ? [{ text: first, y: lines[start].y }] : [];
  for (let index = start + 1; index < lines.length; index++) {
    if (isAbstractStop(lines[index].text) || isAbstractFooter(lines[index].text)) break;
    body.push(lines[index]);
    if (stitchPdfParagraphs(body).length > 2800) break;
  }
  return body;
}

function isAbstractFooter(text: string) {
  return /^(?:manuscript received|date of publication|date of current version|authorized licensed|this work was supported|©|\(c\)\s*\d{4})/i.test(text.trim());
}

/** Two-column pages sort left+right into one line; keep only the Abstract column.
 * Full-width wrapped lines (hyphen across gutter) keep both sides. */
function runsInAbstractColumn(runs: PdfTextRun[]) {
  const usable = runs.filter(run => run.str.length);
  if (usable.length < 4) return usable;
  const absY = abstractHeadingY(usable);
  const splitX = absY !== undefined
    ? columnGutterX(usable, { yMax: absY - 1, yMin: absY - 120, maxFont: 12 })
      ?? columnGutterX(usable, { yMax: absY - 1, maxFont: 12 })
      ?? columnGutterX(usable)
    : columnGutterX(usable);
  if (splitX === undefined) return usable;
  const layout = absY !== undefined ? detectAbstractLayout(usable, splitX, absY) : "single";
  if (layout === "full-width") return usable;
  const lines = clusterLines(usable);
  const absLine = lines.find(line => ABSTRACT_HEAD_LINE.test(line.text));
  if (!absLine) return usable;
  const near = usable.filter(run => Math.abs(run.y - absLine.y) <= Math.max(2.4, run.fontSize * 0.35));
  const anchorX = near.length ? Math.min(...near.map(run => run.x)) : Math.min(...usable.map(run => run.x));
  if (anchorX < splitX) return usable.filter(run => run.x < splitX);
  return usable.filter(run => run.x >= splitX);
}

function abstractHeadingY(runs: PdfTextRun[]) {
  const hit = runs.find(run => ABSTRACT_HEAD_LINE.test(run.str) || /^abstract$/i.test(run.str.trim()));
  return hit?.y;
}

/**
 * full-width: same visual line wraps across gutter (sys- | tems)
 * two-column-flow: left column then right stub above Index Terms (IEEE TKDE)
 * single: Abstract only on one side
 */
function detectAbstractLayout(runs: PdfTextRun[], splitX: number, absY: number): "full-width" | "two-column-flow" | "single" {
  const rightFromAbs = clusterLines(runs.filter(run => run.x >= splitX)).filter(line => line.y <= absY + 3);
  const stopAt = rightFromAbs.findIndex(line => isAbstractStop(line.text));
  if (stopAt > 0 && stopAt <= 5) {
    const stub = rightFromAbs.slice(0, stopAt).map(line => line.text).join(" ").replace(/\s+/g, " ").trim();
    if (/^[a-z]/.test(stub)) return "two-column-flow";
  }

  const below = runs.filter(run => run.y < absY - 1 && run.y > absY - 90 && !ABSTRACT_HEAD_LINE.test(run.str));
  if (!below.length) return "single";
  const firstY = Math.max(...below.map(run => run.y));
  const band = below.filter(run => Math.abs(run.y - firstY) <= Math.max(2.4, run.fontSize * 0.35));
  const left = band.some(run => run.x < splitX);
  const right = band.some(run => run.x >= splitX);
  if (left && right) return "full-width";
  return "single";
}

/** Largest horizontal gap between text x-origins; absent on single-column pages.
 * Prefer body runs below the Abstract band so author lines spanning the page do not hide the gutter. */
function columnGutterX(runs: PdfTextRun[], scope?: { yMax?: number; yMin?: number; maxFont?: number }) {
  const scoped = runs.filter(run =>
    (scope?.yMax === undefined || run.y <= scope.yMax)
    && (scope?.yMin === undefined || run.y >= scope.yMin)
    && (scope?.maxFont === undefined || run.fontSize <= scope.maxFont)
  );
  const pool = scoped.length >= 8 ? scoped : runs;
  const xs = [...new Set(pool.map(run => Math.round(run.x)))].sort((left, right) => left - right);
  if (xs.length < 2) return undefined;
  let bestGap = 0;
  let gutter: number | undefined;
  for (let index = 1; index < xs.length; index++) {
    const gap = xs[index] - xs[index - 1];
    if (gap > bestGap) {
      bestGap = gap;
      gutter = (xs[index - 1] + xs[index]) / 2;
    }
  }
  if (bestGap < 36) return undefined;
  return gutter;
}

function looksPollutedAbstract(text: string) {
  const trimmed = text.trim();
  if (/^[,;:]?\s*\([ivx]+\)/i.test(trimmed)) return true;
  if (/\bUser number\b|\bEpoch\b|\bAccuracy\s*\(%\)/i.test(trimmed)) return true;
  const tokens = trimmed.split(/\s+/).filter(Boolean);
  if (tokens.length < 12) return false;
  const digitish = tokens.filter(token => /^\d[\d,.%]*$/.test(token)).length;
  return digitish >= 8 && digitish / tokens.length > 0.12;
}

function pickAbstract(...candidates: (string | undefined)[]) {
  for (const candidate of candidates) {
    if (candidate && !looksPollutedAbstract(candidate)) return candidate;
  }
  return undefined;
}

function extractAbstractFromRaw(text?: string) {
  if (!text?.trim()) return undefined;
  const prepared = unsplitSmallCaps(text.replace(/\u0000/g, " "));
  const head = RAW_ABSTRACT_HEAD.exec(prepared);
  if (!head) return undefined;
  const after = prepared.slice(head.index + head[0].length);
  const stop = RAW_ABSTRACT_STOP.exec(after);
  const end = stop ? stop.index + stop[1].length : 2800;
  return cleanAbstractText(after.slice(0, end).replace(/\s+/g, " ").trim());
}

function subjectAsAbstract(value?: string) {
  const text = value?.replace(/\s+/g, " ").trim();
  if (!text || text.length < 40 || JUNK_TITLE.test(text)) return undefined;
  return cleanAbstractText(extractAbstractFromRaw(text) || text);
}

function extractVenue(blob: string) {
  // Require a year for WWW — bare WWW matches URL hosts like www.ieee.org.
  const named = blob.match(/\b(NeurIPS|NIPS|ICML|ICLR|CVPR|ICCV|ECCV|ACL|EMNLP|NAACL|AAAI|KDD|SIGIR|CHI)(?:\s+\d{4})?\b|\bWWW\s+\d{4}\b/i);
  if (named) return named[0].replace(/\s+/g, " ");
  const proceedings = blob.match(/Proceedings of[^.\n]{5,80}/i)?.[0];
  if (proceedings) return proceedings;
  return undefined;
}

const IEEE_DOI_VENUE: Record<string, string> = {
  TKDE: "IEEE TKDE",
  TPAMI: "IEEE TPAMI",
  TNNLS: "IEEE TNNLS",
  TIP: "IEEE TIP",
  TIFS: "IEEE TIFS",
  TOC: "IEEE ToC",
  TC: "IEEE TC",
  TVCG: "IEEE TVCG",
  TASLP: "IEEE TASLP",
  TACL: "TACL",
  SPL: "IEEE SPL",
  WACV: "WACV",
  CVPR: "CVPR",
  ICCV: "ICCV",
  ECCV: "ECCV",
  ICRA: "ICRA",
  IROS: "IROS"
};

function venueFromDoi(doi?: string) {
  if (!doi) return undefined;
  const ieee = doi.match(/^10\.1109\/([A-Z]{2,12})\./i)?.[1]?.toUpperCase();
  if (ieee && IEEE_DOI_VENUE[ieee]) return IEEE_DOI_VENUE[ieee];
  if (ieee) return `IEEE ${ieee}`;
  return undefined;
}

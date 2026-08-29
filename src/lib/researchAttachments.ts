import { withPdfDocument } from "./pdfSession";
import type { ResearchAttachmentInput } from "../types";

export type AttachmentDraft = ResearchAttachmentInput & { id: string; sizeLabel: string };

const IMAGE_MIME = new Set(["image/png", "image/jpeg", "image/jpg", "image/webp", "image/gif"]);
const PLAIN_EXTENSIONS = new Set([
  "txt", "md", "markdown", "tex", "bib", "csv", "tsv", "json", "yaml", "yml",
  "py", "ts", "tsx", "js", "jsx", "rs", "java", "c", "h", "cpp", "go", "sql",
]);

export const ATTACHMENT_EXTENSIONS = [
  "png", "jpg", "jpeg", "webp", "gif",
  "pdf", "docx", "xlsx", "pptx",
  ...PLAIN_EXTENSIONS,
];

/** LLM 只能接收文本与图片，音视频没有可用的解析路径，直接在选择阶段挡掉。 */
export const REJECTED_HINT = "音频、视频与压缩包无法作为调研上下文，请改为文本、图片、PDF 或 Office 文档。";

function extensionOf(name: string) {
  const dot = name.lastIndexOf(".");
  return dot < 0 ? "" : name.slice(dot + 1).toLowerCase();
}

function sizeLabel(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function toBase64(bytes: Uint8Array) {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

async function pdfText(bytes: Uint8Array) {
  return withPdfDocument(bytes, async document => {
    const pages: string[] = [];
    const total = Math.min(document.numPages, 40);
    for (let index = 1; index <= total; index += 1) {
      const page = await document.getPage(index);
      const content = await page.getTextContent();
      pages.push(content.items.map(item => ("str" in item ? item.str : "")).join(" "));
    }
    return pages.join("\n\n");
  });
}

async function docxText(bytes: Uint8Array) {
  const mammoth = await import("mammoth");
  const result = await mammoth.extractRawText({ arrayBuffer: bytes.slice().buffer });
  return result.value;
}

async function xlsxText(bytes: Uint8Array) {
  const XLSX = await import("xlsx");
  const book = XLSX.read(bytes, { type: "array" });
  return book.SheetNames.map(name => {
    const sheet = book.Sheets[name];
    return `# ${name}\n${XLSX.utils.sheet_to_csv(sheet)}`;
  }).join("\n\n");
}

/** pptx 没有轻量解析库，直接从 slide XML 里取 <a:t> 文本节点。 */
async function pptxText(bytes: Uint8Array) {
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(bytes);
  const slides = Object.keys(zip.files)
    .filter(name => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const out: string[] = [];
  for (const name of slides) {
    const xml = await zip.files[name].async("string");
    const texts = [...xml.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map(match => match[1]);
    out.push(`# ${name.replace("ppt/slides/", "")}\n${texts.join(" ")}`);
  }
  return out.join("\n\n");
}

export async function readAttachment(file: File): Promise<AttachmentDraft> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const ext = extensionOf(file.name);
  const base = { id: `${file.name}-${file.size}-${Date.now()}`, name: file.name, sizeLabel: sizeLabel(file.size) };

  if (IMAGE_MIME.has(file.type) || ["png", "jpg", "jpeg", "webp", "gif"].includes(ext)) {
    return { ...base, kind: "image", mime: file.type || `image/${ext}`, dataBase64: toBase64(bytes) };
  }

  let text: string;
  if (ext === "pdf") text = await pdfText(bytes);
  else if (ext === "docx") text = await docxText(bytes);
  else if (ext === "xlsx" || ext === "xls") text = await xlsxText(bytes);
  else if (ext === "pptx") text = await pptxText(bytes);
  else if (PLAIN_EXTENSIONS.has(ext)) text = new TextDecoder().decode(bytes);
  else throw new Error(`${file.name}：${REJECTED_HINT}`);

  if (!text.trim()) throw new Error(`${file.name} 没有可提取的文本。`);
  return { ...base, kind: "text", mime: file.type || undefined, text };
}

const URL_PATTERN = /https?:\/\/[^\s，。；、）)】]+/g;

export function extractLinks(text: string): string[] {
  return [...new Set(text.match(URL_PATTERN) ?? [])];
}

export function linkAttachments(text: string): ResearchAttachmentInput[] {
  return extractLinks(text).map(url => ({ name: hostOf(url), kind: "link" as const, url }));
}

export function hostOf(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

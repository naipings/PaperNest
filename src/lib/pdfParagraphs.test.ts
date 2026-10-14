import { describe, expect, it } from "vitest";
import { splitParagraphs, toPageRect, type PdfTextRun } from "./pdfParagraphs";

const run = (str: string, x: number, y: number, fontSize = 10): PdfTextRun => ({ str, x, y, width: str.length * fontSize * 0.5, fontSize });
const texts = (runs: PdfTextRun[]) => splitParagraphs(runs).map(paragraph => paragraph.text);

describe("splitParagraphs", () => {
  it("merges wrapped lines and runs on the same baseline", () => {
    expect(texts([run("We propose", 50, 700), run("a model", 110, 700), run("for retrieval.", 50, 688)]))
      .toEqual(["We propose a model for retrieval."]);
  });

  it("breaks on a large vertical gap and rejoins hyphenated words", () => {
    const paragraphs = texts([
      run("Retrieval aug-", 50, 700),
      run("mented generation works.", 50, 688),
      run("Results improve.", 50, 650),
    ]);
    expect(paragraphs).toEqual(["Retrieval augmented generation works.", "Results improve."]);
  });

  it("breaks on first-line indent, column jumps and heading font size", () => {
    const paragraphs = texts([
      run("3 Method", 50, 720, 12),
      run("The encoder maps inputs.", 50, 700),
      run("It is trained end to end.", 50, 688),
      run("The decoder predicts tokens.", 60, 676),
      run("Second column text.", 320, 720),
    ]);
    expect(paragraphs).toEqual([
      "3 Method",
      "The encoder maps inputs. It is trained end to end.",
      "The decoder predicts tokens.",
      "Second column text.",
    ]);
  });

  it("returns nothing for pages without text", () => {
    expect(splitParagraphs([run("", 0, 0), run("   ", 10, 10)])).toEqual([]);
  });

  it("records one box per line spanning all runs on that line", () => {
    const [paragraph] = splitParagraphs([run("We propose", 50, 700), run("a model", 110, 700), run("for retrieval.", 50, 688)]);
    expect(paragraph.lines).toEqual([
      { left: 50, bottom: 698, right: 145, top: 708 },
      { left: 50, bottom: 686, right: 120, top: 696 },
    ]);
  });
});

describe("toPageRect", () => {
  it("flips the PDF y axis and normalizes by the viewport size", () => {
    const viewport = { width: 600, height: 800, convertToViewportRectangle: ([x1, y1, x2, y2]: number[]) => [x1, 800 - y1, x2, 800 - y2] };
    expect(toPageRect({ left: 60, bottom: 600, right: 300, top: 640 }, viewport)).toEqual({ x: 0.1, y: 0.2, width: 0.4, height: 0.05 });
  });
});

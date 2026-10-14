import { describe, expect, it } from "vitest";
import { splitParagraphs, type PdfTextRun } from "./pdfParagraphs";

const run = (str: string, x: number, y: number, fontSize = 10): PdfTextRun => ({ str, x, y, width: str.length * fontSize * 0.5, fontSize });

describe("splitParagraphs", () => {
  it("merges wrapped lines and runs on the same baseline", () => {
    expect(splitParagraphs([run("We propose", 50, 700), run("a model", 110, 700), run("for retrieval.", 50, 688)]))
      .toEqual(["We propose a model for retrieval."]);
  });

  it("breaks on a large vertical gap and rejoins hyphenated words", () => {
    const paragraphs = splitParagraphs([
      run("Retrieval aug-", 50, 700),
      run("mented generation works.", 50, 688),
      run("Results improve.", 50, 650),
    ]);
    expect(paragraphs).toEqual(["Retrieval augmented generation works.", "Results improve."]);
  });

  it("breaks on first-line indent, column jumps and heading font size", () => {
    const paragraphs = splitParagraphs([
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
});

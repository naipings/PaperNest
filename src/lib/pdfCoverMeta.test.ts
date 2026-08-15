import { describe, expect, it } from "vitest";
import { inferCoverMeta, looksBetterTitle, type PdfTextRun } from "./pdfCoverMeta";

function run(str: string, fontSize: number, y: number, x = 80, width?: number): PdfTextRun {
  return { str, fontSize, x, y, width };
}

describe("inferCoverMeta", () => {
  it("reads the largest first-page lines as title and authors", () => {
    const meta = inferCoverMeta([
      run("Provided as a conference paper at NeurIPS 2017", 9, 780),
      run("Attention Is All You Need", 18, 700),
      run("Ashish Vaswani", 11, 650, 80, 90),
      run("Noam Shazeer", 11, 650, 280, 80),
      run("Google Brain", 9, 620),
      run("Abstract", 12, 540),
      run("The dominant sequence transduction models...", 10, 500)
    ]);
    expect(meta.titleEn).toBe("Attention Is All You Need");
    expect(meta.authors).toEqual(["Ashish Vaswani", "Noam Shazeer"]);
    expect(meta.publicationDate).toBe("2017");
  });

  it("falls back to PDF Info when the first page has no text", () => {
    const meta = inferCoverMeta([], { Title: "BERT: Pre-training of Deep Bidirectional Transformers", Author: "Jacob Devlin, Ming-Wei Chang", CreationDate: "D:20181011090000Z" });
    expect(meta.titleEn).toMatch(/^BERT/);
    expect(meta.authors).toEqual(["Jacob Devlin", "Ming-Wei Chang"]);
    expect(meta.publicationDate).toBe("2018-10-11");
  });

  it("ignores Word/Acrobat junk metadata", () => {
    const meta = inferCoverMeta([], { Title: "Microsoft Word - draft.docx", Author: "Adobe" });
    expect(meta.titleEn).toBeUndefined();
    expect(meta.authors).toEqual([]);
  });

  it("ignores affiliation superscript numbers glued between author names", () => {
    const meta = inferCoverMeta([
      run("Breaking the Scale Barrier", 18, 700),
      run("1", 7, 650, 80, 4),
      run("2", 7, 650, 100, 4),
      run("Jianlu Shen", 11, 650, 120, 70),
      run("Fu Feng", 11, 650, 220, 50),
      run("Abstract", 12, 540),
      run("We present a one-shot knowledge transfer method based on frequency transforms for large models.", 10, 500)
    ]);
    expect(meta.authors.join(" ")).toMatch(/Jianlu Shen/);
    expect(meta.authors.join(" ")).toMatch(/Fu Feng/);
    expect(meta.authors.join(" ")).not.toMatch(/\d/);
  });

  it("drops author lines that are only affiliation markers", () => {
    const meta = inferCoverMeta([
      run("Breaking the Scale Barrier", 18, 700),
      run("1 2 1 2 1 2 1 2 1 1", 11, 650),
      run("Abstract", 12, 540),
      run("We present a one-shot knowledge transfer method based on frequency transforms for large models.", 10, 500)
    ]);
    expect(meta.authors).toEqual([]);
  });
});

describe("looksBetterTitle", () => {
  it("replaces a filename-like import title", () => {
    expect(looksBetterTitle("Attention Is All You Need", "1706.03762")).toBe(true);
    expect(looksBetterTitle("Short", "Attention Is All You Need")).toBe(false);
  });
});

describe("abstract extraction", () => {
  it("joins PDF line breaks and hyphenation into one paragraph", () => {
    const meta = inferCoverMeta([
      run("Attention Is All You Need", 18, 700),
      run("Abstract", 12, 540),
      run("The dominant sequence transduc-", 10, 520),
      run("tion models are based on complex recurrent or", 10, 508),
      run("convolutional neural networks.", 10, 496),
      run("1 Introduction", 12, 430)
    ]);
    expect(meta.abstractEn).toBe("The dominant sequence transduction models are based on complex recurrent or convolutional neural networks.");
    expect(meta.venue).toBeUndefined();
  });

  it("keeps a blank vertical gap as a paragraph break", () => {
    const meta = inferCoverMeta([
      run("A Study of Transformers", 18, 700),
      run("Abstract", 12, 560),
      run("First paragraph stays together on wrapped lines.", 10, 540),
      run("It continues on the next line.", 10, 528),
      run("Still the same paragraph.", 10, 516),
      run("Second paragraph starts after a larger gap.", 10, 450),
      run("Keywords", 11, 400)
    ]);
    expect(meta.abstractEn).toBe("First paragraph stays together on wrapped lines. It continues on the next line. Still the same paragraph.\n\nSecond paragraph starts after a larger gap.");
  });

  it("reassembles per-glyph Abstract heading and body", () => {
    const heading = [..."Abstract"].map((str, index) => run(str, 12, 540, 80 + index * 6.2, 6));
    const body = "The dominant sequence transduction models are based on complex recurrent or convolutional neural networks.";
    const glyphs = [...body].map((str, index) => run(str, 10, 500, 80 + index * 5.1, 5));
    const meta = inferCoverMeta([
      run("Attention Is All You Need", 18, 700),
      ...heading,
      ...glyphs,
      run("1 Introduction", 12, 430)
    ]);
    expect(meta.abstractEn).toBe(body);
  });

  it("reads an Abstract glued to the next sentence in a raw PDF dump", () => {
    const meta = inferCoverMeta([], {}, "AbstractThe dominant sequence transduction models are based on complex recurrent or convolutional neural networks.1 Introduction");
    expect(meta.abstractEn).toBe("The dominant sequence transduction models are based on complex recurrent or convolutional neural networks.");
  });

  it("uses PDF Subject when the first page has no Abstract heading", () => {
    const meta = inferCoverMeta([], { Subject: "The dominant sequence transduction models are based on complex recurrent or convolutional neural networks." });
    expect(meta.abstractEn).toMatch(/dominant sequence transduction models/);
  });

  it("stops at a small-caps Introduction heading", () => {
    const meta = inferCoverMeta([
      run("KuaiSim: A Comprehensive Simulator", 18, 700),
      run("Abstract", 12, 600),
      run("We present a simulator for recommender systems research on public datasets.", 10, 580),
      run("1", 12, 520, 80, 6),
      run("I", 12, 520, 96, 6),
      run("NTRODUCTION", 9, 520, 104),
      run("Recommender systems are widely deployed and this paragraph is not part of the abstract.", 10, 500)
    ]);
    expect(meta.abstractEn).toBe("We present a simulator for recommender systems research on public datasets.");
  });

  it("stops at a roman-numeral Introduction heading", () => {
    const meta = inferCoverMeta([
      run("A Study of Recommenders", 18, 700),
      run("Abstract", 12, 600),
      run("This paper studies sequential recommenders under a unified evaluation protocol.", 10, 580),
      run("II. INTRODUCTION", 11, 520),
      run("Sequential recommendation has attracted attention and must stay out of the abstract.", 10, 500)
    ]);
    expect(meta.abstractEn).toBe("This paper studies sequential recommenders under a unified evaluation protocol.");
  });

  it("stops the raw fallback at CCS concepts and keeps the ACM reference format out", () => {
    const meta = inferCoverMeta([], {}, "AbstractWe study collaborative distillation for sequential recommendation on four datasets.CCS CONCEPTS Information systems Recommender systems ACM Reference Format: 1 INTRODUCTION Recommenders are everywhere.");
    expect(meta.abstractEn).toBe("We study collaborative distillation for sequential recommendation on four datasets.");
  });

  it("rejects ACM CCS taxonomy dumped as LaTeX instead of an abstract", () => {
    const meta = inferCoverMeta([], {}, String.raw`Abstract\textbullet Information systems $\rightarrow$ -1Retrieval models and ranking.\textbullet Computing methodologies $\rightarrow$ -1Natural language processing.`);
    expect(meta.abstractEn).toBeUndefined();
  });

  it("stops raw abstract text at a small-caps Introduction glued after the body", () => {
    const meta = inferCoverMeta([], {}, "AbstractWe present PRONT for one-shot knowledge transfer across large models.1 I NTRODUCTION Large language models dominate current research.");
    expect(meta.abstractEn).toBe("We present PRONT for one-shot knowledge transfer across large models.");
  });

  it("keeps left-column Abstract away from right-column intro text", () => {
    const meta = inferCoverMeta([
      run("Item-Ranking Promotion", 18, 700, 54),
      run("ABSTRACT", 11, 520, 54, 70),
      run("(ii) secure new users via promotions in the right column.", 10, 520, 318, 220),
      run("In this paper, we first define the item-ranking promotion problem for recommender systems.", 10, 500, 54, 240),
      run("We then propose a multi-objective optimization framework.", 10, 484, 54, 240),
      run("1 Introduction", 12, 420, 54),
      run("Recommender systems are widely used and must not enter the abstract.", 10, 400, 318, 220)
    ]);
    expect(meta.abstractEn).toMatch(/^In this paper, we first define/);
    expect(meta.abstractEn).not.toMatch(/\(ii\) secure/);
    expect(meta.abstractEn).not.toMatch(/widely used/);
  });

  it("keeps left-column Abstract away from right-column chart ticks", () => {
    const meta = inferCoverMeta([
      run("HeteFedRec", 18, 700, 60),
      run("Abstract", 11, 560, 60, 50),
      run("350", 8, 560, 400, 20),
      run("1200", 8, 548, 420, 24),
      run("User number", 8, 536, 380, 50),
      run("Federated recommendation protects user privacy while training across clients with heterogeneous data.", 10, 540, 60, 240),
      run("We propose HeteFedRec for this setting and evaluate it on public benchmarks.", 10, 520, 60, 240),
      run("800", 8, 520, 410, 20),
      run("1 Introduction", 12, 460, 60)
    ]);
    expect(meta.abstractEn).toMatch(/^Federated recommendation protects/);
    expect(meta.abstractEn).not.toMatch(/\b350\b/);
    expect(meta.abstractEn).not.toMatch(/User number/);
  });

  it("reads Abstract glued after a prior word in a raw PDF dump", () => {
    const meta = inferCoverMeta([], {}, "South KoreaABSTRACTIn this paper, we first define the item-ranking promotion problem for recommender systems.1 Introduction More text.");
    expect(meta.abstractEn).toMatch(/^In this paper, we first define/);
  });
});

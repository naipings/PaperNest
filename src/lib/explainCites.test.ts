import { describe, expect, it } from "vitest";
import { compactExplainMarkdown, extractExplainCites, linkifyExplainPageRefs, parseExplainPageHref } from "./explainCites";

describe("extractExplainCites", () => {
  it("reads P-style and Chinese page markers", () => {
    expect(extractExplainCites("见 P3 与第 7 页，以及 p.12。")).toEqual([3, 7, 12]);
  });

  it("deduplicates pages", () => {
    expect(extractExplainCites("P2 与 P2 和第 2 页")).toEqual([2]);
  });

  it("reads ranges and parenthetical lists", () => {
    expect(extractExplainCites("见 (P2-P3) 与 (P2, P3)。")).toEqual([2, 3]);
  });
});

describe("linkifyExplainPageRefs", () => {
  it("turns page refs into markdown links", () => {
    const linked = linkifyExplainPageRefs("结论见 (P2-P3) 与 P5。");
    expect(linked).toContain("[P2](#pn-2)");
    expect(linked).toContain("[P3](#pn-3)");
    expect(linked).toContain("[P5](#pn-5)");
  });

  it("skips fenced code blocks", () => {
    const linked = linkifyExplainPageRefs("正文 P2\n```\nP9\n```");
    expect(linked).toContain("[P2](#pn-2)");
    expect(linked).toContain("```\nP9\n```");
  });
});

describe("parseExplainPageHref", () => {
  it("parses page hash links", () => {
    expect(parseExplainPageHref("#pn-12")).toBe(12);
    expect(parseExplainPageHref("https://example.com")).toBeUndefined();
  });
});

describe("compactExplainMarkdown", () => {
  it("joins orphaned list markers with the next line", () => {
    expect(compactExplainMarkdown("1.\n\n**标题**：说明\n\n2.\n\n下一项")).toBe(
      "1. **标题**：说明\n2. 下一项",
    );
  });

  it("keeps nested bullets attached to the parent item", () => {
    expect(compactExplainMarkdown("1. **标题**\n\n- a\n- b")).toBe("1. **标题**\n- a\n- b");
  });

  it("collapses blank lines between loose bullet items", () => {
    expect(compactExplainMarkdown("- a\n\n- b\n\n- c")).toBe("- a\n- b\n- c");
  });

  it("collapses blank line between heading and list", () => {
    expect(compactExplainMarkdown("## 流程\n\n- a\n\n- b")).toBe("## 流程\n- a\n- b");
  });
});

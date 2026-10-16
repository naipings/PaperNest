import { describe, expect, it } from "vitest";
import { replaceMarkdownBlock, splitMarkdownBlocks } from "./markdownBlocks";

const sample = "# 标题\n\n一段正文。\n\n- 冷静、直接、克制\n- 不写客套话\n\n```\ncode\n```\n";

describe("markdown blocks", () => {
  it("keeps fences together and splits list items", () => {
    const blocks = splitMarkdownBlocks(sample).map(block => sample.slice(block.start, block.end));
    expect(blocks).toEqual(["# 标题", "一段正文。", "- 冷静、直接、克制", "- 不写客套话", "```\ncode\n```"]);
  });

  it("replaces one block without moving the others", () => {
    const next = replaceMarkdownBlock(sample, 2, "- 冷静");
    expect(next).toContain("- 冷静\n- 不写客套话");
    expect(next.startsWith("# 标题")).toBe(true);
    expect(splitMarkdownBlocks(next).map(block => next.slice(block.start, block.end))[2]).toBe("- 冷静");
  });
});

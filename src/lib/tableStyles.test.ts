import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function rules(css: string) {
  return [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)].map(match => ({ selector: match[1].replace(/\s+/g, " ").trim(), body: match[2] }));
}

describe("library table CSS", () => {
  const css = readFileSync("src/styles.css", "utf8");

  it("does not use sticky positioning on paper-table cells", () => {
    const sticky = rules(css).filter(rule => /\.paper-table/.test(rule.selector) && /position:\s*sticky/.test(rule.body));
    expect(sticky.map(rule => rule.selector)).toEqual([]);
  });

  it("keeps checkbox and body cells in the same scroll flow", () => {
    const select = rules(css).find(rule => /\.col-select/.test(rule.selector) && /position:\s*(relative|static)/.test(rule.body));
    expect(select).toBeTruthy();
  });
});

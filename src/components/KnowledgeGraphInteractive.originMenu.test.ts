import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("KnowledgeGraphInteractive origin menu", () => {
  it("portals the origin candidate menu to document.body with fixed positioning", () => {
    const source = readFileSync("src/components/KnowledgeGraphInteractive.tsx", "utf8");
    expect(source).toMatch(/createPortal/);
    expect(source).toMatch(/document\.body/);
    expect(source).toMatch(/originMenuBox/);
    const css = readFileSync("src/styles.css", "utf8");
    expect(css).toMatch(/\.cp-origin-menu\s*\{[^}]*position:\s*fixed/s);
    expect(css).toMatch(/z-index:\s*10000/);
  });
});

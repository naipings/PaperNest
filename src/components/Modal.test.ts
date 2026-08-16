import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("modal dialog", () => {
  const source = readFileSync("src/components/Modal.tsx", "utf8");

  it("renders through a body portal so workspace overflow cannot pin it to the bottom", () => {
    expect(source).toMatch(/createPortal/);
    expect(source).toMatch(/document\.body/);
    expect(source).toMatch(/role="dialog"/);
  });
});

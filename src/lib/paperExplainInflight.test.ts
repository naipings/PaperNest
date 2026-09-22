import { describe, expect, it } from "vitest";
import { getExplainStartInflight, resetExplainInflightForTests, trackExplainStart } from "./paperExplainInflight";
import type { PaperExplainSession } from "../types";

const session: PaperExplainSession = {
  paperId: "p1",
  locale: "zh-CN",
  overview: null,
  messages: [],
};

describe("paperExplainInflight", () => {
  it("reuses the same start promise for one paper", async () => {
    resetExplainInflightForTests();
    let calls = 0;
    let resolve!: (value: PaperExplainSession) => void;
    const run = () => {
      calls += 1;
      return new Promise<PaperExplainSession>(r => { resolve = r; });
    };
    const first = trackExplainStart("p1", run);
    const second = trackExplainStart("p1", run);
    expect(first).toBe(second);
    expect(calls).toBe(1);
    expect(getExplainStartInflight("p1")).toBe(first);
    resolve(session);
    await expect(first).resolves.toEqual(session);
    expect(getExplainStartInflight("p1")).toBeUndefined();
  });
});

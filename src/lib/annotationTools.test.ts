import { describe, expect, it } from "vitest";
import { toolForCapturedSelection } from "./annotationTools";

describe("captured text annotation actions", () => {
  it("maps the top toolbar actions to the active text selection", () => {
    expect(toolForCapturedSelection("高亮", true)).toBe("highlight");
    expect(toolForCapturedSelection("下划线", true)).toBe("underline");
  });

  it("does not consume a toolbar action when there is no text selection", () => {
    expect(toolForCapturedSelection("高亮", false)).toBeUndefined();
  });
});

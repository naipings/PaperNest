import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LazyScreenBoundary } from "./LazyScreenBoundary";

function BrokenPage(): never {
  throw new Error("动态模块加载失败");
}

describe("lazy screen boundary", () => {
  afterEach(() => vi.restoreAllMocks());

  it("keeps a recoverable screen when a lazy page fails", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    render(<LazyScreenBoundary><BrokenPage /></LazyScreenBoundary>);

    expect(screen.getByRole("alert")).toHaveTextContent("页面加载失败");
    expect(screen.getByRole("button", { name: "重新加载" })).toBeInTheDocument();
  });
});

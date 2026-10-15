import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DeepReadChatTab } from "./DeepReadChatTab";

describe("精读追问输入", () => {
  it("中文输入法确认候选词时不发送，普通回车发送", async () => {
    const onAsk = vi.fn(async () => true);
    render(<DeepReadChatTab messages={[]} canAsk answering={false} onAsk={onAsk} onDeleteTurn={() => undefined} />);
    const input = screen.getByRole("textbox", { name: "精读追问" });
    fireEvent.change(input, { target: { value: "消融实验说明了什么？" } });
    fireEvent.keyDown(input, { key: "Enter", isComposing: true });
    fireEvent.keyDown(input, { key: "Enter", keyCode: 229 });
    fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
    expect(onAsk).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(onAsk).toHaveBeenCalledWith("消融实验说明了什么？"));
    await waitFor(() => expect(input).toHaveValue(""));
  });

  it("发送失败保留问题，便于重试", async () => {
    const onAsk = vi.fn(async () => false);
    render(<DeepReadChatTab messages={[]} canAsk answering={false} onAsk={onAsk} onDeleteTurn={() => undefined} />);
    const input = screen.getByRole("textbox", { name: "精读追问" });
    fireEvent.change(input, { target: { value: "解释方法" } });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));
    await waitFor(() => expect(onAsk).toHaveBeenCalledOnce());
    expect(input).toHaveValue("解释方法");
  });
});

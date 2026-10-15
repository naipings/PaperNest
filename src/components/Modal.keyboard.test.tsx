import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { Modal } from "./Modal";

it("keeps keyboard focus inside the dialog and returns it to the opener", () => {
  const opener = document.createElement("button");
  document.body.append(opener);
  opener.focus();
  const onClose = vi.fn();
  const { unmount } = render(<Modal title="新建精读" onClose={onClose}><input aria-label="搜索" /><button>开始</button></Modal>);
  expect(screen.getByRole("dialog")).toHaveFocus();
  fireEvent.keyDown(window, { key: "Tab" });
  expect(screen.getByRole("button", { name: "关闭" })).toHaveFocus();
  fireEvent.keyDown(window, { key: "Tab", shiftKey: true });
  expect(screen.getByRole("button", { name: "开始" })).toHaveFocus();
  fireEvent.keyDown(window, { key: "Tab" });
  expect(screen.getByRole("button", { name: "关闭" })).toHaveFocus();
  fireEvent.keyDown(window, { key: "Escape" });
  expect(onClose).toHaveBeenCalledOnce();
  unmount();
  expect(opener).toHaveFocus();
  opener.remove();
});

it("Escape closes only the top dialog", () => {
  const parentClose = vi.fn();
  const childClose = vi.fn();
  render(<><Modal title="父窗口" onClose={parentClose}><p>内容</p></Modal><Modal title="子窗口" onClose={childClose}><p>内容</p></Modal></>);
  fireEvent.keyDown(window, { key: "Escape" });
  expect(childClose).toHaveBeenCalledOnce();
  expect(parentClose).not.toHaveBeenCalled();
});

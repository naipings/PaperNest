import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const FAP_ZOOM_ONCHANGE = 'c(G === -1 ? "fit-width" : G === -2 ? "fit-page" : G / 100 + "")';
const FAP_ZOOM_ONCHANGE_FIXED = "c(G === -1 ? \"fit-width\" : G === -2 ? \"fit-page\" : G / 100)";

/** fresh-air-pdf 补丁：离线 worker、缩放灵敏度、缩放下拉框、常见 UI 文案中文化 */
function patchFreshAirPdf() {
  const unpkgWorker = /tk\.workerSrc = `https:\/\/unpkg\.com\/pdfjs-dist@\$\{ik\}\/build\/pdf\.worker\.min\.mjs`;/;
  const localWorker = `tk.workerSrc = (typeof window !== "undefined" ? new URL("fresh-air-worker.mjs", window.location.href).href : "/fresh-air-worker.mjs");`;
  const uiReplacements: [string, string][] = [
    ['children: "Fit Width"', 'children: "适应宽度"'],
    ['children: "Fit Page"', 'children: "适应页面"'],
    ['title: "Zoom Out"', 'title: "缩小"'],
    ['title: "Zoom In"', 'title: "放大"'],
    ['title: "Previous Page"', 'title: "上一页"'],
    ['title: "Next Page"', 'title: "下一页"'],
    ['title: "Toggle Sidebar"', 'title: "切换侧栏"'],
    ['title: "Search"', 'title: "搜索"'],
    ['title: "Thumbnails"', 'title: "缩略图"'],
    ['children: "Loading document..."', 'children: "正在加载文档…"'],
    ['"Form Field Properties"', '"表单字段属性"'],
    ['"Field Name *"', '"字段名称 *"'],
    ['"Field Type"', '"字段类型"'],
    ['"Required Field"', '"必填"'],
    ['"Read Only"', '"只读"'],
    ['"Default Value"', '"默认值"'],
    ['"Placeholder Text"', '"占位文字"'],
    ['"Checked by default"', '"默认选中"'],
    ['"Unique identifier for this field"', '"此字段的唯一标识符"'],
    ['children: "Text Input"', 'children: "文本输入"'],
    ['children: "Checkbox"', 'children: "复选框"'],
    ['children: "Radio Button"', 'children: "单选框"'],
    ['children: "Dropdown"', 'children: "下拉框"'],
    ['children: "Signature"', 'children: "签名"'],
  ];
  return {
    name: "patch-fresh-air-pdf",
    transform(code: string, id: string) {
      if (id.replace(/\\/g, "/").indexOf("fresh-air-pdf/dist/fresh-air-pdf") === -1) return;
      let next = code;
      if (unpkgWorker.test(next)) next = next.replace(unpkgWorker, localWorker);
      if (next.indexOf("nt.deltaY * 5e-3") !== -1) {
        next = next.replace(/nt\.deltaY \* 5e-3/g, "nt.deltaY * 1.2e-3");
        next = next.replace("Math.max(0.1, Math.min(Nt * dr, 5))", "Math.max(0.55, Math.min(Nt * dr, 2.5))");
      }
      if (next.indexOf(FAP_ZOOM_ONCHANGE) !== -1) next = next.replace(FAP_ZOOM_ONCHANGE, FAP_ZOOM_ONCHANGE_FIXED);
      for (const [from, to] of uiReplacements) {
        if (next.indexOf(from) !== -1) next = next.split(from).join(to);
      }
      return next === code ? undefined : next;
    },
  };
}

export default defineConfig({
  plugins: [react(), patchFreshAirPdf()],
  clearScreen: false,
  server: { port: 1420, strictPort: true, host: "127.0.0.1" },
  envPrefix: ["VITE_", "TAURI_ENV_"],
  build: { target: "chrome105", minify: true },
});

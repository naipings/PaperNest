const TITLE_MAP: Record<string, string> = {
  "Toggle Sidebar": "切换侧栏",
  "Open File": "打开文件",
  Save: "保存",
  "Download PDF": "下载 PDF",
  Print: "打印",
  Thumbnails: "缩略图",
  Search: "搜索",
  Fullscreen: "全屏",
  "Exit Fullscreen": "退出全屏",
  "Previous Page": "上一页",
  "Next Page": "下一页",
  "Current Page Number": "当前页码",
  "Page Number": "页码",
  "Zoom Out": "缩小",
  "Zoom In": "放大",
  "Zoom Level": "缩放级别",
  "Text Field": "文本框",
  Checkbox: "复选框",
  "Radio Button": "单选框",
  Dropdown: "下拉框",
  "Signature Field": "签名字段",
  "Fields Panel": "字段面板",
  Pages: "页面",
  "Close sidebar": "关闭侧栏",
  "Loading thumbnails...": "正在加载缩略图…",
  "No bookmarks": "无书签",
  "Bookmarks from the PDF will appear here": "PDF 书签将显示在这里",
  "No annotations": "暂无批注",
  "Annotations will appear here as you add them": "添加批注后将显示在这里",
  "Loading document...": "正在加载文档…",
  "No document loaded": "尚未加载文档",
  "Open a PDF file to get started": "打开 PDF 文件开始阅读",
  "Error Loading Document": "文档加载失败",
  "Fit Width": "适应宽度",
  "Fit Page": "适应页面",
  "Search fields...": "搜索字段…",
  "Form Fields": "表单字段",
  "Form Field Properties": "表单字段属性",
  "Field Name *": "字段名称 *",
  "Field Type": "字段类型",
  "Required Field": "必填",
  "Read Only": "只读",
  "Default Value": "默认值",
  "Placeholder Text": "占位文字",
  "Checked by default": "默认选中",
  "Page Location": "页面位置",
  "Unique identifier for this field": "此字段的唯一标识符",
  "Text Input": "文本输入",
  "Multiline Text": "多行文本",
  All: "全部",
  Text: "文本",
  Check: "复选",
  Radio: "单选",
  Select: "下拉",
  Sign: "签名",
  "No fields match your search": "没有匹配的字段",
  "No form fields yet": "暂无表单字段",
  "Select a form field tool and draw on the PDF to add fields": "选择表单工具后在 PDF 上绘制以添加字段",
  "Save Changes": "保存更改",
  Delete: "删除",
  Page: "第",
  "Page:": "页码：",
};

const FORM_TOOL_TITLES = new Set([
  "Text Field",
  "Checkbox",
  "Radio Button",
  "Dropdown",
  "Signature Field",
  "Fields Panel",
  "文本框",
  "复选框",
  "单选框",
  "下拉框",
  "签名字段",
  "字段面板",
]);

function translateTitle(node: Element) {
  const title = node.getAttribute("title");
  if (!title) return;
  const next = TITLE_MAP[title];
  if (next) node.setAttribute("title", next);
}

function translateAttributes(node: HTMLElement) {
  const placeholder = node.getAttribute("placeholder");
  if (placeholder && TITLE_MAP[placeholder]) node.setAttribute("placeholder", TITLE_MAP[placeholder]);
  const aria = node.getAttribute("aria-label");
  if (aria && TITLE_MAP[aria]) node.setAttribute("aria-label", TITLE_MAP[aria]);
}

function translateTextNode(node: Text) {
  const raw = node.textContent?.trim();
  if (!raw) return;
  const next = TITLE_MAP[raw];
  if (next) node.textContent = node.textContent!.replace(raw, next);
  if (raw.startsWith("Page ") && /^\d+$/.test(raw.slice(5))) {
    node.textContent = node.textContent!.replace(raw, `第 ${raw.slice(5)} 页`);
  }
  if (raw.startsWith("Page:")) {
    node.textContent = node.textContent!.replace(raw, `页码：${raw.slice(5).trim()}`);
  }
}

function hideFormPanels(root: HTMLElement) {
  root.querySelectorAll<HTMLElement>("h3, span, label").forEach(node => {
    const text = node.textContent?.trim();
    if (text !== "Form Field Properties" && text !== "表单字段属性" && text !== "Form Fields" && text !== "表单字段") return;
    let panel = node.closest<HTMLElement>("div");
    while (panel && panel !== root) {
      if (panel.querySelector("input, select, textarea")) {
        panel.style.display = "none";
        return;
      }
      panel = panel.parentElement;
    }
  });
}

function hideFormChrome(root: HTMLElement) {
  root.querySelectorAll<HTMLElement>("button[title]").forEach(button => {
    const title = button.getAttribute("title");
    if (!title || !FORM_TOOL_TITLES.has(title)) return;
    button.style.display = "none";
    const section = button.closest<HTMLElement>("div[style*='display: flex']");
    if (section?.parentElement) {
      const siblings = [...section.parentElement.children];
      const index = siblings.indexOf(section);
      if (index > 0 && siblings[index - 1]?.getAttribute("style")?.includes("width: 1px")) {
        (siblings[index - 1] as HTMLElement).style.display = "none";
      }
    }
  });

  root.querySelectorAll<HTMLElement>("input, select, textarea").forEach(translateAttributes);
  root.querySelectorAll<HTMLElement>("select option").forEach(option => {
    const label = option.textContent?.trim();
    if (label && TITLE_MAP[label]) option.textContent = TITLE_MAP[label];
  });

  hideFormPanels(root);
}

function localizeRoot(root: HTMLElement) {
  root.querySelectorAll("[title]").forEach(translateTitle);
  root.querySelectorAll("input, select, textarea").forEach(node => {
    if (node instanceof HTMLElement) translateAttributes(node);
  });
  root.querySelectorAll("option, label").forEach(node => {
    const label = node.textContent?.trim();
    if (label && TITLE_MAP[label]) node.textContent = TITLE_MAP[label];
  });
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.parentElement?.closest("[data-locale-skip]")) continue;
    translateTextNode(node as Text);
  }
  hideFormChrome(root);
}

export function setupFreshAirLocale(root: HTMLElement, options?: { onZoomInteraction?(): void }) {
  localizeRoot(root);

  let timer = 0;
  const observer = new MutationObserver(() => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => localizeRoot(root), 120);
  });
  observer.observe(root, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["title", "placeholder", "aria-label"] });

  const markZoom = () => options?.onZoomInteraction?.();
  root.addEventListener("change", event => {
    const target = event.target;
    if (!(target instanceof HTMLSelectElement)) return;
    if (target.getAttribute("aria-label") === "Zoom Level" || target.getAttribute("title") === "缩放级别") markZoom();
  }, true);
  root.addEventListener("click", event => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const button = target.closest("button[title]");
    const title = button?.getAttribute("title");
    if (title === "缩小" || title === "放大" || title === "Zoom Out" || title === "Zoom In") markZoom();
  }, true);

  return () => {
    window.clearTimeout(timer);
    observer.disconnect();
  };
}
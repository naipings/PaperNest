/** Browser-safe stub for packages that only need createRequire to read package.json version. */
const PACKAGE_JSON: Record<string, { name: string; version: string }> = {
  "../package.json": { name: "@deepseek-ai/dsh-session", version: "0.0.1-rc.5" },
  "../../package.json": { name: "@deepseek-ai/dsh-session", version: "0.0.1-rc.5" },
};

export function createRequire(_url: string | URL) {
  return function requireStub(id: string) {
    const normalized = id.replace(/\\/g, "/");
    if (normalized.endsWith("package.json")) {
      return PACKAGE_JSON[normalized] ?? PACKAGE_JSON["../package.json"];
    }
    throw new Error(`Node require("${id}") is not available in the PaperNest webview`);
  };
}

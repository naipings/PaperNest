import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import fs from "node:fs";
import path from "node:path";
import type { Rule } from "postcss";

const nodeShimFiles = {
  "node:module": path.resolve(__dirname, "src/shims/node-module.ts"),
  "node:path": path.resolve(__dirname, "src/shims/node-path.ts"),
} as const;

function rewriteDshNodeImports(): Plugin {
  const replacements = {
    "node:module": "/src/shims/node-module.ts",
    "node:path": "/src/shims/node-path.ts",
  } as const;
  return {
    name: "papernest-rewrite-dsh-node-imports",
    enforce: "pre",
    transform(code, id) {
      if (!id.includes("node_modules") || !id.includes("@deepseek-ai/dsh-")) return;
      let next = code;
      for (const [from, to] of Object.entries(replacements)) {
        next = next.replaceAll(`"${from}"`, `"${to}"`).replaceAll(`'${from}'`, `'${to}'`);
      }
      return next === code ? undefined : { code: next, map: null };
    },
  };
}

function nodeBuiltinsShim(): Plugin {
  const virtualPrefix = "\0papernest-node-shim:";
  return {
    name: "papernest-node-shims",
    enforce: "pre",
    resolveId(source) {
      if (source in nodeShimFiles) {
        return virtualPrefix + source;
      }
      return null;
    },
    load(id) {
      if (!id.startsWith(virtualPrefix)) return null;
      const builtin = id.slice(virtualPrefix.length) as keyof typeof nodeShimFiles;
      return fs.readFileSync(nodeShimFiles[builtin], "utf8");
    },
  };
}

export default defineConfig({
  plugins: [rewriteDshNodeImports(), nodeBuiltinsShim(), react()],
  clearScreen: false,
  css: {
    postcss: {
      plugins: [{
        postcssPlugin: "papernest-pdf-viewer-scope",
        Rule(rule: Rule) {
          if (!rule.source?.input.file?.replaceAll("\\", "/").endsWith("pdfjs-dist/web/pdf_viewer.css")) return;
          if (rule.parent?.type === "atrule" && /keyframes$/.test(rule.parent.name)) return;
          rule.selectors = rule.selectors.map(selector => selector.includes(":root")
            ? selector.replaceAll(":root", ":where(.continuous-page-host)")
            : `:where(.continuous-page-host) ${selector}`);
        },
      }],
    },
  },
  optimizeDeps: {
    exclude: [
      "@deepseek-ai/dsh-client-test-runtime",
      "@deepseek-ai/dsh-client-runtime",
      "@deepseek-ai/dsh-client-ui-trajectory",
      "@deepseek-ai/dsh-session",
      "@deepseek-ai/dsh-llm",
    ],
  },
  resolve: {
    dedupe: ["react", "react-dom", "react/jsx-runtime"],
    alias: process.env.VITEST
      ? {}
      : {
          vitest: path.resolve(__dirname, "src/shims/vitest-stub.ts"),
          ...nodeShimFiles,
        },
  },
  server: { port: 5173, strictPort: true, host: "127.0.0.1", watch: { ignored: ["**/src-tauri/**"] } },
  envPrefix: ["VITE_", "TAURI_ENV_"],
  build: { target: "chrome105", minify: true },
});

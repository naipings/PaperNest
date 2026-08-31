/**
 * dsh-client-test-runtime 从 ModuleLoader 脚本做 ESM named import 会得到 undefined。
 * 安装后把它的 import 改写到我们的 shim。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const target = path.join(
  root,
  "node_modules/@deepseek-ai/dsh-client-test-runtime/lib/index.js",
);

if (!fs.existsSync(target)) {
  console.log("patch-dsh-test-runtime: package missing, skip");
  process.exit(0);
}

let text = fs.readFileSync(target, "utf8");
const replacements = [
  [
    'from "@deepseek-ai/dsh-client-runtime/client"',
    'from "/src/shims/dsh-client-runtime-client.ts"',
  ],
  ['from "vitest"', 'from "/src/shims/vitest-stub.ts"'],
];

let changed = false;
for (const [from, to] of replacements) {
  if (text.includes(from)) {
    text = text.replaceAll(from, to);
    changed = true;
  }
}

if (changed) {
  fs.writeFileSync(target, text);
  console.log("patch-dsh-test-runtime: patched", target);
} else {
  console.log("patch-dsh-test-runtime: already patched or unexpected source");
}

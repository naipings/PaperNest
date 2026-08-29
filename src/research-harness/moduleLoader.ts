import * as React from "react";
import * as ReactDOM from "react-dom";
import * as jsxRuntime from "react/jsx-runtime";
import * as cordis from "@deepseek-ai/cordis";
import * as uiSlots from "@deepseek-ai/dsh-client-ui-slots";
import * as uiPrimitives from "@deepseek-ai/dsh-client-ui-primitives";

type ModuleFactory = (require: (id: string) => unknown) => Record<string, unknown>;

const moduleCache = new Map<string, Record<string, unknown>>();

const CLIENT_ALIASES: Record<string, string> = {
  "@deepseek-ai/dsh-client-runtime/client": "@deepseek-ai/dsh-client-runtime",
  "@deepseek-ai/dsh-client-locale/client": "@deepseek-ai/dsh-client-locale",
  "@deepseek-ai/dsh-client-ui-trajectory/client": "@deepseek-ai/dsh-client-ui-trajectory",
};

const BUILTIN_MODULES: Record<string, unknown> = {
  react: React,
  "react-dom": ReactDOM,
  "react/jsx-runtime": jsxRuntime,
  "@deepseek-ai/cordis": cordis,
  "@deepseek-ai/dsh-client-ui-slots": uiSlots,
  "@deepseek-ai/dsh-client-ui-primitives": uiPrimitives,
};

function createRequire(parentId: string) {
  return function requireModule(id: string): unknown {
    const alias = CLIENT_ALIASES[id] ?? id;
    if (moduleCache.has(alias)) {
      return moduleCache.get(alias);
    }
    if (BUILTIN_MODULES[alias] !== undefined) {
      return BUILTIN_MODULES[alias];
    }
    if (BUILTIN_MODULES[id] !== undefined) {
      return BUILTIN_MODULES[id];
    }
    throw new Error(`DSH module loader: cannot resolve "${id}" from "${parentId}"`);
  };
}

declare global {
  interface Window {
    __ModuleLoader__?: {
      load: (spec: { id: string; factory: ModuleFactory }) => Record<string, unknown>;
    };
  }
}

export function installDshModuleLoader(): void {
  if (typeof window === "undefined") return;
  window.__ModuleLoader__ = {
    load(spec) {
      if (!moduleCache.has(spec.id)) {
        const exports = spec.factory(createRequire(spec.id));
        moduleCache.set(spec.id, exports);
      }
      return moduleCache.get(spec.id)!;
    },
  };
}

function loadClassicScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    document.querySelectorAll("script[data-dsh-bundle]").forEach(node => {
      if ((node as HTMLScriptElement).dataset.dshBundle === src) node.remove();
    });
    const script = document.createElement("script");
    script.src = src;
    script.async = false;
    script.dataset.dshBundle = src;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Failed to load DSH bundle: ${src}`));
    document.head.appendChild(script);
  });
}

async function ensureBundleRegistered(id: string, src: string): Promise<void> {
  if (moduleCache.has(id)) return;
  await loadClassicScript(src);
  if (!moduleCache.has(id)) {
    throw new Error(`DSH bundle did not register "${id}" (script loaded but ModuleLoader cache miss)`);
  }
}

export async function loadDshClientBundles(): Promise<void> {
  installDshModuleLoader();
  // 用相对 node_modules 路径 + ?url，避免命中 vite alias 的 `/client` shim（否则循环依赖）。
  const [{ default: runtimeUrl }, { default: trajectoryUrl }] = await Promise.all([
    import("../../node_modules/@deepseek-ai/dsh-client-runtime/lib/client.js?url"),
    import("../../node_modules/@deepseek-ai/dsh-client-ui-trajectory/lib/client.js?url"),
  ]);
  await ensureBundleRegistered("@deepseek-ai/dsh-client-runtime", runtimeUrl);
  await ensureBundleRegistered("@deepseek-ai/dsh-client-ui-trajectory", trajectoryUrl);
}

export function getDshModule<T = Record<string, unknown>>(id: string): T {
  const mod = moduleCache.get(id);
  if (!mod) {
    throw new Error(`DSH module "${id}" is not loaded`);
  }
  return mod as T;
}

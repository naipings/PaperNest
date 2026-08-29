/**
 * `@deepseek-ai/dsh-client-runtime/client` 发布物是 ModuleLoader 经典脚本，无 ESM named export。
 * test-runtime 等包仍 `import { SlotRegistry } from ".../client"`，在 Vite 下会得到 undefined。
 * 本 shim 先加载 ModuleLoader bundle，再转发真实导出。
 */
import { getDshModule, installDshModuleLoader, loadDshClientBundles } from "../research-harness/moduleLoader";

installDshModuleLoader();
await loadDshClientBundles();

const runtime = getDshModule<Record<string, unknown>>("@deepseek-ai/dsh-client-runtime");

export const ConversationEventRegistry = runtime.ConversationEventRegistry;
export const ConversationNodeAssembler = runtime.ConversationNodeAssembler;
export const ConversationViewRegistry = runtime.ConversationViewRegistry;
export const EMPTY_CHAT_SNAPSHOT = runtime.EMPTY_CHAT_SNAPSHOT;
export const EMPTY_CONVERSATION_VIEWS = runtime.EMPTY_CONVERSATION_VIEWS;
export const SessionProvideChannel = runtime.SessionProvideChannel;
export const SlotRegistry = runtime.SlotRegistry;
export const createScope = runtime.createScope;
export const createSnapshotStore = runtime.createSnapshotStore;
export const scopeOf = runtime.scopeOf;
export const apply = runtime.apply;
export const inject = runtime.inject;
export const defineStore = runtime.defineStore;
export const displayFailureMessage = runtime.displayFailureMessage;
export const emptyAssistantBlock = runtime.emptyAssistantBlock;
export const toAssistantBlock = runtime.toAssistantBlock;
export const toAssistantBlocks = runtime.toAssistantBlocks;
export const isTokenDelta = runtime.isTokenDelta;
export const isAppendSurfaceEvent = runtime.isAppendSurfaceEvent;
export const isReplacementSurfaceEvent = runtime.isReplacementSurfaceEvent;
export const contextForm = runtime.contextForm;
export const contextProvenance = runtime.contextProvenance;
export const indexSubagentDescendants = runtime.indexSubagentDescendants;
export const resolveWorkspacePath = runtime.resolveWorkspacePath;
export const shallowEqual = runtime.shallowEqual;
export const workspaceTitleOf = runtime.workspaceTitleOf;

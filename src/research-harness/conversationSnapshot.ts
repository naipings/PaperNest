import type { ConversationSnapshot } from "@deepseek-ai/dsh-client-runtime/client";

/** 与 @deepseek-ai/dsh-client-test-runtime 中 conversationSnapshot 一致（空 views/chat 由 sync 覆盖） */
export function conversationSnapshot(sessionId: string): ConversationSnapshot {
  return {
    sessionId,
    views: new Map() as ConversationSnapshot["views"],
    chat: {
      legacy: {
        nodes: [],
        turnTimings: new Map(),
        turnEnds: new Map(),
        partial: null,
        runningCalls: [],
      },
    } as unknown as ConversationSnapshot["chat"],
    nodes: [],
    turnTimings: new Map(),
    turnEnds: new Map(),
    partial: null,
    runningCalls: [],
    pending: [],
    queue: [],
    running: false,
    subagent: null,
    composerPhase: "active",
    removed: false,
    openState: "open",
    openError: null,
    hasMore: false,
    loadingOlder: false,
    promptError: null,
    blank: false,
    lastAgentError: null,
  };
}

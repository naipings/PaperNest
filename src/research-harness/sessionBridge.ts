import { invoke } from "@tauri-apps/api/core";

/** Rust `research_dsh_*` 返回的事件行；与 DSH SessionEvent 同形，避免浏览器加载 dsh-session。 */
export type DshSessionEvent = Record<string, unknown> & { seq?: number };

export interface DshSessionSnapshot {
  header: {
    type: "session";
    version: number;
    id: string;
    createdAt: number;
    cwd?: string;
    delegationDepth?: number;
  };
  events: DshSessionEvent[];
}

export async function loadDshSnapshot(researchSessionId: string): Promise<DshSessionSnapshot> {
  return invoke<DshSessionSnapshot>("research_dsh_load_snapshot", { id: researchSessionId });
}

export async function appendDshEvent(researchSessionId: string, event: DshSessionEvent): Promise<DshSessionEvent> {
  return invoke<DshSessionEvent>("research_dsh_append_event", { id: researchSessionId, event });
}

export async function loadDefaultResumeBoundary(researchSessionId: string): Promise<number> {
  return invoke<number>("research_dsh_default_boundary", { id: researchSessionId });
}

export async function deriveDshMessages(researchSessionId: string): Promise<unknown[]> {
  return invoke<unknown[]>("research_dsh_derive_messages", { id: researchSessionId });
}

export async function forkResearchSession(
  parentId: string,
  boundarySeq?: number,
  title?: string,
): Promise<{ id: string }> {
  return invoke<{ id: string; title: string; status: string }>("research_fork_session", {
    input: { id: parentId, boundarySeq, title },
  });
}

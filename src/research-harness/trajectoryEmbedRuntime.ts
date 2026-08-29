/**
 * 桌面端嵌入 Trajectory 的生产运行时（不依赖 SlotTestRuntime / vitest）。
 */
import { Context } from "@deepseek-ai/cordis";
import { Fragment, createElement, useSyncExternalStore, type ReactElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { flushSync } from "react-dom";
import { createSlotRenderer } from "@deepseek-ai/dsh-client-web-react";
import type { ConversationSnapshot } from "@deepseek-ai/dsh-client-runtime/client";
import type { DshSessionEvent } from "./sessionBridge";
import { conversationSnapshot } from "./conversationSnapshot";
import { createStubLocale } from "./stubLocale";
import { getDshModule, installDshModuleLoader, loadDshClientBundles } from "./moduleLoader";

type DshRuntimeExports = {
  SlotRegistry: new (ctx: Context) => unknown;
  ConversationEventRegistry: new (ctx: Context) => unknown;
  ConversationViewRegistry: new (ctx: Context) => unknown;
  ConversationNodeAssembler: new (
    events: unknown,
    views: unknown,
  ) => {
    replaceWindow: (entries: { event: DshSessionEvent; view: undefined }[], hasMore: boolean) => unknown;
    flush: () => boolean;
    snapshot: (target: string) => unknown;
  };
  SessionProvideChannel: new (opts: {
    rebuildBundles: () => void;
    resolveCurrent: () => unknown;
  }) => {
    materializeInfo: (binding: unknown) => unknown;
    maybeInfo: unknown;
    currentProvideInfo: unknown;
    publishCurrent: () => void;
  };
  createScope: (ctx: Context, id: string) => { ctx: Context; fiber: { dispose: () => Promise<void> } };
  createSnapshotStore: <T>(init: T) => SnapshotStore<T>;
  EMPTY_CHAT_SNAPSHOT: ConversationSnapshot["chat"];
};

type SnapshotStore<T> = {
  getSnapshot: () => T;
  subscribe: (fn: () => void) => () => void;
  update: (mutate: (draft: T) => void) => void;
};

type TrajectoryPlugin = {
  inject: string[] | Record<string, unknown>;
  apply: (ctx: Context) => void;
};

class OwnerPropsCell {
  private owners = new Map<string, unknown>();
  private listeners = new Set<() => void>();
  private version = 0;

  getVersion = () => this.version;

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  set(key: string, owner: unknown) {
    this.owners.set(key, owner);
    this.version += 1;
    for (const fn of [...this.listeners]) fn();
  }

  entries() {
    return [...this.owners.entries()];
  }
}

function createEmbedSessions(rootCtx: Context, dsh: DshRuntimeExports) {
  const { createSnapshotStore, SessionProvideChannel, createScope } = dsh;

  class EmbedSessions {
    list: SnapshotStore<{
      ids: string[];
      byId: Record<string, { id: string; displayTitle: string; running: boolean; blank: boolean; updatedAt: number }>;
      current: string | undefined;
      phase: "ready";
      subagentsByParent: Record<string, string[]>;
      jobsBySession: Record<string, unknown[]>;
      currentAddress: string | undefined;
    }>;

    channel: InstanceType<typeof SessionProvideChannel>;

    currentProvideInfo: unknown;

    private records = new Map<
      string,
      {
        id: string;
        summary: { id: string; displayTitle: string; running: boolean; blank: boolean; updatedAt: number };
        snapshot: SnapshotStore<ConversationSnapshot>;
        session: {
          sessionId: string;
          getSnapshot: () => ConversationSnapshot;
          subscribe: (fn: () => void) => () => void;
          loadOlder: () => Promise<void>;
        };
        scope?: Context;
        scopeFiber?: { dispose: () => Promise<void> };
        provideInfo?: unknown;
      }
    >();

    constructor() {
      this.list = createSnapshotStore({
        ids: [],
        byId: {},
        current: undefined,
        phase: "ready",
        subagentsByParent: {},
        jobsBySession: {},
        currentAddress: undefined,
      });

      this.channel = new SessionProvideChannel({
        rebuildBundles: () => {
          for (const record of this.records.values()) {
            if (record.provideInfo !== undefined) {
              record.provideInfo = this.channel.materializeInfo(this.bindingOf(record.id, record));
            }
          }
        },
        resolveCurrent: () => this.maybeProvideInfo(this.list.getSnapshot().current),
      });
      this.currentProvideInfo = this.channel.currentProvideInfo;
      this.list.subscribe(() => this.channel.publishCurrent());
    }

    async add(input: {
      id: string;
      session: { loadOlder: () => Promise<void> };
      snapshot: ConversationSnapshot;
    }) {
      const id = input.id;
      if (this.records.has(id)) return id;
      const summary = {
        id,
        displayTitle: id,
        running: false,
        blank: false,
        updatedAt: this.records.size + 1,
      };
      const snapshot = createSnapshotStore({
        ...conversationSnapshot(id),
        ...input.snapshot,
      });
      const sessionFace = {
        sessionId: id,
        getSnapshot: () => snapshot.getSnapshot(),
        subscribe: (fn: () => void) => snapshot.subscribe(fn),
        loadOlder: input.session.loadOlder,
      };
      this.records.set(id, { id, summary, snapshot, session: sessionFace });
      flushSync(() => {
        this.list.update(draft => {
          draft.ids.push(id);
          draft.byId[id] = summary;
          draft.current = id;
        });
      });
      return id;
    }

    async updateSnapshot(id: string, mutate: (draft: ConversationSnapshot) => void) {
      const record = this.records.get(id);
      if (!record) return;
      flushSync(() => record.snapshot.update(mutate));
    }

    async setCurrent(id: string) {
      if (!this.records.has(id)) return;
      flushSync(() => {
        this.list.update(draft => {
          draft.current = id;
        });
      });
    }

    binding(id: string) {
      const record = this.records.get(id);
      if (!record) return undefined;
      return this.bindingOf(id, record);
    }

    provideInfo(id: string) {
      const record = this.records.get(id);
      if (!record) return undefined;
      record.provideInfo ??= this.channel.materializeInfo(this.bindingOf(id, record));
      return record.provideInfo;
    }

    maybeProvideInfo(id?: string) {
      return (id ? this.provideInfo(id) : undefined) ?? this.channel.maybeInfo;
    }

    private bindingOf(id: string, record: NonNullable<ReturnType<typeof this.records.get>>) {
      return {
        sessionId: id,
        session: record.session,
        ctx: this.scope(id),
      };
    }

    private scope(id: string) {
      const record = this.records.get(id);
      if (!record) return undefined;
      if (!record.scope) {
        const handle = createScope(rootCtx, id);
        record.scope = handle.ctx;
        record.scopeFiber = handle.fiber;
      }
      return record.scope;
    }
  }

  return new EmbedSessions();
}

function createEmbedWorkspaces(dsh: DshRuntimeExports) {
  const { createSnapshotStore } = dsh;
  const list = createSnapshotStore({
    items: [],
    archivedSessionIds: [],
    state: "idle" as const,
    phase: "ready" as const,
    error: null,
    baselinesReady: true,
    recentWorkspaceId: undefined,
  });
  return {
    list,
    update(mutate: (draft: typeof list extends SnapshotStore<infer T> ? T : never) => void) {
      list.update(mutate);
    },
    connectWorkspace: async (workspaceId: string) => `session-of-${workspaceId}`,
    startSession: () => undefined,
    create: async (input: { path: string }) => ({
      workspaceId: `ws-${input.path}`,
      title: input.path,
      path: input.path,
      sessionIds: [] as string[],
    }),
    openPath: async () => undefined,
  };
}

export type TrajectoryEmbedRuntime = {
  ctx: Context;
  sessions: ReturnType<typeof createEmbedSessions>;
  mount: (plugin: TrajectoryPlugin) => Promise<void>;
  declare: (children: Record<string, unknown>) => Promise<void>;
  renderSlot: (
    key: string,
    owner: unknown,
    mountEl?: HTMLElement,
  ) => { container: HTMLElement; update: (owner: unknown) => void };
};

let runtimePromise: Promise<TrajectoryEmbedRuntime> | null = null;
let dshRuntimePromise: Promise<DshRuntimeExports> | null = null;
let reactRoot: Root | null = null;
let trajectoryMountRoot: HTMLDivElement | null = null;

/** 测试或重试前清空单例运行时 */
export function resetTrajectoryRuntime(): void {
  runtimePromise = null;
  reactRoot?.unmount();
  reactRoot = null;
  trajectoryMountRoot = null;
}

async function ensureDshRuntimeExports(): Promise<DshRuntimeExports> {
  if (!dshRuntimePromise) {
    dshRuntimePromise = (async () => {
      installDshModuleLoader();
      await loadDshClientBundles();
      const mod = getDshModule<DshRuntimeExports>("@deepseek-ai/dsh-client-runtime");
      if (!mod.SlotRegistry || !mod.ConversationEventRegistry || !mod.ConversationViewRegistry) {
        throw new Error(
          `DSH runtime 导出不完整（键：${Object.keys(mod as object).slice(0, 12).join(", ")}）`,
        );
      }
      return mod;
    })().catch(error => {
      dshRuntimePromise = null;
      throw error;
    });
  }
  return dshRuntimePromise;
}

function trajectoryPlugin(): TrajectoryPlugin {
  const mod = getDshModule<Record<string, unknown>>("@deepseek-ai/dsh-client-ui-trajectory");
  if (typeof mod.apply !== "function") {
    throw new Error(`DSH trajectory 缺少 apply（导出键：${Object.keys(mod).join(", ")}）`);
  }
  if (!mod.inject) {
    throw new Error("DSH trajectory 缺少 inject");
  }
  return { apply: mod.apply as TrajectoryPlugin["apply"], inject: mod.inject as TrajectoryPlugin["inject"] };
}

export async function ensureTrajectoryRuntime(): Promise<TrajectoryEmbedRuntime> {
  if (runtimePromise) return runtimePromise;
  runtimePromise = (async () => {
    const dsh = await ensureDshRuntimeExports();
    const { SlotRegistry, ConversationEventRegistry, ConversationViewRegistry } = dsh;

    const ctx = new Context();
    await ctx.plugin(SlotRegistry).await();
    await ctx.plugin(ConversationEventRegistry).await();
    await ctx.plugin(ConversationViewRegistry).await();

    const slots = ctx.get("slots") as {
      install: (spec: { renderRoot: (host: unknown, owner: unknown) => unknown }) => void;
      register: (spec: unknown, frame: unknown) => () => void;
      renderSlot: (name: string, owner: unknown) => unknown;
    };
    const sessions = createEmbedSessions(ctx, dsh);
    const workspaces = createEmbedWorkspaces(dsh);
    ctx.provide("sessions", sessions);
    ctx.provide("workspaces", workspaces);

    // installLocale 经 ctx.effect 注册，须在插件 fiber 内调用才会写入 host.locale
    await ctx
      .plugin({
        apply(bootCtx) {
          const bootSlots = bootCtx.get("slots") as { installLocale: (face: unknown) => void };
          const locale = createStubLocale();
          bootCtx.provide("locale", locale);
          bootSlots.installLocale(locale);
        },
      })
      .await();

    const renderer = createSlotRenderer();
    slots.install({
      renderRoot: (host, ownerProps) =>
        (renderer.renderRoot as (host: unknown, owner: unknown) => unknown)(host, ownerProps),
    });

    const ownerCell = new OwnerPropsCell();
    const autoDeclared = new Set<string>();

    const runtime: TrajectoryEmbedRuntime = {
      ctx,
      sessions,
      async mount(plugin) {
        const fiber = ctx.plugin(plugin);
        await fiber.await();
      },
      async declare(children) {
        for (const key of Object.keys(children)) autoDeclared.add(key);
        const AutoFrame = (props: {
          renderSlot: (key: string, owner: unknown, opts?: { only?: string }) => unknown;
        }) => {
          useSyncExternalStore(ownerCell.subscribe, ownerCell.getVersion);
          return createElement(
            Fragment,
            null,
            ownerCell.entries().map(([key, owner]) => {
              const propsOwner = owner as { only?: string; sessionId?: string };
              const opts = propsOwner.only !== undefined ? { only: propsOwner.only } : undefined;
              return createElement(
                Fragment,
                { key },
                props.renderSlot(key, owner, opts) as ReactNode,
              );
            }),
          );
        };
        flushSync(() => {
          slots.register({ name: "root", children }, AutoFrame);
        });
      },
      renderSlot(key, owner, parentEl) {
        if (!autoDeclared.has(key)) {
          throw new Error(`renderSlot('${key}') 前须先 declare`);
        }
        const install = (next: unknown) => {
          flushSync(() => ownerCell.set(key, next));
        };
        install(owner);
        if (!parentEl) {
          throw new Error("renderSlot 需要挂载容器");
        }
        if (!trajectoryMountRoot || !parentEl.contains(trajectoryMountRoot)) {
          trajectoryMountRoot = document.createElement("div");
          trajectoryMountRoot.className = "dsh-trajectory-mount";
          trajectoryMountRoot.style.display = "contents";
          parentEl.replaceChildren(trajectoryMountRoot);
          reactRoot = createRoot(trajectoryMountRoot);
        }
        flushSync(() => {
          reactRoot!.render(slots.renderSlot("root", {}) as ReactElement);
        });
        const container = trajectoryMountRoot.querySelector(`[data-slot="${key}"]`);
        if (!(container instanceof HTMLElement)) {
          const found = [...trajectoryMountRoot.querySelectorAll("[data-slot]")].map(el =>
            el.getAttribute("data-slot"),
          );
          const rootEntries = slots.entries("root") as unknown[];
          const viewEntries = slots.entries("conversation.view") as unknown[];
          throw new Error(
            `renderSlot('${key}'): 未找到 data-slot 容器（已有：${found.length ? found.join(", ") : "无"}；root注册=${rootEntries.length}；view注册=${viewEntries.length}；html=${trajectoryMountRoot.innerHTML.slice(0, 120)}）`,
          );
        }
        return { container, update: install };
      },
    };

    await runtime.mount(trajectoryPlugin());
    await runtime.declare({
      "conversation.view": { kind: "list", scope: "session" },
    });
    return runtime;
  })().catch(error => {
    runtimePromise = null;
    throw error;
  });
  return runtimePromise;
}

export async function syncTrajectorySession(sessionId: string, events: DshSessionEvent[]): Promise<number> {
  const runtime = await ensureTrajectoryRuntime();
  const dsh = await ensureDshRuntimeExports();
  const { ConversationNodeAssembler, EMPTY_CHAT_SNAPSHOT } = dsh;
  const eventsApi = runtime.ctx.get("conversationEvents");
  const viewsApi = runtime.ctx.get("conversationViews");
  if (!eventsApi || !viewsApi) {
    throw new Error("DSH conversation registries unavailable");
  }

  const inputs = events.map(event => ({ event, view: undefined as undefined }));
  const assembler = new ConversationNodeAssembler(eventsApi, viewsApi);
  assembler.replaceWindow(inputs, false);
  assembler.flush();

  const chat = (assembler.snapshot("chat") as ConversationSnapshot["chat"] | undefined) ?? EMPTY_CHAT_SNAPSHOT;
  const legacy = chat.legacy;
  const snapshot: ConversationSnapshot = {
    ...conversationSnapshot(sessionId),
    sessionId: sessionId as ConversationSnapshot["sessionId"],
    views: assembler as unknown as ConversationSnapshot["views"],
    chat,
    nodes: legacy.nodes,
    turnTimings: legacy.turnTimings,
    turnEnds: legacy.turnEnds,
    partial: legacy.partial,
    runningCalls: legacy.runningCalls,
  };

  const existing = runtime.sessions.binding(sessionId);
  if (!existing) {
    await runtime.sessions.add({
      id: sessionId,
      session: { loadOlder: async () => undefined },
      snapshot,
    });
    await runtime.sessions.setCurrent(sessionId);
  } else {
    await runtime.sessions.updateSnapshot(sessionId, draft => {
      Object.assign(draft, snapshot);
    });
  }

  return events.length;
}

export function trajectoryOwnerProps(sessionId: string) {
  return {
    only: "trajectory" as const,
    sessionId,
  };
}

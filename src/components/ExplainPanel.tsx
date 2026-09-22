import { History, Plus, SendHorizontal, Sparkles, Trash2 } from "lucide-react";
import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { extractExplainCites } from "../lib/explainCites";
import { getExplainAskInflight, getExplainStartInflight, trackExplainAsk, trackExplainStart } from "../lib/paperExplainInflight";
import { backend } from "../services/backend";
import { useLibrary } from "../state/LibraryContext";
import type { Paper, PaperExplainChatSummary, PaperExplainOverview, PaperExplainSession } from "../types";
import { ExplainAnswerMarkdown } from "./ExplainAnswerMarkdown";

const QUICK_QUESTIONS = ["这篇的核心贡献是什么？", "方法上有哪些关键设计？", "结论与局限是什么？"];
const CITE_SPLIT = /(\(?P\.?\s*\d+(?:\s*[-–—~～到至]\s*P?\.?\s*\d+)?(?:\s*[,，、/]\s*P\.?\s*\d+)*\)?|第\s*\d+\s*页)/gi;

function titleLine(paper: Paper) {
  const title = (paper.titleZh || paper.titleEn || "未命名论文").trim();
  return title.length > 42 ? `${title.slice(0, 42)}…` : title;
}

function OverviewCards({ overview, onJump }: { overview: PaperExplainOverview; onJump?(page: number): void }) {
  const blocks: { label: string; body: string }[] = [
    { label: "一句话", body: overview.summary },
    { label: "问题与动机", body: overview.problem },
    { label: "方法", body: overview.method },
    { label: "结果与贡献", body: overview.findings },
    { label: "局限", body: overview.limits },
    { label: "精读建议", body: overview.readingTips },
  ].filter(item => item.body.trim());

  return (
    <div className="explain-overview">
      {blocks.map(item => (
        <section className="summary-card explain-card" key={item.label}>
          <label>{item.label}</label>
          <p className="explain-card-body">
            {item.body.split("\n").map((line, index) => (
              <span key={`${item.label}-${index}`}>
                {index > 0 && <br />}
                <CiteText text={line} onJump={onJump} />
              </span>
            ))}
          </p>
        </section>
      ))}
    </div>
  );
}

function formatChatTime(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hour = String(date.getHours()).padStart(2, "0");
  const minute = String(date.getMinutes()).padStart(2, "0");
  return `${month}-${day} ${hour}:${minute}`;
}

function CiteText({ text, onJump }: { text: string; onJump?(page: number): void }) {
  if (!onJump) return <>{text}</>;
  const parts = text.split(CITE_SPLIT);
  return (
    <>
      {parts.map((part, index) => {
        const pages = extractExplainCites(part);
        if (!pages.length || !/P\.?\s*\d+|第\s*\d+\s*页/i.test(part)) {
          return <span key={index}>{part}</span>;
        }
        return (
          <button type="button" className="explain-cite" key={index} onClick={() => onJump(pages[0])}>
            {part}
          </button>
        );
      })}
    </>
  );
}

export function ExplainPanel({
  paper,
  pageTextReady,
  llmReady,
  onJumpPage,
}: {
  paper: Paper;
  pageTextReady: boolean;
  llmReady: boolean;
  onJumpPage(page: number): void;
}) {
  const { paperExplaining, startPaperExplain, finishPaperExplain } = useLibrary();
  const [session, setSession] = useState<PaperExplainSession | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState("");
  const [draft, setDraft] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const historyRef = useRef<HTMLDivElement>(null);
  const explainingLabel = paperExplaining[paper.id];
  const starting = busy || (!!explainingLabel && explainingLabel.includes("解读"));
  const answering = asking || (!!explainingLabel && explainingLabel.includes("回答"));

  useEffect(() => {
    let cancelled = false;
    setHydrated(false);
    setSession(null);
    setError("");

    async function hydrate() {
      const startJob = getExplainStartInflight(paper.id);
      if (startJob) {
        setBusy(true);
        setHydrated(true);
        try {
          const next = await startJob;
          if (!cancelled) setSession(next);
        } catch (err) {
          if (!cancelled) setError(err instanceof Error ? err.message : String(err));
        } finally {
          if (!cancelled) setBusy(false);
        }
        return;
      }

      try {
        const value = await backend.explainGet(paper.id);
        if (cancelled) return;
        setSession(value);
        setHydrated(true);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
        setSession({ paperId: paper.id, locale: "zh-CN", overview: null, messages: [], model: null, updatedAt: null });
        setHydrated(true);
      }

      const askJob = getExplainAskInflight(paper.id);
      if (askJob) {
        setAsking(true);
        try {
          const next = await askJob;
          if (!cancelled) setSession(next);
        } catch (err) {
          if (!cancelled) setError(err instanceof Error ? err.message : String(err));
        } finally {
          if (!cancelled) setAsking(false);
        }
      }
    }

    void hydrate();
    return () => { cancelled = true; };
  }, [paper.id]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView?.({ block: "nearest" });
  }, [session?.messages.length, answering]);

  useEffect(() => {
    if (!historyOpen) return;
    const onPointer = (event: MouseEvent) => {
      if (!historyRef.current?.contains(event.target as Node)) setHistoryOpen(false);
    };
    document.addEventListener("mousedown", onPointer);
    return () => document.removeEventListener("mousedown", onPointer);
  }, [historyOpen]);

  useEffect(() => {
    setHistoryOpen(false);
  }, [paper.id]);

  async function startExplain(resetChat = true) {
    if (!llmReady) {
      setError("请先在设置中配置 LLM API Key");
      return;
    }
    if (!pageTextReady) {
      setError(paper.hasTextLayer === false
        ? "尚无正文文本。扫描版请先 OCR。"
        : "正文仍在抽取入库，请稍候再试。");
      return;
    }
    if (getExplainStartInflight(paper.id)) return;
    const label = `正在解读：${titleLine(paper)}`;
    setBusy(true);
    setError("");
    startPaperExplain(paper.id, label);
    try {
      const next = await trackExplainStart(paper.id, () => backend.explainStart(paper.id, "zh-CN", resetChat));
      setSession(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      finishPaperExplain(paper.id);
      setBusy(false);
    }
  }

  async function ask(questionRaw?: string) {
    const question = (questionRaw ?? draft).trim();
    if (!question || answering) return;
    if (!llmReady) {
      setError("请先在设置中配置 LLM API Key");
      return;
    }
    if (getExplainAskInflight(paper.id)) return;
    setAsking(true);
    setError("");
    setDraft("");
    startPaperExplain(paper.id, `正在回答：${titleLine(paper)}`);
    try {
      const next = await trackExplainAsk(paper.id, () => backend.explainAsk(paper.id, question));
      setSession(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setDraft(question);
    } finally {
      finishPaperExplain(paper.id);
      setAsking(false);
    }
  }

  async function newChat() {
    if (starting || answering) return;
    setBusy(true);
    setError("");
    setHistoryOpen(false);
    try {
      setSession(await backend.explainNewChat(paper.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function switchChat(chatId: string) {
    if (starting || answering || chatId === session?.chatId) {
      setHistoryOpen(false);
      return;
    }
    setBusy(true);
    setError("");
    setHistoryOpen(false);
    try {
      setSession(await backend.explainSwitchChat(paper.id, chatId));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function deleteChat(chat: PaperExplainChatSummary, event: ReactMouseEvent) {
    event.stopPropagation();
    if (starting || answering) return;
    if (!confirm(`删除对话「${chat.title}」？`)) return;
    setBusy(true);
    setError("");
    try {
      setSession(await backend.explainDeleteChat(paper.id, chat.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function deleteTurn(messageIndex: number) {
    if (starting || answering) return;
    if (!confirm("删除这一轮问答？")) return;
    setBusy(true);
    setError("");
    try {
      setSession(await backend.explainDeleteTurn(paper.id, messageIndex));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function resetAll() {
    if (!confirm("清除本篇解读与对话记录？")) return;
    setBusy(true);
    setError("");
    try {
      setSession(await backend.explainReset(paper.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const overview = session?.overview ?? null;
  const messages = session?.messages ?? [];
  const chats = session?.chats ?? [];
  const activeChatId = session?.chatId ?? null;
  const activeChatTitle = chats.find(item => item.id === activeChatId)?.title ?? "新对话";
  const meta = `PDF · ${paper.pageCount ?? "?"} 页`;
  const canStart = llmReady && pageTextReady && !starting && !answering;

  if (!hydrated) {
    return (
      <div className="explain-panel explain-loading" data-testid="explain-hydrating">
        <Sparkles size={22} className="explain-spin" />
        <p>加载解读会话…</p>
      </div>
    );
  }

  if (!overview && !starting) {
    return (
      <div className="explain-panel explain-welcome">
        <div className="explain-hero">
          <Sparkles size={28} />
          <h3>解读这篇论文</h3>
          <p>先生成结构化讲稿，再就正文继续提问。</p>
        </div>
        <div className="explain-start-card">
          <div className="explain-file">
            <strong title={paper.titleZh || paper.titleEn}>{titleLine(paper)}</strong>
            <small>{meta}</small>
          </div>
          <label className="explain-label">回复语言</label>
          <select className="explain-select" value="zh-CN" disabled>
            <option value="zh-CN">中文（简体）</option>
          </select>
          <button type="button" className="explain-primary" disabled={!canStart} onClick={() => void startExplain(true)}>
            开始解读
          </button>
          {!llmReady && <p className="explain-notice">需要先在设置中保存 LLM API Key。</p>}
          {llmReady && !pageTextReady && (
            <p className="explain-notice">
              {paper.hasTextLayer === false ? "尚无正文文本。扫描版请先 OCR。" : "正在抽取正文，请稍候…"}
            </p>
          )}
          {error && <p className="explain-notice">{error}</p>}
          <p className="explain-disclaimer">AI 生成内容，仅供参考。</p>
        </div>
      </div>
    );
  }

  if (starting && !overview) {
    return (
      <div className="explain-panel explain-loading" data-testid="explain-starting">
        <Sparkles size={22} className="explain-spin" />
        <p>正在解读全文…</p>
        <p className="muted">通常需要数十秒，取决于模型与论文长度。可切换其它页，进度会保留。</p>
        {error && <p className="explain-notice">{error}</p>}
      </div>
    );
  }

  return (
    <div className="explain-panel explain-ready">
      <header className="explain-toolbar">
        <div className="explain-toolbar-title">
          <strong>解读</strong>
          <small className="muted" title={activeChatTitle}>{activeChatTitle}</small>
        </div>
        <div className="explain-toolbar-actions">
          <button type="button" className="secondary" disabled={starting || answering || busy} onClick={() => void newChat()} title="新建对话（复用已有讲稿）">
            <Plus size={14} />
          </button>
          <div className="explain-history" ref={historyRef}>
            <button
              type="button"
              className="secondary"
              disabled={starting || answering || busy || !chats.length}
              onClick={() => setHistoryOpen(value => !value)}
              title="查看历史对话"
            >
              <History size={14} />
            </button>
            {historyOpen && (
              <div className="explain-history-menu" role="menu">
                {chats.map(chat => (
                  <div
                    className={`explain-history-item ${chat.id === activeChatId ? "is-active" : ""}`}
                    key={chat.id}
                    role="menuitem"
                    onClick={() => void switchChat(chat.id)}
                  >
                    <div className="explain-history-copy">
                      <strong>{chat.title || "新对话"}</strong>
                      <small>{formatChatTime(chat.updatedAt)} · {chat.messageCount} 条</small>
                    </div>
                    <button
                      type="button"
                      className="explain-history-delete"
                      title="删除此对话"
                      onClick={event => void deleteChat(chat, event)}
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
          <button type="button" className="secondary" disabled={starting || answering} onClick={() => void startExplain(false)} title="重新生成结构化讲稿，保留各对话">
            重新解读
          </button>
          <button type="button" className="secondary" disabled={starting || answering} onClick={() => void resetAll()}>
            重置
          </button>
        </div>
      </header>
      {starting && <p className="explain-busy-banner">正在重新解读…</p>}
      {!messages.length && !answering && (
        <p className="explain-chat-hint muted">可直接提问；本对话复用上方讲稿，无需再次全文解读。</p>
      )}

      <div className="explain-scroll">
        {overview && <OverviewCards overview={overview} onJump={onJumpPage} />}
        <div className="explain-chat">
          {messages.map((message, index) => {
            const inlineCites = message.role === "assistant" ? extractExplainCites(message.content) : [];
            const extraCites = message.role === "assistant"
              ? (message.cites ?? []).filter(page => !inlineCites.includes(page))
              : [];
            return (
              <article className={`explain-bubble ${message.role === "user" ? "is-user" : "is-assistant"}`} key={`${message.createdAt}-${index}`}>
                {message.role === "assistant"
                  ? <ExplainAnswerMarkdown text={message.content} onJumpPage={onJumpPage} />
                  : message.content}
                {extraCites.length > 0 && (
                  <div className="explain-cite-row">
                    {extraCites.map(page => (
                      <button type="button" className="explain-cite" key={page} onClick={() => onJumpPage(page)}>P{page}</button>
                    ))}
                  </div>
                )}
                {message.role === "assistant" && (
                  <div className="explain-turn-actions">
                    <button
                      type="button"
                      className="explain-turn-delete"
                      disabled={starting || answering || busy}
                      title="删除本轮问答"
                      onClick={() => void deleteTurn(index)}
                    >
                      <Trash2 size={12} />
                      <span>删除本轮</span>
                    </button>
                  </div>
                )}
              </article>
            );
          })}
          {answering && <article className="explain-bubble is-assistant muted">正在回答…</article>}
          <div ref={bottomRef} />
        </div>
      </div>

      <div className="explain-composer">
        {!messages.length && !answering && (
          <div className="explain-quick">
            {QUICK_QUESTIONS.map(item => (
              <button type="button" key={item} className="secondary" disabled={answering || starting} onClick={() => void ask(item)}>
                {item}
              </button>
            ))}
          </div>
        )}
        <textarea
          rows={3}
          value={draft}
          placeholder="就这篇论文提问…"
          disabled={answering || starting}
          onChange={event => setDraft(event.target.value)}
          onKeyDown={event => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void ask();
            }
          }}
        />
        <div className="explain-composer-bar">
          <span className="muted">Enter 发送 · Shift+Enter 换行</span>
          <button type="button" className="explain-send" disabled={answering || starting || !draft.trim()} onClick={() => void ask()} title="发送">
            <SendHorizontal size={16} />
          </button>
        </div>
        {error && <p className="explain-notice">{error}</p>}
        <p className="explain-disclaimer">AI 生成内容，仅供参考。</p>
      </div>
    </div>
  );
}

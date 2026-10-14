import { useEffect, useRef, useState } from "react";
import { SendHorizontal, Trash2 } from "lucide-react";
import type { PaperExplainMessage } from "../../types";
import { DeepReadMarkdown } from "./DeepReadMarkdown";

type Props = {
  messages: PaperExplainMessage[];
  canAsk: boolean;
  answering: boolean;
  onAsk(question: string): Promise<boolean>;
  onDeleteTurn(messageIndex: number): void;
};

export function DeepReadChatTab({ messages, canAsk, answering, onAsk, onDeleteTurn }: Props) {
  const [draft, setDraft] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView?.({ block: "end" });
  }, [messages.length, answering]);

  const send = async () => {
    const question = draft.trim();
    if (!question) return;
    if (await onAsk(question)) setDraft("");
  };

  return (
    <div className="deepread-chat">
      <div className="deepread-chat-flow">
        {!messages.length && !answering && (
          <p className="deepread-chat-hint">{canAsk ? "基于精读报告与原文段落继续追问，回答会给出页码与段落证据。" : "报告生成完成后可追问。"}</p>
        )}
        {messages.map((message, index) => (
          <article className={`deepread-bubble ${message.role === "user" ? "is-user" : "is-assistant"}`} key={`${message.createdAt}-${index}`}>
            {message.role === "assistant" ? <DeepReadMarkdown text={message.content} /> : message.content}
            {message.role === "assistant" && (
              <div className="deepread-turn-actions">
                {!!message.skills?.length && <span className="deepread-turn-skills">使用 skill：{message.skills.join("、")}</span>}
                <button type="button" className="ghost" disabled={answering} title="删除本轮问答" onClick={() => onDeleteTurn(index)}>
                  <Trash2 size={12} />
                  删除本轮
                </button>
              </div>
            )}
          </article>
        ))}
        {answering && <article className="deepread-bubble is-assistant deepread-chat-hint">正在回答…</article>}
        <div ref={bottomRef} />
      </div>
      <div className="deepread-composer">
        <textarea
          className="research-input"
          rows={3}
          value={draft}
          placeholder="就这篇论文继续追问…"
          disabled={!canAsk || answering}
          onChange={event => setDraft(event.target.value)}
          onKeyDown={event => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void send();
            }
          }}
        />
        <div className="deepread-composer-bar">
          <span>Enter 发送 · Shift+Enter 换行</span>
          <button type="button" className="primary" disabled={!canAsk || answering || !draft.trim()} onClick={() => void send()}>
            <SendHorizontal size={15} />
            发送
          </button>
        </div>
      </div>
    </div>
  );
}

import { useRef, useState } from "react";
import { FileText, Image, Link2, LoaderCircle, Paperclip, Send, X } from "lucide-react";
import { ATTACHMENT_EXTENSIONS, extractLinks, hostOf, type AttachmentDraft } from "../../lib/researchAttachments";

const ACCEPT = ATTACHMENT_EXTENSIONS.map(ext => `.${ext}`).join(",");

type Props = {
  value: string;
  attachments: AttachmentDraft[];
  busy: boolean;
  disabled?: boolean;
  placeholder: string;
  submitLabel: string;
  hint?: string;
  rows?: number;
  onChange: (value: string) => void;
  onAddFiles: (files: File[]) => void;
  onRemoveAttachment: (id: string) => void;
  onSubmit: () => void;
};

export function ResearchComposer({
  value,
  attachments,
  busy,
  disabled = false,
  placeholder,
  submitLabel,
  hint,
  rows = 3,
  onChange,
  onAddFiles,
  onRemoveAttachment,
  onSubmit,
}: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const links = extractLinks(value);

  return (
    <div
      className={`research-composer${dragging ? " is-dragging" : ""}`}
      onDragOver={event => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={event => {
        event.preventDefault();
        setDragging(false);
        onAddFiles([...event.dataTransfer.files]);
      }}
    >
      {(attachments.length > 0 || links.length > 0) && (
        <div className="research-chip-row">
          {attachments.map(item => (
            <span key={item.id} className={`research-chip research-chip--${item.kind}`}>
              {item.kind === "image" ? <Image size={13} /> : <FileText size={13} />}
              <span className="research-chip-name">{item.name}</span>
              <small>{item.sizeLabel}</small>
              <button type="button" aria-label={`移除 ${item.name}`} onClick={() => onRemoveAttachment(item.id)}>
                <X size={12} />
              </button>
            </span>
          ))}
          {links.map(url => (
            <span key={url} className="research-chip research-chip--link" title={url}>
              <Link2 size={13} />
              <span className="research-chip-name">{hostOf(url)}</span>
            </span>
          ))}
        </div>
      )}
      <textarea
        className="research-composer-input"
        rows={rows}
        value={value}
        disabled={disabled}
        placeholder={placeholder}
        onChange={event => onChange(event.target.value)}
        onPaste={event => {
          const files = [...event.clipboardData.files];
          if (files.length) {
            event.preventDefault();
            onAddFiles(files);
          }
        }}
        onKeyDown={event => {
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            onSubmit();
          }
        }}
      />
      <div className="research-composer-actions">
        <button type="button" className="ghost" disabled={disabled} onClick={() => fileRef.current?.click()}>
          <Paperclip size={15} />
          附件
        </button>
        <span className="research-composer-hint">{hint ?? "Ctrl+Enter 发送 · 可拖入或粘贴文件 · 粘贴网址即成为链接"}</span>
        <button type="button" className="primary" disabled={busy || disabled} onClick={onSubmit}>
          {busy ? <LoaderCircle className="spin" size={15} /> : <Send size={15} />}
          {submitLabel}
        </button>
      </div>
      <input
        ref={fileRef}
        type="file"
        multiple
        accept={ACCEPT}
        hidden
        onChange={event => {
          onAddFiles([...(event.target.files ?? [])]);
          event.target.value = "";
        }}
      />
    </div>
  );
}

import { FolderOpen, Sparkles } from "lucide-react";
import { ResearchComposer } from "./ResearchComposer";
import type { AttachmentDraft } from "../../lib/researchAttachments";

type Props = {
  query: string;
  attachments: AttachmentDraft[];
  outputRequirements: string;
  workspacePath: string;
  busy: boolean;
  onQueryChange: (value: string) => void;
  onAddFiles: (files: File[]) => void;
  onRemoveAttachment: (id: string) => void;
  onOutputChange: (value: string) => void;
  onWorkspaceChange: (value: string) => void;
  onPickWorkspace: () => void;
  onCreate: () => void;
};

export function ResearchNewSessionCard({
  query,
  attachments,
  outputRequirements,
  workspacePath,
  busy,
  onQueryChange,
  onAddFiles,
  onRemoveAttachment,
  onOutputChange,
  onWorkspaceChange,
  onPickWorkspace,
  onCreate,
}: Props) {
  return (
    <section className="research-new-card" aria-labelledby="research-new-heading">
      <header className="research-new-card-head">
        <div>
          <h3 id="research-new-heading">新建调研</h3>
          <p>描述研究问题，可附上图片、PDF、Office 文档与网址。创建后可在右侧继续多轮追问。</p>
        </div>
        <span className="research-new-card-badge" aria-hidden>
          <Sparkles size={14} />
        </span>
      </header>

      <ResearchComposer
        value={query}
        attachments={attachments}
        busy={busy}
        rows={7}
        placeholder="例如：推荐系统冷启动在 2024–2026 年的主要方法与局限"
        submitLabel="创建任务"
        onChange={onQueryChange}
        onAddFiles={onAddFiles}
        onRemoveAttachment={onRemoveAttachment}
        onSubmit={onCreate}
      />

      <div className="research-field">
        <label className="research-field-label" htmlFor="research-output">
          输出要求
        </label>
        <textarea
          id="research-output"
          className="research-input research-textarea research-textarea--compact"
          rows={2}
          value={outputRequirements}
          onChange={e => onOutputChange(e.target.value)}
          placeholder="中文综述，含引用标注 [src-xxx]"
        />
      </div>

      <div className="research-field">
        <label className="research-field-label" htmlFor="research-workspace">
          项目文件夹
          <span className="research-field-optional">可选</span>
        </label>
        <div className="research-path-row">
          <input
            id="research-workspace"
            className="research-input"
            value={workspacePath}
            onChange={e => onWorkspaceChange(e.target.value)}
            placeholder="默认：资料库/research/&lt;id&gt;/"
          />
          <button type="button" className="secondary research-path-pick" onClick={onPickWorkspace}>
            <FolderOpen size={15} />
            选择
          </button>
        </div>
      </div>
    </section>
  );
}

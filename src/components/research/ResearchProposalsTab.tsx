import { ExternalLink } from "lucide-react";
import type { ResearchProposal } from "../../types";

const STATUS_LABEL: Record<string, string> = {
  pending: "待审批",
  approved: "已入库",
  rejected: "已拒绝",
};

type Props = {
  proposals: ResearchProposal[];
  researchBusy: boolean;
  onApprove: (proposalId: string, downloadPdf: boolean) => void;
  onReject: (proposalId: string) => void;
  onOpenUrl: (url: string) => void;
};

export function ResearchProposalsTab({ proposals, researchBusy, onApprove, onReject, onOpenUrl }: Props) {
  if (!proposals.length) {
    return <p className="muted research-proposals-empty">调研过程中检索到、但尚未入库的论文会出现在这里。</p>;
  }
  const pending = proposals.filter(item => item.status === "pending").length;
  return (
    <div className="research-proposals-tab">
      <p className="muted research-proposals-summary">共 {proposals.length} 篇候选，{pending} 篇待审批。</p>
      <div className="radar-card-list">
        {proposals.map(item => (
          <article
            key={item.id}
            className={`radar-card${item.status === "approved" ? " in-library" : ""}${item.status === "rejected" ? " is-hidden" : ""}`}
          >
            <header>
              <strong>{item.title}</strong>
              <div className="radar-card-meta">
                {item.arxivId && <span>arXiv {item.arxivId}</span>}
                <span>{STATUS_LABEL[item.status] ?? item.status}</span>
                {item.resolvedPaperId && <span>论文 ID {item.resolvedPaperId}</span>}
              </div>
            </header>
            <p>{item.abstractEn?.trim() || "暂无摘要"}</p>
            <footer>
              {item.url && (
                <button type="button" className="ghost" onClick={() => onOpenUrl(item.url!)}>
                  <ExternalLink size={14} />
                  原文
                </button>
              )}
              {item.status === "pending" && (
                <>
                  <button type="button" className="secondary" disabled={researchBusy} onClick={() => onApprove(item.id, false)}>
                    仅元数据
                  </button>
                  <button type="button" className="primary" disabled={researchBusy} onClick={() => onApprove(item.id, true)}>
                    下载 PDF 入库
                  </button>
                  <button type="button" className="ghost" disabled={researchBusy} onClick={() => onReject(item.id)}>
                    拒绝
                  </button>
                </>
              )}
            </footer>
          </article>
        ))}
      </div>
    </div>
  );
}

import { useEffect, useRef, useState } from "react";
import { Columns2, LoaderCircle, X } from "lucide-react";
import { backend } from "../../services/backend";
import { useLibrary } from "../../state/LibraryContext";
import { figureRect, parseEvidence, resolveEvidence } from "../../lib/deepReadEvidence";
import { PdfReader, type PdfReaderHandle } from "../PdfReader";
import { Modal } from "../Modal";
import { DeepReadReportTab } from "./DeepReadReportTab";
import type { DeepRead, DeepReadDetail } from "../../types";

/** 对照阅读：左侧精读报告，右侧阅读台；只列出已关联论文库论文的任务。 */
export function DeepReadCompare({ tasks, initialId, onExit }: { tasks: DeepRead[]; initialId: string; onExit(id: string): void }) {
  const { data } = useLibrary();
  const readerRef = useRef<PdfReaderHandle>(null);
  const leaveAfterRef = useRef<(() => void) | undefined>(undefined);
  const [taskId, setTaskId] = useState(initialId);
  const [detail, setDetail] = useState<DeepReadDetail>();
  const [notice, setNotice] = useState("");
  const [leavePrompt, setLeavePrompt] = useState(false);
  const [loading, setLoading] = useState(true);

  const linked = tasks.filter(task => task.paperId && data?.papers.some(paper => paper.id === task.paperId && !paper.deletedAt));
  const task = linked.find(item => item.id === taskId);
  const paper = data?.papers.find(item => item.id === task?.paperId);

  useEffect(() => {
    let current = true;
    setDetail(undefined);
    setNotice("");
    setLoading(true);
    void backend.deepreadGet(taskId).then(next => { if (current) setDetail(next); })
      .catch(error => { if (current) setNotice(error instanceof Error ? error.message : String(error)); })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [taskId]);

  const guard = (after: () => void) => {
    if (!readerRef.current?.isDirty()) {
      after();
      return;
    }
    leaveAfterRef.current = after;
    setLeavePrompt(true);
  };

  const finishLeave = async (discard: boolean) => {
    if (discard) await readerRef.current?.discard();
    const after = leaveAfterRef.current;
    leaveAfterRef.current = undefined;
    setLeavePrompt(false);
    after?.();
  };

  const revealEvidence = (segment: string) => {
    const reader = readerRef.current;
    if (!reader || !detail) return;
    const target = resolveEvidence(parseEvidence(segment), detail.paragraphs, detail.figures, reader.pageSize());
    if (!target) {
      setNotice(`无法定位证据：${segment}`);
      return;
    }
    setNotice(target.marks.length && target.marks.every(mark => !mark.rects.length) ? `已跳到第 ${target.page} 页（该任务创建时未记录段落位置，无法高亮段落）` : "");
    reader.reveal(target.page, target.marks);
  };

  const revealFigure = (src: string) => {
    const reader = readerRef.current;
    const figure = detail?.figures.find(item => item.image === src);
    if (!reader || !figure) {
      setNotice(`插图不在提取清单中：${src}`);
      return;
    }
    setNotice("");
    reader.reveal(figure.page, [{ page: figure.page, rects: [figureRect(figure.regionBoundary, reader.pageSize())] }]);
  };

  return (
    <main className="deepread-compare">
      <header className="deepread-compare-bar">
        <Columns2 size={17} />
        <strong>对照阅读</strong>
        <select aria-label="切换精读报告" value={taskId} onChange={event => { const next = event.target.value; guard(() => setTaskId(next)); }}>
          {linked.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}
        </select>
        <button type="button" className="secondary" onClick={() => guard(() => onExit(taskId))}><X size={16} />退出对照</button>
      </header>
      {notice && <div className="deepread-notice" role="status">{notice}</div>}
      <div className="deepread-compare-body">
        <section className="deepread-compare-report" aria-label="精读报告">
          {detail?.task.id === taskId
            ? <DeepReadReportTab detail={detail} onEvidence={revealEvidence} onFigure={revealFigure} />
            : <div className="research-report-empty" role="status">{loading ? <><LoaderCircle className="spin" size={22} /><p>正在加载报告…</p></> : <p>报告加载失败，请切换任务后重试。</p>}</div>}
        </section>
        <section className="deepread-compare-reader" aria-label="论文原文">
          {paper && <PdfReader key={paper.id} ref={readerRef} pane paper={paper} onBack={() => guard(() => onExit(taskId))} />}
        </section>
      </div>
      {leavePrompt && <Modal title="离开阅读台" onClose={() => { leaveAfterRef.current = undefined; setLeavePrompt(false); }}>
        <div className="paper-editor">
          <p>当前有高亮、批注或收录改动。是否保存后离开？</p>
          <footer>
            <button type="button" className="ghost" onClick={() => { leaveAfterRef.current = undefined; setLeavePrompt(false); }}>取消</button>
            <button type="button" className="secondary" onClick={() => void finishLeave(true)}>不保存</button>
            <button type="button" className="primary" onClick={() => void finishLeave(false)}>保存并离开</button>
          </footer>
        </div>
      </Modal>}
    </main>
  );
}

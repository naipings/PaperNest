import { useEffect, useState } from "react";
import Markdown, { defaultUrlTransform, type Components } from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import "katex/dist/katex.min.css";
import { backend } from "../../services/backend";
import { EVIDENCE_SCHEME, linkEvidence } from "../../lib/deepReadEvidence";

function DeepReadFigureImage({ taskId, src, alt, onClick }: { taskId: string; src: string; alt: string; onClick?(): void }) {
  const [url, setUrl] = useState<string>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    let active = true;
    let current = "";
    setUrl(undefined);
    setError(undefined);
    void backend.readPdf(`deepread/${taskId}/${src}`).then(bytes => {
      current = URL.createObjectURL(new Blob([bytes], { type: "image/png" }));
      if (active) setUrl(current);
      else URL.revokeObjectURL(current);
    }).catch(error => { if (active) setError(error instanceof Error ? error.message : String(error)); });
    return () => {
      active = false;
      if (current) URL.revokeObjectURL(current);
    };
  }, [taskId, src]);
  if (error) return <span className="deepread-figure-error">插图读取失败：{src}（{error}）</span>;
  if (!url) return <span className="deepread-figure-loading">{alt}</span>;
  return onClick
    ? <img className="deepread-figure clickable" src={url} alt={alt} title="在原文中定位此图表" onClick={onClick} />
    : <img className="deepread-figure" src={url} alt={alt} />;
}

/**
 * 报告插图路径为工作区相对路径（`figures/…`），经资料库受管文件读取显示。
 * 传入 `onEvidence` / `onFigure` 时（对照阅读），证据锚点与插图可点击定位原文。
 */
export function DeepReadMarkdown({ text, taskId, onEvidence, onFigure }: {
  text: string;
  taskId?: string;
  onEvidence?(segment: string): void;
  onFigure?(src: string): void;
}) {
  const components: Components = {};
  if (taskId) {
    components.img = ({ src, alt }) => {
      const path = String(src ?? "");
      return <DeepReadFigureImage taskId={taskId} src={path} alt={alt ?? ""} onClick={onFigure ? () => onFigure(path) : undefined} />;
    };
  }
  if (onEvidence) {
    components.a = ({ href, children, node: _node, ...rest }) => href?.startsWith(EVIDENCE_SCHEME)
      ? <a {...rest} href={href} className="deepread-evidence" onClick={event => {
        event.preventDefault();
        onEvidence(decodeURIComponent(href.slice(EVIDENCE_SCHEME.length)));
      }}>{children}</a>
      : <a {...rest} href={href}>{children}</a>;
  }
  return (
    <div className="markdown-body deepread-md">
      <Markdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex]}
        components={components}
        urlTransform={url => url.startsWith(EVIDENCE_SCHEME) ? url : defaultUrlTransform(url)}
      >
        {onEvidence ? linkEvidence(text) : text}
      </Markdown>
    </div>
  );
}

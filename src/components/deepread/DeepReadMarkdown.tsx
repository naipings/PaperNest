import { useEffect, useState } from "react";
import Markdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import "katex/dist/katex.min.css";
import { backend } from "../../services/backend";

function DeepReadFigureImage({ taskId, src, alt }: { taskId: string; src: string; alt: string }) {
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
  return url ? <img className="deepread-figure" src={url} alt={alt} /> : <span className="deepread-figure-loading">{alt}</span>;
}

/** 报告插图路径为工作区相对路径（`figures/…`），经资料库受管文件读取显示。 */
export function DeepReadMarkdown({ text, taskId }: { text: string; taskId?: string }) {
  return (
    <div className="markdown-body deepread-md">
      <Markdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex]}
        components={taskId ? { img: ({ src, alt }) => <DeepReadFigureImage taskId={taskId} src={String(src ?? "")} alt={alt ?? ""} /> } : undefined}
      >
        {text}
      </Markdown>
    </div>
  );
}

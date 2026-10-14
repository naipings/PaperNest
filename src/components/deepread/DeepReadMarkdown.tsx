import Markdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import "katex/dist/katex.min.css";

export function DeepReadMarkdown({ text }: { text: string }) {
  return (
    <div className="markdown-body deepread-md">
      <Markdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}>{text}</Markdown>
    </div>
  );
}

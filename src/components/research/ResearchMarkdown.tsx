import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

export function ResearchMarkdown({ text }: { text: string }) {
  return (
    <div className="markdown-body">
      <Markdown remarkPlugins={[remarkGfm]}>{text}</Markdown>
    </div>
  );
}

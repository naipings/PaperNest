import type { Components } from "react-markdown";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { compactExplainMarkdown, linkifyExplainPageRefs, parseExplainPageHref } from "../lib/explainCites";

export function ExplainAnswerMarkdown({
  text,
  onJumpPage,
}: {
  text: string;
  onJumpPage?(page: number): void;
}) {
  const compacted = compactExplainMarkdown(text);
  const linked = onJumpPage ? linkifyExplainPageRefs(compacted) : compacted;
  const components: Components | undefined = onJumpPage
    ? {
        a({ href, children }) {
          const page = parseExplainPageHref(href);
          if (page != null) {
            return (
              <button type="button" className="explain-cite" onClick={() => onJumpPage(page)}>
                {children}
              </button>
            );
          }
          return <a href={href}>{children}</a>;
        },
      }
    : undefined;

  return (
    <div className="markdown-body explain-md">
      <Markdown remarkPlugins={[remarkGfm]} components={components}>{linked}</Markdown>
    </div>
  );
}

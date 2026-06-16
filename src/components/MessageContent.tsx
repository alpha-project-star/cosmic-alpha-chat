import ReactMarkdown from "react-markdown";
import remarkMath from "remark-math";
import remarkGfm from "remark-gfm";
import rehypeKatex from "rehype-katex";

export function MessageContent({ text }: { text: string }) {
  return (
    <div
      className="prose prose-invert prose-sm max-w-none break-words [overflow-wrap:anywhere]
        prose-headings:text-foreground prose-headings:font-semibold prose-h2:text-base prose-h3:text-sm
        prose-p:my-2 prose-p:leading-relaxed
        prose-li:my-1 prose-ul:my-2 prose-ol:my-2
        prose-strong:text-primary
        prose-a:text-primary prose-a:underline prose-a:break-all
        prose-code:text-accent-foreground prose-code:bg-black/40 prose-code:px-1 prose-code:rounded
        prose-pre:bg-black/60 prose-pre:border prose-pre:border-primary/30 prose-pre:overflow-x-auto prose-pre:max-w-full
        prose-table:block prose-table:overflow-x-auto prose-table:max-w-full
        prose-th:border prose-th:border-primary/30 prose-th:px-2 prose-th:py-1
        prose-td:border prose-td:border-primary/20 prose-td:px-2 prose-td:py-1
        prose-img:rounded-lg prose-img:max-w-full prose-img:h-auto"
    >
      <ReactMarkdown remarkPlugins={[remarkMath, remarkGfm]} rehypePlugins={[rehypeKatex]}>
        {text}
      </ReactMarkdown>
    </div>
  );
}
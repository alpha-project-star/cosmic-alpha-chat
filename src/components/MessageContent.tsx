import ReactMarkdown from "react-markdown";
import remarkMath from "remark-math";
import remarkGfm from "remark-gfm";
import rehypeKatex from "rehype-katex";

export function MessageContent({ text }: { text: string }) {
  return (
    <div className="prose prose-invert max-w-none prose-p:my-2 prose-pre:bg-black/60 prose-pre:border prose-pre:border-primary/30 prose-code:text-accent-foreground">
      <ReactMarkdown remarkPlugins={[remarkMath, remarkGfm]} rehypePlugins={[rehypeKatex]}>
        {text}
      </ReactMarkdown>
    </div>
  );
}
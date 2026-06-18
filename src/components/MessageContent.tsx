import ReactMarkdown from "react-markdown";
import remarkMath from "remark-math";
import remarkGfm from "remark-gfm";
import rehypeKatex from "rehype-katex";

function prettyHost(url: string): string {
  try {
    const u = new URL(url);
    let h = u.hostname.replace(/^www\./, "");
    // hide ugly grounding redirect hosts
    if (h.includes("vertexaisearch") || h.includes("googleusercontent")) return "Open source";
    return h;
  } catch { return "Open link"; }
}

export function MessageContent({ text }: { text: string }) {
  return (
    <div
      className="prose prose-invert prose-base max-w-full w-full min-w-0 overflow-hidden break-words [overflow-wrap:anywhere] [word-break:break-word]
        prose-headings:text-foreground prose-headings:font-bold prose-headings:tracking-tight
        prose-h1:text-2xl prose-h1:mt-8 prose-h1:mb-4 prose-h1:leading-tight
        prose-h2:text-xl prose-h2:mt-7 prose-h2:mb-3 prose-h2:leading-tight
        prose-h3:text-lg prose-h3:mt-6 prose-h3:mb-2
        prose-p:my-4 prose-p:leading-7 prose-p:break-words
        prose-li:my-2 prose-li:leading-7 prose-li:marker:text-primary/70
        prose-ul:my-4 prose-ol:my-4 prose-ul:pl-6 prose-ol:pl-6
        prose-hr:my-6 prose-hr:border-primary/20
        prose-strong:text-foreground prose-strong:font-semibold
        prose-a:text-primary prose-a:underline prose-a:break-all
        prose-blockquote:border-l-primary/40 prose-blockquote:text-muted-foreground prose-blockquote:my-4
        prose-code:text-accent-foreground prose-code:bg-black/40 prose-code:px-1 prose-code:rounded
        prose-pre:bg-black/60 prose-pre:border prose-pre:border-primary/30 prose-pre:overflow-x-auto prose-pre:max-w-full prose-pre:whitespace-pre-wrap
        prose-th:border prose-th:border-primary/30 prose-th:px-2 prose-th:py-1
        prose-td:border prose-td:border-primary/20 prose-td:px-2 prose-td:py-1
        prose-img:rounded-lg prose-img:max-w-full prose-img:h-auto"
    >
      <ReactMarkdown
        remarkPlugins={[remarkMath, remarkGfm]}
        rehypePlugins={[rehypeKatex]}
        components={{
          a: ({ href, children }) => {
            const url = String(href || "");
            const txt = String(Array.isArray(children) ? children.join("") : children ?? "");
            // If link text is just a raw URL, replace with the hostname
            const isRawUrl = /^https?:\/\//i.test(txt);
            const label = isRawUrl || !txt.trim() ? prettyHost(url) : txt;
            return (
              <a href={url} target="_blank" rel="noopener noreferrer"
                 className="inline-block max-w-full align-baseline text-primary underline break-all">
                🔗 {label}
              </a>
            );
          },
          table: ({ children }) => (
            <div className="my-2 max-w-full overflow-x-auto rounded-lg border border-primary/20">
              <table className="w-full text-xs">{children}</table>
            </div>
          ),
          pre: ({ children }) => (
            <pre className="my-2 max-w-full overflow-x-auto rounded-lg bg-black/60 border border-primary/30 p-2 text-xs whitespace-pre">
              {children}
            </pre>
          ),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}
import ReactMarkdown from "react-markdown";
import remarkMath from "remark-math";
import remarkGfm from "remark-gfm";
import rehypeKatex from "rehype-katex";

function prettyHost(url: string): string {
  try {
    const u = new URL(url);
    const h = u.hostname.replace(/^www\./, "");
    if (h.includes("vertexaisearch") || h.includes("googleusercontent")) return "Open source";
    return h;
  } catch { return "Open link"; }
}

/**
 * The single rich-text renderer for ALL Alpha-generated content: chat replies,
 * notes, memories, reminders, plans, bills, tool results and search summaries.
 *
 * The model decides the structure (paragraph / heading / list / table / code);
 * this component plus the `.alpha-prose` rules in styles.css decide exactly how
 * that structure looks. Typography and spacing are never left to the model.
 */
export function RichText({ text, size = "base" }: { text: string; size?: "base" | "compact" }) {
  return (
    <div className={`alpha-prose${size === "compact" ? " alpha-prose-compact" : ""}`}>
      <ReactMarkdown
        remarkPlugins={[remarkMath, remarkGfm]}
        rehypePlugins={[rehypeKatex]}
        components={{
          a: ({ href, children }) => {
            const url = String(href || "");
            const txt = String(Array.isArray(children) ? children.join("") : children ?? "");
            const isRawUrl = /^https?:\/\//i.test(txt);
            const label = isRawUrl || !txt.trim() ? prettyHost(url) : txt;
            return (
              <a href={url} target="_blank" rel="noopener noreferrer" className="alpha-link">
                {label}
              </a>
            );
          },
          table: ({ children }) => (
            <div className="alpha-table-wrap">
              <table>{children}</table>
            </div>
          ),
          pre: ({ children }) => <pre className="alpha-pre">{children}</pre>,
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}

/** Backwards-compatible alias — chat surfaces import this name. */
export function MessageContent({ text }: { text: string }) {
  return <RichText text={text} />;
}

import { useEffect, useRef, useState } from "react";
import { ImagePlus, Send, Sparkles, X, ArrowDown, ArrowUp } from "lucide-react";
import { alphaStore, uid, useAlpha } from "../../lib/alpha-store";
import { sendChat } from "../../lib/alpha.functions";
import { MessageContent } from "../MessageContent";
import { prepareUtterance, speakWith } from "../../lib/voice";
import { tryLocalIntent } from "../../lib/local-intents";
import { HudPanel } from "./HudPanel";
import { HudBubble } from "./HudBubble";
import { LiveClock } from "../LiveClock";

/** Full HUD chat panel rendered inside the desktop shell right column. */
export function DesktopChatPanel() {
  const chat = useAlpha(s => s.chat);
  const [text, setText] = useState("");
  const [images, setImages] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [showJump, setShowJump] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  function scrollToBottom(smooth = true) {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: smooth ? "smooth" : "auto" });
  }
  useEffect(() => { scrollToBottom(true); }, [chat.length]);
  useEffect(() => { setTimeout(() => scrollToBottom(false), 0); }, []);

  function onScroll() {
    const el = scrollRef.current; if (!el) return;
    setShowJump(el.scrollHeight - el.scrollTop - el.clientHeight > 200);
  }

  async function send(overrideText?: string) {
    if (busy) return;
    const t = (overrideText ?? text).trim();
    if (!t && images.length === 0) return;
    prepareUtterance();
    alphaStore.appendChat({ id: uid(), role: "user", text: t, images: images.length ? images : undefined, ts: Date.now() });
    setText(""); setImages([]); setBusy(true);
    try {
      const local = t ? tryLocalIntent(t) : null;
      const reply = local ?? await sendChat(alphaStore.get().chat);
      alphaStore.appendChat({ id: uid(), role: "model", text: reply, ts: Date.now() });
      speakWith(reply);
    } catch (e: any) {
      alphaStore.appendChat({ id: uid(), role: "system", text: e?.message || "Error", ts: Date.now(), error: true });
    } finally { setBusy(false); }
  }

  async function pickImages(files: FileList | null) {
    if (!files) return;
    const arr = Array.from(files).slice(0, 4 - images.length);
    const datas = await Promise.all(arr.map(f => new Promise<string>((res, rej) => {
      const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = rej; r.readAsDataURL(f);
    })));
    setImages(prev => [...prev, ...datas].slice(0, 4));
  }

  return (
    <HudPanel className="flex-1 min-h-0 flex flex-col p-4">
      <div className="flex items-center justify-between mb-3 pr-16">
        <div className="flex items-center gap-3">
          <LiveClock />
          <div className="text-[10px] wordmark opacity-70">Conversation</div>
        </div>
        <button onClick={() => alphaStore.clearChat()} className="text-[10px] wordmark opacity-70 hover:opacity-100">
          Clear
        </button>
      </div>

      <div ref={scrollRef} onScroll={onScroll} className="relative flex-1 min-h-0 overflow-y-auto space-y-3 pr-1">
        {chat.length === 0 && (
          <div className="text-center text-muted-foreground text-sm mt-16">
            <Sparkles className="w-6 h-6 mx-auto mb-2 text-primary" /> Say something or type to begin.
          </div>
        )}
        {chat.map(m => {
          if (m.error) {
            return (
              <div key={m.id} className="rounded-xl px-3 py-2 bg-destructive/15 border border-destructive/40 text-destructive-foreground text-sm">
                {m.text}
              </div>
            );
          }
          return (
            <HudBubble key={m.id} side={m.role === "user" ? "user" : "assistant"} label={m.role === "user" ? "YOU" : "ALPHA"}>
              {m.images?.map((src, i) => <img key={i} src={src} className="rounded-lg max-h-40 mb-2 max-w-full" alt="" />)}
              {m.role === "model" ? <MessageContent text={m.text} /> : <div className="whitespace-pre-wrap">{m.text}</div>}
            </HudBubble>
          );
        })}
        {busy && <div className="text-xs text-muted-foreground text-center">Alpha is thinking…</div>}
      </div>

      {showJump && (
        <div className="absolute right-4 bottom-28 z-10 flex flex-col gap-2">
          <button onClick={() => scrollRef.current?.scrollTo({ top: 0, behavior: "smooth" })}
            aria-label="Top" className="hud-bubble p-2 active:scale-95">
            <ArrowUp className="w-4 h-4 text-primary" />
          </button>
          <button onClick={() => scrollToBottom(true)}
            aria-label="Bottom" className="hud-bubble p-2 active:scale-95">
            <ArrowDown className="w-4 h-4 text-primary" />
          </button>
        </div>
      )}

      {images.length > 0 && (
        <div className="pt-2 flex gap-2 overflow-x-auto">
          {images.map((src, i) => (
            <div key={i} className="relative shrink-0">
              <img src={src} className="w-14 h-14 rounded-lg object-cover" alt="" />
              <button onClick={() => setImages(images.filter((_, j) => j !== i))}
                className="absolute -top-1 -right-1 bg-destructive rounded-full p-0.5"><X className="w-3 h-3" /></button>
            </div>
          ))}
        </div>
      )}

      <div className="pt-3 flex items-end gap-2">
        <label className="cursor-pointer p-2 rounded-lg hud-bubble">
          <ImagePlus className="w-5 h-5 text-primary" />
          <input type="file" accept="image/*" multiple hidden onChange={e => pickImages(e.target.files)} />
        </label>
        <textarea
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
          placeholder="Message Alpha…" rows={1}
          className="flex-1 bg-input/60 rounded-xl px-3 py-2 border border-primary/40 outline-none focus:border-primary resize-none max-h-32 text-sm" />
        <button onClick={() => send()} disabled={busy} className="p-2 rounded-lg bg-primary text-primary-foreground neon-border disabled:opacity-50">
          <Send className="w-5 h-5" />
        </button>
      </div>
    </HudPanel>
  );
}
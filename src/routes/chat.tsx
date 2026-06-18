import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { ImagePlus, Mic, MicOff, Send, Sparkles, X, ArrowDown, NotebookPen, Wallet, Image as ImageIcon, Bell, Map, Brain, Settings as SettingsIcon, Grid3x3 } from "lucide-react";
import { alphaStore, uid, useAlpha } from "../lib/alpha-store";
import { sendChat } from "../lib/alpha.functions";
import { MessageContent } from "../components/MessageContent";
import { recognizer, prepareUtterance, speakWith, stopSpeaking } from "../lib/voice";
import { MiniOrb } from "../components/MiniOrb";

export const Route = createFileRoute("/chat")({
  head: () => ({ meta: [{ title: "Alpha — Chat" }, { name: "description", content: "Talk with Alpha." }] }),
  component: ChatRoute,
});

const NAV = [
  { to: "/", icon: Sparkles, label: "Orb" },
  { to: "/notes", icon: NotebookPen, label: "Notes" },
  { to: "/bills", icon: Wallet, label: "Bills" },
  { to: "/image", icon: ImageIcon, label: "Image" },
  { to: "/reminders", icon: Bell, label: "Reminders" },
  { to: "/plans", icon: Map, label: "Plans" },
  { to: "/memories", icon: Brain, label: "Memories" },
  { to: "/settings", icon: SettingsIcon, label: "Settings" },
] as const;

function ChatRoute() {
  const chat = useAlpha(s => s.chat);
  const [text, setText] = useState("");
  const [images, setImages] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const [micError, setMicError] = useState("");
  const [showJump, setShowJump] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [toolsOpen, setToolsOpen] = useState(false);

  function scrollToBottom(smooth = true) {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: smooth ? "smooth" : "auto" });
  }

  useEffect(() => { scrollToBottom(true); }, [chat.length]);
  // jump on mount
  useEffect(() => { setTimeout(() => scrollToBottom(false), 0); }, []);
  useEffect(() => () => { recognizer.stop(); stopSpeaking(); }, []);

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
      const reply = await sendChat(alphaStore.get().chat);
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

  async function toggleMic() {
    prepareUtterance();
    if (listening) { recognizer.stop(); setListening(false); setMicError(""); return; }
    setMicError("");
    recognizer.setHandlers({
      onInterim: t => setText(t),
      onFinal: t => { setText(t); recognizer.stop(); setListening(false); send(t); },
      onStart: () => setListening(true),
      onStop: () => setListening(false),
      onError: e => { setListening(false); setMicError(e); },
    });
    recognizer.start();
  }

  return (
    <div className="starfield min-h-screen flex flex-col overflow-x-hidden w-full max-w-full">
      <header className="glass border-b border-primary/20">
        <div className="flex items-center justify-between px-3 py-2 relative">
          <Link to="/" className="flex items-center gap-2 min-w-0">
            <span className="text-xs tracking-[0.4em] text-muted-foreground">ALPHA</span>
          </Link>
          <div className="absolute left-1/2 -translate-x-1/2"><MiniOrb /></div>
          <button onClick={() => alphaStore.clearChat()} className="text-xs text-muted-foreground shrink-0">Clear</button>
        </div>
      </header>

      <div ref={scrollRef} onScroll={onScroll} className="flex-1 overflow-y-auto overflow-x-hidden px-3 py-4 space-y-3 relative w-full max-w-full">
        {chat.length === 0 && (
          <div className="text-center text-muted-foreground text-sm mt-20">
            <Sparkles className="w-6 h-6 mx-auto mb-2 text-primary" /> Say something or type to begin.
          </div>
        )}
        {chat.map(m => {
          if (m.role === "user") {
            return (
              <div key={m.id} className="flex w-full min-w-0 justify-end">
                <div className="max-w-[85%] min-w-0 overflow-hidden rounded-2xl px-4 py-2 bg-primary/20 border border-primary/40 break-words [overflow-wrap:anywhere] [word-break:break-word]">
                  {m.images?.map((src, i) => <img key={i} src={src} className="rounded-lg max-h-48 mb-2 max-w-full" alt="" />)}
                  <div className="whitespace-pre-wrap text-sm break-words [overflow-wrap:anywhere]">{m.text}</div>
                </div>
              </div>
            );
          }
          if (m.error) {
            return (
              <div key={m.id} className="w-full min-w-0 rounded-xl px-3 py-2 bg-destructive/15 border border-destructive/40 text-destructive-foreground text-sm break-words [overflow-wrap:anywhere]">
                {m.text}
              </div>
            );
          }
          // assistant: NO bubble — full width like ChatGPT/Gemini
          return (
            <div key={m.id} className="w-full min-w-0 overflow-hidden px-1 py-2 break-words [overflow-wrap:anywhere] [word-break:break-word]">
              {m.images?.map((src, i) => <img key={i} src={src} className="rounded-lg max-h-60 mb-2 max-w-full" alt="" />)}
              <MessageContent text={m.text} />
            </div>
          );
        })}
        {busy && <div className="text-xs text-muted-foreground text-center">Alpha is thinking…</div>}
      </div>

      {showJump && (
        <button onClick={() => scrollToBottom(true)}
          className="fixed bottom-28 right-4 z-20 glass rounded-full p-2 neon-border active:scale-95">
          <ArrowDown className="w-4 h-4 text-primary" />
        </button>
      )}

      {images.length > 0 && (
        <div className="px-3 pb-2 flex gap-2 overflow-x-auto">
          {images.map((src, i) => (
            <div key={i} className="relative shrink-0">
              <img src={src} className="w-16 h-16 rounded-lg object-cover" alt="" />
              <button onClick={() => setImages(images.filter((_, j) => j !== i))}
                className="absolute -top-1 -right-1 bg-destructive rounded-full p-0.5"><X className="w-3 h-3" /></button>
            </div>
          ))}
        </div>
      )}

      <div className="p-3 glass border-t border-primary/20 relative">
        {toolsOpen && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setToolsOpen(false)} />
            <div className="absolute bottom-full left-2 right-2 mb-2 z-20 glass neon-border rounded-2xl p-2 grid grid-cols-4 gap-2">
              {NAV.map(({ to, icon: Icon, label }) => (
                <Link key={to} to={to as any} onClick={() => setToolsOpen(false)}
                  className="flex flex-col items-center gap-1 px-2 py-2 rounded-xl bg-background/40 active:scale-95">
                  <Icon className="w-5 h-5 text-primary" />
                  <span className="text-[10px] text-foreground/80">{label}</span>
                </Link>
              ))}
            </div>
          </>
        )}
        {micError && <div className="mb-2 text-xs text-destructive">{micError}</div>}
        <div className="flex items-end gap-2">
          <button onClick={() => setToolsOpen(v => !v)} className="p-2 rounded-lg glass" aria-label="Tools">
            <Grid3x3 className="w-5 h-5 text-primary" />
          </button>
          <label className="cursor-pointer p-2 rounded-lg glass">
            <ImagePlus className="w-5 h-5 text-primary" />
            <input type="file" accept="image/*" multiple hidden onChange={e => pickImages(e.target.files)} />
          </label>
          <textarea
            value={text}
            onChange={e => setText(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
            placeholder="Message Alpha…" rows={1}
            className="flex-1 bg-input rounded-xl px-3 py-2 border border-border outline-none focus:border-primary resize-none max-h-32" />
          <button onClick={toggleMic} className="p-2 rounded-lg glass">
            {listening ? <MicOff className="w-5 h-5 text-destructive" /> : <Mic className="w-5 h-5 text-primary" />}
          </button>
          <button onClick={() => send()} disabled={busy} className="p-2 rounded-lg bg-primary text-primary-foreground neon-border disabled:opacity-50">
            <Send className="w-5 h-5" />
          </button>
        </div>
      </div>
    </div>
  );
}
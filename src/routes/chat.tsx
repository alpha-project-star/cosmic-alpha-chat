import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { ImagePlus, Mic, MicOff, Send, Sparkles, X } from "lucide-react";
import { alphaStore, uid, useAlpha } from "../lib/alpha-store";
import { sendChat } from "../lib/alpha.functions";
import { MessageContent } from "../components/MessageContent";
import { recognizer, prepareUtterance, speakWith, stopSpeaking } from "../lib/voice";
import alphaAvatar from "../assets/alpha-avatar.png.asset.json";

export const Route = createFileRoute("/chat")({
  head: () => ({ meta: [{ title: "Alpha — Chat" }, { name: "description", content: "Talk with Alpha." }] }),
  component: ChatRoute,
});

function ChatRoute() {
  const chat = useAlpha(s => s.chat);
  const [text, setText] = useState("");
  const [images, setImages] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const [micError, setMicError] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => { scrollRef.current?.scrollTo({ top: 999999, behavior: "smooth" }); }, [chat.length]);
  useEffect(() => () => { recognizer.stop(); stopSpeaking(); }, []);

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
    <div className="starfield min-h-screen flex flex-col">
      <header className="flex items-center justify-between p-3 glass border-b border-primary/20">
        <Link to="/" className="flex items-center gap-2">
          <img src={alphaAvatar.url} alt="Alpha" className="w-9 h-9 rounded-full ring-1 ring-primary/60" />
          <span className="font-semibold neon-text">Alpha</span>
        </Link>
        <button onClick={() => alphaStore.clearChat()} className="text-xs text-muted-foreground">Clear</button>
      </header>

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-4 space-y-3">
        {chat.length === 0 && (
          <div className="text-center text-muted-foreground text-sm mt-20">
            <Sparkles className="w-6 h-6 mx-auto mb-2 text-primary" /> Say something or type to begin.
          </div>
        )}
        {chat.map(m => (
          <div key={m.id} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[85%] rounded-2xl px-4 py-2 ${
              m.role === "user" ? "bg-primary/20 border border-primary/40"
              : m.error ? "bg-destructive/15 border border-destructive/40 text-destructive-foreground"
              : "glass"
            }`}>
              {m.images?.map((src, i) => <img key={i} src={src} className="rounded-lg max-h-48 mb-2" alt="" />)}
              {m.role === "model" ? <MessageContent text={m.text} /> : <div className="whitespace-pre-wrap text-sm">{m.text}</div>}
            </div>
          </div>
        ))}
        {busy && <div className="text-xs text-muted-foreground text-center">Alpha is thinking…</div>}
      </div>

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

      <div className="p-3 glass border-t border-primary/20">
        {micError && <div className="mb-2 text-xs text-destructive">{micError}</div>}
        <div className="flex items-end gap-2">
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
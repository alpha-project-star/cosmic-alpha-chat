import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { AlphaOrb } from "../components/AlphaOrb";
import { LiveTranscript } from "../components/LiveTranscript";
import { recognizer, prepareUtterance, speakWith, stopSpeaking } from "../lib/voice";
import { parseIntent } from "../lib/voice-router";
import { sendChat, generateImage } from "../lib/alpha.functions";
import { alphaStore, uid, useAlpha } from "../lib/alpha-store";
import { MessageSquare, NotebookPen, Wallet, Image as ImageIcon, Mic, MicOff, Settings as SettingsIcon } from "lucide-react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Alpha — Cosmic AI Companion" },
      { name: "description", content: "A voice-first AI companion. Listen, ask, navigate." },
      { property: "og:title", content: "Alpha — Cosmic AI Companion" },
      { property: "og:description", content: "A voice-first AI companion." },
    ],
  }),
  component: OrbHome,
});

function OrbHome() {
  const router = useRouter();
  const [interim, setInterim] = useState("");
  const [status, setStatus] = useState("Tap the orb to begin");
  const [active, setActive] = useState(false);
  const hasKey = useAlpha(s => !!s.settings.geminiApiKey);
  const thinkingRef = useRef(false);

  useEffect(() => () => recognizer.dispose(), []);

  async function handleFinal(text: string) {
    if (thinkingRef.current) return;
    const intent = parseIntent(text);
    if (intent.kind === "navigate") {
      setStatus(`Opening ${intent.to.slice(1) || "home"}…`);
      router.navigate({ to: intent.to });
      return;
    }
    if (intent.kind === "stop") {
      recognizer.stop(); setActive(false); setStatus("Paused");
      return;
    }
    // chat intent
    if (!hasKey) {
      setStatus("No API key — opening settings");
      router.navigate({ to: "/settings" });
      return;
    }
    thinkingRef.current = true;
    setStatus("Thinking…");
    alphaStore.appendChat({ id: uid(), role: "user", text, ts: Date.now() });
    try {
      const reply = await sendChat(alphaStore.get().chat);
      alphaStore.appendChat({ id: uid(), role: "model", text: reply, ts: Date.now() });
      speakWith(reply);
      setStatus("Listening continuously…");
    } catch (e: any) {
      const msg = e?.message || "Error";
      alphaStore.appendChat({ id: uid(), role: "system", text: msg, ts: Date.now(), error: true });
      setStatus(msg.slice(0, 80));
    } finally { thinkingRef.current = false; }
  }

  async function toggleMic() {
    prepareUtterance(); // sync gesture allocation
    if (active) { recognizer.stop(); setActive(false); setStatus("Paused"); stopSpeaking(); return; }
    recognizer.setHandlers({
      onInterim: t => setInterim(t),
      onFinal: t => { setInterim(""); handleFinal(t); },
      onStart: () => { setActive(true); setStatus("Listening continuously…"); },
      onStop: () => setActive(false),
      onError: e => setStatus(e),
    });
    recognizer.start();
  }

  return (
    <div className="starfield min-h-screen flex flex-col items-center px-4 pt-10 pb-28 relative overflow-hidden">
      <div className="absolute top-4 right-4">
        <Link to="/settings" className="glass rounded-full p-2 inline-flex"><SettingsIcon className="w-5 h-5 text-primary" /></Link>
      </div>
      <h1 className="text-xs tracking-[0.5em] text-muted-foreground mb-8">PROJECT ALPHA</h1>

      <div onClick={toggleMic} className="cursor-pointer select-none">
        <AlphaOrb analyser={recognizer.analyserNode} active={active} size={300} />
      </div>

      <LiveTranscript interim={interim} status={status} />

      <div className="flex items-center justify-center mt-6">
        <button onClick={toggleMic} className="glass rounded-full p-4 neon-border">
          {active ? <MicOff className="w-6 h-6 text-primary" /> : <Mic className="w-6 h-6 text-primary" />}
        </button>
      </div>

      <nav className="fixed bottom-4 left-4 right-4 grid grid-cols-4 gap-2 max-w-md mx-auto">
        <NavBtn to="/chat" icon={<MessageSquare className="w-5 h-5" />} label="Chat" />
        <NavBtn to="/notes" icon={<NotebookPen className="w-5 h-5" />} label="Notes" />
        <NavBtn to="/bills" icon={<Wallet className="w-5 h-5" />} label="Bills" />
        <NavBtn to="/image" icon={<ImageIcon className="w-5 h-5" />} label="Image" />
      </nav>
    </div>
  );
}

function NavBtn({ to, icon, label }: { to: string; icon: React.ReactNode; label: string }) {
  return (
    <Link to={to as any} className="glass rounded-xl py-2 flex flex-col items-center text-xs text-foreground/90 active:scale-95 transition">
      <span className="text-primary mb-0.5">{icon}</span>
      {label}
    </Link>
  );
}

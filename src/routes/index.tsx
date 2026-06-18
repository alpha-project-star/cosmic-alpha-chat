import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { AlphaOrb } from "../components/AlphaOrb";
import { LiveTranscript } from "../components/LiveTranscript";
import { recognizer, prepareUtterance, speakWith, stopSpeaking, speakingState } from "../lib/voice";
import { parseIntent } from "../lib/voice-router";
import { sendChat } from "../lib/alpha.functions";
import { alphaStore, uid, useAlpha } from "../lib/alpha-store";
import { Mic, MicOff, Settings as SettingsIcon, MessageSquare } from "lucide-react";

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
  const [micError, setMicError] = useState("");
  const hasKey = useAlpha(s => !!s.settings.geminiApiKey);
  const thinkingRef = useRef(false);
  const [speaking, setSpeaking] = useState(false);

  useEffect(() => speakingState.sub(setSpeaking), []);
  useEffect(() => () => { recognizer.dispose(); stopSpeaking(); }, []);

  async function handleFinal(text: string) {
    if (thinkingRef.current) return;
    const intent = parseIntent(text);
    if (intent.kind === "navigate") {
      setStatus(`Opening ${intent.to.slice(1) || "home"}…`);
      router.navigate({ to: intent.to });
      return;
    }
    if (intent.kind === "stop") { recognizer.stop(); setActive(false); setStatus("Paused"); return; }
    if (!hasKey) { setStatus("No API key — opening settings"); router.navigate({ to: "/settings" }); return; }

    thinkingRef.current = true;
    setStatus("Thinking…");
    // Suspend mic while thinking so Alpha doesn't hear ambient noise / its own pre-speech
    const wasListening = recognizer.isWanted;
    if (wasListening) recognizer.suspend();
    alphaStore.appendChat({ id: uid(), role: "user", text, ts: Date.now() });
    try {
      const reply = await sendChat(alphaStore.get().chat);
      alphaStore.appendChat({ id: uid(), role: "model", text: reply, ts: Date.now() });
      setStatus("Speaking…");
      await speakWith(reply);
      setStatus(recognizer.isWanted ? "Listening…" : "Tap the orb to begin");
    } catch (e: any) {
      const msg = e?.message || "Error";
      alphaStore.appendChat({ id: uid(), role: "system", text: msg, ts: Date.now(), error: true });
      setStatus(msg.slice(0, 80));
    } finally {
      thinkingRef.current = false;
      // Give a small grace window then resume listening
      if (wasListening) setTimeout(() => { if (recognizer.isWanted) recognizer.resume(); }, 500);
    }
  }

  async function toggleMic() {
    prepareUtterance();
    if (active) { recognizer.stop(); setActive(false); setStatus("Paused"); stopSpeaking(); return; }
    setMicError("");
    recognizer.setHandlers({
      onInterim: t => setInterim(t),
      onFinal: t => { setInterim(""); handleFinal(t); },
      onStart: () => { setActive(true); setStatus("Listening…"); },
      onStop: () => setActive(false),
      onError: e => { setMicError(e); setStatus(e); },
    });
    recognizer.start();
  }

  return (
    <div className="starfield min-h-screen flex flex-col items-center px-4 pt-10 pb-12 relative overflow-hidden">
      <div className="absolute top-4 right-4">
        <Link to="/settings" className="glass rounded-full p-2 inline-flex"><SettingsIcon className="w-5 h-5 text-primary" /></Link>
      </div>
      <div className="absolute top-4 left-4">
        <Link to="/chat" className="glass rounded-full p-2 inline-flex" aria-label="Open chat">
          <MessageSquare className="w-5 h-5 text-primary" />
        </Link>
      </div>
      <h1 className="text-xs tracking-[0.5em] text-muted-foreground mb-8">ALPHA</h1>

      <div onClick={toggleMic} className="cursor-pointer select-none">
        <AlphaOrb analyser={recognizer.analyserNode} active={active || speaking} size={300} />
      </div>

      <LiveTranscript interim={interim} status={speaking ? "Speaking…" : status} />
      {micError && <div className="mt-2 text-xs text-destructive">{micError}</div>}

      <div className="flex items-center justify-center mt-6">
        <button onClick={toggleMic} className="glass rounded-full p-4 neon-border">
          {active ? <MicOff className="w-6 h-6 text-primary" /> : <Mic className="w-6 h-6 text-primary" />}
        </button>
        <Link to="/chat" className="ml-4 glass rounded-full px-4 py-3 inline-flex items-center gap-2 text-sm">
          <MessageSquare className="w-4 h-4 text-primary" /> Chat
        </Link>
      </div>

      <div className="mt-8 max-w-sm text-center text-[11px] leading-relaxed text-muted-foreground/70 italic space-y-1">
        <div>Say: <span className="text-primary/70">"open chat"</span> · <span className="text-primary/70">"open notes"</span> · <span className="text-primary/70">"open bills"</span></div>
        <div>Say: <span className="text-primary/70">"open reminders"</span> · <span className="text-primary/70">"open plans"</span> · <span className="text-primary/70">"open memories"</span></div>
        <div>Say: <span className="text-primary/70">"open image"</span> · <span className="text-primary/70">"open settings"</span> · <span className="text-primary/70">"stop listening"</span></div>
      </div>
    </div>
  );
}
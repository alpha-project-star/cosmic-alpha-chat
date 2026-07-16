import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { AlphaOrb } from "../components/AlphaOrb";
import { LiveTranscript } from "../components/LiveTranscript";
import { recognizer, prepareUtterance, speakWith, stopSpeaking, speakingState } from "../lib/voice";
import { parseIntent } from "../lib/voice-router";
import { sendChat } from "../lib/alpha.functions";
import { tryLocalIntent } from "../lib/local-intents";
import { alphaStore, uid, useAlpha } from "../lib/alpha-store";
import { Settings as SettingsIcon, MessageSquare, ChevronDown, NotebookPen, Wallet, Image as ImageIcon, Bell, Map, Brain } from "lucide-react";
import { DesktopShell } from "../components/desktop/DesktopShell";
import { DesktopHomePanel } from "../components/desktop/DesktopHomePanel";
import { KittScanner } from "../components/KittScanner";


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
  const hasUsableBrain = useAlpha(s => !!(
    s.settings.groqApiKey ||
    s.settings.openaiCompatKey ||
    s.settings.openRouterKey
  ));
  const bgEnabled = useAlpha(s => s.settings.backgroundEnabled);
  const thinkingRef = useRef(false);
  const [speaking, setSpeaking] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

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

    // Local CRUD intents (add reminder / note / memory etc) — no API call
    const local = tryLocalIntent(text);
    if (local) {
      alphaStore.appendChat({ id: uid(), role: "user", text, ts: Date.now() });
      alphaStore.appendChat({ id: uid(), role: "model", text: local, ts: Date.now() });
      setStatus("Speaking…"); await speakWith(local);
      setStatus(recognizer.isWanted ? "Listening…" : "Tap the orb to begin");
      return;
    }

    if (!hasUsableBrain) { setStatus("No model key — opening settings"); router.navigate({ to: "/settings" }); return; }

    thinkingRef.current = true;
    setStatus("Thinking…");
    // Suspend mic while thinking so Alpha doesn't hear ambient noise / its own pre-speech
    const wasListening = recognizer.isWanted;
    if (wasListening) recognizer.suspend();
    alphaStore.appendChat({ id: uid(), role: "user", text, ts: Date.now() });
    try {
      const reply = await sendChat(alphaStore.get().chat, { task: "fast" });
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
    <>
    {/* Desktop layout — blueprint HUD */}
    <DesktopShell
      active={active}
      onMicToggle={toggleMic}
      right={<DesktopHomePanel status={speaking ? "Speaking…" : status} interim={interim} />}
    />
    {/* Mobile layout */}
    <div className="lg:hidden starfield min-h-screen flex flex-col items-center px-4 pt-10 pb-12 relative overflow-hidden">
      <div className="absolute top-4 right-4 z-10">
        <button onClick={() => setSettingsOpen(v => !v)} aria-label="Settings" className="glass rounded-full p-1.5 inline-flex neon-border">
          <ChevronDown className="w-4 h-4 text-primary" />
        </button>
        {settingsOpen && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setSettingsOpen(false)} />
            <div className="absolute top-10 right-0 z-20 glass neon-border rounded-xl p-1.5 flex flex-col gap-1 w-40">
              <Link to="/settings" onClick={() => setSettingsOpen(false)} className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-background/40 text-xs">
                <SettingsIcon className="w-4 h-4 text-primary" /> Settings
              </Link>
            </div>
          </>
        )}
      </div>
      <div className="absolute top-4 left-4 z-10">
        <button onClick={() => setToolsOpen(v => !v)} aria-label="Tools" className="glass rounded-full p-1.5 inline-flex neon-border">
          <ChevronDown className="w-4 h-4 text-primary" />
        </button>
        {toolsOpen && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setToolsOpen(false)} />
            <div className="absolute top-12 left-0 z-20 glass neon-border rounded-2xl p-2 grid grid-cols-3 gap-2 w-60">
              {[
                { to: "/chat", icon: MessageSquare, label: "Chat" },
                { to: "/notes", icon: NotebookPen, label: "Notes" },
                { to: "/bills", icon: Wallet, label: "Bills" },
                { to: "/image", icon: ImageIcon, label: "Image" },
                { to: "/reminders", icon: Bell, label: "Reminders" },
                { to: "/plans", icon: Map, label: "Plans" },
                { to: "/memories", icon: Brain, label: "Memories" },
                { to: "/settings", icon: SettingsIcon, label: "Settings" },
              ].map(({ to, icon: Icon, label }) => (
                <Link key={to} to={to as any} onClick={() => setToolsOpen(false)}
                  className="flex flex-col items-center gap-1 px-2 py-2 rounded-xl bg-background/40 active:scale-95">
                  <Icon className="w-5 h-5 text-primary" />
                  <span className="text-[10px] text-foreground/80">{label}</span>
                </Link>
              ))}
            </div>
          </>
        )}
      </div>
      <h1 className="text-xs tracking-[0.5em] text-muted-foreground mb-8">ALPHA</h1>

      <div onClick={toggleMic} className="cursor-pointer select-none">
        <AlphaOrb analyser={recognizer.analyserNode} active={active || speaking} size={300} />
      </div>

      {/* Curved K.I.T.T. equalizer arc beneath the orb */}
      <div className="mt-1 w-[22rem] max-w-[92vw] -translate-y-7 pointer-events-none">
        <KittScanner curved state={!bgEnabled ? "off" : active ? "scanning" : "idle"} bars={34} height={58} />
      </div>

      <LiveTranscript interim={interim} status={speaking ? "Speaking…" : status} />
      {micError && <div className="mt-2 text-xs text-destructive">{micError}</div>}

      <div className="flex items-center justify-center mt-6">
        <Link to="/chat" aria-label="Open chat" className="glass rounded-full p-4 neon-border inline-flex">
          <MessageSquare className="w-6 h-6 text-primary" />
        </Link>
      </div>
    </div>
    </>
  );
}
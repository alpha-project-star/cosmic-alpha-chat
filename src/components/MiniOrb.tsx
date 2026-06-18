import { useEffect, useState } from "react";
import { useRouter } from "@tanstack/react-router";
import alphaAvatar from "../assets/alpha-avatar.png.asset.json";
import { recognizer, prepareUtterance, stopSpeaking, speakingState } from "../lib/voice";
import { alphaStore, uid } from "../lib/alpha-store";
import { sendChat } from "../lib/alpha.functions";
import { speakWith } from "../lib/voice";
import { parseIntent } from "../lib/voice-router";
import { tryLocalIntent } from "../lib/local-intents";

/**
 * Tiny beating orb in the chat header. Tap to start/stop voice — keeps the
 * chat in sync (appends to the same chat thread) so voice & text co-exist.
 */
export function MiniOrb({ size = 56 }: { size?: number }) {
  const router = useRouter();
  const [active, setActive] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [beat, setBeat] = useState(0);

  useEffect(() => speakingState.sub(setSpeaking), []);

  useEffect(() => {
    if (!speaking && !active) { setBeat(0); return; }
    let raf = 0; const t0 = performance.now();
    const loop = () => {
      const t = (performance.now() - t0) / 1000;
      setBeat(0.5 + 0.5 * Math.sin(t * (speaking ? 4 : 2.5)));
      raf = requestAnimationFrame(loop);
    };
    loop(); return () => cancelAnimationFrame(raf);
  }, [speaking, active]);

  async function handleFinal(text: string) {
    if (!text.trim()) return;
    const intent = parseIntent(text);
    if (intent.kind === "navigate") { router.navigate({ to: intent.to }); return; }
    if (intent.kind === "stop") { recognizer.stop(); stopSpeaking(); setActive(false); return; }
    const local = tryLocalIntent(text);
    if (local) {
      alphaStore.appendChat({ id: uid(), role: "user", text, ts: Date.now() });
      alphaStore.appendChat({ id: uid(), role: "model", text: local, ts: Date.now() });
      speakWith(local);
      return;
    }
    alphaStore.appendChat({ id: uid(), role: "user", text, ts: Date.now() });
    try {
      const reply = await sendChat(alphaStore.get().chat);
      alphaStore.appendChat({ id: uid(), role: "model", text: reply, ts: Date.now() });
      speakWith(reply);
    } catch (e: any) {
      alphaStore.appendChat({ id: uid(), role: "system", text: e?.message || "Error", ts: Date.now(), error: true });
    }
  }

  function toggle() {
    prepareUtterance();
    if (active) { recognizer.stop(); stopSpeaking(); setActive(false); return; }
    recognizer.setHandlers({
      onFinal: t => handleFinal(t),
      onStart: () => setActive(true),
      onStop: () => setActive(false),
      onError: () => setActive(false),
    });
    recognizer.start();
  }

  const scale = 1 + (active || speaking ? beat * 0.18 : 0);

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={active ? "Stop voice" : "Talk to Alpha"}
      className="relative rounded-full overflow-hidden ring-2 ring-primary/70 active:scale-95 transition shrink-0"
      style={{ width: size, height: size, boxShadow: active || speaking ? "0 0 16px oklch(0.72 0.22 250 / 0.7), 0 0 32px oklch(0.6 0.25 250 / 0.4)" : "0 0 8px oklch(0.6 0.25 250 / 0.25)" }}
    >
      <img
        src={alphaAvatar.url}
        alt="Alpha"
        className="w-full h-full object-cover"
        style={{ transform: `scale(${scale})`, transition: "transform .1s linear" }}
      />
      {(active || speaking) && (
        <span className="absolute inset-0 rounded-full pointer-events-none"
          style={{ boxShadow: "inset 0 0 10px oklch(0.85 0.18 240 / 0.6)" }} />
      )}
    </button>
  );
}
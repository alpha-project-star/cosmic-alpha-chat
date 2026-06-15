import { useEffect, useState } from "react";
import alphaAvatar from "../assets/alpha-avatar.png.asset.json";
import { recognizer, prepareUtterance, stopSpeaking, speakingState } from "../lib/voice";
import { alphaStore, uid } from "../lib/alpha-store";
import { sendChat } from "../lib/alpha.functions";
import { speakWith } from "../lib/voice";

/**
 * Tiny beating orb in the chat header. Tap to start/stop voice — keeps the
 * chat in sync (appends to the same chat thread) so voice & text co-exist.
 */
export function MiniOrb() {
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
      className="relative w-10 h-10 rounded-full overflow-hidden ring-1 ring-primary/60 active:scale-95 transition"
      style={{ boxShadow: active || speaking ? "0 0 16px oklch(0.72 0.22 250 / 0.7), 0 0 32px oklch(0.6 0.25 250 / 0.4)" : "none" }}
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
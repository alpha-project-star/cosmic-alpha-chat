import { useEffect, useState } from "react";
import alphaAvatar from "../assets/alpha-icon.png.asset.json";
import { AudioSpectrum } from "./AudioSpectrum";
import { speakingState } from "../lib/voice";

export function AlphaOrb({ analyser, active, size = 280, sizeCss }: { analyser: AnalyserNode | null; active: boolean; size?: number; sizeCss?: string }) {
  const [level, setLevel] = useState(0);
  const [speaking, setSpeaking] = useState(false);
  const [beat, setBeat] = useState(0);

  useEffect(() => speakingState.sub(setSpeaking), []);

  useEffect(() => {
    if (!analyser) return;
    let raf = 0; const data = new Uint8Array(64);
    const tick = () => {
      analyser.getByteFrequencyData(data);
      let s = 0; for (let i = 0; i < data.length; i++) s += data[i];
      setLevel(s / data.length / 255);
      raf = requestAnimationFrame(tick);
    };
    tick(); return () => cancelAnimationFrame(raf);
  }, [analyser]);

  // Soft heartbeat while Alpha speaks
  useEffect(() => {
    if (!speaking) { setBeat(0); return; }
    let raf = 0; const t0 = performance.now();
    const loop = () => {
      const t = (performance.now() - t0) / 1000;
      setBeat(0.5 + 0.5 * Math.sin(t * 4)); // ~0.6 Hz pulse
      raf = requestAnimationFrame(loop);
    };
    loop(); return () => cancelAnimationFrame(raf);
  }, [speaking]);

  const pulse = 1 + (active ? level * 0.18 : 0) + (speaking ? beat * 0.08 : 0);

  return (
    <div className="relative" style={{ width: sizeCss ?? size, height: sizeCss ?? size }}>
      <div
        className="absolute inset-[-30%] rounded-full pointer-events-none"
        style={{
          background: "radial-gradient(circle, oklch(0.6 0.28 250 / 0.45), transparent 65%)",
          filter: "blur(30px)",
          opacity: 0.4 + (active ? level * 0.6 : 0.1) + (speaking ? beat * 0.4 : 0),
          transition: "opacity .15s",
        }}
      />
      <AudioSpectrum analyser={active ? analyser : null} speaking={speaking} bars={56} className="absolute inset-[-18%] w-[136%] h-[136%]" />
      <div className="absolute inset-0 rounded-full p-[3px] conic-ring" style={{ animationDuration: (active || speaking) ? "5s" : "18s" }}>
        <div className="w-full h-full rounded-full overflow-hidden relative"
          style={{ transform: `scale(${pulse})`, transition: "transform .08s linear", boxShadow: "var(--shadow-glow)" }}>
          <img src={alphaAvatar.url} alt="Alpha" className="w-full h-full object-cover" draggable={false} />
          <div className="absolute inset-0 mix-blend-overlay" style={{
            background: "radial-gradient(circle at 30% 20%, oklch(0.95 0.05 240 / 0.4), transparent 60%)",
          }} />
        </div>
      </div>
      <div className="absolute inset-[-8%] rounded-full border border-primary/30 pointer-events-none"
        style={{ animation: "pulse-glow 4s ease-in-out infinite" }} />
    </div>
  );
}
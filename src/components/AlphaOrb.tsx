import { useEffect, useState } from "react";
import alphaAvatar from "../assets/alpha-avatar.png.asset.json";
import { AudioSpectrum } from "./AudioSpectrum";

export function AlphaOrb({ analyser, active, size = 280 }: { analyser: AnalyserNode | null; active: boolean; size?: number }) {
  const [level, setLevel] = useState(0);
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

  const pulse = active ? 1 + level * 0.18 : 1;

  return (
    <div className="relative" style={{ width: size, height: size }}>
      {/* aurora bloom */}
      <div
        className="absolute inset-[-30%] rounded-full pointer-events-none"
        style={{
          background: "radial-gradient(circle, oklch(0.6 0.28 250 / 0.45), transparent 65%)",
          filter: "blur(30px)",
          opacity: 0.5 + (active ? level * 0.7 : 0.1),
          transition: "opacity .1s",
        }}
      />
      {/* spectrum ring */}
      <AudioSpectrum analyser={active ? analyser : null} bars={56} className="absolute inset-[-18%] w-[136%] h-[136%]" />
      {/* conic rotating border */}
      <div className="absolute inset-0 rounded-full p-[3px] conic-ring" style={{ animationDuration: active ? "6s" : "18s" }}>
        <div className="w-full h-full rounded-full overflow-hidden relative"
          style={{ transform: `scale(${pulse})`, transition: "transform .08s linear", boxShadow: "var(--shadow-glow)" }}>
          <img src={alphaAvatar.url} alt="Alpha" className="w-full h-full object-cover" draggable={false} />
          <div className="absolute inset-0 mix-blend-overlay" style={{
            background: "radial-gradient(circle at 30% 20%, oklch(0.95 0.05 240 / 0.4), transparent 60%)",
          }} />
        </div>
      </div>
      {/* outer ring */}
      <div className="absolute inset-[-8%] rounded-full border border-primary/30 pointer-events-none"
        style={{ animation: "pulse-glow 4s ease-in-out infinite" }} />
    </div>
  );
}
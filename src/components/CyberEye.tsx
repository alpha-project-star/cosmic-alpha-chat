import { useEffect, useState } from "react";

/**
 * Live "cyber-lens" eye — pure SVG/CSS, no bitmap.
 * Layers (outer → inner):
 *   1. Brushed silver bezel with rotating conic sheen + micro-text "CYBER-LENS 0.1nm RES".
 *   2. Dark metallic groove with diagonal blade slits.
 *   3. Neon-blue HUD lattice (concentric arcs, radial spokes).
 *   4. Animated aperture iris (6 blades) that breathes with audio.
 *   5. Pupil core with crosshair + pulsing bright center.
 *
 * Reacts to `analyser` frequency data and `speaking` state.
 */
export function CyberEye({
  analyser,
  active,
  speaking,
  size,
  showMicroText = true,
}: {
  analyser: AnalyserNode | null;
  active: boolean;
  speaking: boolean;
  size: number | string;
  showMicroText?: boolean;
}) {
  const [level, setLevel] = useState(0);
  const [beat, setBeat] = useState(0);

  useEffect(() => {
    if (!analyser || !active) { setLevel(0); return; }
    let raf = 0; const data = new Uint8Array(64);
    const tick = () => {
      analyser.getByteFrequencyData(data);
      let s = 0; for (let i = 0; i < data.length; i++) s += data[i];
      setLevel(s / data.length / 255);
      raf = requestAnimationFrame(tick);
    };
    tick(); return () => cancelAnimationFrame(raf);
  }, [analyser, active]);

  useEffect(() => {
    if (!speaking && !active) { setBeat(0); return; }
    let raf = 0; const t0 = performance.now();
    const loop = () => {
      const t = (performance.now() - t0) / 1000;
      setBeat(0.5 + 0.5 * Math.sin(t * (speaking ? 4 : 2.2)));
      raf = requestAnimationFrame(loop);
    };
    loop(); return () => cancelAnimationFrame(raf);
  }, [speaking, active]);

  const hot = active || speaking;
  const bezelDur = hot ? "6s" : "20s";
  const irisDur = hot ? "5s" : "16s";
  const irisOpen = 0.72 + level * 0.18 + (speaking ? beat * 0.08 : 0);
  const pupilGlow = 0.55 + (active ? level * 0.6 : 0) + (speaking ? beat * 0.45 : 0);

  // 6 aperture blade polygons around a unit circle at r=42, closing toward center at r=8.
  const blades = Array.from({ length: 6 }, (_, i) => {
    const a = (i / 6) * Math.PI * 2;
    const a2 = a + (Math.PI * 2) / 6;
    const rOut = 42;
    const rIn = 8 + (1 - irisOpen) * 22;
    const p = (r: number, ang: number) => `${50 + Math.cos(ang) * r},${50 + Math.sin(ang) * r}`;
    return `M${p(rIn, a)} L${p(rOut, a)} L${p(rOut, a2)} Z`;
  }).join(" ");

  return (
    <div className="relative select-none" style={{ width: size, height: size }}>
      {/* Outer neon halo */}
      <div
        className="absolute inset-[-25%] rounded-full pointer-events-none"
        style={{
          background: "radial-gradient(circle, oklch(0.75 0.24 245 / 0.55), transparent 65%)",
          filter: "blur(28px)",
          opacity: 0.35 + (hot ? level * 0.5 + beat * 0.25 : 0.05),
          transition: "opacity .15s",
        }}
      />

      {/* Rotating brushed silver bezel */}
      <div
        className="absolute inset-0 rounded-full cyber-bezel"
        style={{ animation: `cyber-spin ${bezelDur} linear infinite` }}
      />

      {/* Inner dark groove */}
      <div className="absolute inset-[7%] rounded-full cyber-groove" />

      {/* SVG stack — HUD lattice + iris + pupil */}
      <svg viewBox="0 0 100 100" className="absolute inset-[9%] w-[82%] h-[82%] overflow-visible">
        <defs>
          <radialGradient id="pupilCore" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="oklch(0.98 0.05 235)" stopOpacity="1" />
            <stop offset="35%" stopColor="oklch(0.78 0.24 245)" stopOpacity="0.95" />
            <stop offset="100%" stopColor="oklch(0.15 0.15 260)" stopOpacity="0" />
          </radialGradient>
          <radialGradient id="lensBg" cx="50%" cy="50%" r="60%">
            <stop offset="0%" stopColor="oklch(0.12 0.1 255)" />
            <stop offset="70%" stopColor="oklch(0.05 0.06 260)" />
            <stop offset="100%" stopColor="#000" />
          </radialGradient>
          <filter id="neonBlur" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="0.6" />
          </filter>
        </defs>

        {/* Lens background */}
        <circle cx="50" cy="50" r="49" fill="url(#lensBg)" />

        {/* Concentric HUD arcs */}
        <g stroke="oklch(0.8 0.2 240)" fill="none" filter="url(#neonBlur)">
          {[45, 40, 34, 28, 22].map((r, i) => (
            <circle
              key={r}
              cx="50"
              cy="50"
              r={r}
              strokeWidth={0.3}
              strokeDasharray={`${2 + i} ${1 + i * 0.5}`}
              opacity={0.35 + i * 0.08}
              style={{
                transformOrigin: "50% 50%",
                animation: `cyber-spin ${18 - i * 2}s linear ${i % 2 ? "reverse" : "normal"} infinite`,
              }}
            />
          ))}
        </g>

        {/* Radial spokes */}
        <g stroke="oklch(0.85 0.18 235 / 0.35)" strokeWidth="0.25">
          {Array.from({ length: 24 }).map((_, i) => {
            const a = (i / 24) * Math.PI * 2;
            const x1 = 50 + Math.cos(a) * 20;
            const y1 = 50 + Math.sin(a) * 20;
            const x2 = 50 + Math.cos(a) * 45;
            const y2 = 50 + Math.sin(a) * 45;
            return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} />;
          })}
        </g>

        {/* Crosshair */}
        <g stroke="oklch(0.88 0.2 235)" strokeWidth="0.35" opacity={0.75}>
          <line x1="2" y1="50" x2="98" y2="50" />
          <line x1="50" y1="2" x2="50" y2="98" />
        </g>

        {/* Aperture iris blades */}
        <path
          d={blades}
          fill="oklch(0.18 0.1 258)"
          stroke="oklch(0.7 0.2 240)"
          strokeWidth="0.3"
          style={{
            transformOrigin: "50% 50%",
            animation: `cyber-spin ${irisDur} linear infinite`,
            transition: "d .1s linear",
          }}
        />

        {/* Pupil core */}
        <circle
          cx="50"
          cy="50"
          r={9 + pupilGlow * 4}
          fill="url(#pupilCore)"
          style={{ transition: "r .08s linear", filter: `drop-shadow(0 0 ${4 + pupilGlow * 8}px oklch(0.8 0.25 240))` }}
        />
        <circle cx="50" cy="50" r="1.4" fill="oklch(0.99 0.03 230)" />
      </svg>

      {/* Curved micro-text on bezel */}
      {showMicroText && (
        <svg viewBox="0 0 100 100" className="absolute inset-0 w-full h-full pointer-events-none">
          <defs>
            <path id="cyberTop" d="M 50,50 m -46,0 a 46,46 0 1,1 92,0 a 46,46 0 1,1 -92,0" />
          </defs>
          <text
            fill="oklch(0.9 0.05 230 / 0.75)"
            style={{ fontSize: 2.6, letterSpacing: "0.35em", fontFamily: "Orbitron, sans-serif", textTransform: "uppercase" }}
          >
            <textPath href="#cyberTop" startOffset="0%">
              · CYBER-LENS · 0.1 nm RES · ALPHA CORE · ONLINE · CYBER-LENS · 0.1 nm RES ·
            </textPath>
          </text>
        </svg>
      )}
    </div>
  );
}
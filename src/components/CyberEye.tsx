import { useEffect, useState } from "react";

/**
 * Live "cyber-lens" eye — brushed silver bezel, spiraling carbon-fiber
 * aperture blades, holographic neon-blue HUD retina, and a pulsating
 * micro-aperture pupil. All CSS + SVG, reacts to audio + speaking state.
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
  const bezelDur = hot ? "18s" : "40s";
  const pupilGlow = 0.5 + (active ? level * 0.7 : 0) + (speaking ? beat * 0.5 : 0);

  // 10 spiraling carbon-fiber aperture blades. Each blade is a curved crescent
  // sweeping from the outer groove toward the center — like a real camera iris.
  const BLADES = 10;
  const rOuter = 48;
  const rInner = 14;   // where blade tips converge
  const sweep = (Math.PI * 2) / BLADES * 1.55; // overlap angle → spiral
  const bladePaths = Array.from({ length: BLADES }, (_, i) => {
    const a0 = (i / BLADES) * Math.PI * 2;
    const a1 = a0 + sweep;
    const p = (r: number, ang: number) =>
      `${(50 + Math.cos(ang) * r).toFixed(2)},${(50 + Math.sin(ang) * r).toFixed(2)}`;
    // Control point pulled inward to curve the blade
    const ctrlR = rInner + 6;
    const ctrlA = (a0 + a1) / 2;
    return `M ${p(rOuter, a0)} A ${rOuter} ${rOuter} 0 0 1 ${p(rOuter, a1)} Q ${p(ctrlR, ctrlA)} ${p(rInner, a0)} Z`;
  });

  return (
    <div className="relative select-none" style={{ width: size, height: size }}>
      {/* Outer neon halo */}
      <div
        className="absolute inset-[-20%] rounded-full pointer-events-none"
        style={{
          background: "radial-gradient(circle, oklch(0.75 0.26 245 / 0.55), transparent 62%)",
          filter: "blur(30px)",
          opacity: 0.3 + (hot ? level * 0.5 + beat * 0.25 : 0.08),
          transition: "opacity .15s",
        }}
      />

      {/* Rotating brushed silver bezel */}
      <div
        className="absolute inset-0 rounded-full cyber-bezel"
        style={{ animation: `cyber-spin ${bezelDur} linear infinite` }}
      />
      {/* Fine inner silver lip */}
      <div className="absolute inset-[5.5%] rounded-full cyber-bezel-lip pointer-events-none" />

      {/* Dark metallic groove holding the aperture */}
      <div className="absolute inset-[8%] rounded-full cyber-groove" />

      {/* SVG stack: aperture blades + HUD retina + pupil */}
      <svg viewBox="0 0 100 100" className="absolute inset-[10%] w-[80%] h-[80%] overflow-visible">
        <defs>
          <radialGradient id="pupilCore" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="oklch(0.99 0.06 232)" stopOpacity="1" />
            <stop offset="28%" stopColor="oklch(0.82 0.28 240)" stopOpacity="0.95" />
            <stop offset="70%" stopColor="oklch(0.42 0.22 250)" stopOpacity="0.6" />
            <stop offset="100%" stopColor="oklch(0 0 0)" stopOpacity="0" />
          </radialGradient>
          <radialGradient id="lensBg" cx="50%" cy="50%" r="65%">
            <stop offset="0%" stopColor="oklch(0.14 0.14 255)" />
            <stop offset="55%" stopColor="oklch(0.06 0.08 260)" />
            <stop offset="100%" stopColor="#000" />
          </radialGradient>
          <radialGradient id="bladeShade" cx="50%" cy="50%" r="60%">
            <stop offset="0%" stopColor="oklch(0.22 0.03 255)" />
            <stop offset="100%" stopColor="oklch(0.05 0.02 260)" />
          </radialGradient>
          <linearGradient id="glassSheen" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="oklch(1 0 0 / 0.35)" />
            <stop offset="50%" stopColor="oklch(1 0 0 / 0.05)" />
            <stop offset="100%" stopColor="oklch(1 0 0 / 0)" />
          </linearGradient>
          <filter id="neonBlur" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="0.5" />
          </filter>
        </defs>

        {/* Lens background */}
        <circle cx="50" cy="50" r="49" fill="url(#lensBg)" />

        {/* Dense HUD retina — concentric data rings with ticks */}
        <g fill="none" filter="url(#neonBlur)">
          {[46, 42, 37, 32, 26, 20].map((r, i) => (
            <circle
              key={r}
              cx="50" cy="50" r={r}
              stroke="oklch(0.82 0.22 240)"
              strokeWidth={i === 0 ? 0.35 : 0.22}
              strokeDasharray={i % 2 ? `0.6 1.4` : `${1.2 + i * 0.4} ${0.6 + i * 0.3}`}
              opacity={0.35 + i * 0.08}
              style={{
                transformOrigin: "50% 50%",
                animation: `cyber-spin ${24 - i * 2.5}s linear ${i % 2 ? "reverse" : "normal"} infinite`,
              }}
            />
          ))}
        </g>

        {/* Faint teal circuit traces (short chord segments) */}
        <g stroke="oklch(0.78 0.16 200 / 0.55)" strokeWidth="0.18" fill="none">
          {Array.from({ length: 12 }).map((_, i) => {
            const a = (i / 12) * Math.PI * 2;
            const r1 = 24, r2 = 40;
            const x1 = 50 + Math.cos(a) * r1, y1 = 50 + Math.sin(a) * r1;
            const x2 = 50 + Math.cos(a + 0.18) * r2, y2 = 50 + Math.sin(a + 0.18) * r2;
            const xm = 50 + Math.cos(a + 0.09) * ((r1 + r2) / 2);
            const ym = 50 + Math.sin(a + 0.09) * ((r1 + r2) / 2);
            return <polyline key={i} points={`${x1},${y1} ${xm},${ym} ${x2},${y2}`} />;
          })}
        </g>

        {/* Radial hair spokes */}
        <g stroke="oklch(0.88 0.18 235 / 0.28)" strokeWidth="0.18">
          {Array.from({ length: 48 }).map((_, i) => {
            const a = (i / 48) * Math.PI * 2;
            const r1 = 18, r2 = i % 4 === 0 ? 46 : 42;
            return (
              <line key={i}
                x1={50 + Math.cos(a) * r1} y1={50 + Math.sin(a) * r1}
                x2={50 + Math.cos(a) * r2} y2={50 + Math.sin(a) * r2}
              />
            );
          })}
        </g>

        {/* Precision crosshair */}
        <g stroke="oklch(0.95 0.2 232)" strokeWidth="0.35" opacity={0.85} filter="url(#neonBlur)">
          <line x1="1" y1="50" x2="99" y2="50" />
          <line x1="50" y1="1" x2="50" y2="99" />
        </g>

        {/* Spiraling carbon-fiber aperture blades (drawn OVER the HUD, framing pupil) */}
        <g>
          {bladePaths.map((d, i) => (
            <path
              key={i}
              d={d}
              fill="url(#bladeShade)"
              stroke="oklch(0.55 0.02 240 / 0.55)"
              strokeWidth="0.25"
              opacity={0.92}
            />
          ))}
        </g>

        {/* Energy ring around micro-aperture */}
        <circle cx="50" cy="50" r={rInner + 0.3}
          fill="none"
          stroke="oklch(0.9 0.28 235)"
          strokeWidth={1.2 + pupilGlow * 1.6}
          opacity={0.85}
          style={{ filter: `drop-shadow(0 0 ${4 + pupilGlow * 10}px oklch(0.85 0.28 238))` }}
        />

        {/* Pupil core (bright blue) */}
        <circle
          cx="50" cy="50"
          r={rInner - 3 + pupilGlow * 2}
          fill="url(#pupilCore)"
          style={{ transition: "r .08s linear", filter: `drop-shadow(0 0 ${6 + pupilGlow * 10}px oklch(0.85 0.28 240))` }}
        />

        {/* Pitch-black micro void at dead center */}
        <circle cx="50" cy="50" r={rInner - 8} fill="#000" />
        <circle cx="50" cy="50" r="0.9" fill="oklch(0.99 0.04 232)" />

        {/* Glossy top-half dome highlight */}
        <ellipse cx="50" cy="30" rx="34" ry="16" fill="url(#glassSheen)" opacity="0.55" />
      </svg>

      {/* Curved micro-text engraved on the silver bezel */}
      {showMicroText && (
        <svg viewBox="0 0 100 100" className="absolute inset-0 w-full h-full pointer-events-none">
          <defs>
            <path id="cyberTop" d="M 50,50 m -46,0 a 46,46 0 1,1 92,0 a 46,46 0 1,1 -92,0" />
          </defs>
          <text
            fill="oklch(0.35 0.01 240 / 0.95)"
            style={{ fontSize: 2.5, letterSpacing: "0.32em", fontFamily: "Orbitron, sans-serif", textTransform: "uppercase" }}
          >
            <textPath href="#cyberTop" startOffset="0%">
              · CYBER-LENS 0.1nm RES · CYBER-LENS 0.1nm RES · CYBER-LENS 0.1nm RES · CYBER-LENS 0.1nm RES ·
            </textPath>
          </text>
        </svg>
      )}
    </div>
  );
}
import { useEffect, useState } from "react";

/**
 * Live "cyber-lens" eye — brushed silver bezel with neon-blue engraved
 * micro-text at four cardinal points, a dense holographic HUD retina, eight
 * curved neon-blue light streaks acting as the iris, a bright cyan crosshair
 * with radial light burst, and a proper spiral shutter pupil.
 *
 * All CSS + SVG. Reacts to the audio analyser + speaking state.
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
  const bezelDur = hot ? "24s" : "60s";
  const pupilGlow = 0.5 + (active ? level * 0.7 : 0) + (speaking ? beat * 0.5 : 0);

  // 8 gentle neon-blue light-streak crescents that read as iris blades.
  // The angular offset (~0.35 rad) is deliberately small so the streaks
  // are almost radial with a subtle CCW tilt — matching the reference,
  // where the blades are long soft arcs, not aggressive spirals.
  const BLADES = 8;
  const rOuter = 47;
  const rPupil = 12;
  const bladeStreaks = Array.from({ length: BLADES }, (_, i) => {
    const a0 = (i / BLADES) * Math.PI * 2 - Math.PI / 2;
    // Long sweeping arc — blade wraps ~55° (0.95 rad) counterclockwise
    // from the outer rim into the pupil, matching the reference's long
    // flowing crescents.
    const a1 = a0 + 0.95;
    const x1 = 50 + Math.cos(a0) * rOuter;
    const y1 = 50 + Math.sin(a0) * rOuter;
    const x2 = 50 + Math.cos(a1) * (rPupil + 1);
    const y2 = 50 + Math.sin(a1) * (rPupil + 1);
    const am = (a0 + a1) / 2;
    // Control point pulled outward from the chord midpoint so the arc
    // bows outward, giving each blade a gentle scimitar curve.
    const cx = 50 + Math.cos(am - 0.15) * ((rOuter + rPupil) / 2 + 4);
    const cy = 50 + Math.sin(am - 0.15) * ((rOuter + rPupil) / 2 + 4);
    return `M ${x1.toFixed(2)},${y1.toFixed(2)} Q ${cx.toFixed(2)},${cy.toFixed(2)} ${x2.toFixed(2)},${y2.toFixed(2)}`;
  });

  // 8-segment spiral shutter pupil — smooth overlapping petals with a
  // subtle swirl. Rather than pointed tips, the petals wrap around each
  // other so the interior reads as a soft rotating aperture.
  const PUPIL_BLADES = 8;
  const rP = rPupil - 0.5;  // pupil outer
  const shutterPetals = Array.from({ length: PUPIL_BLADES }, (_, i) => {
    const a0 = (i / PUPIL_BLADES) * Math.PI * 2;
    const a1 = a0 + (Math.PI * 2) / PUPIL_BLADES;
    const p = (r: number, ang: number) =>
      `${(50 + Math.cos(ang) * r).toFixed(2)},${(50 + Math.sin(ang) * r).toFixed(2)}`;
    // Classic camera-aperture blade: outer arc from a0 → a1, then a curved
    // chord back through an inner point biased toward a1 for the swirl.
    const innerA = a0 + ((a1 - a0) * 0.72);
    const innerR = rP * 0.08;
    const cA = a0 + ((a1 - a0) * 0.35);
    const cR = rP * 0.55;
    return `M ${p(rP, a0)} A ${rP} ${rP} 0 0 1 ${p(rP, a1)} Q ${p(cR, cA)} ${p(innerR, innerA)} Z`;
  });

  // Radial "light burst" rays emanating from the pupil.
  const RAYS = 36;
  const rays = Array.from({ length: RAYS }, (_, i) => {
    const a = (i / RAYS) * Math.PI * 2;
    const rIn = rPupil + 0.5;
    const rOut = 46;
    return {
      x1: 50 + Math.cos(a) * rIn,
      y1: 50 + Math.sin(a) * rIn,
      x2: 50 + Math.cos(a) * rOut,
      y2: 50 + Math.sin(a) * rOut,
      strong: i % 3 === 0,
    };
  });

  return (
    <div className="relative select-none" style={{ width: size, height: size }}>
      {/* Outer neon halo */}
      <div
        className="absolute inset-[-20%] rounded-full pointer-events-none"
        style={{
          background: "radial-gradient(circle, oklch(0.75 0.26 245 / 0.55), transparent 62%)",
          filter: "blur(30px)",
          opacity: 0.28 + (hot ? level * 0.5 + beat * 0.25 : 0.05),
          transition: "opacity .15s",
        }}
      />

      {/* Rotating brushed silver bezel */}
      <div
        className="absolute inset-0 rounded-full cyber-bezel"
        style={{ animation: `cyber-spin ${bezelDur} linear infinite` }}
      />
      {/* Static bezel overlays (text + LCD ticks + inner tick ring) sit on
          top of the rotating brushed metal so they read cleanly. */}
      {showMicroText && <BezelOverlay />}
      {/* Fine inner silver lip */}
      <div className="absolute inset-[5.5%] rounded-full cyber-bezel-lip pointer-events-none" />

      {/* Dark metallic groove holding the aperture */}
      <div className="absolute inset-[8%] rounded-full cyber-groove" />

      {/* SVG stack: HUD retina + light-streak iris + radial burst + shutter pupil.
          NOTE: no overflow-visible — crosshair/rays must clip at the lens edge. */}
      <svg viewBox="0 0 100 100" className="absolute inset-[10%] w-[80%] h-[80%]">
        <defs>
          <clipPath id="lensClip"><circle cx="50" cy="50" r="49" /></clipPath>
          <radialGradient id="pupilCore" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="oklch(0.99 0.06 232)" stopOpacity="1" />
            <stop offset="28%" stopColor="oklch(0.82 0.28 240)" stopOpacity="0.95" />
            <stop offset="70%" stopColor="oklch(0.42 0.22 250)" stopOpacity="0.6" />
            <stop offset="100%" stopColor="oklch(0 0 0)" stopOpacity="0" />
          </radialGradient>
          <radialGradient id="lensBg" cx="50%" cy="50%" r="65%">
            <stop offset="0%" stopColor="oklch(0.22 0.18 250)" />
            <stop offset="45%" stopColor="oklch(0.1 0.12 258)" />
            <stop offset="100%" stopColor="oklch(0.02 0.04 260)" />
          </radialGradient>
          <radialGradient id="burstGrad" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="oklch(0.98 0.24 235)" stopOpacity="1" />
            <stop offset="35%" stopColor="oklch(0.75 0.28 240)" stopOpacity="0.7" />
            <stop offset="100%" stopColor="oklch(0.4 0.22 250)" stopOpacity="0" />
          </radialGradient>
          <linearGradient id="glassSheen" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="oklch(1 0 0 / 0.35)" />
            <stop offset="50%" stopColor="oklch(1 0 0 / 0.05)" />
            <stop offset="100%" stopColor="oklch(1 0 0 / 0)" />
          </linearGradient>
          <filter id="neonBlur" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="0.35" />
          </filter>
          <filter id="neonGlow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="1.2" />
          </filter>
        </defs>

        <g clipPath="url(#lensClip)">
        {/* Lens background */}
        <circle cx="50" cy="50" r="49" fill="url(#lensBg)" />

        {/* Dense HUD retina — many concentric data rings with dashed ticks */}
        <g fill="none" filter="url(#neonBlur)">
          {[47, 44, 41, 38, 35, 32, 29, 26, 23, 20, 17].map((r, i) => (
            <circle
              key={r}
              cx="50" cy="50" r={r}
              stroke="oklch(0.75 0.22 240)"
              strokeWidth={i % 3 === 0 ? 0.28 : 0.16}
              strokeDasharray={
                i % 3 === 0 ? `${1.5 + i * 0.2} ${0.5 + i * 0.15}`
                : i % 2 === 0 ? `0.4 1.2`
                : `2.4 1.0 0.4 1.0`
              }
              opacity={0.35 + (i % 3 === 0 ? 0.25 : 0.1)}
              style={{
                transformOrigin: "50% 50%",
                animation: `cyber-spin ${34 - i * 2}s linear ${i % 2 ? "reverse" : "normal"} infinite`,
              }}
            />
          ))}
        </g>

        {/* Scattered rectangular data glyphs (mimics the small readouts in ref) */}
        <g fill="oklch(0.8 0.22 238)" opacity="0.55">
          {Array.from({ length: 22 }).map((_, i) => {
            const a = (i * 137.5) * Math.PI / 180; // golden-angle scatter
            const r = 22 + ((i * 7) % 20);
            const x = 50 + Math.cos(a) * r;
            const y = 50 + Math.sin(a) * r;
            const w = 0.7 + (i % 3) * 0.4;
            const h = 0.35;
            return <rect key={i} x={x} y={y} width={w} height={h} rx="0.1" />;
          })}
        </g>

        {/* Radial light burst — bright rays emanating from the pupil */}
        <g filter="url(#neonBlur)">
          {rays.map((r, i) => (
            <line
              key={i}
              x1={r.x1} y1={r.y1} x2={r.x2} y2={r.y2}
              stroke={r.strong ? "oklch(0.95 0.25 235)" : "oklch(0.78 0.22 240)"}
              strokeWidth={r.strong ? 0.35 : 0.18}
              opacity={r.strong ? 0.7 : 0.35}
            />
          ))}
        </g>

        {/* Bright cyan crosshair spanning full lens */}
        <g stroke="oklch(0.96 0.22 232)" strokeWidth="0.55" opacity="0.95" filter="url(#neonBlur)">
          <line x1="2" y1="50" x2="98" y2="50" />
          <line x1="50" y1="2" x2="50" y2="98" />
        </g>
        {/* Crosshair glow underlay */}
        <g stroke="oklch(0.8 0.28 240)" strokeWidth="1.6" opacity="0.35" filter="url(#neonGlow)">
          <line x1="2" y1="50" x2="98" y2="50" />
          <line x1="50" y1="2" x2="50" y2="98" />
        </g>

        {/* Iris — 8 glowing neon-blue light-streak crescents spiraling inward */}
        <g fill="none" strokeLinecap="round" filter="url(#neonBlur)">
          {bladeStreaks.map((d, i) => (
            <g key={i}>
              {/* soft outer glow */}
              <path d={d} stroke="oklch(0.75 0.28 240)" strokeWidth="1.4" opacity="0.35" />
              {/* bright inner streak */}
              <path d={d} stroke="oklch(0.96 0.22 235)" strokeWidth="0.5" opacity="0.95" />
            </g>
          ))}
        </g>

        {/* Radial burst gradient disc behind pupil (soft bloom) — larger and
            brighter so the pupil clearly radiates, matching the reference. */}
        <circle cx="50" cy="50" r={rPupil + 16 + pupilGlow * 4} fill="url(#burstGrad)" opacity={0.75 + pupilGlow * 0.25} />
        <circle cx="50" cy="50" r={rPupil + 6} fill="oklch(0.95 0.24 235)" opacity={0.35 + pupilGlow * 0.25} filter="url(#neonGlow)" />

        {/* Spiral shutter pupil — bright blue overlapping petals with a
            smooth swirl (no starburst spikes). */}
        <g style={{ filter: `drop-shadow(0 0 ${5 + pupilGlow * 10}px oklch(0.85 0.28 238))` }}>
          <circle cx="50" cy="50" r={rP + 0.3} fill="oklch(0.55 0.24 245)" />
          {shutterPetals.map((d, i) => (
            <path
              key={i}
              d={d}
              fill="oklch(0.78 0.26 240)"
              stroke="oklch(0.98 0.2 232)"
              strokeWidth="0.18"
              opacity="0.9"
            />
          ))}
          {/* Bright rim of the pupil disc */}
          <circle cx="50" cy="50" r={rP + 0.4} fill="none" stroke="oklch(0.99 0.22 232)" strokeWidth="0.35" opacity="0.9" />
        </g>

        {/* Pitch-black micro void at dead center */}
        <circle cx="50" cy="50" r="1.1" fill="#000" />

        {/* Glossy top-half dome highlight */}
        <ellipse cx="50" cy="28" rx="36" ry="14" fill="url(#glassSheen)" opacity="0.5" />
        </g>
      </svg>
    </div>
  );
}

/**
 * Static overlay drawn on top of the rotating brushed-silver bezel:
 *   • bright neon-blue "CYBER-LENS 0.1nm RES" at 4 cardinal points
 *   • LCD-strip tick clusters between the text
 *   • fine tick ring on the inner edge of the bezel
 */
function BezelOverlay() {
  // Bezel text is placed by rotation transform, not textPath — the string is
  // short enough to read as a straight chord, and this approach guarantees
  // upright glyphs on every browser.
  //   • R_TEXT is the radius of the text baseline in viewBox units (0..100)
  //   • Bezel visible ring runs ~33..50 in viewBox radius
  // Bezel visible ring in viewBox coords: ~42..50 (groove ends at 42, bezel
  // outer edge at 50). Text sits at R=46 — the middle of the silver rim.
  const R_TEXT = 46;
  const LABEL = "CYBER-LENS 0.1nm RES";
  // Four cardinal positions and the rotation each label needs so it reads
  // upright when viewed from outside the ring.
  const labels = [
    { tx: 50,             ty: 50 - R_TEXT + 1.0, rotate: 0   }, // TOP
    { tx: 50 + R_TEXT - 1.0, ty: 50,             rotate: 90  }, // RIGHT
    { tx: 50,             ty: 50 + R_TEXT - 0.2, rotate: 180 }, // BOTTOM (label rotates 180 so it reads upright when viewed from outside the ring)
    { tx: 50 - R_TEXT + 1.0, ty: 50,             rotate: 270 }, // LEFT
  ];
  return (
    <svg viewBox="0 0 100 100" className="absolute inset-0 w-full h-full pointer-events-none">
      {labels.map((l, i) => (
        <text
          key={i}
          x={l.tx}
          y={l.ty}
          transform={`rotate(${l.rotate} ${l.tx} ${l.ty})`}
          textAnchor="middle"
          fill="oklch(0.9 0.24 235)"
          fontFamily="Orbitron, sans-serif"
          fontSize="2.6"
          letterSpacing="0.35"
          style={{ textTransform: "uppercase", filter: "drop-shadow(0 0 0.5px oklch(0.95 0.28 235))" }}
        >
          {LABEL}
        </text>
      ))}

      {/* LCD-strip tick clusters at 4 inter-cardinal positions (~45°) */}
      <g stroke="oklch(0.85 0.24 235)" strokeWidth="0.35" opacity="0.9"
         style={{ filter: "drop-shadow(0 0 0.6px oklch(0.9 0.28 235))" }}>
        {[45, 135, 225, 315].map((deg) => {
          const a = (deg - 90) * Math.PI / 180;
          const cx = 50 + Math.cos(a) * 46;
          const cy = 50 + Math.sin(a) * 46;
          // Tangent direction for the tick strip
          const tx = -Math.sin(a), ty = Math.cos(a);
          // Radial direction (for tick length)
          const rx = Math.cos(a), ry = Math.sin(a);
          return (
            <g key={deg}>
              {Array.from({ length: 9 }).map((_, i) => {
                const off = (i - 4) * 0.55;
                const bx = cx + tx * off;
                const by = cy + ty * off;
                const len = i % 2 === 0 ? 1.4 : 0.8;
                return (
                  <line key={i}
                    x1={bx - rx * len / 2} y1={by - ry * len / 2}
                    x2={bx + rx * len / 2} y2={by + ry * len / 2}
                  />
                );
              })}
            </g>
          );
        })}
      </g>

      {/* Fine tick ring on the inner edge of the bezel */}
      <g stroke="oklch(0.6 0.06 240 / 0.9)" strokeWidth="0.14">
        {Array.from({ length: 120 }).map((_, i) => {
          const a = (i / 120) * Math.PI * 2;
          const r1 = 43.5;
          const r2 = i % 5 === 0 ? 42.3 : 42.9;
          return (
            <line key={i}
              x1={50 + Math.cos(a) * r1} y1={50 + Math.sin(a) * r1}
              x2={50 + Math.cos(a) * r2} y2={50 + Math.sin(a) * r2}
            />
          );
        })}
      </g>
    </svg>
  );
}
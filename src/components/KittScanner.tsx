import { useEffect, useState } from "react";
import { speakingState } from "../lib/voice";
import { alertBus } from "../lib/alerts";

export type KittState = "idle" | "scanning" | "speaking" | "processing" | "alert" | "off";

/**
 * Knight Rider (K.I.T.T.) style "anamorphic equalizer" scanner.
 * Two halves split by a central divider; each half sweeps outward with
 * softly trailing bars. States:
 *   idle       — slow heartbeat sweep
 *   scanning   — brisk sweep while the mic is listening
 *   speaking   — fast bright sweep while Alpha talks
 *   processing — bars fire from the center gap outward simultaneously
 *   alert      — fast amber urgent sweep (auto-triggered from alertBus)
 *   off        — fully faded (background-processing disabled in settings)
 *
 * `curved` renders the bar as a subtle arc — used under the voice-first orb.
 */
export function KittScanner({
  state = "idle",
  bars = 24,
  className = "",
  height = 18,
  curved = false,
}: {
  state?: KittState;
  bars?: number;
  className?: string;
  height?: number;
  curved?: boolean;
}) {
  const [talking, setTalking] = useState(false);
  const [alerting, setAlerting] = useState(false);
  useEffect(() => speakingState.sub(setTalking), []);
  useEffect(() =>
    alertBus.sub((on) => {
      setAlerting(on);
      if (on) setTimeout(() => setAlerting(false), 6000);
    }),
  []);

  const effective: KittState =
    state === "off" ? "off"
    : alerting ? "alert"
    : talking ? "speaking"
    : state;

  if (curved) {
    const segmentCount = Math.max(10, bars);
    const dur =
      effective === "alert" ? 500 :
      effective === "speaking" ? 900 :
      effective === "processing" ? 700 :
      effective === "scanning" ? 1400 : 2600;
    // Geometry: a proper circular arc that follows the bottom of the orb —
    // ends rise UP the sides (like headphones / a smile), dipping at centre.
    // Circle centre above the viewBox so only the lower arc lies inside.
    const cx = 150, cy = 10, r = 130;
    const startDeg = 32, endDeg = 148; // sweep across the bottom of the orb
    const rad = (d: number) => (d * Math.PI) / 180;
    const arcBars = Array.from({ length: segmentCount }).map((_, i) => {
      const t = i / (segmentCount - 1);
      const deg = startDeg + (endDeg - startDeg) * t;
      const x = cx + r * Math.cos(rad(deg));
      const y = cy + r * Math.sin(rad(deg));
      // Tangent orientation: 90° from radial (so segments sit ON the arc).
      const tangent = deg + 90;
      // Distance from centre bar, 0..1 (used for wave delay)
      const centreT = Math.abs(t - 0.5) * 2;
      const delay = effective === "processing"
        ? (1 - centreT) * dur           // centre fires first, outward
        : centreT * dur;                 // ends first, sweep toward centre
      return { x, y, angle: tangent, delay };
    });
    // Rail path — same arc, drawn as a full stroke behind segments.
    const p0 = { x: cx + r * Math.cos(rad(startDeg)), y: cy + r * Math.sin(rad(startDeg)) };
    const p1 = { x: cx + r * Math.cos(rad(endDeg)),   y: cy + r * Math.sin(rad(endDeg)) };
    const railD = `M ${p0.x} ${p0.y} A ${r} ${r} 0 0 1 ${p1.x} ${p1.y}`;
    // Gap marker sits at bottom-centre of the arc.
    const gapX = cx, gapY = cy + r; // bottom of circle
    return (
      <svg
        role="presentation"
        viewBox="0 0 300 160"
        className={`kitt-arc ${effective === "alert" ? "kitt-alert" : ""} ${effective === "off" ? "kitt-off" : ""} ${className}`}
        style={{ height, "--kitt-dur": `${dur}ms` } as unknown as React.CSSProperties}
        preserveAspectRatio="none"
      >
        <path className="kitt-arc-rail" d={railD} />
        {arcBars.map((b, i) => (
          <rect
            key={i}
            className="kitt-arc-segment"
            x={b.x - 6}
            y={b.y - 2.5}
            width="12"
            height="5"
            rx="2"
            style={{ animationDelay: `${b.delay}ms`, transformOrigin: `${b.x}px ${b.y}px`, transform: `rotate(${b.angle}deg)` }}
          />
        ))}
        <rect className="kitt-arc-gap" x={gapX - 5} y={gapY - 8} width="10" height="16" rx="2" />
      </svg>
    );
  }

  if (effective === "off") {
    return <div className={`kitt-split kitt-off ${curved ? "kitt-curved" : ""} ${className}`} style={{ height }} />;
  }

  const dur =
    effective === "alert" ? 500 :
    effective === "speaking" ? 900 :
    effective === "processing" ? 700 :
    effective === "scanning" ? 1400 : 2600;
  const opacityMin =
    effective === "alert" ? 0.4 :
    effective === "speaking" ? 0.35 :
    effective === "scanning" ? 0.25 : 0.15;
  const opacityMax =
    effective === "alert" ? 1 :
    effective === "speaking" ? 1 :
    effective === "scanning" ? 0.95 : 0.6;

  const half = Math.max(4, Math.floor(bars / 2));
  // For "processing", bars fire outward from the center gap — index 0 (nearest
  // gap) starts first. For everything else, sweep from outer edge inward.
  const delayFor = (i: number) =>
    effective === "processing"
      ? (i / half) * dur          // 0 = center → outward
      : ((half - i) / half) * dur; // 0 = outer edge → toward center

  const halfStyle = {
    "--kitt-dur": `${dur}ms`,
    "--kitt-min": opacityMin,
    "--kitt-max": opacityMax,
  } as unknown as React.CSSProperties;

  return (
    <div
      role="presentation"
      className={`kitt-split ${effective === "alert" ? "kitt-alert" : ""} ${curved ? "kitt-curved" : ""} ${className}`}
      style={{ height }}
    >
      <div className="kitt-half left" style={halfStyle}>
        {Array.from({ length: half }).map((_, i) => (
          <span key={i} className="kitt-bar" style={{ animationDelay: `${delayFor(i)}ms` }} />
        ))}
      </div>
      <div className="kitt-gap" />
      <div className="kitt-half right" style={halfStyle}>
        {Array.from({ length: half }).map((_, i) => (
          <span key={i} className="kitt-bar" style={{ animationDelay: `${delayFor(i)}ms` }} />
        ))}
      </div>
    </div>
  );
}
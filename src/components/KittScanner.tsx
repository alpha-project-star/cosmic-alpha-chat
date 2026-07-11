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
    // @ts-expect-error CSS variables
    "--kitt-dur": `${dur}ms`,
    "--kitt-min": opacityMin,
    "--kitt-max": opacityMax,
  } as React.CSSProperties;

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
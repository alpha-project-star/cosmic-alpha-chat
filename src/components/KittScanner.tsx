import { useEffect, useState } from "react";
import { speakingState } from "../lib/voice";

export type KittState = "idle" | "scanning" | "speaking";

/**
 * Knight Rider style horizontal scanner bar.
 * A row of vertical bars pulsing in a wave sweep. Pure CSS animation —
 * each bar has a staggered animation-delay so it lights up in sequence.
 *
 * States:
 *  - idle: slow, dim breathing sweep
 *  - scanning: fast, bright sweep (mic listening)
 *  - speaking: fastest, high intensity (Alpha talking)
 */
export function KittScanner({
  state = "idle",
  bars = 24,
  className = "",
  height = 18,
}: {
  state?: KittState;
  bars?: number;
  className?: string;
  height?: number;
}) {
  // Auto-reflect global speaking state → override to "speaking" while Alpha talks.
  const [talking, setTalking] = useState(false);
  useEffect(() => speakingState.sub(setTalking), []);
  const effective: KittState = talking ? "speaking" : state;

  const dur =
    effective === "speaking" ? 900 :
    effective === "scanning" ? 1400 : 2600;
  const opacityMin =
    effective === "speaking" ? 0.35 :
    effective === "scanning" ? 0.25 : 0.15;
  const opacityMax =
    effective === "speaking" ? 1 :
    effective === "scanning" ? 0.95 : 0.6;

  return (
    <div
      role="presentation"
      className={`kitt-scanner ${className}`}
      style={{
        // @ts-expect-error CSS variables
        "--kitt-count": bars,
        "--kitt-dur": `${dur}ms`,
        "--kitt-min": opacityMin,
        "--kitt-max": opacityMax,
        height,
      }}
    >
      {Array.from({ length: bars }).map((_, i) => (
        <span
          key={i}
          className="kitt-bar"
          style={{
            // Delay proportional to index — creates the sweep.
            animationDelay: `${(i / bars) * dur}ms`,
          }}
        />
      ))}
    </div>
  );
}
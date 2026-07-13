import { AlphaOrb } from "../AlphaOrb";
import { HorizontalSpectrum } from "./HorizontalSpectrum";
import { recognizer, speakingState } from "../../lib/voice";
import { useEffect, useState } from "react";
import { KittScanner } from "../KittScanner";
import { useAlpha } from "../../lib/alpha-store";

/**
 * Desktop hero orb with left/right horizontal spectrum wings, sized to viewport.
 */
export function OrbStage({ active }: { active: boolean }) {
  const [speaking, setSpeaking] = useState(false);
  const bgEnabled = useAlpha(s => s.settings.backgroundEnabled);
  useEffect(() => speakingState.sub(setSpeaking), []);
  const hot = active || speaking;
  return (
    <div className="relative flex items-center justify-center w-full h-full">
      <div
        className="absolute inset-0 pointer-events-none"
        style={{ background: "var(--gradient-nebula)", opacity: 0.9 }}
      />
      <div className="relative flex items-center justify-center w-full">
        <HorizontalSpectrum
          analyser={hot ? recognizer.analyserNode : null}
          speaking={speaking}
          mirror
          className="hidden lg:block flex-1 h-24 opacity-80"
        />
        <div className="relative shrink-0 mx-4">
          <AlphaOrb
            analyser={recognizer.analyserNode}
            active={hot}
            sizeCss="min(58vmin, 620px)"
          />
          <div className="absolute left-1/2 top-[82%] w-[78%] -translate-x-1/2 pointer-events-none">
            <KittScanner curved state={!bgEnabled ? "off" : active ? "scanning" : speaking ? "speaking" : "idle"} bars={38} height={86} />
          </div>
        </div>
        <HorizontalSpectrum
          analyser={hot ? recognizer.analyserNode : null}
          speaking={speaking}
          className="hidden lg:block flex-1 h-24 opacity-80"
        />
      </div>
    </div>
  );
}
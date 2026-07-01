import { AlphaOrb } from "../AlphaOrb";
import { HorizontalSpectrum } from "./HorizontalSpectrum";
import { recognizer, speakingState } from "../../lib/voice";
import { useEffect, useState } from "react";

/**
 * Desktop hero orb with left/right horizontal spectrum wings, sized to viewport.
 */
export function OrbStage({ active }: { active: boolean }) {
  const [speaking, setSpeaking] = useState(false);
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
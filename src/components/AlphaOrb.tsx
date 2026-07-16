import { useEffect, useState } from "react";
import { AudioSpectrum } from "./AudioSpectrum";
import { speakingState } from "../lib/voice";
import { CyberEye } from "./CyberEye";

export function AlphaOrb({ analyser, active, size = 280, sizeCss }: { analyser: AnalyserNode | null; active: boolean; size?: number; sizeCss?: string }) {
  const [speaking, setSpeaking] = useState(false);
  useEffect(() => speakingState.sub(setSpeaking), []);

  return (
    <div className="relative" style={{ width: sizeCss ?? size, height: sizeCss ?? size }}>
      <AudioSpectrum analyser={active ? analyser : null} speaking={speaking} bars={56} className="absolute inset-[-18%] w-[136%] h-[136%]" />
      <CyberEye analyser={analyser} active={active} speaking={speaking} size="100%" />
    </div>
  );
}
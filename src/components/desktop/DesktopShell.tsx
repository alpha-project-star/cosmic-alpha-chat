import type { ReactNode } from "react";
import { MicDock } from "./MicDock";
import { ToolRail } from "./ToolRail";
import { OrbStage } from "./OrbStage";

/**
 * Two-column desktop layout: giant orb on the left, HUD panel (right children).
 * Rendered only at lg+ via `hidden lg:block`.
 */
export function DesktopShell({
  right,
  active,
  onMicToggle,
}: {
  right: ReactNode;
  active: boolean;
  onMicToggle: () => void;
}) {
  return (
    <div className="hidden lg:block starfield fixed inset-0 overflow-hidden">
      <div className="absolute top-6 left-1/2 -translate-x-1/2 z-20 wordmark text-2xl select-none pointer-events-none">
        ALPHA
      </div>

      <ToolRail />

      <div className="grid grid-cols-[1fr_minmax(380px,460px)] gap-6 h-full pt-24 pb-32 pr-6 pl-24">
        <div className="relative min-w-0">
          <OrbStage active={active} />
        </div>
        <div className="relative min-w-0 min-h-0 flex flex-col pr-2">
          {right}
        </div>
      </div>

      <MicDock active={active} onToggle={onMicToggle} />
    </div>
  );
}
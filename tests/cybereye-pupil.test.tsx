/** @vitest-environment jsdom */
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { CyberEye } from "../src/components/CyberEye";

describe("CyberEye Orb Pupil Removal", () => {
  it("completely removes the tiny pupil from the orb center", () => {
    const { container } = render(
      <CyberEye analyser={null} active={false} speaking={false} size={280} />
    );

    // Verify outer container does not have tilt transform or tilt rotation
    const outerContainer = container.querySelector(".relative.select-none > div");
    expect(outerContainer).not.toBeNull();
    const outerTransform = outerContainer?.getAttribute("style") || "";
    expect(outerTransform).not.toContain("translate3d");
    expect(outerTransform).not.toContain("rotate(");

    // Verify that the pupil core circles have been completely removed
    const circles = container.querySelectorAll("circle");
    
    // Check that pupil-specific circles are NOT present
    const pupilCoreCircles = Array.from(circles).filter((c) => {
      const fill = c.getAttribute("fill") || "";
      return (
        fill === "oklch(0.08 0.18 258)" ||
        fill === "oklch(0.42 0.28 254)" ||
        fill === "oklch(0.98 0.22 250)" ||
        fill === "#fff"
      );
    });
    expect(pupilCoreCircles).toHaveLength(0);

    // Only the soft ambient aperture glow disc remains at cx=50, cy=50
    const burstCircle = Array.from(circles).find(
      (c) => c.getAttribute("fill") === "url(#burstGrad)"
    );
    expect(burstCircle?.getAttribute("cx")).toBe("50");
    expect(burstCircle?.getAttribute("cy")).toBe("50");
  });
});

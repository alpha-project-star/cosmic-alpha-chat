import { describe, it, expect, vi } from "vitest";
import { handleEyeCommand, shouldCaptureFrame } from "../src/lib/vision-command";
import { stripLeakedThinking } from "../src/lib/openai-compat";
import { alphaStore } from "../src/lib/alpha-store";

describe("Forensic Verification & Regression Guard", () => {
  it("enforces Eye semantic separation, variations, and idempotency", async () => {
    // Explicit activation variations should be recognized as eye commands (not null)
    expect(await handleEyeCommand("Alpha, open your eyes")).not.toBeNull();
    expect(await handleEyeCommand("open the eyes")).not.toBeNull();
    expect(await handleEyeCommand("turn on the camera")).not.toBeNull();

    // Explicit deactivation variations
    expect(await handleEyeCommand("Alpha, close your eyes")).not.toBeNull();
    expect(await handleEyeCommand("close the eyes")).not.toBeNull();

    // Ordinary language should NOT trigger eye commands (must return null)
    expect(await handleEyeCommand("My eye hurts")).toBeNull();
    expect(await handleEyeCommand("I hurt my eye")).toBeNull();
    expect(await handleEyeCommand("The eye icon is nice")).toBeNull();
    expect(await handleEyeCommand("Where is the eye button?")).toBeNull();
    expect(await handleEyeCommand("Keep an eye on this")).toBeNull();
    expect(await handleEyeCommand("I like your eyes")).toBeNull();

    // Visual inquiry while closed should not capture or activate
    expect(shouldCaptureFrame("What can you see?", false, false)).toBe(false);
  });

  it("strips leaked thinking and reasoning tags correctly", () => {
    const raw = "<think>Internal reasoning step</think>Here is the final answer.";
    const cleaned = stripLeakedThinking(raw);
    expect(cleaned).toBe("Here is the final answer.");
    expect(cleaned).not.toContain("Internal reasoning step");
  });

  it("rejects unauthorized or unknown settings in alpha store", () => {
    alphaStore.setSettings({ backgroundEnabled: true });
    expect(alphaStore.get().settings.backgroundEnabled).toBe(true);
  });
});


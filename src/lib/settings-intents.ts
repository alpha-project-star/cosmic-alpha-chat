import { alphaStore } from "./alpha-store";

/**
 * Voice/text intents that flip settings or return a canned answer.
 * Returns confirmation string, or null if no match.
 */
export function trySettingsIntent(raw: string): string | null {
  const t = raw.trim().toLowerCase();

  // Backend switch
  if (/(switch|go|change|use)\s+.*offline/.test(t) || /offline\s+mode/.test(t)) {
    alphaStore.setSettings({ aiBackend: "ollama" });
    return "Switched to offline mode (Ollama).";
  }
  if (/(switch|go|change|use)\s+.*online/.test(t) || /online\s+mode/.test(t) || /use\s+gemini/.test(t)) {
    alphaStore.setSettings({ aiBackend: "gemini" });
    return "Switched to online mode (Gemini).";
  }
  if (/use\s+auto|automatic\s+backend/.test(t)) {
    alphaStore.setSettings({ aiBackend: "auto" });
    return "Backend set to Auto.";
  }

  // Voice on/off
  if (/(mute|silence|stop\s+speaking\s+aloud|voice\s+off|disable\s+voice)/.test(t)) {
    alphaStore.setSettings({ voiceEnabled: false });
    return "Voice replies disabled.";
  }
  if (/(unmute|voice\s+on|enable\s+voice|speak\s+aloud)/.test(t)) {
    alphaStore.setSettings({ voiceEnabled: true });
    return "Voice replies enabled.";
  }

  // Task model routing quick set: "use groq for fast", "use gemini for coding"
  const m = t.match(/use\s+(gemini|groq|openai)(?:\s+(\S+))?\s+for\s+(fast|thinking|deep|coding|code)/);
  if (m) {
    const prov = m[1];
    const model = m[2] || (prov === "groq" ? "llama-3.1-8b-instant" : prov === "gemini" ? "gemini-2.5-pro" : "gpt-4o-mini");
    let key: "fast" | "thinking" | "coding" =
      /coding|code/.test(m[3]) ? "coding" :
      /thinking|deep/.test(m[3]) ? "thinking" : "fast";
    const cur = alphaStore.get().settings.taskModels;
    alphaStore.setSettings({ taskModels: { ...cur, [key]: `${prov}:${model}` } });
    return `Set ${key} to ${prov}:${model}.`;
  }

  return null;
}
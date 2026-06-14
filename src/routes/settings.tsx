import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Home } from "lucide-react";
import { alphaStore, useAlpha } from "../lib/alpha-store";
import { listVoices } from "../lib/voice";

export const Route = createFileRoute("/settings")({
  head: () => ({ meta: [{ title: "Alpha — Settings" }, { name: "description", content: "Configure Alpha." }] }),
  component: SettingsRoute,
});

function SettingsRoute() {
  const s = useAlpha(x => x.settings);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  useEffect(() => {
    const update = () => setVoices(listVoices());
    update();
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.onvoiceschanged = update;
    }
  }, []);

  return (
    <div className="starfield min-h-screen">
      <header className="p-3 flex items-center gap-3 glass border-b border-primary/20">
        <Link to="/" className="p-1.5 rounded-full glass"><Home className="w-4 h-4 text-primary" /></Link>
        <span className="font-semibold neon-text">Settings</span>
      </header>

      <div className="p-4 max-w-xl mx-auto space-y-5">
        <Section title="Gemini API Key" hint="Paste your Google AI Studio key. Stored locally only — never sent to Lovable.">
          <input type="password" value={s.geminiApiKey} onChange={e => alphaStore.setSettings({ geminiApiKey: e.target.value })}
            placeholder="AI..." className="w-full bg-input rounded-md px-3 py-2 border border-border" />
        </Section>

        <Section title="Chat Model">
          <select value={s.chatModel} onChange={e => alphaStore.setSettings({ chatModel: e.target.value })}
            className="w-full bg-input rounded-md px-3 py-2 border border-border">
            <option value="gemini-2.5-flash">gemini-2.5-flash (fast)</option>
            <option value="gemini-2.5-pro">gemini-2.5-pro (strong)</option>
            <option value="gemini-2.0-flash">gemini-2.0-flash</option>
          </select>
        </Section>

        <Section title="Voice">
          <label className="flex items-center gap-2 text-sm mb-2">
            <input type="checkbox" checked={s.voiceEnabled} onChange={e => alphaStore.setSettings({ voiceEnabled: e.target.checked })} />
            Speak replies aloud
          </label>
          <label className="flex items-center gap-2 text-sm mb-2">
            <input type="checkbox" checked={s.continuousListen} onChange={e => alphaStore.setSettings({ continuousListen: e.target.checked })} />
            Continuous listening on the Orb
          </label>
          <div className="text-xs text-muted-foreground mb-1">Preferred voice (British female auto-selected)</div>
          <select value={s.preferredVoice} onChange={e => alphaStore.setSettings({ preferredVoice: e.target.value })}
            className="w-full bg-input rounded-md px-3 py-2 border border-border">
            <option value="">Auto</option>
            {voices.map(v => <option key={v.name} value={v.name}>{v.name} ({v.lang})</option>)}
          </select>
        </Section>

        <Section title="Persona Extras" hint="Add personal context Alpha should remember each call.">
          <textarea value={s.personaExtra} onChange={e => alphaStore.setSettings({ personaExtra: e.target.value })}
            className="w-full bg-input rounded-md px-3 py-2 border border-border min-h-[100px]" />
        </Section>
      </div>
    </div>
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="glass rounded-xl p-4">
      <div className="text-sm font-semibold mb-1">{title}</div>
      {hint && <div className="text-xs text-muted-foreground mb-2">{hint}</div>}
      {children}
    </div>
  );
}
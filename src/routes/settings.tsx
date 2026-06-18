import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ArrowLeft, Check } from "lucide-react";
import { alphaStore, useAlpha } from "../lib/alpha-store";
import { listVoices, speakWith } from "../lib/voice";

export const Route = createFileRoute("/settings")({
  head: () => ({ meta: [{ title: "Alpha — Settings" }, { name: "description", content: "Configure Alpha." }] }),
  component: SettingsRoute,
});

const KOKORO_VOICES = [
  { id: "am_michael", label: "Michael (smooth male)" },
  { id: "am_adam", label: "Adam (deep male)" },
  { id: "am_echo", label: "Echo (male)" },
  { id: "am_eric", label: "Eric (male)" },
  { id: "am_liam", label: "Liam (male)" },
  { id: "am_onyx", label: "Onyx (rich male)" },
  { id: "am_puck", label: "Puck (male)" },
  { id: "af_heart", label: "Heart (warm female)" },
  { id: "af_bella", label: "Bella (female)" },
  { id: "af_nicole", label: "Nicole (female)" },
  { id: "bf_emma", label: "Emma (British female)" },
  { id: "bm_george", label: "George (British male)" },
];

function SettingsRoute() {
  const s = useAlpha(x => x.settings);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [saved, setSaved] = useState(false);
  const [kokoroStatus, setKokoroStatus] = useState<string>("");
  useEffect(() => {
    const update = () => setVoices(listVoices());
    update();
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.onvoiceschanged = update;
    }
  }, []);

  async function testKokoro() {
    setKokoroStatus("Testing…");
    const url = s.kokoroEndpoint.trim();
    if (!url) { setKokoroStatus("⚠️ No endpoint set."); return; }
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input: "Hello, this is Alpha.", text: "Hello, this is Alpha.", model: "kokoro", voice: s.kokoroVoice, response_format: "mp3", speed: s.ttsRate }),
      });
      if (!res.ok) { setKokoroStatus(`❌ HTTP ${res.status}. Check the URL & CORS on your Kokoro server.`); return; }
      const blob = await res.blob();
      if (!blob.size) { setKokoroStatus("❌ Empty audio returned."); return; }
      const audio = new Audio(URL.createObjectURL(blob));
      audio.play().catch(() => {});
      setKokoroStatus(`✅ Kokoro is working (${(blob.size / 1024).toFixed(1)} KB).`);
    } catch (e: any) {
      setKokoroStatus(`❌ ${e?.message || "Fetch failed"}. Most likely CORS — your Kokoro server must allow this origin.`);
    }
  }

  return (
    <div className="starfield min-h-screen pb-24">
      <header className="p-3 flex items-center gap-3 glass border-b border-primary/20">
        <Link to="/" aria-label="Back" className="p-1.5 rounded-full glass neon-border"><ArrowLeft className="w-4 h-4 text-primary" /></Link>
        <span className="text-xs tracking-[0.4em] text-muted-foreground">SETTINGS</span>
      </header>

      <div className="p-4 max-w-xl mx-auto space-y-5">
        <Section title="Gemini API Key" hint="Paste your Google AI Studio key. Stored locally only.">
          <input type="password" value={s.geminiApiKey} onChange={e => alphaStore.setSettings({ geminiApiKey: e.target.value })}
            placeholder="AI..." className="w-full bg-input rounded-md px-3 py-2 border border-border" />
        </Section>

        <Section title="Chat Model">
          <select value={s.chatModel} onChange={e => alphaStore.setSettings({ chatModel: e.target.value })}
            className="w-full bg-input rounded-md px-3 py-2 border border-border">
            <option value="gemini-2.5-pro">gemini-2.5-pro (most powerful)</option>
            <option value="gemini-2.5-flash">gemini-2.5-flash (fast)</option>
            <option value="gemini-2.5-flash-lite">gemini-2.5-flash-lite (cheapest)</option>
            <option value="gemini-2.0-flash">gemini-2.0-flash</option>
            <option value="gemini-2.0-flash-exp">gemini-2.0-flash-exp</option>
          </select>
        </Section>

        <Section title="Kokoro TTS (preferred male voice)" hint="Paste an OpenAI-compatible Kokoro endpoint URL (e.g. https://your-kokoro/v1/audio/speech). When empty or unreachable Alpha falls back to your browser voice.">
          <input type="text" value={s.kokoroEndpoint} onChange={e => alphaStore.setSettings({ kokoroEndpoint: e.target.value })}
            placeholder="https://your-kokoro-host/v1/audio/speech"
            className="w-full bg-input rounded-md px-3 py-2 border border-border mb-2" />
          <div className="text-xs text-muted-foreground mb-1">Kokoro voice</div>
          <select value={s.kokoroVoice} onChange={e => alphaStore.setSettings({ kokoroVoice: e.target.value })}
            className="w-full bg-input rounded-md px-3 py-2 border border-border mb-2">
            {KOKORO_VOICES.map(v => <option key={v.id} value={v.id}>{v.id} — {v.label}</option>)}
          </select>
          <div className="text-xs text-muted-foreground mb-1">Rate ({s.ttsRate.toFixed(2)}x)</div>
          <input type="range" min={0.7} max={1.4} step={0.05} value={s.ttsRate}
            onChange={e => alphaStore.setSettings({ ttsRate: Number(e.target.value) })} className="w-full" />
          <div className="mt-2 flex gap-2 flex-wrap">
            <button onClick={() => speakWith("Mm — hi. This is Alpha. Voice check, one two.")}
              className="px-3 py-1.5 text-sm rounded-md bg-primary text-primary-foreground">Test voice</button>
            <button onClick={testKokoro}
              className="px-3 py-1.5 text-sm rounded-md glass neon-border">Diagnose Kokoro</button>
          </div>
          {kokoroStatus && <div className="mt-2 text-xs break-words">{kokoroStatus}</div>}
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
          <div className="text-xs text-muted-foreground mb-1">Browser voice fallback (used if Kokoro is unset/unreachable)</div>
          <select value={s.preferredVoice} onChange={e => alphaStore.setSettings({ preferredVoice: e.target.value })}
            className="w-full bg-input rounded-md px-3 py-2 border border-border">
            <option value="">Auto (prefers male)</option>
            {voices.map(v => <option key={v.name} value={v.name}>{v.name} ({v.lang})</option>)}
          </select>
        </Section>

        <Section title="Persona Extras" hint="Personal context Alpha keeps each call.">
          <textarea value={s.personaExtra} onChange={e => alphaStore.setSettings({ personaExtra: e.target.value })}
            className="w-full bg-input rounded-md px-3 py-2 border border-border min-h-[100px]" />
        </Section>
      </div>

      {/* Sticky Save bar — settings auto-save on each keystroke, but this gives
          the user explicit confirmation. */}
      <div className="fixed bottom-0 inset-x-0 z-30 glass border-t border-primary/30 p-3 flex items-center justify-between">
        <span className="text-xs text-muted-foreground">Changes save automatically.</span>
        <button
          onClick={() => { setSaved(true); setTimeout(() => setSaved(false), 1500); }}
          className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-semibold inline-flex items-center gap-2">
          {saved ? <><Check className="w-4 h-4" /> Saved</> : "Save"}
        </button>
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
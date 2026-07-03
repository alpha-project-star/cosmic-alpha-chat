import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ArrowLeft, Check, Wifi, WifiOff } from "lucide-react";
import { alphaStore, useAlpha } from "../lib/alpha-store";
import { listVoices, speakWith } from "../lib/voice";
import { listOllamaModels } from "../lib/ollama";

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
  const [ollamaStatus, setOllamaStatus] = useState<string>("");
  const [whisperStatus, setWhisperStatus] = useState<string>("");
  const [newModel, setNewModel] = useState("");
  const [online, setOnline] = useState<boolean>(typeof navigator !== "undefined" ? navigator.onLine : true);

  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => { window.removeEventListener("online", on); window.removeEventListener("offline", off); };
  }, []);

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

  async function testOllama() {
    setOllamaStatus("Testing…");
    try {
      const models = await listOllamaModels(s.ollamaEndpoint);
      if (!models.length) { setOllamaStatus("⚠️ Reached Ollama, but no models installed. Run: ollama pull llama3.2:3b"); return; }
      alphaStore.setSettings({ ollamaModels: models });
      setOllamaStatus(`✅ Connected. ${models.length} model(s): ${models.join(", ")}`);
    } catch (e: any) {
      setOllamaStatus(`❌ ${e?.message || "Could not reach Ollama"}. Make sure Ollama is running and started with OLLAMA_ORIGINS='*' so the browser can call it.`);
    }
  }

  async function testWhisper() {
    setWhisperStatus("Testing…");
    try {
      const url = (s.whisperEndpoint || "").replace(/\/+$/, "") + "/v1/models";
      const res = await fetch(url);
      if (!res.ok) { setWhisperStatus(`❌ HTTP ${res.status} @ ${url}. Is faster-whisper-server running?`); return; }
      setWhisperStatus(`✅ Whisper reachable. Voice input will use local transcription when active.`);
    } catch (e: any) {
      setWhisperStatus(`❌ ${e?.message || "Fetch failed"}. Whisper server unreachable — check the URL & CORS.`);
    }
  }

  const allOllamaModels = Array.from(new Set([s.ollamaModel, ...s.ollamaModels].filter(Boolean)));

  return (
    <div className="starfield min-h-screen pb-24">
      <header className="p-3 flex items-center gap-3 glass border-b border-primary/20">
        <Link to="/" aria-label="Back" className="p-1.5 rounded-full glass neon-border"><ArrowLeft className="w-4 h-4 text-primary" /></Link>
        <span className="text-xs tracking-[0.4em] text-muted-foreground">SETTINGS</span>
        <span className={`ml-auto inline-flex items-center gap-1 text-[10px] tracking-wider px-2 py-0.5 rounded-full border ${online ? "border-emerald-400/40 text-emerald-300" : "border-amber-400/40 text-amber-300"}`}>
          {online ? <Wifi className="w-3 h-3" /> : <WifiOff className="w-3 h-3" />}
          {online ? "ONLINE" : "OFFLINE"}
        </span>
      </header>

      <div className="p-4 max-w-xl mx-auto space-y-5">
        <Section title="AI Backend" hint="Where Alpha does her thinking. Auto uses Gemini when online and falls back to local Ollama when offline (or when no Gemini key is set).">
          <div className="grid grid-cols-3 gap-2 mb-3">
            {(["auto","gemini","ollama"] as const).map(v => (
              <button key={v} onClick={() => alphaStore.setSettings({ aiBackend: v })}
                className={`px-3 py-2 rounded-md text-sm border ${s.aiBackend === v ? "bg-primary text-primary-foreground border-primary" : "glass neon-border"}`}>
                {v === "auto" ? "Auto" : v === "gemini" ? "Gemini (cloud)" : "Ollama (local)"}
              </button>
            ))}
          </div>
          <div className="text-[11px] text-muted-foreground">
            Current route: <b>{s.aiBackend === "gemini" ? "Gemini" : s.aiBackend === "ollama" ? "Ollama" : (online && s.geminiApiKey ? "Gemini (auto)" : "Ollama (auto — offline / no key)")}</b>
          </div>
        </Section>

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

        <Section title="Ollama (local LLM)" hint="Endpoint of your locally-running Ollama server. Start with: OLLAMA_ORIGINS='*' ollama serve  — the wildcard lets this browser origin call it.">
          <input type="text" value={s.ollamaEndpoint} onChange={e => alphaStore.setSettings({ ollamaEndpoint: e.target.value })}
            placeholder="http://localhost:11434"
            className="w-full bg-input rounded-md px-3 py-2 border border-border mb-2" />
          <div className="text-xs text-muted-foreground mb-1">Active local model</div>
          <select value={s.ollamaModel} onChange={e => alphaStore.setSettings({ ollamaModel: e.target.value })}
            className="w-full bg-input rounded-md px-3 py-2 border border-border mb-2">
            {allOllamaModels.map(m => <option key={m} value={m}>{m}</option>)}
            {!allOllamaModels.includes("llama3.2:3b") && <option value="llama3.2:3b">llama3.2:3b</option>}
          </select>
          <div className="flex gap-2 mb-2">
            <input value={newModel} onChange={e => setNewModel(e.target.value)}
              placeholder="add another model tag e.g. qwen2.5:7b"
              className="flex-1 bg-input rounded-md px-3 py-2 border border-border text-sm" />
            <button onClick={() => {
              const t = newModel.trim(); if (!t) return;
              const list = Array.from(new Set([...(s.ollamaModels || []), t]));
              alphaStore.setSettings({ ollamaModels: list, ollamaModel: t });
              setNewModel("");
            }} className="px-3 py-1.5 text-sm rounded-md bg-primary text-primary-foreground">Add</button>
          </div>
          <button onClick={testOllama} className="px-3 py-1.5 text-sm rounded-md glass neon-border">Detect installed models</button>
          {ollamaStatus && <div className="mt-2 text-xs break-words">{ollamaStatus}</div>}
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

        <Section title="Speech-to-Text Backend" hint="Browser Web Speech is fastest but streams your audio to Google. Whisper (local) is fully offline. Auto uses browser when online, Whisper when offline.">
          <div className="grid grid-cols-3 gap-2 mb-3">
            {(["auto","browser","whisper"] as const).map(v => (
              <button key={v} onClick={() => alphaStore.setSettings({ sttBackend: v })}
                className={`px-3 py-2 rounded-md text-sm border ${s.sttBackend === v ? "bg-primary text-primary-foreground border-primary" : "glass neon-border"}`}>
                {v === "auto" ? "Auto" : v === "browser" ? "Browser" : "Whisper (local)"}
              </button>
            ))}
          </div>
          <input type="text" value={s.whisperEndpoint} onChange={e => alphaStore.setSettings({ whisperEndpoint: e.target.value })}
            placeholder="http://localhost:8001"
            className="w-full bg-input rounded-md px-3 py-2 border border-border mb-2" />
          <input type="text" value={s.whisperModel} onChange={e => alphaStore.setSettings({ whisperModel: e.target.value })}
            placeholder="Systran/faster-whisper-small"
            className="w-full bg-input rounded-md px-3 py-2 border border-border mb-2" />
          <button onClick={testWhisper} className="px-3 py-1.5 text-sm rounded-md glass neon-border">Test Whisper</button>
          {whisperStatus && <div className="mt-2 text-xs break-words">{whisperStatus}</div>}
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
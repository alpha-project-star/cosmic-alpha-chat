import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ArrowLeft, Check, ChevronDown, ChevronRight, Music, Trash2, Wifi, WifiOff } from "lucide-react";
import { alphaStore, useAlpha } from "../lib/alpha-store";
import { listVoices, speakWith } from "../lib/voice";
import { listOllamaModels } from "../lib/ollama";
import { testAlarmNow, requestAlarmPermission } from "../lib/alarm-engine";
import { KittScanner } from "../components/KittScanner";
import { addMusicFiles, deleteMusicTrack, listMusicTracks, playMusicByName, stopMusic, type MusicTrackMeta } from "../lib/music";

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
  const profile = useAlpha(x => x.profile);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [saved, setSaved] = useState(false);
  const [kokoroStatus, setKokoroStatus] = useState<string>("");
  const [alarmStatus, setAlarmStatus] = useState<string>("");
  const [ollamaStatus, setOllamaStatus] = useState<string>("");
  const [whisperStatus, setWhisperStatus] = useState<string>("");
  const [musicStatus, setMusicStatus] = useState<string>("");
  const [tracks, setTracks] = useState<MusicTrackMeta[]>([]);
  const [newModel, setNewModel] = useState("");
  const [online, setOnline] = useState<boolean>(typeof navigator !== "undefined" ? navigator.onLine : true);
  const [openGroup, setOpenGroup] = useState<"online" | "offline" | "data" | null>("online");

  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => { window.removeEventListener("online", on); window.removeEventListener("offline", off); };
  }, []);

  useEffect(() => { void refreshTracks(); }, []);

  async function refreshTracks() {
    try { setTracks(await listMusicTracks()); } catch { setTracks([]); }
  }

  async function uploadMusic(files: FileList | null) {
    if (!files?.length) return;
    setMusicStatus("Saving…");
    try {
      const saved = await addMusicFiles(files);
      await refreshTracks();
      setMusicStatus(saved.length ? `Saved ${saved.length} track${saved.length === 1 ? "" : "s"}.` : "No audio files selected.");
    } catch (e: any) {
      setMusicStatus(e?.message || "Could not save music.");
    }
  }

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
      setOllamaStatus(`❌ ${e?.message || "Could not reach Ollama"}. Make sure Ollama is running with OLLAMA_ORIGINS='*'.`);
    }
  }

  async function testWhisper() {
    setWhisperStatus("Testing…");
    try {
      const url = (s.whisperEndpoint || "").replace(/\/+$/, "") + "/v1/models";
      const res = await fetch(url);
      if (!res.ok) { setWhisperStatus(`❌ HTTP ${res.status} @ ${url}. Is faster-whisper-server running?`); return; }
      setWhisperStatus(`✅ Whisper reachable.`);
    } catch (e: any) {
      setWhisperStatus(`❌ ${e?.message || "Fetch failed"}. Whisper server unreachable — check URL & CORS.`);
    }
  }

  const allOllamaModels = Array.from(new Set([s.ollamaModel, ...s.ollamaModels].filter(Boolean)));

  return (
    <div className="starfield min-h-screen pb-8">
      <header className="p-3 flex items-center gap-3 glass border-b border-primary/20">
        <Link to="/" aria-label="Back" className="p-1.5 rounded-full glass neon-border"><ArrowLeft className="w-4 h-4 text-primary" /></Link>
        <span className="text-xs tracking-[0.4em] text-muted-foreground">SETTINGS</span>
        <span className={`ml-auto inline-flex items-center gap-1 text-[10px] tracking-wider px-2 py-0.5 rounded-full border ${online ? "border-emerald-400/40 text-emerald-300" : "border-amber-400/40 text-amber-300"}`}>
          {online ? <Wifi className="w-3 h-3" /> : <WifiOff className="w-3 h-3" />}
          {online ? "ONLINE" : "OFFLINE"}
        </span>
      </header>
      <div className="px-3 pt-2"><KittScanner bars={22} height={8} /></div>

      <div className="p-4 max-w-xl mx-auto space-y-4">
        {/* ONLINE ================================================== */}
        <Group id="online" title="Online Settings"
          hint="Cloud APIs Alpha uses when you have internet."
          open={openGroup === "online"} onToggle={() => setOpenGroup(openGroup === "online" ? null : "online")}>

          <Section title="AI Backend" hint="Auto = Gemini when online, Ollama when offline. Force one to override.">
            <div className="grid grid-cols-3 gap-2 mb-3">
              {(["auto","gemini","ollama"] as const).map(v => (
                <button key={v} onClick={() => alphaStore.setSettings({ aiBackend: v })}
                  className={`px-3 py-2 rounded-md text-sm border ${s.aiBackend === v ? "bg-primary text-primary-foreground border-primary" : "glass neon-border"}`}>
                  {v === "auto" ? "Auto" : v === "gemini" ? "Gemini (cloud)" : "Ollama (local)"}
                </button>
              ))}
            </div>
            <div className="text-[11px] text-muted-foreground">
              Current: <b>{s.aiBackend === "gemini" ? "Gemini" : s.aiBackend === "ollama" ? "Ollama" : (online && s.geminiApiKey ? "Gemini (auto)" : "Ollama (auto — offline / no key)")}</b>
            </div>
          </Section>

          <Section title="Gemini API Key" hint="Google AI Studio key. Stored locally only.">
            <input type="password" value={s.geminiApiKey} onChange={e => alphaStore.setSettings({ geminiApiKey: e.target.value })}
              placeholder="AI..." className="w-full bg-input rounded-md px-3 py-2 border border-border" />
          </Section>

          <Section title="Default Gemini Chat Model">
            <select value={s.chatModel} onChange={e => alphaStore.setSettings({ chatModel: e.target.value })}
              className="w-full bg-input rounded-md px-3 py-2 border border-border">
              <option value="gemini-2.5-pro">gemini-2.5-pro (most powerful)</option>
              <option value="gemini-2.5-flash">gemini-2.5-flash (fast)</option>
              <option value="gemini-2.5-flash-lite">gemini-2.5-flash-lite (cheapest)</option>
              <option value="gemini-2.0-flash">gemini-2.0-flash</option>
              <option value="gemini-2.0-flash-exp">gemini-2.0-flash-exp</option>
            </select>
          </Section>

          <Section title="Groq API Key" hint="Fast text models (Llama, Mixtral). Free tier at console.groq.com.">
            <input type="password" value={s.groqApiKey} onChange={e => alphaStore.setSettings({ groqApiKey: e.target.value })}
              placeholder="gsk_..." className="w-full bg-input rounded-md px-3 py-2 border border-border" />
          </Section>

          <Section title="OpenAI-compatible provider" hint="For OpenAI, DeepSeek, Together, xAI Grok, or any /v1/chat/completions endpoint.">
            <input type="text" value={s.openaiCompatBase} onChange={e => alphaStore.setSettings({ openaiCompatBase: e.target.value })}
              placeholder="https://api.openai.com/v1" className="w-full bg-input rounded-md px-3 py-2 border border-border mb-2" />
            <input type="password" value={s.openaiCompatKey} onChange={e => alphaStore.setSettings({ openaiCompatKey: e.target.value })}
              placeholder="sk-..." className="w-full bg-input rounded-md px-3 py-2 border border-border" />
          </Section>

          <Section title="OpenRouter API Key" hint="Used by Code mode and OpenRouter-hosted models such as Qwen Coder.">
            <input type="password" value={s.openRouterKey} onChange={e => alphaStore.setSettings({ openRouterKey: e.target.value })}
              placeholder="sk-or-..." className="w-full bg-input rounded-md px-3 py-2 border border-border" />
          </Section>

          <Section title="Task Routing" hint="Which model runs each job. Format: provider:model (providers: gemini, groq, openai, openrouter). Auto uses Fast first when its key is available; the chat composer can switch task per message.">
            <TaskRow label="⚡ Fast (chat, quick)" value={s.taskModels.fast}
              onChange={v => alphaStore.setSettings({ taskModels: { ...s.taskModels, fast: v } })}
              examples={["groq:llama-3.3-70b-versatile","groq:llama-3.1-8b-instant","gemini:gemini-1.5-flash"]} />
            <TaskRow label="🧠 Deep thinking" value={s.taskModels.thinking}
              onChange={v => alphaStore.setSettings({ taskModels: { ...s.taskModels, thinking: v } })}
              examples={["openrouter:deepseek/deepseek-r1:free","gemini:gemini-2.5-pro","openrouter:qwen/qwen-2.5-72b-instruct:free"]} />
            <TaskRow label="🛠 Coding & debug" value={s.taskModels.coding}
              onChange={v => alphaStore.setSettings({ taskModels: { ...s.taskModels, coding: v } })}
              examples={["openrouter:poolside/laguna-m.1:free","openrouter:qwen/qwen3-coder:free","openrouter:cohere/north-mini-code:free"]} />
          </Section>

          <Section title="Kokoro TTS (preferred male voice)" hint="OpenAI-compatible Kokoro endpoint. Empty = browser voice fallback.">
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
        </Group>

        {/* OFFLINE ================================================== */}
        <Group id="offline" title="Offline Settings"
          hint="Local servers Alpha uses with no internet."
          open={openGroup === "offline"} onToggle={() => setOpenGroup(openGroup === "offline" ? null : "offline")}>

          <Section title="Ollama (local LLM)" hint="Start with: OLLAMA_ORIGINS='*' ollama serve">
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

          <Section title="Speech-to-Text Backend" hint="Auto = browser when online, Whisper when offline.">
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
        </Group>

        {/* ALPHA DATA ================================================== */}
        <Group id="data" title="Alpha Data"
          hint="Persona, voice preferences, and who Alpha is."
          open={openGroup === "data"} onToggle={() => setOpenGroup(openGroup === "data" ? null : "data")}>

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

          <Section title="Alarms" hint="Reminders fire in the background while Alpha is open. Enable browser notifications for pop-ups when the tab is hidden.">
            <div className="flex flex-wrap gap-2">
              <button onClick={async () => { const ok = await requestAlarmPermission(); setAlarmStatus(ok ? "✅ Notifications enabled. Alarms will chime, speak, and show pop-ups while Alpha is open." : "⚠️ Notifications blocked. Alarms will still chime and speak while Alpha is open."); }}
                className="px-3 py-1.5 text-sm rounded-md bg-primary text-primary-foreground">Enable notifications</button>
              <button onClick={() => { testAlarmNow(); setAlarmStatus("✅ Test alarm fired — scanner alert, chime, and voice were triggered."); }}
                className="px-3 py-1.5 text-sm rounded-md glass neon-border">Test alarm now</button>
            </div>
            {alarmStatus && <div className="mt-2 text-xs text-muted-foreground">{alarmStatus}</div>}
          </Section>

          <Section title="Music Library" hint="Store MP3/audio locally in this browser. Then ask Alpha: 'play my music', 'play [track name]', or 'stop music'.">
            <label className="inline-flex items-center gap-2 px-3 py-2 rounded-md bg-primary text-primary-foreground text-sm cursor-pointer">
              <Music className="w-4 h-4" /> Upload MP3/audio
              <input type="file" accept="audio/*,.mp3" multiple hidden onChange={e => uploadMusic(e.target.files)} />
            </label>
            <div className="mt-3 space-y-2">
              {tracks.length === 0 && <div className="text-xs text-muted-foreground">No tracks saved yet.</div>}
              {tracks.map(track => (
                <div key={track.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-lg border border-primary/20 bg-background/30 px-3 py-2">
                  <button type="button" onClick={async () => { try { setMusicStatus(await playMusicByName(track.name)); } catch (e: any) { setMusicStatus(e?.message || "Playback failed."); } }}
                    className="min-w-0 text-left text-sm truncate text-primary hover:text-primary/80">
                    {track.name}
                  </button>
                  <button type="button" aria-label={`Delete ${track.name}`} onClick={async () => { await deleteMusicTrack(track.id); stopMusic(); await refreshTracks(); setMusicStatus(`Deleted ${track.name}.`); }}
                    className="shrink-0 rounded-md p-1.5 glass neon-border">
                    <Trash2 className="w-4 h-4 text-destructive" />
                  </button>
                </div>
              ))}
            </div>
            {tracks.length > 0 && <button type="button" onClick={() => { stopMusic(); setMusicStatus("Music stopped."); }} className="mt-2 px-3 py-1.5 text-sm rounded-md glass neon-border">Stop music</button>}
            {musicStatus && <div className="mt-2 text-xs text-muted-foreground">{musicStatus}</div>}
          </Section>

          <Section title="About You" hint="Alpha uses this to recognise and address you personally.">
            <input type="text" value={profile.name}
              onChange={e => alphaStore.setProfile({ ...profile, name: e.target.value })}
              placeholder="Your name (e.g. Alex)"
              className="w-full bg-input rounded-md px-3 py-2 border border-border mb-2" />
            <textarea value={profile.bio}
              onChange={e => alphaStore.setProfile({ ...profile, bio: e.target.value })}
              placeholder="Tell Alpha about yourself — role, interests, tone you prefer, anything you want him to remember about you."
              className="w-full bg-input rounded-md px-3 py-2 border border-border min-h-[100px]" />
          </Section>

          <Section title="Background Data (Watchlist)" hint="Topics or reminders Alpha keeps an eye on and surfaces proactively. One per line — e.g. 'Latest AI news', 'Alarm 5:00', 'Kimetsu no Yaiba release'.">
            <textarea value={s.backgroundData}
              onChange={e => alphaStore.setSettings({ backgroundData: e.target.value })}
              placeholder="Latest AI news\nDelta intake update\n8:30 am Saturday reminder"
              className="w-full bg-input rounded-md px-3 py-2 border border-border min-h-[100px] font-mono text-xs" />
            <label className="flex items-center gap-2 text-sm mt-2">
              <input type="checkbox" checked={s.backgroundEnabled}
                onChange={e => alphaStore.setSettings({ backgroundEnabled: e.target.checked })} />
              Background processing enabled (scanner lights on)
            </label>
          </Section>

          <Section title="Alpha Build Record" hint="Alpha's own spec sheet — he reads this so he knows himself. Edit to update his self-knowledge.">
            <textarea value={s.buildRecord}
              onChange={e => alphaStore.setSettings({ buildRecord: e.target.value })}
              className="w-full bg-input rounded-md px-3 py-2 border border-border min-h-[160px] font-mono text-xs" />
          </Section>
        </Group>

        {/* Inline Save bar (was fixed & hidden behind orb — now inline) */}
        <div className="glass border border-primary/30 rounded-xl p-3 flex items-center justify-between mt-4">
          <span className="text-xs text-muted-foreground">Changes save automatically.</span>
          <button
            onClick={() => { setSaved(true); setTimeout(() => setSaved(false), 1500); }}
            className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-semibold inline-flex items-center gap-2">
            {saved ? <><Check className="w-4 h-4" /> Saved</> : "Save"}
          </button>
        </div>
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

function Group({
  id, title, hint, open, onToggle, children,
}: { id: string; title: string; hint?: string; open: boolean; onToggle: () => void; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-primary/30 overflow-hidden">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={`group-${id}`}
        className="w-full flex items-center gap-2 px-4 py-3 bg-primary/10 hover:bg-primary/15 transition text-left">
        {open ? <ChevronDown className="w-4 h-4 text-primary shrink-0" /> : <ChevronRight className="w-4 h-4 text-primary shrink-0" />}
        <div className="flex-1">
          <div className="text-sm font-semibold tracking-wide">{title}</div>
          {hint && <div className="text-[11px] text-muted-foreground">{hint}</div>}
        </div>
      </button>
      {open && (
        <div id={`group-${id}`} className="p-3 space-y-3 bg-background/20">
          {children}
        </div>
      )}
    </div>
  );
}

function TaskRow({ label, value, onChange, examples }: {
  label: string; value: string; onChange: (v: string) => void; examples: string[];
}) {
  return (
    <div className="mb-3 last:mb-0">
      <div className="text-xs text-muted-foreground mb-1">{label}</div>
      <input type="text" value={value} onChange={e => onChange(e.target.value)}
        placeholder="provider:model"
        className="w-full bg-input rounded-md px-3 py-2 border border-border text-sm font-mono" />
      <div className="mt-1 flex flex-wrap gap-1">
        {examples.map(ex => (
          <button key={ex} type="button" onClick={() => onChange(ex)}
            className="text-[10px] px-2 py-0.5 rounded-full glass neon-border text-muted-foreground hover:text-primary">
            {ex}
          </button>
        ))}
      </div>
    </div>
  );
}
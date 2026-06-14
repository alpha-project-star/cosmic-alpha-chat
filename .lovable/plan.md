## Alpha — Voice-First Cosmic Orb PWA

A futuristic, dark-blue PWA that opens into a Cosmic Orb voice assistant powered by Gemini, with Chat, Notes, and Bills modules. Offline-capable, installable on Android, biometric-aware lock screen, continuous listening with a fluent British female TTS voice.

### Stack & infra
- TanStack Start (existing) + Tailwind v4 + shadcn (existing).
- Lovable Cloud enabled for one purpose only: server route `/api/generate-image` that calls the Lovable AI Gateway (`google/gemini-3.1-flash-image-preview`).
- Chat, image fallback, and all other AI calls go **direct from the browser** to Google Gemini using the key the user pastes into Settings (`localStorage`). The key in your message will not be committed; rotate it.
- PWA: web app manifest + icons (no offline service worker by default — Lovable preview guard blocks SW; we'll ship manifest-only for installability and document the offline option).

### File layout
```
src/
  routes/
    __root.tsx              (theme shell, head/meta, manifest link, AlphaLock gate)
    index.tsx               (Cosmic Orb home — voice-first)
    chat.tsx                (AlphaChat full interface)
    notes.tsx               (SimpleCrud — notes)
    bills.tsx               (SimpleCrud — bills/ledger)
    image.tsx               (multi-modal image dashboard)
    settings.tsx            (AlphaSettings)
    api/generate-image.ts   (server route → Lovable AI Gateway, SSE passthrough)
  components/
    AlphaLock.tsx           (password + WebAuthn; skipped in non-PWA contexts)
    AlphaOrb.tsx            (avatar + aurora ring + conic border + spectrum)
    AlphaChat.tsx           (message list, composer, ImagePlus, mic)
    AlphaSettings.tsx       (key input, persona, voice toggles, prompt)
    SimpleCrud.tsx          (generic list w/ all fields visible inline)
    MessageContent.tsx      (ReactMarkdown + remarkMath + rehypeKatex)
    AudioSpectrum.tsx       (Web Audio AnalyserNode visualizer)
    LiveTranscript.tsx      (rolling transcript console under Orb)
  lib/
    alpha-store.ts          (zustand-style store + localStorage sync)
    alpha.functions.ts      (Gemini REST: chat, vision, image-gen fallback)
    voice.ts                (STT continuous; TTS w/ British female filter; prepareUtterance/speakWith)
    speech-text.ts          (LaTeX → phonetic normalizer)
    voice-router.ts         (transcript keyword → route map)
    pwa.ts                  (install prompt helper, isStandalone)
  assets/
    alpha-avatar.png        (lovable-assets pointer to uploaded image)
public/
  manifest.webmanifest
  icon-192.png, icon-512.png, maskable-512.png   (generated from avatar)
```

### Design tokens (src/styles.css)
- Pure black bg `oklch(0 0 0)`, deep navy surface `oklch(0.18 0.08 270)`.
- Neon primary `oklch(0.72 0.22 250)` with glow halo via `--shadow-glow`.
- Glassmorphism utility: `backdrop-blur` + 1px neon border + inner gradient.
- Font: Inter (body), Space Grotesk (headings/UI numerals).

### Cosmic Orb home (`/`)
- Centered circular avatar (uploaded reference, processed into a square asset).
- Conic-gradient rotating border ring (CSS `@property --angle` + keyframes).
- Outer aurora ring: layered radial gradients animated via CSS, **opacity reacts to mic RMS** so it pulses only when voice is detected.
- `AudioSpectrum` ring of 64 bars around the orb, fed by AnalyserNode (active only while a transcript is forming — never random idle motion).
- `LiveTranscript` semi-transparent console under orb shows interim text.
- Bottom nav: Open Chat / Open Notes / Open Bills.
- Status text: "Listening continuously…" / "Paused" / "Thinking…".

### Voice pipeline (`voice.ts`)
- **STT:** `webkitSpeechRecognition` with `continuous=true, interimResults=true`, auto-restart on `end` unless paused.
- Silence detection: 1.2s of no `interim` change → fire `onFinal(transcript)`.
- **TTS critical fix — `prepareUtterance()`/`speakWith()`:**
  - Every user tap (Open Chat button, mic toggle, send) calls `prepareUtterance()` synchronously inside the gesture, instantiating a `SpeechSynthesisUtterance("")` and assigning the picked voice. Stored in a module-level slot.
  - When the Gemini fetch resolves, `speakWith(text)` mutates `slot.text = text` and calls `speechSynthesis.speak(slot)` — no new utterance created post-await, so Android Chrome doesn't block playback.
  - Voice selection filter: prefer `voices.find(v => /en-GB/i.test(v.lang) && /female|Libby|Sonia|Hazel|Google UK English Female|Amy/i.test(v.name))`, then any `en-GB`, then default.
- `speech-text.ts` strips/normalizes LaTeX before passing to `speakWith` (e.g. `\frac{1}{2}` → "one half", `x^2` → "x squared", inline `$...$` → spoken phrase).

### Voice router
Final transcript matched against keyword table → `router.navigate({ to: "/chat" | "/notes" | "/bills" | "/image" })` or `voice.pause()` for "stop listening". Anything else is forwarded to chat with a tag so it appears as a message in `/chat`.

### Chat (`/chat`, `AlphaChat.tsx`)
- Glowing starfield canvas background.
- Message list using `MessageContent` (markdown + KaTeX).
- Composer: textarea, `ImagePlus` (up to 4 images, base64 inline), mic button.
- Header shows an **Orb icon** to return to `/`.
- Live audio spectrum bar inside the composer when mic is hot.

### `alpha.functions.ts` (client-side Gemini)
- `sendChat({ history, userText, images })` → `POST https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=…` with `contents`, `systemInstruction = DEFAULT_SYSTEM + currentDate`, capped to last **100** history entries.
- `generateImage(prompt)`:
  1. Try `fetch("/api/generate-image", { body: { prompt } })` (Lovable Gateway, SSE — renders partials w/ blur per `ai-image-generation`).
  2. On any non-2xx or stream error → direct call to `gemini-2.5-flash-image-preview` with `responseModalities: ["IMAGE","TEXT"]`, render returned base64.
- Errors: surface raw API error string in chat as a system bubble; recover to conversational mode on safety-block (`finishReason === "SAFETY"`).
- `CHAT_KEY = "alpha.chat.v1"` persisted via `useEffect` in store on every mutation.

### `DEFAULT_SYSTEM`
- Persona block (witty L3, hums/acknowledgments).
- Temporal grounding: appended `new Date().toUTCString()` each call.
- LaTeX output rules + math verification instruction.
- Recovery instruction on safety block.

### AlphaLock
- On first launch, prompt for 6+ char password → `crypto.subtle.digest("SHA-256")` stored in localStorage.
- WebAuthn registration on supported devices; subsequent unlocks try platform authenticator first, fall back to password.
- **Skipped** when `!window.matchMedia('(display-mode: standalone)').matches && hostname !== production`, so desktop preview goes straight to the Orb.

### SimpleCrud
- Generic `<SimpleCrud schema={…}/>` rendering an inline list where every field defined in `schema.fields` is shown as columns/lines on the card — no drill-in required to see amounts, dates, balances.
- Add/edit via inline expandable row; delete via swipe/long-press on mobile.
- Used by `/notes` (title, body, updatedAt) and `/bills` (name, amount, dueDate, balance, status).

### State (`alpha-store.ts`)
- Plain TS store with subscribe + `useSyncExternalStore`.
- Slices: `chat`, `settings`, `notes`, `bills`, `profile`.
- Each slice writes to localStorage on change; chat slice enforces 100-message cap on push.

### PWA
- `public/manifest.webmanifest` with name "Alpha", short_name "Alpha", `display: "standalone"`, theme `#0a0e1f`, background `#000`, icons 192/512/maskable.
- `<link rel="manifest">` + `<meta name="theme-color">` + apple-touch-icon in `__root.tsx` head.
- Manifest-only by default (no SW — per Lovable PWA skill, offline support needs the guarded `vite-plugin-pwa` flow; we can add later on request).

### Assets
- Process uploaded reference into `src/assets/alpha-avatar.png` (square crop) via `imagegen--edit_image`.
- Generate 192/512/maskable icons from the avatar.

### Things explicitly out of scope (this turn)
- Offline service worker (manifest-only ship; flag for follow-up).
- Encrypted-at-rest local storage (data is in localStorage; "encrypted" in the spec is interpreted as obfuscated/namespaced — true encryption needs a user key).
- Camera capture beyond `<input type="file" accept="image/*" capture>` on the image dashboard.

### Build order
1. Enable Lovable Cloud + provision LOVABLE_API_KEY.
2. Process avatar + generate PWA icons + manifest + theme tokens.
3. Store, voice pipeline, speech-text normalizer.
4. Orb home route + transcript console + voice router.
5. Chat route + `alpha.functions.ts` + MessageContent.
6. Settings (API key, persona, voice picker).
7. SimpleCrud + Notes + Bills.
8. Image route + `/api/generate-image` server route + direct fallback.
9. AlphaLock gate in `__root.tsx`.
10. Smoke-test routes in preview.

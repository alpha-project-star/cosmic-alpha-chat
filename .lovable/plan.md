# Alpha Agent Framework — Phase 1

Focused on the four numbered asks you flagged as "start here". Larger pieces (background workers, Supabase tables, presence check, proactive TTS) come in Phase 2 once these land, because they depend on Lovable Cloud being enabled and on the local-intent surface from #2.

## 1. KITT Scanner Bar (status ring, reimagined)

Replace the "glowing ring" idea with a **horizontal Knight Rider scanner** in electric blue.

- New component `src/components/KittScanner.tsx`: a row of ~24 vertical bars, CSS-only, driven by a single `state` prop (`idle | scanning | speaking`).
  - `idle`: slow left→right→left sweep, low brightness (breathing).
  - `scanning`: fast sweep, high brightness, subtle glow trail.
  - `speaking`: audio-reactive — bars scale from a shared amplitude value (reuse the analyser in `AudioSpectrum.tsx`), fallback to fast ripple if no mic stream.
- Placement:
  - **Desktop HUD**: inside `DesktopShell`, spanning the top of the right-hand HUD panel (above chat), and a second thin instance under the wordmark.
  - **Mobile**: inside the chat header strip and on the home Orb page directly under the orb.
- Colors pulled from existing `--hud-cyan` / primary tokens — no new palette.
- State source: a tiny `useAlphaStatus()` hook reading `listening / busy / speaking` flags already tracked in chat + voice modules.

## 2. Full CRUD Control for Alpha

Extend `src/lib/local-intents.ts` so Alpha can actually mutate every store surface via natural language, not just create.

Add intent handlers for:
- **Delete**: "delete note about X", "remove reminder to call mom", "clear all bills", "delete memory of Y". Fuzzy match on title/body; if multiple matches, ask which.
- **Update**: "mark bill electric as paid", "rename note X to Y", "reschedule reminder X to tomorrow 8am", "mark reminder done".
- **Read/List**: "what reminders do I have", "list my notes", "show unpaid bills", "what do you remember about X" — returns a formatted markdown answer inline (no API call).
- **Navigate/Settings**: "open settings", "switch to offline mode", "use groq for fast", "set voice to af_heart" — dispatched through a new `settings-intents.ts`.
- **Bulk**: "clear all done reminders", "delete all notes from last week".

Each handler returns a confirmation string that flows through the normal chat reply path so it also gets spoken.

## 3. Live Time Monitor

Add a compact real-time clock so Alpha (and the user) can see time flow.

- New `src/components/LiveClock.tsx`: shows `HH:MM:SS` + weekday + date, updates every second via `setInterval`, cleaned up on unmount.
- Placement: top-right of `DesktopShell` (next to wordmark area), and mobile chat header (small, right of MiniOrb).
- Also inject the current ISO timestamp into every system prompt call in `alpha.functions.ts` (append to the existing `temporalBlock()`), so the model always knows the *exact* moment of the request — this feeds later reminder logic.

## 4. Real Background Alarm for Reminders

The current `Reminder` type stores `when` as free text. Upgrade it to an actual scheduled alarm.

- Store change (`alpha-store.ts`):
  - `Reminder.when` becomes an ISO datetime string (keep old string as fallback via `Date.parse`).
  - Add `firedAt?: number` so alarms don't re-fire.
- New `src/lib/alarm-engine.ts`:
  - A singleton started at app root that ticks every 15 seconds.
  - Scans reminders; when `Date.now() >= parse(when)` and not `firedAt` and not `done=yes`, fires.
  - **Fire action**: (a) speak "Excuse me — reminder: {title}. {notes}" via existing `speakWith`, (b) request `Notification` permission the first time and show a system notification, (c) play a short audio chime (WebAudio oscillator, no asset needed), (d) mark `firedAt` and persist.
  - Keeps running while tab is open. When tab is hidden, notifications + chime still fire (browsers allow both from an already-running page). Real background-when-closed alarms need a service-worker `push` or `periodicSync`, which is a Phase 2 item — we'll note this in the UI.
- Reminders route: add a "time" input (`datetime-local`) alongside the existing text field so new reminders get a real ISO value.
- Add a "Test alarm now" button in Settings → Alpha Data for quick verification.

## Files touched

- `src/components/KittScanner.tsx` (new)
- `src/components/LiveClock.tsx` (new)
- `src/lib/alarm-engine.ts` (new)
- `src/lib/settings-intents.ts` (new)
- `src/lib/local-intents.ts` (extend: delete / update / list / bulk)
- `src/lib/alpha-store.ts` (Reminder ISO + firedAt)
- `src/lib/alpha.functions.ts` (inject live timestamp into system prompt)
- `src/components/desktop/DesktopShell.tsx` (scanner + clock placement)
- `src/routes/chat.tsx` (mobile header scanner + clock)
- `src/routes/index.tsx` (home scanner under orb)
- `src/routes/reminders.tsx` (datetime input + status column)
- `src/routes/__root.tsx` (boot alarm engine)
- `src/routes/settings.tsx` (test-alarm button)

## Explicitly deferred to Phase 2 (after you confirm Phase 1)

- Groq/Gemini hybrid routing on image upload — most of it already exists in `alpha.functions.ts`; needs a hardening pass.
- `agent_tasks` + `news_logs` tables, background worker cron — requires enabling **Lovable Cloud** (Supabase). I'll ask before enabling.
- `system_capabilities.md` living blueprint injected into every system prompt.
- User Presence Check + auto-notes fallback.

Say go and I'll implement Phase 1 in one pass.
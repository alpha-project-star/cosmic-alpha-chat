# Alpha — Desktop UI Blueprint

Bring the attached reference to life as Alpha's desktop experience: a giant living orb on the left, a floating holographic chat panel on the right, deep-space background, cyan HUD accents, thin sci-fi typography. Mobile stays exactly as it is today.

## Layout system (desktop ≥ 1024px)

```text
┌───────────────────────────────────────────────────────────────┐
│  ALPHA  (wordmark, top-center, thin glow)      · · · settings │
├───────────────────────────────────────────────────────────────┤
│                                                               │
│                                     ┌───────────────────────┐ │
│                                     │  ALPHA                │ │
│                                     │  Hello Alpha, what…   │ │
│    ┌─────────────────┐              │                       │ │
│    │                 │              │  A  Greetings! …      │ │
│    │   COSMIC ORB    │  ~~~~~~~~~~  │                       │ │
│    │  (huge, 60vmin) │  spectrum    │  Just say a command…  │ │
│    │                 │  ~~~~~~~~~~  │                       │ │
│    └─────────────────┘              │  A  Currently opti…   │ │
│                                     │                       │ │
│                                     │  A  Awaiting input.   │ │
│                                     └───────────────────────┘ │
│                                                               │
│            ~~~~ 🎙  ~~~~   (mic + waveform, bottom-center)    │
└───────────────────────────────────────────────────────────────┘
```

- **Grid:** `grid-cols-[1fr_minmax(380px,440px)]` on `lg+`, orb column centers vertically, chat column is a floating HUD panel pinned to the right with 24px gap from viewport edges.
- **Wordmark:** "ALPHA" thin uppercase, letter-spaced 0.35em, top-center, subtle cyan glow (`text-shadow` from `--primary`).
- **Mic dock:** fixed bottom-center bar with mic button flanked by two live waveform strips (reuses existing `AudioSpectrum` rendered horizontally, mirrored L/R).
- **Tool dock:** vertical rail of glass icon buttons (Notes / Bills / Image / Reminders / Plans / Memories / Settings) pinned to the left edge, only visible on `lg+`. Mobile keeps the current `Grid3x3` popover.
- **Mobile (<1024px):** unchanged — current stacked layout stays. Everything below is `lg:` scoped.

## Visual system additions to `src/styles.css`

Semantic tokens only, no hardcoded colors in components.

- `--hud-cyan: oklch(0.85 0.18 230)` — HUD outlines and glyphs
- `--hud-cyan-soft: oklch(0.7 0.18 235 / 0.35)` — bubble borders
- `--space-deep: oklch(0.08 0.04 260)` — background base
- `--gradient-nebula`: radial layered nebula for the orb halo
- `--gradient-hud-panel`: vertical glass gradient for the chat panel
- `--shadow-hud`: cyan double-glow for panels and bubbles
- `--edge-hud`: 1px inset cyan hairline used on every HUD frame
- `@utility hud-frame`: rounded 20px, 1px cyan border, inner + outer glow, corner tick marks via `::before/::after` (the little L-brackets visible on the reference panel)
- `@utility hud-bubble`: rounded 14px, `--hud-cyan-soft` border, tail via clip-path
- `@utility wordmark`: uppercase, `letter-spacing: 0.35em`, cyan glow
- Type: add **Orbitron** (wordmark + section labels) and keep **Space Grotesk** for body. Loaded via `<link>` in `__root.tsx` head, not `@import` — Tailwind v4 rule.

## Components (new / edited)

New:
- `src/components/desktop/DesktopShell.tsx` — the two-column grid, wordmark, mic dock, tool rail. Only mounts on `lg+` (CSS gated); mobile renders current layout.
- `src/components/desktop/HudPanel.tsx` — reusable HUD frame with corner brackets and "ALPHA" tag in the top-right chip.
- `src/components/desktop/HudBubble.tsx` — chat bubble with tail, small "ALPHA" caption over assistant bubbles matching the reference.
- `src/components/desktop/OrbStage.tsx` — enlarges `AlphaOrb` to ~60vmin, wraps in horizontal spectrum wings (left + right mirrored `AudioSpectrum`).
- `src/components/desktop/MicDock.tsx` — bottom-center mic + waveform.
- `src/components/desktop/ToolRail.tsx` — left vertical icon rail (same routes as current `NAV`).

Edited:
- `src/routes/index.tsx` — render `<DesktopShell>` at `lg+`, current orb layout stays as the `<lg` fallback.
- `src/routes/chat.tsx` — at `lg+`, chat list + composer render inside `HudPanel` on the right of the same `DesktopShell`; header wordmark replaces the current top bar. Existing mobile chat layout untouched.
- `src/components/AlphaOrb.tsx` — accept a `sizeVMin` prop so the desktop stage can push it much larger without breaking mobile defaults.

## Behavioral notes

- The orb and chat share one page at `lg+`: `/` and `/chat` both mount `DesktopShell`, and the right panel shows either an "Awaiting your input." idle state (on `/`) or the live transcript (on `/chat`). Voice input from the mic dock works from either route.
- Tool rail links use existing routes; no route additions.
- Everything is presentation-only. No changes to `alpha.functions.ts`, `voice.ts`, `alpha-store.ts`, or any AI/network logic.

## Out of scope this turn

- Mobile redesign (kept as-is).
- New animations beyond CSS glow pulses on the orb halo, bubbles, and wordmark. Motion library not added.
- Any backend, model, or voice pipeline changes.

## Verification

After build: preview at desktop viewport, confirm wordmark, orb scale, HUD panel with corner brackets, bubbles with "ALPHA" caption, mic dock centered, tool rail on the left, and that mobile viewport still shows the current layout unchanged.

## Alpha "Cyber-Lens" Redesign

Transform Alpha's entire visual identity around the uploaded cyber-lens eye: brushed silver bezel, deep black core, electric neon blue circuitry, animated iris. This replaces the anime portrait orb everywhere and shifts the whole app theme to a live "advanced robot" circuit-board aesthetic.

### 1. New Orb = Cyber Eye (replaces `AlphaOrb.tsx` visual)

Build a pure CSS/SVG stacked "eye" — no static image — so it feels alive and reacts to voice level + speaking state:

- **Outer bezel** — brushed-silver conic gradient ring that rotates constantly (slow when idle, ~5s when active), with fine tick marks and small "CYBER-LENS 0.1nm RES" micro-text curved around it (SVG textPath).
- **Mid ring** — dark metallic groove with animated segmented dashes (the diagonal blade slits from the reference).
- **HUD ring** — neon-blue circuit lattice: concentric arcs, radial spokes, tiny data glyphs, drawn in SVG so we can animate stroke-dashoffset for a "scanning" feel.
- **Iris** — animated aperture blades (6–8 SVG polygons) that subtly breathe open/closed with audio level; blades rotate opposite the bezel.
- **Pupil core** — bright blue radial glow with a cross-hair reticle and a pulsing center that beats with `speakingState` / analyser level (reuses existing hooks in `AlphaOrb`).
- **Overlay** — faint horizontal + vertical scan lines crossing the whole eye (matches the reference cross-hair).

All layers respond to the existing `analyser` + `speakingState` the current orb already consumes, so behavior stays intact.

### 2. `MiniOrb` (chat header)

Rebuild as a scaled-down version of the same eye (bezel + iris + pupil only, no micro-text) so the chat header matches. Same component API, no other file changes needed.

### 3. Theme tokens — silver / black / neon blue

Rewrite the color layer in `src/styles.css`:

- `--background`: pure black `oklch(0 0 0)` (already is)
- `--foreground`: cool silver `oklch(0.92 0.02 240)`
- `--primary` / `--accent` / `--ring`: electric cyber-blue `oklch(0.75 0.24 245)` with a brighter `--neon-glow oklch(0.9 0.2 235)`
- `--hud-cyan`: shift to true neon blue (currently more cyan) to match the eye
- New `--silver` / `--silver-dark` tokens for bezel + panel edges
- New `--gradient-brushed`: repeating linear-gradient simulating brushed metal for bezels and HUD frame borders
- `--gradient-nebula`: deep-blue radial, less purple
- `--shadow-glow` / `--shadow-hud`: retuned to the new neon blue

### 4. "Live circuit" ambient theme

Global circuit-board feel, everywhere (not just the orb):

- **Starfield → CircuitGrid**: replace `.starfield` background on `DesktopShell` and mobile shell with a layered SVG/CSS "PCB" background — thin blue traces, junction dots, faint hex/grid pattern, animated pulses traveling along traces (CSS `stroke-dashoffset` animation on a fixed full-viewport SVG).
- **HUD frames** (`hud-frame`, `hud-frame-corners`): swap border to brushed-silver gradient with brighter neon-blue corner ticks and a subtle inner circuit trace line.
- **KITT scanner**: recolor bars/arc to the new neon-blue palette so it reads as part of the same system.
- **Wordmark "ALPHA"**: keep Orbitron, recolor to neon blue with a subtle silver stroke.

### 5. Assets

Keep `alpha-eye.png` as the installed PWA app icon and favicon (already set). Stop using `alpha-icon.png` inside the running UI — the in-app orb becomes the live CSS/SVG eye. No new binary assets needed.

### Files to touch

- `src/components/AlphaOrb.tsx` — replace image core with layered SVG/CSS eye
- `src/components/MiniOrb.tsx` — mirror the new eye at small size
- `src/styles.css` — theme tokens, `.starfield` → circuit background, `hud-frame*`, `wordmark`, `kitt-*` recolor, new `@keyframes` for bezel spin / iris breathe / trace pulse
- `src/components/desktop/OrbStage.tsx` — minor tweaks so nebula tint matches new blue (no structural change)

### Out of scope

No changes to voice pipeline, model routing, CRUD/agent logic, alarms, or settings behavior. Purely visual + theme.

### Answer to "is this possible"

Yes — fully doable with CSS + inline SVG, no extra libraries, no image generation. The eye stays crisp at any size, animates smoothly, and reacts to the existing audio analyser.
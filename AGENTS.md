# Alpha — Base44 Dev Environment

## What this is
Alpha is a voice-first AI companion built with **TanStack Start** (SSR), **React 19**, **Tailwind CSS v4**, and **Vite 7**. It is a **client-side app**: all data (chat, notes, reminders, memories, settings) lives in the browser's localStorage. There is **no backend database** and **no server-side API** of its own.

## Stack / setup
- Package manager: **Bun** (lockfile `bun.lock`). Installed inside the container via `npm install -g bun`.
- Dev command: `bunx vite dev --port 3000 --host 0.0.0.0 --strictPort` (the `dev` npm script is `vite dev`).
- Base image: `node:22` (pre-cached). Source is bind-mounted at `/app`; `node_modules` lives in a named volume so container installs don't shadow the mount.
- The Vite config is provided by `@lovable.dev/vite-tanstack-config`, which bundles the TanStack Start / React / Tailwind / Nitro plugins and enforces `server.host: "::"`. CLI flags (`--port 3000`) override its default port 8080 because the project config is merged on top.

## External hostname / allowedHosts
- Vite 7 blocks unknown Host headers by default (returns 403). `vite.config.ts` sets `vite.server.allowedHosts: true` so the preview's external hostname is accepted. **Keep this** — without it the preview iframe gets a 403 while localhost works.

## Secrets
- **None required to boot.** The optional AI provider keys (Groq, OpenRouter, OpenAI-compatible) are entered by the user at runtime in **Settings → Online** and stored in localStorage. Without them Alpha falls back to Ollama in offline mode. Do not add secrets for these.

## Verify it works
- `docker compose -f docker-compose.base44.yml up -d --build`, then `docker compose -f docker-compose.base44.yml ps` (wait for `healthy`).
- `curl -sf http://localhost:3000/` returns the SSR HTML shell.
- External-host check (must be 200, not 403):
  `curl -sf -H "Host: external-preview.example.com" http://localhost:3000/`
- The served HTML references unhashed source (`/src/styles.css`, `data-tsd-source="..."`) — confirms the dev server is serving live cloned source, not a prebuilt bundle.

## Live reload
Vite HMR is active; frontend edits appear in the preview without a restart. No backend services to restart.

## Tests
`bun run test` (vitest) — repo has a `tests/` dir but coverage is minimal.

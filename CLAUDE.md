# CLAUDE.md

Guidance for Claude Code when working in this repository.

## What this is

Trap Card Game — a multiplayer card game on an npm-workspace monorepo:

- `apps/mobile` — Expo (React Native; web is test-only). The product.
- `apps/party` — Cloudflare Worker + PartyServer Durable Object (`LobbyDO`), backed by D1 + KV.
- `packages/shared` (`@trap/shared`) — single source of truth for types, the WebSocket message contract, and the pure, deterministic game rules.

The legacy `frontend/` (Vue PWA) and `backend/` (FastAPI/Redis/Postgres) stacks have been removed (Phase 6 cutover landed); remaining work is deployment + polish (see `plans/remaining-work.md`).

## Read first

- **`AGENTS.md`** — conventions, gotchas, and resolved confusion points (PartyServer
  addressing, the workers test-pool limits, the Expo-free mobile core). Read before editing.
- **`plans/migration-expo-cloudflare.md`** — the overall migration plan and status.
- **`plans/remaining-work.md`** — the executable plan for what's left.

## Commands

- Test: `npm test` (all workspaces), or `npm run test:shared` / `npm run test:party` /
  `npm run test --workspace=@trap/mobile`.
- Typecheck: `npm run typecheck` (shared) or `--workspace=@trap/party` / `--workspace=@trap/mobile`.
- Mobile (from `apps/mobile`): `npx expo start`; health checks `npx expo-doctor`, `npx expo install --check`.
- Browser e2e (from `apps/mobile`): `npm run test:e2e` (Playwright, drives the web build against a live local Worker — see `apps/mobile/e2e/README.md`).
- Worker (from `apps/party`): `npx wrangler dev`.

## Conventions

- Test-driven: outline tests and function contracts before functional changes.
- Keep `packages/shared` the single source of truth for cross-cutting types and the WS contract.
- Do **not** run `npm audit fix --force` in `apps/party` (it swaps in a broken test-pool version — see AGENTS.md).
- **Never commit changes without explicit user approval.**

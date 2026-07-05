# CLAUDE.md

Guidance for Claude Code when working in this repository.

## What this is

Trap Card Game — a multiplayer card game on an npm-workspace monorepo:

- `apps/mobile` — Expo (React Native; web is test-only). The product.
- `apps/party` — Cloudflare Worker + PartyServer Durable Object (`LobbyDO`), backed by D1 + KV.
- `packages/shared` (`@trap/shared`) — single source of truth for types, the WebSocket message contract, and the pure, deterministic game rules.

The legacy `frontend/` (Vue PWA) and `backend/` (FastAPI/Redis/Postgres) stacks have been removed (Phase 6 cutover landed); remaining work is deployment + polish (see `plans/2026-06-21-remaining-work.md`).

## Read first

- **`AGENTS.md`** — conventions, gotchas, and resolved confusion points (PartyServer
  addressing, the workers test-pool limits, the Expo-free mobile core). Read before editing.
- **`plans/2026-06-21-migration-expo-cloudflare.md`** — the overall migration plan and status.
- **`plans/2026-06-21-remaining-work.md`** — the executable plan for what's left.
- **`docs/runsheets/`** — operational runbooks (Cloudflare setup, Android
  deploy, PWA deploy). Releases are normally automated by
  `.github/workflows/release.yml` (production = root `package.json` version
  bump on main; preview = manual dispatch, **Android-only** — the PWA has no
  preview environment).

## Commands

- Test: `npm test` (all workspaces), or `npm run test:shared` / `npm run test:party` /
  `npm run test --workspace=@trap/mobile`.
- Typecheck: `npm run typecheck` (shared) or `--workspace=@trap/party` / `--workspace=@trap/mobile`.
- Lint (from repo root): `npm run lint` — ESLint (TS/JS) + markdownlint (docs); or `npm run lint:js` / `npm run lint:md`.
- Mobile (from `apps/mobile`): `npx expo start`; health checks `npx expo-doctor`, `npx expo install --check`.
- Browser e2e (from `apps/mobile`): `npm run test:e2e` (Playwright, drives the web build against a live local Worker — see `apps/mobile/e2e/README.md`).
- Worker (from `apps/party`): `npx wrangler dev`.

## Conventions

- Test-driven: outline tests and function contracts before functional changes.
- Keep `packages/shared` the single source of truth for cross-cutting types and the WS contract.
- Do **not** run `npm audit fix --force` in `apps/party` (it swaps in a broken test-pool version — see AGENTS.md).
- **Always run `npm run lint` before committing** (ESLint + markdownlint must pass; CI enforces it). Fix findings rather than disabling rules.
- **Never commit changes without explicit user approval.**

<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **trap-card-game** (1507 symbols, 2488 relationships, 62 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> If any GitNexus tool warns the index is stale, run `npx gitnexus analyze` in terminal first.

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `gitnexus_impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run `gitnexus_detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `gitnexus_query({query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `gitnexus_context({name: "symbolName"})`.

## Never Do

- NEVER edit a function, class, or method without first running `gitnexus_impact` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use `gitnexus_rename` which understands the call graph.
- NEVER commit changes without running `gitnexus_detect_changes()` to check affected scope.

## Resources

| Resource | Use for |
|----------|---------|
| `gitnexus://repo/trap-card-game/context` | Codebase overview, check index freshness |
| `gitnexus://repo/trap-card-game/clusters` | All functional areas |
| `gitnexus://repo/trap-card-game/processes` | All execution flows |
| `gitnexus://repo/trap-card-game/process/{name}` | Step-by-step execution trace |

## CLI

| Task | Read this skill file |
|------|---------------------|
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus/gitnexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus/gitnexus-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus/gitnexus-refactoring/SKILL.md` |
| Tools, resources, schema reference | `.claude/skills/gitnexus/gitnexus-guide/SKILL.md` |
| Index, status, clean, wiki CLI commands | `.claude/skills/gitnexus/gitnexus-cli/SKILL.md` |

<!-- gitnexus:end -->

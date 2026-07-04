import { defineConfig, devices } from '@playwright/test';

/**
 * Runs the same e2e specs against the **exported** web build served by the
 * Worker's static assets on :8787 — the exact shape production takes (same
 * origin for HTML, API, and WebSocket). Catches static-export-only breakage
 * the dev-server suite (playwright.config.ts) cannot.
 *
 * Prerequisite — export dist/ pointed at the local Worker first (PowerShell,
 * from apps/mobile):
 *
 *   $env:EXPO_PUBLIC_API_BASE_URL = 'http://127.0.0.1:8787'
 *   $env:EXPO_PUBLIC_PARTY_HOST = '127.0.0.1:8787'
 *   npx expo export --platform web
 *
 * Then: npx playwright test --config playwright.exported.config.ts
 */

const WORKER_PORT = 8787;
const ORIGIN = `http://127.0.0.1:${WORKER_PORT}`;

export default defineConfig({
  testDir: './e2e',
  timeout: 120_000,
  expect: { timeout: 20_000 },
  // Two-client tests share lobby state on a single Worker — never parallelise.
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: ORIGIN,
    trace: 'retain-on-failure',
  },
  // Chromium only: engine coverage (WebKit) lives in the dev-server suite;
  // this config's job is the export/hosting shape, not the engine matrix.
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'npm run db:apply:local && npx wrangler dev --ip 127.0.0.1 --port 8787',
      cwd: '../party',
      port: WORKER_PORT,
      // NOTE: an already-running wrangler dev serves the assets it read at
      // startup — restart it after re-exporting, or you'll test a stale build.
      reuseExistingServer: true,
      timeout: 120_000,
    },
  ],
});

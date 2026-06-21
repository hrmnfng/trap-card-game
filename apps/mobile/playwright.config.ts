import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end (browser) tests for the Expo **web** build, driving the real
 * Cloudflare Worker + Durable Object over HTTP + WebSocket. This automates the
 * Phase A4 manual matrix (see `plans/remaining-work.md`).
 *
 * Playwright owns both services via `webServer`:
 *   1. the Worker — `wrangler dev` on :8787 (schema applied first on a cold
 *      start; an already-running dev server is reused, which avoids the
 *      concurrent-`d1 execute` corruption documented in AGENTS.md);
 *   2. Expo web — `expo start --web` on :8081, pointed at the local Worker.
 *
 * Run from `apps/mobile`: `npm run test:e2e`.
 */

const WORKER_PORT = 8787;
const WEB_PORT = 8081;
const WORKER_ORIGIN = `http://127.0.0.1:${WORKER_PORT}`;

export default defineConfig({
  testDir: './e2e',
  // Expo's first web bundle (Metro) is slow; give each test room for it.
  timeout: 120_000,
  expect: { timeout: 20_000 },
  // Two-client tests share lobby state on a single Worker — never parallelise.
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: `http://127.0.0.1:${WEB_PORT}`,
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      // Apply the local D1 schema, then serve the Worker. Skipped entirely when
      // a dev server is already listening (`reuseExistingServer`).
      command: 'npm run db:apply:local && npx wrangler dev --ip 127.0.0.1 --port 8787',
      cwd: '../party',
      port: WORKER_PORT,
      reuseExistingServer: true,
      timeout: 120_000,
    },
    {
      command: 'npx expo start --web --port 8081',
      cwd: '.',
      port: WEB_PORT,
      reuseExistingServer: true,
      timeout: 180_000,
      env: {
        // Point the web build at the local Worker (overrides apps/mobile/.env,
        // whose LAN IP is for physical devices). Keep non-interactive.
        EXPO_PUBLIC_API_BASE_URL: WORKER_ORIGIN,
        EXPO_PUBLIC_PARTY_HOST: `127.0.0.1:${WORKER_PORT}`,
        CI: '1',
        BROWSER: 'none',
      },
    },
  ],
});

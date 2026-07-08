import { test, expect } from '@playwright/test';
import { registerAndLand, startTwoPlayerGame, uniqueUser, vis } from './helpers';

/**
 * Pull-to-refresh, web half: RefreshControl is a no-op on react-native-web, so
 * web gets a visible refresh button wired to the same store refresh(). The
 * button label returning from "Refreshing…" to "↻ Refresh" is the honest-spinner
 * contract: it flips back only after a state_update round-trip (or the 5s cap).
 */
test('lobby refresh button round-trips and the lobby stays rendered', async ({ page }) => {
  await registerAndLand(page, uniqueUser('refresh'));
  await vis(page.getByTestId('create-lobby')).click();
  await page.waitForURL(/\/lobby\/[A-Z0-9]+/);
  await expect(vis(page.getByText(/1 player in lobby/i))).toBeVisible();

  await vis(page.getByTestId('refresh')).click();
  await expect(vis(page.getByTestId('refresh'))).toHaveText('↻ Refresh');
  await expect(vis(page.getByText(/1 player in lobby/i))).toBeVisible();
});

/**
 * The intermediate "Refreshing…" state is invisible on a fast local
 * round-trip, so proxy the lobby WebSocket and delay server→client frames:
 * the label must flip to "Refreshing…" and only settle back once the delayed
 * state_update lands.
 */
test('the spinner label stays on Refreshing… until the round-trip completes', async ({ page }) => {
  let delayServerFrames = false;
  await page.routeWebSocket(/\/parties\/lobby\//, (ws) => {
    const server = ws.connectToServer();
    ws.onMessage((frame) => server.send(frame));
    server.onMessage((frame) => {
      if (delayServerFrames) setTimeout(() => ws.send(frame), 750);
      else ws.send(frame);
    });
  });

  await registerAndLand(page, uniqueUser('spin'));
  await vis(page.getByTestId('create-lobby')).click();
  await page.waitForURL(/\/lobby\/[A-Z0-9]+/);
  await expect(vis(page.getByText(/1 player in lobby/i))).toBeVisible();

  delayServerFrames = true;
  await vis(page.getByTestId('refresh')).click();
  await expect(vis(page.getByTestId('refresh'))).toHaveText('Refreshing…');
  await expect(vis(page.getByTestId('refresh'))).toHaveText('↻ Refresh');
});

/**
 * Home half: the lobby list comes over plain HTTP (no socket), so its refresh
 * re-fetches lobby history in place. A guest joining from another browser bumps
 * the stored playerCount on the host's history row; after a refresh click the
 * row must show the new count without leaving Home.
 */
test('home refresh button refetches the lobby list in place', async ({ browser }) => {
  const hostCtx = await browser.newContext();
  const guestCtx = await browser.newContext();
  const host = await hostCtx.newPage();
  const guest = await guestCtx.newPage();
  try {
    const hostUser = uniqueUser('home');
    await registerAndLand(host, hostUser);
    await registerAndLand(guest, uniqueUser('visitor'));

    await vis(host.getByTestId('create-lobby')).click();
    await host.waitForURL(/\/lobby\/[A-Z0-9]+/);
    const code = new URL(host.url()).pathname.split('/lobby/')[1]!;

    // Back on Home, the focus refetch lists the fresh lobby with one member.
    await vis(host.getByText('Leave lobby')).click();
    await expect(vis(host.getByText(/1 player ·/))).toBeVisible();

    // The guest joins while the host sits on Home — nothing pushes the change.
    await vis(guest.getByPlaceholder('Lobby code')).fill(code);
    await vis(guest.getByTestId('join-lobby')).click();
    await guest.waitForURL(new RegExp(`/lobby/${code}`));
    await expect(vis(guest.getByText(new RegExp(hostUser)))).toBeVisible();

    await vis(host.getByTestId('refresh')).click();
    await expect(vis(host.getByTestId('refresh'))).toHaveText('↻ Refresh');
    await expect(vis(host.getByText(/2 players ·/))).toBeVisible();
    expect(new URL(host.url()).pathname).toBe('/');
  } finally {
    await hostCtx.close();
    await guestCtx.close();
  }
});

test('game refresh button round-trips with the hand intact', async ({ browser }) => {
  const hostCtx = await browser.newContext();
  const guestCtx = await browser.newContext();
  const host = await hostCtx.newPage();
  const guest = await guestCtx.newPage();
  try {
    await startTwoPlayerGame(host, guest);
    await vis(host.getByTestId('refresh')).click();
    await expect(vis(host.getByTestId('refresh'))).toHaveText('↻ Refresh');
    await expect(vis(host.getByTestId('hand-card'))).toHaveCount(3);
  } finally {
    await hostCtx.close();
    await guestCtx.close();
  }
});

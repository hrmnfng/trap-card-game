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

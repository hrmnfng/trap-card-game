import { test, expect } from '@playwright/test';
import { registerAndLand, uniqueUser, vis } from './helpers';

/**
 * A4 rows 3–6, end-to-end over two isolated browser contexts (two "devices")
 * against one Worker:
 *   - host creates a lobby, guest joins by code, both see each other;
 *   - the non-owner has no Start control;
 *   - the owner starts, both navigate to the game with a 3-card hand;
 *   - a card the host plays is reflected on both clients.
 */
test('two players: create/join, start, deal three cards, and play a card', async ({
  browser,
}) => {
  const hostCtx = await browser.newContext();
  const guestCtx = await browser.newContext();
  const host = await hostCtx.newPage();
  const guest = await guestCtx.newPage();
  const hostUser = uniqueUser('host');
  const guestUser = uniqueUser('guest');

  try {
    await registerAndLand(host, hostUser);
    await registerAndLand(guest, guestUser);

    // Host creates a lobby and lands on /lobby/<CODE>. Expo Router appends a
    // `?__EXPO_ROUTER_key=` query string, so match the path (no `$` anchor) and
    // read the code from the pathname only.
    await vis(host.getByTestId('create-lobby')).click();
    await host.waitForURL(/\/lobby\/[A-Z0-9]+/);
    const code = new URL(host.url()).pathname.split('/lobby/')[1]!;
    expect(code).toMatch(/^[A-Z0-9]+$/);

    // Guest joins by code.
    await vis(guest.getByPlaceholder('Lobby code')).fill(code);
    await vis(guest.getByTestId('join-lobby')).click();
    await guest.waitForURL(new RegExp(`/lobby/${code}`));

    // Both clients see both players.
    await expect(vis(host.getByText(guestUser))).toBeVisible();
    await expect(vis(guest.getByText(hostUser))).toBeVisible();

    // The guest is not the owner: no Start control, and the waiting hint shows.
    await expect(vis(guest.getByTestId('start-game'))).toHaveCount(0);
    await expect(
      vis(guest.getByText('Waiting for the host to start…'))
    ).toBeVisible();

    // The owner can start once two players are present.
    await expect(vis(host.getByTestId('start-game'))).toBeEnabled();
    await vis(host.getByTestId('start-game')).click();

    // Both navigate to the game and are each dealt three cards.
    await host.waitForURL(new RegExp(`/game/${code}`));
    await guest.waitForURL(new RegExp(`/game/${code}`));
    await expect(vis(host.getByTestId('hand-card'))).toHaveCount(3);
    await expect(vis(guest.getByTestId('hand-card'))).toHaveCount(3);

    // Host selects a card and plays it on the opponent.
    await vis(host.getByTestId('hand-card')).first().click();
    await vis(host.getByTestId('opponent')).first().click();

    // Host's hand drops to two, and both clients see the play in history.
    await expect(vis(host.getByTestId('hand-card'))).toHaveCount(2);
    await expect(vis(host.getByText(new RegExp(`${hostUser} played`)))).toBeVisible();
    await expect(vis(guest.getByText(new RegExp(`${hostUser} played`)))).toBeVisible();
  } finally {
    await hostCtx.close();
    await guestCtx.close();
  }
});

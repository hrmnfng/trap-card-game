import { test, expect } from '@playwright/test';
import { registerAndLand, uniqueUser, vis } from './helpers';

/**
 * A4 rows 3–6, end-to-end over two isolated browser contexts (two "devices")
 * against one Worker:
 *   - host creates a lobby, guest joins by code, both see each other;
 *   - the non-owner has no Start control;
 *   - both players ready up, owner starts prep, each authors 3 statements;
 *   - owner begins the game, both navigate with a 3-card hand;
 *   - a card the host plays is reflected on both clients.
 */
test('two players: create/join, ready, prep, begin game, and play a card', async ({
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

    // Both players ready up.
    await vis(host.getByTestId('ready-toggle')).click();
    await vis(guest.getByTestId('ready-toggle')).click();

    // Owner starts prep; both land on the prep screen.
    await expect(vis(host.getByTestId('start-game'))).toBeEnabled();
    await vis(host.getByTestId('start-game')).click();
    await host.waitForURL(new RegExp(`/prep/${code}`));
    await guest.waitForURL(new RegExp(`/prep/${code}`));

    // Each authors three statements and submits.
    for (const page of [host, guest]) {
      for (let i = 0; i < 3; i++) {
        await vis(page.getByTestId(`statement-${i}`)).fill(`trap ${i + 1}`);
      }
      await vis(page.getByTestId('submit-cards')).click();
    }

    // Owner begins the game; both land on the game with a 3-card hand.
    await expect(vis(host.getByTestId('begin-game'))).toBeEnabled();
    await vis(host.getByTestId('begin-game')).click();
    await host.waitForURL(new RegExp(`/game/${code}`));
    await guest.waitForURL(new RegExp(`/game/${code}`));
    await expect(vis(host.getByTestId('hand-card'))).toHaveCount(3);
    await expect(vis(guest.getByTestId('hand-card'))).toHaveCount(3);

    // Host plays a card on the opponent.
    await vis(host.getByTestId('hand-card')).first().click();
    await vis(host.getByTestId('opponent')).first().click();

    await expect(vis(host.getByTestId('hand-card'))).toHaveCount(2);
    await expect(vis(host.getByText(new RegExp(`${hostUser} played`)))).toBeVisible();
    await expect(vis(guest.getByText(new RegExp(`${hostUser} played`)))).toBeVisible();
  } finally {
    await hostCtx.close();
    await guestCtx.close();
  }
});

import { expect, type Locator, type Page } from '@playwright/test';

export const PASSWORD = 'password1';

/**
 * Restrict a locator to its **visible** matches.
 *
 * Expo Router on web keeps previously-visited screens mounted (hidden, for
 * back navigation), so a `/ → /login → /` round trip leaves two Home screens in
 * the DOM — only one visible. Filtering to visible isolates the active screen,
 * which both avoids strict-mode violations and makes count assertions (e.g.
 * "three cards") reflect what the player actually sees.
 */
export function vis(locator: Locator): Locator {
  return locator.filter({ visible: true });
}

/** A unique username per test run so reruns never collide in D1. */
export function uniqueUser(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
}

/**
 * Register a brand-new account from the login screen and wait until the
 * authenticated Home screen ("Welcome, <user>") is showing.
 */
export async function registerAndLand(page: Page, username: string): Promise<void> {
  await page.goto('/login');
  // Default mode is "login"; toggle to register.
  await vis(page.getByTestId('auth-toggle')).click();
  await vis(page.getByPlaceholder('Username')).fill(username);
  await vis(page.getByPlaceholder('Password')).fill(PASSWORD);
  await vis(page.getByTestId('auth-submit')).click();
  await expect(vis(page.getByText(`Welcome, ${username}`))).toBeVisible();
}

export interface TwoPlayerGame {
  code: string;
  hostUser: string;
  guestUser: string;
}

/**
 * Drive two fresh accounts from registration to the in-game screen (3-card
 * hands each). `onLobby` runs after the guest has joined and both rosters are
 * visible, before anyone readies up — the place for lobby-stage assertions.
 */
export async function startTwoPlayerGame(
  host: Page,
  guest: Page,
  onLobby?: (ctx: TwoPlayerGame) => Promise<void>
): Promise<TwoPlayerGame> {
  const hostUser = uniqueUser('host');
  const guestUser = uniqueUser('guest');
  await registerAndLand(host, hostUser);
  await registerAndLand(guest, guestUser);

  await vis(host.getByTestId('create-lobby')).click();
  await host.waitForURL(/\/lobby\/[A-Z0-9]+/);
  const code = new URL(host.url()).pathname.split('/lobby/')[1]!;

  await vis(guest.getByPlaceholder('Lobby code')).fill(code);
  await vis(guest.getByTestId('join-lobby')).click();
  await guest.waitForURL(new RegExp(`/lobby/${code}`));
  await expect(vis(host.getByText(guestUser))).toBeVisible();
  await expect(vis(guest.getByText(hostUser))).toBeVisible();

  const ctx: TwoPlayerGame = { code, hostUser, guestUser };
  if (onLobby) await onLobby(ctx);

  await vis(host.getByTestId('ready-toggle')).click();
  await vis(guest.getByTestId('ready-toggle')).click();
  await expect(vis(host.getByTestId('start-game'))).toBeEnabled();
  await vis(host.getByTestId('start-game')).click();
  await host.waitForURL(new RegExp(`/prep/${code}`));
  await guest.waitForURL(new RegExp(`/prep/${code}`));

  for (const page of [host, guest]) {
    for (let i = 0; i < 3; i++) {
      await vis(page.getByTestId(`statement-${i}`)).fill(`trap ${i + 1}`);
    }
    await vis(page.getByTestId('submit-cards')).click();
  }

  await expect(vis(host.getByTestId('begin-game'))).toBeEnabled();
  await vis(host.getByTestId('begin-game')).click();
  await host.waitForURL(new RegExp(`/game/${code}`));
  await guest.waitForURL(new RegExp(`/game/${code}`));
  await expect(vis(host.getByTestId('hand-card'))).toHaveCount(3);
  await expect(vis(guest.getByTestId('hand-card'))).toHaveCount(3);
  return ctx;
}

import { test, expect } from '@playwright/test';
import { PASSWORD, registerAndLand, uniqueUser, vis } from './helpers';

/**
 * A4 rows 1–2: registration lands authenticated, and a logout/login round-trip
 * restores the session (the token is re-minted by the Worker on login).
 */
test('register a new user, log out, and log back in', async ({ page }) => {
  const username = uniqueUser('auth');

  await registerAndLand(page, username);

  // Log out -> back to the unauthenticated Home view.
  await vis(page.getByTestId('logout')).click();
  await expect(
    vis(page.getByText('Sign in to create or join a lobby.'))
  ).toBeVisible();

  // Log back in (mode defaults to "login").
  await vis(page.getByText('Sign in / Register')).click();
  await vis(page.getByPlaceholder('Username')).fill(username);
  await vis(page.getByPlaceholder('Password')).fill(PASSWORD);
  await vis(page.getByTestId('auth-submit')).click();

  await expect(vis(page.getByText(`Welcome, ${username}`))).toBeVisible();
});

/**
 * A4 row 2, the half logout/login can't cover: the session must survive a
 * cold start (page reload), via the persisted token + restoreSession().
 * Regression for the storage-binding bug where the auth store captured the
 * in-memory default before _layout configured the real backend.
 */
test('a logged-in session survives a page reload', async ({ page }) => {
  const username = uniqueUser('persist');

  await registerAndLand(page, username);

  // Cold start: a fresh JS runtime must restore the session from storage.
  await page.reload();
  await expect(vis(page.getByText(`Welcome, ${username}`))).toBeVisible();

  // Control: wiping the persisted token and reloading must land signed-out,
  // proving the restore above came from localStorage and not elsewhere.
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(
    vis(page.getByText('Sign in to create or join a lobby.'))
  ).toBeVisible();
});

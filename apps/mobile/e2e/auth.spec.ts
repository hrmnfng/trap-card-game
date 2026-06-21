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

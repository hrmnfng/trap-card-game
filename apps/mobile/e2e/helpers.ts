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

import { test, expect } from '@playwright/test';
import { registerAndLand, uniqueUser, vis } from './helpers';

/**
 * Regression for the transparent-header padding bug: the Stack uses
 * `headerTransparent: true`, so screens must clear the real header height
 * themselves. The old Screen container only padded the safe-area inset (0 on
 * web), so top-anchored content rendered under the page title — by a different
 * amount on Android, web, and the installed PWA. Assert the lobby screen's
 * first content element sits fully below the header title.
 */
test('lobby content clears the transparent header', async ({ page }) => {
  await registerAndLand(page, uniqueUser('layout'));
  await vis(page.getByTestId('create-lobby')).click();
  await page.waitForURL(/\/lobby\/[A-Z0-9]+/);

  const title = vis(page.getByRole('heading', { name: 'Lobby', exact: true }));
  const content = vis(page.getByTestId('copy-code'));
  await expect(title).toBeVisible();
  await expect(content).toBeVisible();

  const titleBox = await title.boundingBox();
  const contentBox = await content.boundingBox();
  expect(titleBox).not.toBeNull();
  expect(contentBox).not.toBeNull();
  // The content's top edge must not sit above the header title's bottom edge.
  expect(contentBox!.y).toBeGreaterThanOrEqual(titleBox!.y + titleBox!.height);
});

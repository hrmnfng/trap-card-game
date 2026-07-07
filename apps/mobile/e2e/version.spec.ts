import { test, expect } from '@playwright/test';
import { registerAndLand, uniqueUser, vis } from './helpers';
import { version } from '../../../package.json';

/**
 * The footer must show the ROOT package.json version — the value release.yml
 * gates and tags on — on the login screen and both Home states.
 */
test('login and home show the release version', async ({ page }) => {
  await page.goto('/');
  await expect(vis(page.getByTestId('app-version'))).toHaveText(`v${version}`);

  await page.goto('/login');
  await expect(vis(page.getByTestId('app-version'))).toHaveText(`v${version}`);

  await registerAndLand(page, uniqueUser('ver'));
  await expect(vis(page.getByTestId('app-version'))).toHaveText(`v${version}`);
});

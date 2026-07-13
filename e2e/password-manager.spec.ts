import { expect, test } from '@playwright/test';

test('password-manager loads the packaged Swarmbase stack without runtime errors', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') {
      errors.push(`console: ${message.text()}`);
    }
  });

  await page.goto('/');
  await expect(page).toHaveTitle('Swarmbase Password Manager');
  await page.waitForTimeout(1_000);
  expect(errors, 'application startup errors').toEqual([]);
  await expect(page.locator('#root')).not.toBeEmpty();
  await expect(page.getByRole('button', { name: 'Login' })).toBeVisible();
});

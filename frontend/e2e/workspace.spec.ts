import { test, expect } from '@playwright/test';

test('create a provider, configure a room, stream replies and preserve history', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await page.getByRole('heading', { name: /Create your account|Welcome back/ }).waitFor();
  if (await page.getByRole('heading', { name: 'Welcome back' }).isVisible())
    await page.getByRole('button', { name: 'Need an account? Create one' }).click();
  const email = `browser-${Date.now()}@example.com`;
  await page.getByLabel('Name', { exact: true }).fill('Browser Test');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password', { exact: true }).fill('correct-horse-battery-staple');
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await page.getByRole('button', { name: 'Model connections', exact: true }).click();
  await page.getByRole('button', { name: 'Add connection', exact: true }).first().click();
  await page.getByLabel('Connection name').fill('Mock local provider');
  await page.getByLabel('Provider type').selectOption('ollama');
  await page.getByLabel('Base URL').fill('http://127.0.0.1:8766');
  await page.getByRole('button', { name: 'Save connection' }).click();
  await expect(page.getByRole('heading', { name: 'Mock local provider' })).toBeVisible();
  await page.getByTitle('Create room').click();
  await page.getByLabel('Room name', { exact: true }).fill('Architecture council');
  await page.getByRole('dialog').getByRole('button', { name: 'Create room', exact: true }).click();
  await page.getByRole('button', { name: 'Set up agents' }).click();
  await page.getByRole('button', { name: 'Add an agent' }).click();
  await page.getByLabel('Agent name').fill('Pragmatic analyst');
  await page.getByLabel('Model name or ID').fill('mock-model');
  await page.getByRole('button', { name: 'Save configuration' }).click();
  await page.getByLabel('Message the group').fill('Compare a monolith with microservices.');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(
    page.getByText('A practical response from the test provider.', { exact: true }).first(),
  ).toBeVisible();
  await expect(page.locator('.status-dot.completed')).toBeVisible();
  await expect(page.getByText('10 in / 8 out', { exact: true })).toHaveCount(2);
  await page.reload();
  await expect(
    page.getByText('Compare a monolith with microservices.', { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText('A practical response from the test provider.', { exact: true }),
  ).toHaveCount(2);
  await page.screenshot({ path: 'test-results/desktop-room.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByLabel('Toggle navigation')).toBeVisible();
  await expect(page.getByLabel('Message the group')).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBeTruthy();
  await page.getByLabel('Toggle navigation').click();
  await expect(page.getByRole('button', { name: 'Model connections', exact: true })).toBeVisible();
  await page.getByLabel('Toggle navigation').click();
  await expect
    .poll(async () => (await page.locator('.sidebar').boundingBox())?.x || 0)
    .toBeLessThan(-200);
  await page.screenshot({
    path: 'test-results/mobile-room.png',
    fullPage: true,
    animations: 'disabled',
  });
  expect(errors).toEqual([]);
});

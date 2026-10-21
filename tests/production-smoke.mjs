import { chromium } from 'playwright-core';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fixtures, output } from './fixtures.mjs';

await fixtures();
const baseURL = process.env.TEST_URL || 'http://127.0.0.1:5173/';
const expectedOrigin = new URL(baseURL).origin;
const browser = await chromium.launch({ executablePath: process.env.BROWSER_PATH || (process.platform === 'win32' ? 'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe' : chromium.executablePath()), headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, reducedMotion: 'reduce' });
const errors = [], external = [];
page.on('pageerror', error => errors.push(error.message));
await page.route('**/*', route => {
  if (new URL(route.request().url()).origin !== expectedOrigin) { external.push(route.request().url()); return route.abort(); }
  return route.continue();
});
try {
  assert.equal((await page.goto(baseURL)).status(), 200);
  await page.locator('#upload-card').waitFor();
  await page.screenshot({ path: path.join(output, 'production-library.png'), fullPage: true });
  for (const name of ['small.fb2', 'small.epub']) {
    const previous = await page.locator('.book-card').count();
    await page.locator('#file-input').setInputFiles(path.join(output, name));
    await page.waitForFunction(count => document.querySelectorAll('.book-card').length > count, previous);
    await page.locator('#import-panel').waitFor({ state: 'hidden' });
  }
  assert.equal(await page.locator('.book-card').count(), 3);
  await page.locator('[data-open="booktyper-welcome-v1"]').click();
  await page.locator('#text-window .caret').waitFor();
  await page.locator('#focus-prompt').click();
  for (const char of 'Кожна велика') await page.keyboard.insertText(char);
  await page.waitForFunction(() => document.querySelector('#position-label').textContent.startsWith('12 /'));
  await page.reload(); await page.locator('#continue-book').waitFor();
  await page.locator('#continue-book').click();
  await page.waitForFunction(() => document.querySelector('#position-label')?.textContent.startsWith('12 /'));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('#reader-settings').click();
  await page.locator('#color-theme').selectOption('dark');
  assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark');
  await page.locator('#color-theme').selectOption('light');
  await page.locator('.dialog-close').click(); await page.locator('#typing-input').focus();
  await page.screenshot({ path: path.join(output, 'production-reader-mobile.png'), fullPage: true });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.locator('#back-library').click();
  await page.locator('#upload-card').waitFor();
  assert.equal(await page.evaluate(() => scrollY), 0);
  await page.screenshot({ path: path.join(output, 'production-library-mobile.png'), fullPage: true });
  assert.deepEqual(errors, []); assert.deepEqual(external, []);
  const report = { testedAt: new Date().toISOString(), baseURL, checks: ['static website and relative asset paths', 'bundled import Worker', 'FB2 and compressed EPUB import', 'real typing and reload journal', 'mobile theme control and navigation scroll reset', 'no external network requests'], errors, external };
  await fs.writeFile(path.join(output, 'production-report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  await page.screenshot({ path: path.join(output, 'production-failure.png'), fullPage: true });
  console.error(errors); throw error;
} finally { await browser.close(); }

import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const browser = await chromium.launch({ executablePath: process.env.BROWSER_PATH || 'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe', headless: true });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
const errors = []; page.on('pageerror', error => errors.push(error.message));
const baseURL = process.env.TEST_URL || 'http://127.0.0.1:5173/';
const areaWidth = () => page.locator('#typing-area').evaluate(el => el.getBoundingClientRect().width);
const settings = () => page.locator('#reader-settings').click();
const close = () => page.locator('.dialog-close').click();
async function aligned() {
  await page.waitForTimeout(220);
  const geometry = await page.evaluate(() => {
    const caret = document.querySelector('#typing-caret').getBoundingClientRect();
    const node = document.querySelector('#text-window .caret').getBoundingClientRect();
    const area = document.querySelector('#typing-area').getBoundingClientRect();
    return { x: Math.abs(caret.left + 1 - node.left), y: Math.abs(caret.top - node.top), center: Math.abs(area.x + area.width / 2 - innerWidth / 2), overflow: document.documentElement.scrollWidth - innerWidth };
  });
  assert.ok(geometry.x < 1.5 && geometry.y < 1.5 && geometry.center < 1 && geometry.overflow <= 0, JSON.stringify(geometry));
}
try {
  await page.goto(baseURL); await page.locator('#continue-book').click();
  await page.locator('#text-window .caret').waitFor(); await page.locator('#typing-input').focus();
  await page.keyboard.insertText('Кожна велика історія починається з першого слова. ');
  await aligned(); assert.equal(await areaWidth(), 1200);
  await page.evaluate(() => { window.originalCharacter = document.querySelector('#text-window > span'); });
  await settings();
  const range = page.locator('#content-width');
  await range.press('Home');
  assert.equal(await areaWidth(), 600, 'Width must preview immediately while the dialog is open');
  assert.equal(await page.locator('#content-width-value').textContent(), '600 px');
  for (let i = 0; i < 4; i++) await range.press('ArrowRight');
  await close(); assert.equal(await areaWidth(), 800); await aligned();
  assert.ok(await page.evaluate(() => window.originalCharacter === document.querySelector('#text-window > span')), 'Changing width must reflow, not rebuild book text');
  await page.reload(); await page.locator('#continue-book').click(); await page.locator('#text-window .caret').waitFor();
  assert.equal(await areaWidth(), 800); await settings();
  assert.equal(await range.inputValue(), '800');
  await range.press('End'); await close();
  assert.equal(await areaWidth(), 1712, 'The viewport must limit a saved width of 1800 px');
  await page.locator('#typing-input').focus(); await aligned();
  await page.locator('#zen').click(); await aligned();
  await page.setViewportSize({ width: 390, height: 844 }); await aligned();
  assert.equal(await areaWidth(), 344);
  await page.locator('#zen').click();
  await page.setViewportSize({ width: 1920, height: 1080 });
  await settings(); await page.locator('#reset-content-width').click();
  assert.equal(await range.inputValue(), '1200');
  await fs.mkdir('test-results', { recursive: true });
  await page.screenshot({ path: 'test-results/reader-width-settings.png', fullPage: true });
  await close(); assert.equal(await areaWidth(), 1200); await aligned();
  await page.locator('#back-library').click();
  await page.locator('[data-view="settings"]').click();
  assert.equal(await range.inputValue(), '1200', 'The library settings screen must expose the same preference');
  assert.deepEqual(errors, []);
  console.log('PASS live width preview, 600–1800 px range, reload persistence, reset and both settings screens');
  console.log('PASS text nodes and progress survive reflow; caret stays aligned in focus mode and on mobile');
} finally { await browser.close(); }

import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const baseURL = process.env.TEST_URL || 'http://127.0.0.1:5173/';
const browser = await chromium.launch({ executablePath: process.env.BROWSER_PATH || 'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const title = 'Плавний ритм';
const open = () => page.locator('.book-card').filter({ hasText: title }).locator('[data-open]');
const position = () => page.evaluate(() => Number(document.querySelector('#position-label').textContent.split('/')[0].replace(/\D/g, '')));
const waitPosition = value => page.waitForFunction(value => Number(document.querySelector('#position-label').textContent.split('/')[0].replace(/\D/g, '')) === value, value);
const text = () => page.locator('#text-window').evaluate(el => [...el.children].map(n => n.textContent === '↵\n' ? '\n' : n.textContent).join(''));
async function aligned() {
  await page.waitForTimeout(180);
  const geometry = await page.evaluate(() => {
    const caret = document.querySelector('#typing-caret').getBoundingClientRect();
    const span = document.querySelector('#text-window .caret').getBoundingClientRect();
    const area = document.querySelector('#typing-area').getBoundingClientRect();
    return { dx: Math.abs(caret.left + 1 - span.left), dy: Math.abs(caret.top - span.top), y: caret.top - area.top, x: caret.left - area.left, width: area.width };
  });
  assert.ok(geometry.dx < 1.5 && geometry.dy < 1.5, JSON.stringify(geometry));
  assert.ok(geometry.y >= 0 && geometry.y < 150 && geometry.x >= 0 && geometry.x < geometry.width, JSON.stringify(geometry));
}
try {
  await page.goto(baseURL); await page.locator('#upload-card').waitFor();
  await page.locator('#file-input').setInputFiles({ name: 'smooth.fb2', mimeType: 'application/xml', buffer: Buffer.from(`<FictionBook><description><title-info><book-title>${title}</book-title></title-info></description><body><p>«Книга» ${'Рівний ритм. Спокійний рух курсору — слово за словом 📖. '.repeat(150)}</p><p>Новий абзац.</p></body></FictionBook>`) });
  await open().click(); await page.locator('#text-window .caret').waitFor();
  await page.locator('#typing-input').focus();
  await page.keyboard.insertText('"Книга" '); await waitPosition(8);
  assert.equal(await page.locator('#text-window .mistake, #text-window .wrong').count(), 0);
  console.log('PASS straight quotes type Ukrainian opening and closing guillemets');
  await aligned();

  const motion = await page.evaluate(async () => {
    const input = document.querySelector('#typing-input'), caret = document.querySelector('#typing-caret');
    const x = caret.getBoundingClientRect().left;
    input.dispatchEvent(new InputEvent('beforeinput', { inputType: 'insertText', data: 'Р', bubbles: true, cancelable: true }));
    const samples = [];
    for (let i = 0; i < 10; i++) {
      await new Promise(requestAnimationFrame); samples.push(caret.getBoundingClientRect().left);
    }
    return { x, samples, end: caret.getBoundingClientRect().left };
  });
  assert.ok(motion.samples.some(x => x > motion.x && x < motion.end), JSON.stringify(motion));
  const firstStep = motion.samples.find(x => x > motion.x + .01) - motion.x;
  assert.ok(firstStep / (motion.end - motion.x) < .4, `Caret must accelerate gently, rather than jump on its first frame: ${JSON.stringify(motion)}`);
  assert.ok(motion.samples.every((x, i) => x >= (motion.samples[i - 1] ?? motion.x) - .01 && x <= motion.end + .01), 'Forward movement must stay monotonic without overshoot');
  await page.evaluate(() => { window.savedCharacter = document.querySelector('#text-window > span'); window.savedCaret = document.querySelector('#typing-caret'); });
  await page.locator('#typing-input').press('Backspace'); await waitPosition(8);
  assert.ok(await page.evaluate(() => window.savedCharacter === document.querySelector('#text-window > span') && window.savedCaret === document.querySelector('#typing-caret')));
  console.log('PASS caret interpolates movement and Backspace preserves existing text nodes');

  const rapidText = (await text()).slice(8, 18);
  const rapid = await page.evaluate(async value => {
    const input = document.querySelector('#typing-input'), samples = [];
    for (const char of value) {
      input.dispatchEvent(new InputEvent('beforeinput', { inputType: 'insertText', data: char, bubbles: true, cancelable: true }));
      await new Promise(requestAnimationFrame);
      samples.push({ actual: document.querySelector('#typing-caret').getBoundingClientRect().left, expected: document.querySelector('#text-window .caret').getBoundingClientRect().left - 1 });
      await new Promise(resolve => setTimeout(resolve, 18));
    }
    return samples;
  }, rapidText);
  await waitPosition(8 + rapidText.length); await aligned();
  assert.ok(rapid.every(sample => sample.actual <= sample.expected + .5 && sample.expected - sample.actual < 45), JSON.stringify(rapid));
  for (const char of rapidText) await page.locator('#typing-input').press('Backspace');
  await waitPosition(8); await aligned();
  console.log('PASS gentle acceleration, monotonic motion and rapid retargeting without dropped text or excessive lag');

  const first = await text();
  await page.keyboard.insertText(first.slice(8)); await waitPosition(first.length);
  await page.waitForFunction(() => document.querySelector('#text-window > span')?.dataset.offset !== '0');
  await aligned();
  const context = await page.locator('.typing-history').textContent();
  assert.ok(context.length > 0 && first.endsWith(context.replaceAll('↵\n', '\n')));
  const second = await text();
  // All events arrive in one task while the asynchronous fragment switch is
  // pending. A delete must keep its position relative to queued text.
  const burst = await page.evaluate(value => {
    const input = document.querySelector('#typing-input');
    input.dispatchEvent(new InputEvent('beforeinput', { inputType: 'insertText', data: value, bubbles: true, cancelable: true }));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true }));
    input.dispatchEvent(new InputEvent('beforeinput', { inputType: 'insertText', data: [...value].at(-1), bubbles: true, cancelable: true }));
    return value.length;
  }, second);
  await waitPosition(first.length + burst);
  console.log('PASS line context survives fragment changes and queued Backspace keeps input order');
  assert.ok(await page.locator('.typing-content [data-offset]').count() < 2400);
  await aligned();
  await page.locator('#zen').click(); await aligned();
  await page.setViewportSize({ width: 390, height: 844 }); await aligned();
  await page.locator('#reader-settings').click({ force: true });
  await page.locator('#font-size').selectOption('32');
  await page.locator('.dialog-close').click(); await aligned();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  assert.equal(await page.locator('#typing-caret').evaluate(el => getComputedStyle(el).transitionDuration), '0s');
  await fs.mkdir('test-results', { recursive: true });
  await page.screenshot({ path: 'test-results/typing-motion-mobile.png', fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.locator('#zen').click(); await page.locator('#typing-input').focus(); await aligned();
  await page.screenshot({ path: 'test-results/typing-motion-desktop.png', fullPage: true });
  assert.deepEqual(errors, []);
  console.log('PASS caret alignment on resize, focus mode and font changes; reduced motion respected');
} finally { await browser.close(); }

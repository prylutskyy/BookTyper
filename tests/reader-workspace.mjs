import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const browser = await chromium.launch({ executablePath: process.env.BROWSER_PATH || 'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe', headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const baseURL = process.env.TEST_URL || 'http://127.0.0.1:5173/';
const errors = []; page.on('pageerror', error => errors.push(error.message));
const title = 'Простір для читання';
const open = () => page.locator('.book-card').filter({ hasText: title }).locator('[data-open]');
const waitPosition = value => page.waitForFunction(value => Number(document.querySelector('#position-label').textContent.split('/')[0].replace(/\D/g, '')) === value, value);
const source = () => page.locator('#text-window').evaluate(el => [...el.children].map(n => n.textContent === '↵\n' ? '\n' : n.textContent).join(''));
const type = value => page.keyboard.insertText(value);
try {
  await fs.mkdir('test-results', { recursive: true });
  await page.goto(baseURL); await page.locator('#upload-card').waitFor();
  await page.locator('#file-input').setInputFiles({ name: 'workspace.fb2', mimeType: 'application/xml', buffer: Buffer.from(`<FictionBook><description><title-info><book-title>${title}</book-title></title-info></description><body><section><title><p>Перший розділ</p></title><p>${'Повільний ранок. Рядки складаються в історію. '.repeat(100)}</p><p>English text for the keyboard.</p></section><section><title><p>Другий розділ</p></title><p>Нова сторінка.</p></section></body></FictionBook>`) });
  await open().click(); await page.locator('#text-window .caret').waitFor(); await page.locator('#typing-input').focus();
  await page.locator('#reader-settings').click(); await page.locator('#relaxed').uncheck(); await page.locator('.dialog-close').click();
  const prefix = (await source()).split('\n')[0];
  await type(prefix); await waitPosition(prefix.length);
  assert.equal(await page.locator('.next-key[data-code="Space"],.next-key[data-code="Enter"]').count(), 2);
  await page.locator('#typing-input').press('Space'); await waitPosition(prefix.length + 1);
  assert.equal(await page.locator('#text-window .mistake,#text-window .wrong').count(), 0);
  await page.locator('#typing-input').press('Backspace'); await waitPosition(prefix.length);
  await page.locator('#typing-input').press('Enter'); await waitPosition(prefix.length + 1);
  await page.reload(); await open().click(); await page.locator('#text-window .caret').waitFor(); await waitPosition(prefix.length + 1);
  console.log('PASS Space and Enter accept a paragraph break with strict punctuation; deletion and reload retain exact offsets');
  await page.locator('#typing-input').focus();
  const first = await source();
  // Stop immediately before an anchored line wrap, then sample every frame.
  const wrap = await page.evaluate(minimum => [...document.querySelectorAll('#text-window > span')].find((node, i, all) => i && Number(node.dataset.offset) > minimum && node.offsetTop > all[i - 1].offsetTop && node.offsetTop > 150)?.dataset.offset, prefix.length + 5);
  assert.ok(wrap);
  const target = Number(wrap);
  await type(first.slice(prefix.length + 1, target - 1)); await waitPosition(target - 1); await page.waitForTimeout(180);
  const samples = await page.evaluate(async value => {
    const input = document.querySelector('#typing-input'), caret = document.querySelector('#typing-caret');
    const positions = [caret.getBoundingClientRect().top];
    input.dispatchEvent(new InputEvent('beforeinput', { inputType: 'insertText', data: value, bubbles: true, cancelable: true }));
    for (let i = 0; i < 14; i++) { await new Promise(requestAnimationFrame); positions.push(caret.getBoundingClientRect().top); }
    return positions;
  }, first[target - 1]);
  assert.ok(Math.max(...samples) - Math.min(...samples) < 1.5, `Line wrap bounced: ${samples}`);
  console.log('PASS caret stays at a constant screen height throughout an animated line wrap');
  await type(first.slice(target, -1)); await waitPosition(first.length - 1); await page.waitForTimeout(180);
  const transition = await page.evaluate(async value => {
    const caret = document.querySelector('#typing-caret'), positions = [caret.getBoundingClientRect().top];
    document.querySelector('#typing-input').dispatchEvent(new InputEvent('beforeinput', { inputType: 'insertText', data: value, bubbles: true, cancelable: true }));
    for (let i = 0; i < 18; i++) { await new Promise(requestAnimationFrame); positions.push(caret.getBoundingClientRect().top); }
    return positions;
  }, first.at(-1));
  await page.waitForFunction(() => document.querySelector('#text-window > span')?.dataset.offset !== '0');
  assert.ok(Math.max(...transition) - Math.min(...transition) < 1.5, `Fragment transition jumped: ${transition}`);
  console.log('PASS fragment replacement preserves the visible caret position frame by frame');

  await page.locator('#chapters').click(); assert.equal(await page.locator('[data-chapter]').count(), 2);
  await page.locator('[data-chapter]').last().click(); await page.locator('#text-window .caret').waitFor();
  await page.locator('#chapters').click(); await page.locator('#start-again').click(); await waitPosition(0);
  await page.locator('#reader-settings').click(); await page.locator('#keyboard-layout').selectOption('en'); await page.locator('.dialog-close').click();
  assert.equal(await page.locator('.keyboard-key[data-code="KeyQ"]').textContent(), 'q');
  await page.locator('#reader-settings').click(); await page.locator('#keyboard-layout').selectOption('auto'); await page.locator('.dialog-close').click();
  assert.equal(await page.locator('.keyboard-key[data-code="KeyQ"]').textContent(), 'й');
  console.log('PASS chapter navigation and automatic/manual keyboard layouts');
  const originalHeight = await page.locator('#typing-area').evaluate(el => el.clientHeight);
  await page.locator('#toggle-keyboard').click(); assert.ok(await page.locator('#virtual-keyboard').isHidden());
  assert.ok(await page.locator('#typing-area').evaluate(el => el.clientHeight) > originalHeight);
  await page.reload(); await open().click(); await page.locator('#text-window .caret').waitFor();
  assert.ok(await page.locator('#virtual-keyboard').isHidden());
  await page.locator('#toggle-keyboard').click(); await page.locator('#typing-input').focus();
  for (const [width, height] of [[1280,720],[1366,768],[1920,1080],[390,844]]) {
    await page.setViewportSize({ width, height }); await page.waitForTimeout(180);
    const layout = await page.evaluate(() => {
      const area = document.querySelector('#typing-area').getBoundingClientRect();
      return { center: Math.abs(area.x + area.width / 2 - innerWidth / 2), width: area.width, height: area.height, overflowX: document.documentElement.scrollWidth - innerWidth, overflowY: document.documentElement.scrollHeight - innerHeight };
    });
    assert.ok(layout.center < 1 && layout.overflowX <= 0 && layout.overflowY <= 2, `${width}: ${JSON.stringify(layout)}`);
    if (width >= 1200) assert.ok(layout.width >= 1000);
    if (width === 390) assert.ok(await page.locator('#virtual-keyboard').isHidden());
    await page.screenshot({ path: `test-results/reader-workspace-${width}.png`, fullPage: true });
  }
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.locator('#reader-settings').click(); await page.locator('#color-theme').selectOption('dark'); await page.locator('.dialog-close').click();
  await page.locator('#typing-input').focus(); await page.waitForTimeout(220);
  await page.screenshot({ path: 'test-results/reader-workspace-dark.png', fullPage: true });
  await page.locator('#back-library').click();
  await page.locator('#file-input').setInputFiles({ name: 'english.fb2', mimeType: 'application/xml', buffer: Buffer.from('<FictionBook><description><title-info><book-title>English practice</book-title></title-info></description><body><p>Hello reader. A quiet place to practise.</p></body></FictionBook>') });
  await page.locator('.book-card').filter({ hasText: 'English practice' }).locator('[data-open]').click();
  await page.locator('#text-window .caret').waitFor();
  assert.equal(await page.locator('.keyboard-key[data-code="KeyQ"]').textContent(), 'q');
  assert.equal(await page.locator('.next-key[data-code="KeyH"]').count(), 1);
  assert.equal(await page.locator('.next-key[data-code^="Shift"]').count(), 2);
  assert.deepEqual(errors, []);
  console.log('PASS wider centered text, keyboard visibility persistence, dark theme and complete viewport fit on laptop/desktop/mobile');
} finally { await browser.close(); }

import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';

const baseURL = process.env.TEST_URL || 'http://127.0.0.1:5173/';
const browser = await chromium.launch({ executablePath: process.env.BROWSER_PATH || (process.platform === 'win32' ? 'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe' : chromium.executablePath()), headless: true });
const page = await browser.newPage();
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const title = 'Перевірка збереження помилок';
const id = () => page.locator('.book-card').filter({ hasText: title }).locator('[data-open]');
const wrongOffsets = () => page.evaluate(() => {
  let offset = 0; const wrong = [];
  for (const span of document.querySelector('#text-window').children) {
    if (span.classList.contains('wrong')) wrong.push(offset);
    offset += span.textContent === '↵\n' ? 1 : span.textContent.length;
  }
  return wrong;
});
async function type(value) {
  for (const char of value) {
    if (char === '\n') await page.locator('#typing-input').press('Enter');
    else await page.keyboard.insertText(char);
  }
}
async function focus() { await page.locator('#text-window .caret').waitFor(); await page.locator('#typing-input').focus(); }
async function toggleStrict(value) {
  await page.locator('#reader-settings').click(); await page.locator('#strict').setChecked(value);
  await page.locator('.dialog-close').click(); await focus();
}
try {
  await page.goto(baseURL); await page.locator('#upload-card').waitFor();
  await page.locator('#file-input').setInputFiles({ name: 'typing-errors.fb2', mimeType: 'application/xml', buffer: Buffer.from(`<FictionBook><description><title-info><book-title>${title}</book-title></title-info></description><body><p>${'Кожна велика книга 📖 чекає свого читача. '.repeat(180)}</p></body></FictionBook>`) });
  await id().waitFor(); await id().click(); await focus(); await toggleStrict(false);
  await type('XоYна ');
  assert.deepEqual(await wrongOffsets(), [0, 2]);
  await page.locator('#typing-input').press('Backspace');
  assert.deepEqual(await wrongOffsets(), [0, 2], 'Backspace on a correct character must preserve earlier mistakes');
  await page.locator('#typing-input').press('Backspace');
  await page.locator('#typing-input').press('Backspace');
  await page.locator('#typing-input').press('Backspace');
  assert.deepEqual(await wrongOffsets(), [0], 'Deleting one wrong character must clear only that mistake');
  await type('ж'); assert.deepEqual(await wrongOffsets(), [0]);
  await page.locator('#typing-input').press('Control+Backspace');
  assert.deepEqual(await wrongOffsets(), [], 'Deleting a word must clear only errors in that word');
  console.log('PASS selective Backspace, correcting one error and deleting a word');

  await type('Xо'); await page.locator('#typing-input').press('Backspace');
  await page.reload(); await page.locator('#upload-card').waitFor(); await id().click(); await focus();
  assert.deepEqual(await wrongOffsets(), [0], 'Immediate reload must restore remaining mistakes');
  await page.locator('[data-view="library"]').click(); await id().click(); await focus();
  assert.deepEqual(await wrongOffsets(), [0], 'Reopening a book must preserve mistakes');
  console.log('PASS mistake persistence after reload and reopening');

  const firstChunk = await page.locator('#text-window').evaluate(el => [...el.children].map(span => span.textContent === '↵\n' ? '\n' : span.textContent).join(''));
  await type(firstChunk.slice(1));
  await focus();
  const secondChunk = await page.locator('#text-window').evaluate(el => [...el.children].map(span => span.textContent === '↵\n' ? '\n' : span.textContent).join(''));
  await type('X' + [...secondChunk][1]);
  await page.locator('#typing-input').press('Backspace');
  assert.deepEqual(await wrongOffsets(), [0]);
  await page.locator('#typing-input').press('Backspace');
  assert.deepEqual(await wrongOffsets(), []);
  await page.locator('#typing-input').press('Backspace');
  await page.waitForFunction(position => Number(document.querySelector('#position-label').textContent.split('/')[0].replace(/\D/g, '')) === position, firstChunk.length - 1);
  await focus();
  assert.deepEqual(await wrongOffsets(), [0], 'Returning across a chunk boundary must retain previous mistakes');
  console.log('PASS mistakes across fragment transitions and Unicode text');

  await toggleStrict(true); await type('X');
  assert.equal(await page.locator('.mistake').count(), 1);
  await page.locator('#typing-input').press('Backspace');
  assert.equal(await page.locator('.mistake').count(), 0);
  assert.deepEqual(await wrongOffsets(), [0], 'Strict-mode error clearing must preserve earlier accepted mistakes');
  assert.deepEqual(errors, []);
  console.log('PASS strict-mode error handling remains intact');
} finally { await browser.close(); }

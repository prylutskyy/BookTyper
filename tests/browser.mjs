import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fixtures, largeFixture, largeEpubFixture, output } from './fixtures.mjs';

const browserPath = process.env.BROWSER_PATH || 'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe';
const baseURL = process.env.TEST_URL || 'http://127.0.0.1:5173';
await fixtures();
const browser = await chromium.launch({ executablePath: browserPath, headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1100 }, reducedMotion: 'reduce' });
let page = await context.newPage();
const errors = [], checks = [], metrics = {};
const record = name => { checks.push(name); console.log(`PASS ${name}`); };
const attach = p => { p.on('pageerror', e => errors.push(e.message)); };
attach(page);
async function eventually(check, timeout = 120000) {
  const start = performance.now();
  while (performance.now() - start < timeout) {
    const result = await check(); if (result) return result;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Timed out waiting for browser state');
}
async function waitLibrary() { await page.locator('#upload-card').waitFor(); }
async function books() {
  return page.evaluate(async () => {
    const { listBooks } = await import('/src/db.js'); return listBooks();
  });
}
async function bookText(id) {
  return page.evaluate(async id => {
    const { dbPromise } = await import('/src/db.js');
    return (await (await dbPromise).getAllFromIndex('chunks', 'book', id)).map(c => c.text).join('');
  }, id);
}
async function progress(id) {
  return page.evaluate(async id => (await import('/src/db.js')).loadProgress(id), id);
}
async function importBook(name, title) {
  await page.locator('#file-input').setInputFiles(path.join(output, name));
  await eventually(async () => (await books()).some(b => b.title === title));
  await page.locator('#import-panel').waitFor({ state: 'hidden' });
  const found = (await books()).find(b => b.title === title);
  assert.ok(found, `Expected ${title}; available: ${JSON.stringify(await books())}; toast: ${await page.locator('#toast').textContent()}`);
  return found;
}
async function type(value) {
  for (const char of value) {
    if (char === '\n') await page.locator('#typing-input').press('Enter');
    else await page.keyboard.insertText(char);
  }
}

try {
  await page.goto(baseURL); await waitLibrary();
  await page.screenshot({ path: path.join(output, 'library-desktop.png'), fullPage: true });
  assert.equal((await books()).length, 1); record('fresh library with usable Ukrainian demo');
  await page.locator('#continue-book').click();
  await page.locator('#focus-prompt').click();
  const demoId = 'booktyper-welcome-v1';
  await type('Кожна велика ');
  assert.equal((await progress(demoId)).position, 'Кожна велика '.length);
  await type('X');
  assert.equal((await progress(demoId)).position, 'Кожна велика '.length);
  assert.equal(await page.locator('.mistake').count(), 1);
  await page.locator('#typing-input').press('Backspace');
  assert.equal(await page.locator('.mistake').count(), 0);
  await type('історія');
  await page.screenshot({ path: path.join(output, 'reader-desktop.png'), fullPage: true });
  await page.reload(); await waitLibrary();
  await page.locator('#continue-book').click();
  assert.equal((await progress(demoId)).position, 'Кожна велика історія'.length);
  await page.locator('#focus-prompt').click();
  await page.locator('#typing-input').press('Control+Backspace');
  assert.equal((await progress(demoId)).position, 'Кожна велика '.length);
  record('real Unicode typing, strict mistakes, word backspace, reload persistence');

  await page.locator('#back-library').click();
  const fb2 = await importBook('small.fb2', 'Тест української книги');
  const fb2text = await bookText(fb2.id);
  assert.ok(fb2text.startsWith('Перший розділ\nПривіт, світе!'));
  assert.ok(fb2text.includes('📖')); assert.ok(!fb2text.includes('QUJD'));
  assert.equal(fb2.author, 'Леся Українка'); assert.equal(fb2.chapters.length, 2);
  record('FB2 metadata, paragraphs, Cyrillic, emoji, binary-cover exclusion');
  const epub = await importBook('small.epub', 'EPUB: правильний порядок');
  assert.equal(await bookText(epub.id), 'Перший\nЦе перший розділ & текст.\nДругий\nЦе другий розділ.');
  assert.equal(epub.author, 'Автор EPUB'); record('compressed EPUB, OPF spine order, percent-encoded paths, skipped assets');
  const cp = await importBook('cp1251.fb2', 'CP1251');
  assert.equal(await bookText(cp.id), 'Привіт');
  const utf16 = await importBook('utf16.fb2', 'utf16');
  assert.equal(await bookText(utf16.id), 'Вітаю в книзі.');
  record('Windows-1251 and UTF-16 FB2 encodings');
  await page.locator('#file-input').setInputFiles(path.join(output, 'bad.fb2'));
  await page.locator('#import-panel').waitFor({ state: 'hidden' });
  assert.ok((await page.locator('#toast').textContent()).includes('FictionBook'));
  const dangling = await page.evaluate(async () => {
    const { dbPromise } = await import('/src/db.js'); return (await (await dbPromise).getAll('books')).filter(b => b.status !== 'ready');
  });
  assert.equal(dangling.length, 0); record('invalid input reports failure and removes partial import');

  await page.locator(`[data-open="${fb2.id}"]`).click(); await page.locator('#chapters').click();
  await page.locator('[data-chapter]').last().click();
  assert.equal((await progress(fb2.id)).position, fb2.chapters[1].start);
  await page.locator('#typing-input').focus();
  await type(fb2text.slice(fb2.chapters[1].start));
  await page.locator('#completion').waitFor({ state: 'visible' });
  assert.equal((await progress(fb2.id)).position, fb2.totalChars);
  await page.locator('#chapters').click(); await page.locator('#start-again').click();
  assert.equal((await progress(fb2.id)).position, 0);
  record('chapter navigation, completion and restart');
  await page.locator('#reader-settings').click();
  await page.locator('#font-size').selectOption('28');
  await page.locator('#strict').uncheck();
  await page.locator('.dialog-close').click();
  await page.locator('#typing-input').focus();
  await type('X'); assert.equal((await progress(fb2.id)).position, 1);
  assert.equal(await page.locator('.wrong').count(), 1);
  await page.locator('#back-library').click();
  await page.locator('#theme').click();
  await page.reload(); await waitLibrary();
  assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark');
  await page.locator('#theme').click();
  record('relaxed error mode, appearance settings persistence and theme');

  // Main-thread rAF and input latency during a 100 MiB, multi-million-character import.
  const largePath = await largeFixture(100);
  metrics.largeFileBytes = (await fs.stat(largePath)).size;
  await page.evaluate(() => {
    window.__perf = { frames: [], last: performance.now(), running: true, longTasks: [] };
    const tick = t => { if (!window.__perf.running) return; window.__perf.frames.push(t - window.__perf.last); window.__perf.last = t; requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
    window.__observer = new PerformanceObserver(list => window.__perf.longTasks.push(...list.getEntries().map(e => e.duration)));
    window.__observer.observe({ type: 'longtask', buffered: false });
  });
  await page.locator(`[data-open="${demoId}"]`).click(); await page.locator('#focus-prompt').click();
  await page.locator('#reader-settings').click(); await page.locator('#strict').check(); await page.locator('#font-size').selectOption('25'); await page.locator('.dialog-close').click();
  const beforePosition = (await progress(demoId)).position;
  const demoText = await bookText(demoId);
  const start = performance.now();
  await page.locator('#file-input').setInputFiles(largePath);
  await type(demoText.slice(beforePosition, beforePosition + 30));
  assert.equal((await progress(demoId)).position, beforePosition + 30);
  await eventually(async () => (await books()).some(b => b.title === 'Велика книга 100 МБ'), 180000);
  metrics.largeImportWallMs = Math.round(performance.now() - start);
  metrics.responsiveness = await page.evaluate(() => {
    window.__perf.running = false; window.__observer.disconnect();
    const frames = window.__perf.frames.slice(1).sort((a, b) => a - b);
    return { frameCount: frames.length, p95FrameMs: frames[Math.floor(frames.length * .95)], maxFrameMs: frames.at(-1), longTaskCount: window.__perf.longTasks.length, maxLongTaskMs: Math.max(0, ...window.__perf.longTasks), mainJSHeapBytes: performance.memory?.usedJSHeapSize };
  });
  const large = (await books()).find(b => b.title === 'Велика книга 100 МБ');
  metrics.largeBook = { totalChars: large.totalChars, chunkCount: large.chunkCount, workerImportMs: large.importMs };
  assert.ok(large.totalChars > 40000000); assert.ok(metrics.responsiveness.p95FrameMs < 100);
  record('100 MiB FB2 imports while genuine keyboard input continues');
  await page.locator('#back-library').click();
  const openStart = performance.now(); await page.locator(`[data-open="${large.id}"]`).click();
  await page.locator('#text-window .caret').waitFor();
  metrics.largeBookOpenMs = Math.round(performance.now() - openStart);
  assert.ok(await page.locator('#text-window > span').count() <= 1200);
  await page.locator('#focus-prompt').click();
  const latency = await page.evaluate(async () => {
    const samples = [];
    for (let i = 0; i < 100; i++) {
      const node = document.querySelector('.caret');
      if (!node) break;
      const char = node.textContent === '↵\n' ? '\n' : node.textContent;
      const start = performance.now();
      document.querySelector('#typing-input').dispatchEvent(new InputEvent('beforeinput', { inputType: 'insertText', data: char, bubbles: true, cancelable: true }));
      await new Promise(requestAnimationFrame); samples.push(performance.now() - start);
    }
    samples.sort((a, b) => a - b); return { samples: samples.length, p95EventToFrameMs: samples[Math.floor(samples.length * .95)], maxMs: samples.at(-1) };
  });
  metrics.largeTyping = latency;
  const largePosition = (await progress(large.id)).position;
  // Closing the page immediately exercises the synchronous local progress journal.
  await page.close(); page = await context.newPage(); attach(page);
  await page.goto(baseURL); await waitLibrary();
  await page.locator(`[data-open="${large.id}"]`).click();
  assert.equal((await progress(large.id)).position, largePosition);
  record('bounded character DOM, fast reopen, immediate page-close progress recovery');

  // A single oversized XHTML paragraph must remain bounded as well.
  await page.locator('#focus-prompt').click();
  const currentChunkText = await page.evaluate(async id => (await (await import('/src/db.js')).getChunk(id, 0)).text, large.id);
  const queuedStart = (await progress(large.id)).position;
  await page.evaluate(value => document.querySelector('#typing-input').dispatchEvent(new InputEvent('beforeinput', { inputType: 'insertText', data: value, bubbles: true, cancelable: true })), currentChunkText.slice(queuedStart));
  await eventually(async () => (await progress(large.id)).position === currentChunkText.length);
  assert.ok(await page.locator('#text-window > span').count() <= 1200);
  await page.locator('#typing-input').press('Backspace');
  await eventually(async () => (await progress(large.id)).position === currentChunkText.length - 1);
  record('chunk transition and backspace across a stored fragment boundary');

  const giantEpub = await largeEpubFixture(64);
  const epubStart = performance.now();
  await page.locator('#file-input').setInputFiles(giantEpub.path);
  await eventually(async () => (await books()).some(b => b.title === 'Великий EPUB 64 МБ'), 180000);
  const giantEpubBook = (await books()).find(b => b.title === 'Великий EPUB 64 МБ');
  metrics.largeEpub = { archiveBytes: (await fs.stat(giantEpub.path)).size, uncompressedTextBytes: giantEpub.uncompressedTextBytes, totalChars: giantEpubBook.totalChars, chunks: giantEpubBook.chunkCount, wallMs: Math.round(performance.now() - epubStart), workerImportMs: giantEpubBook.importMs };
  assert.ok(giantEpubBook.totalChars > 30000000);
  record('64 MiB EPUB single-paragraph chapter imports without full expansion on main thread');

  await page.locator('#back-library').click();
  await page.locator('#file-input').setInputFiles(largePath);
  await page.locator('#import-panel').waitFor({ state: 'visible' });
  await page.locator('#cancel-import').click();
  await page.locator('#import-panel').waitFor({ state: 'hidden' });
  const importingBooks = await page.evaluate(async () => {
    const { dbPromise } = await import('/src/db.js'); return (await (await dbPromise).getAll('books')).filter(b => b.status === 'importing');
  });
  assert.equal(importingBooks.length, 0); record('large import cancellation cleans up partial records');
  await page.locator('#file-input').setInputFiles(largePath);
  await page.waitForFunction(() => document.querySelector('#import-progress').value > 0);
  await page.reload(); await waitLibrary();
  assert.equal(await page.evaluate(async () => (await (await (await import('/src/db.js')).dbPromise).getAll('books')).filter(b => b.status === 'importing').length), 0);
  record('interrupted import is reclaimed on reload using browser Web Locks');

  await page.locator('[data-view="settings"]').click();
  const downloadPromise = page.waitForEvent('download'); await page.locator('#export-progress').click();
  const download = await downloadPromise; const backupPath = path.join(output, 'progress-backup.json'); await download.saveAs(backupPath);
  const backup = JSON.parse(await fs.readFile(backupPath, 'utf8'));
  assert.equal(backup.app, 'BookTyper'); assert.ok(backup.books.length > 4);
  await page.locator('#backup-input').setInputFiles(backupPath); await page.locator('#restore-confirm').click();
  await page.locator('#dialog').waitFor({ state: 'hidden' });
  record('export and restore of local progress backup');
  await page.locator('[data-view="library"]').click();
  await page.locator('#search').fill('EPUB:'); assert.equal(await page.locator('.book-card').count(), 1);
  await page.locator('#search').fill('');
  await page.locator(`[data-delete="${cp.id}"]`).click(); await page.locator('#delete-confirm').click();
  await page.locator('#dialog').waitFor({ state: 'hidden' }); assert.ok(!(await books()).some(b => b.id === cp.id));
  record('library search and confirmed deletion');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: path.join(output, 'library-mobile.png'), fullPage: true });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
  await page.locator(`[data-open="${large.id}"]`).click();
  await page.screenshot({ path: path.join(output, 'reader-mobile.png'), fullPage: true });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
  record('mobile library and reader layout without horizontal overflow');
  assert.deepEqual(errors, []);
  const report = { testedAt: new Date().toISOString(), browser: await browser.version(), checks, metrics, errors, limits: 'Synthetic files on this computer. Main-thread heap and frame timing only; peak process-family RAM, CPU, mobile hardware and arbitrary real-world books not measured.' };
  await fs.writeFile(path.join(output, 'browser-report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  await page.screenshot({ path: path.join(output, 'failure.png'), fullPage: true }).catch(() => {});
  console.error('BROWSER ERRORS', errors);
  throw error;
} finally { await browser.close(); }

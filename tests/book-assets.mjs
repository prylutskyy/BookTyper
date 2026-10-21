import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
import { ZipWriter, Uint8ArrayWriter, Uint8ArrayReader, TextReader, configure } from '@zip.js/zip.js';

configure({ useWebWorkers: false });
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jB9kAAAAASUVORK5CYII=', 'base64');
const baseURL = process.env.TEST_URL || 'http://127.0.0.1:5173/';
const browser = await chromium.launch({ executablePath: process.env.BROWSER_PATH || (process.platform === 'win32' ? 'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe' : chromium.executablePath()), headless: true });
const page = await browser.newPage({ viewport: { width: 1920, height: 1000 }, reducedMotion: 'reduce' });
const errors = []; page.on('pageerror', error => errors.push(error.message));
async function epub(version, coverPage = false) {
  const zip = new ZipWriter(new Uint8ArrayWriter());
  const add = (name, text) => zip.add(name, new TextReader(text));
  await add('META-INF/container.xml', '<container><rootfiles><rootfile full-path="OPS/content.opf"/></rootfiles></container>');
  await add('OPS/content.opf', `<package><metadata><dc:title>Обкладинка EPUB ${version}${coverPage ? ' SVG' : ''}</dc:title>${version === 2 && !coverPage ? '<meta name="cover" content="cover"/>' : ''}</metadata><manifest><item id="cover" href="images/front.png" media-type="image/png" ${version === 3 ? 'properties="cover-image"' : ''}/><item id="page" href="cover.xhtml" media-type="application/xhtml+xml"/><item id="title" href="title.xhtml"/><item id="one" href="one.xhtml"/><item id="two" href="two.xhtml"/>${version === 2 ? '<item id="toc" href="toc.ncx" media-type="application/x-dtbncx+xml"/>' : '<item id="toc" href="nav.xhtml" properties="nav"/>'}</manifest><spine toc="toc"><itemref idref="page"/><itemref idref="title"/><itemref idref="one"/><itemref idref="two"/></spine>${coverPage ? '<guide><reference type="cover" href="cover.xhtml"/></guide>' : ''}</package>`);
  await zip.add('OPS/images/front.png', new Uint8ArrayReader(png));
  await add('OPS/cover.xhtml', '<html><body><svg><image xlink:href="images/front.png"/></svg></body></html>');
  await add('OPS/title.xhtml', '<html><body><p>Титульна сторінка</p></body></html>');
  await add('OPS/one.xhtml', '<html><body><p id="first">РОЗДІЛ 1</p><p>Перший розділ доступний від початку.</p></body></html>');
  await add('OPS/two.xhtml', '<html><body><p id="second">РОЗДІЛ 2</p><p>Другий розділ.</p></body></html>');
  await add('OPS/toc.ncx', '<ncx><navMap><navPoint><navLabel><text>РОЗДІЛ 1</text></navLabel><content src="one.xhtml#first"/></navPoint><navPoint><navLabel><text>РОЗДІЛ 2</text></navLabel><content src="two.xhtml#second"/></navPoint></navMap></ncx>');
  await add('OPS/nav.xhtml', '<html><body><nav epub:type="toc"><a href="one.xhtml#first">РОЗДІЛ 1</a><a href="two.xhtml#second">РОЗДІЛ 2</a></nav></body></html>');
  return { name: `assets-${version}-${coverPage}.epub`, mimeType: 'application/epub+zip', buffer: Buffer.from(await zip.close()) };
}
async function importBook(file, title) {
  await page.locator('#file-input').setInputFiles(file);
  await page.locator('#import-panel').waitFor({ state: 'hidden' });
  const card = page.locator('.book-card').filter({ hasText: title });
  await card.waitFor();
  await page.waitForFunction(title => {
    const card = [...document.querySelectorAll('.book-card')].find(el => el.querySelector('.book-info h3').textContent === title);
    const img = card?.querySelector('.cover-image'); return img?.complete && img.naturalWidth > 0;
  }, title);
  return card;
}
async function checkChapters(card, expected = 2) {
  await card.locator('[data-open]').click(); await page.locator('#text-window .caret').waitFor(); await page.locator('#chapters').click();
  assert.equal(await page.locator('[data-chapter]').count(), expected);
  assert.ok((await page.locator('[data-chapter]').first().textContent()).includes('РОЗДІЛ 1'));
  await page.locator('[data-chapter]').first().click();
  await page.waitForFunction(() => document.querySelector('#chapter-title').textContent === 'РОЗДІЛ 1');
  assert.ok((await page.locator('#text-window').textContent()).includes('РОЗДІЛ 1'));
  await page.locator('#back-library').click();
}
try {
  await page.goto(baseURL); await page.locator('#upload-card').waitFor();
  for (const [version, guide] of [[2, false], [3, false], [2, true]]) {
    const title = `Обкладинка EPUB ${version}${guide ? ' SVG' : ''}`;
    await checkChapters(await importBook(await epub(version, guide), title));
  }
  console.log('PASS EPUB 2/3 covers, SVG cover page, NCX/nav titles and empty-cover handling');
  const fb2 = `<FictionBook><description><title-info><book-title>Обкладинка FB2</book-title><coverpage><image l:href="#front"/></coverpage></title-info></description><body><p>Текст книги.</p></body><binary id="front" content-type="image/png">${png.toString('base64')}</binary></FictionBook>`;
  await importBook({ name: 'cover.fb2', mimeType: 'application/xml', buffer: Buffer.from(fb2) }, 'Обкладинка FB2');
  await page.reload(); await page.locator('.cover-image').first().waitFor();
  await page.waitForFunction(() => [...document.querySelectorAll('.cover-image')].every(img => img.complete && img.naturalWidth > 0));
  console.log('PASS FB2 embedded cover and cover persistence after reload');
  const card = page.locator('.book-card').filter({ hasText: 'Обкладинка FB2' });
  await card.locator('[data-open]').click(); await page.locator('#text-window .caret').waitFor();
  await page.locator('#zen').click();
  for (const width of [1440, 1920, 2560, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    const delta = await page.locator('.typing-area').evaluate(el => { const rect = el.getBoundingClientRect(); return Math.abs(rect.x + rect.width / 2 - innerWidth / 2); });
    assert.ok(delta < 1, `Focus mode must be centered at width ${width}; offset ${delta}`);
  }
  await page.locator('#zen').click(); await page.locator('#back-library').click();
  console.log('PASS centered focus layout on desktop, ultrawide and mobile');
  const original = page.locator('.book-card').filter({ hasText: 'Обкладинка FB2' });
  const originalId = await original.locator('[data-open]').getAttribute('data-open');
  await original.locator('[data-open]').click(); await page.locator('#text-window .caret').waitFor();
  await page.locator('#reader-settings').click(); await page.locator('#strict').uncheck(); await page.locator('.dialog-close').click(); await page.locator('#typing-input').focus();
  await page.keyboard.insertText('X'); await page.locator('#back-library').click();
  // Model a book imported before cover/TOC extraction was supported.
  await page.evaluate(async id => {
    const db = await new Promise((resolve, reject) => { const request = indexedDB.open('booktyper'); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    await new Promise((resolve, reject) => {
      const tx = db.transaction('books', 'readwrite'); const store = tx.objectStore('books'); const request = store.get(id);
      request.onsuccess = () => store.put({ ...request.result, coverBlob: null, chapters: [{ title: 'Розділ 2', start: 0 }] });
      tx.oncomplete = resolve; tx.onerror = () => reject(tx.error);
    }); db.close();
  }, originalId);
  await page.reload(); await page.locator('#upload-card').waitFor();
  const beforeCount = await page.locator('.book-card').count();
  const refreshed = await importBook({ name: 'cover.fb2', mimeType: 'application/xml', buffer: Buffer.from(fb2) }, 'Обкладинка FB2');
  assert.equal(await page.locator('.book-card').count(), beforeCount);
  assert.equal(await refreshed.locator('[data-open]').getAttribute('data-open'), originalId);
  await refreshed.locator('[data-open]').click(); await page.locator('#text-window .caret').waitFor();
  assert.equal(await page.locator('.wrong').count(), 1);
  assert.ok((await page.locator('#position-label').textContent()).startsWith('1 /'));
  await page.locator('#back-library').click();
  const changed = fb2.replace('Текст книги.', 'Рядок книги.');
  assert.equal(Buffer.byteLength(changed), Buffer.byteLength(fb2));
  await page.locator('#file-input').setInputFiles({ name: 'cover.fb2', mimeType: 'application/xml', buffer: Buffer.from(changed) });
  await page.locator('#import-panel').waitFor({ state: 'hidden' });
  assert.equal(await page.locator('.book-card').count(), beforeCount + 1);
  console.log('PASS reimport refreshes existing metadata without losing progress/errors; changed text stays separate');
  if (process.env.TEST_BOOK_PATH) {
    await page.setViewportSize({ width: 1440, height: 1000 });
    const real = await importBook(process.env.TEST_BOOK_PATH, 'Марсіянин'); await checkChapters(real, 26);
    console.log('PASS supplied marsiyanin.epub: original cover and all 26 named chapters, including chapter 1');
  }
  assert.deepEqual(errors, []);
} finally { await browser.close(); }

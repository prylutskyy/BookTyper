import test from 'node:test';
import assert from 'node:assert/strict';
import { ChunkBuilder, CHUNK_SIZE, equivalent, chapterAt } from '../src/text.js';
import { createExtractor, parseMetadata, parseNavigation, imageReferences, resolveArchivePath, resolveArchiveLocation, detectEncoding } from '../src/extract.js';

function extract(xml, format = 'fb2', stride = 17) {
  const chunks = [], metadata = { title: '', authorParts: [] };
  const builder = new ChunkBuilder('fixture', chunk => chunks.push(chunk));
  const parser = createExtractor(builder, { format, metadata });
  for (let i = 0; i < xml.length; i += stride) parser.write(xml.slice(i, i + stride));
  parser.end(); const result = builder.finish();
  return { text: chunks.map(c => c.text).join(''), chunks, metadata, ...result };
}

test('FB2: metadata, namespaces, entities, inline markup, notes and binary exclusion', () => {
  const xml = `<?xml version="1.0"?><fb:FictionBook xmlns:fb="urn:fb"><fb:description><fb:title-info><fb:book-title>Книга &amp; світ</fb:book-title><fb:author><fb:first-name>Іван</fb:first-name><fb:last-name>Франко</fb:last-name></fb:author></fb:title-info></fb:description><fb:body><fb:section><fb:title><fb:p>Розділ 1</fb:p></fb:title><fb:p>Ось <fb:emphasis>наша</fb:emphasis> книга &#x1F4D6; &amp; текст.</fb:p><fb:p><![CDATA[Літери <та> слова.]]></fb:p></fb:section></fb:body><fb:body name="notes"><fb:p>SKIP NOTE</fb:p></fb:body><fb:binary>ABCDEF==</fb:binary></fb:FictionBook>`;
  const result = extract(xml);
  assert.equal(result.metadata.title, 'Книга & світ');
  assert.deepEqual(result.metadata.authorParts, ['Іван', 'Франко']);
  assert.equal(result.text, 'Розділ 1\nОсь наша книга 📖 & текст.\nЛітери <та> слова.');
  assert.deepEqual(result.chapters, [{ title: 'Розділ 1', start: 0 }]);
});
test('a giant paragraph retains bounded buffers and preserves every code point', () => {
  const chunks = [], b = new ChunkBuilder('large', c => chunks.push(c));
  const piece = 'Довга книга 📖 — наступне слово. '.repeat(1000);
  for (let i = 0; i < 1000; i++) {
    b.text(piece); assert.ok(b.buffer.length <= CHUNK_SIZE * 2);
  }
  const result = b.finish();
  assert.ok(chunks.every(c => c.text.length <= CHUNK_SIZE));
  assert.ok(chunks.every(c => !/^[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/.test(c.text)));
  assert.equal(result.totalChars, piece.length * 1000 - 1);
  for (let i = 1; i < chunks.length; i++) assert.equal(chunks[i].start, chunks[i - 1].start + chunks[i - 1].text.length);
});
test('EPUB extraction handles XHTML head, scripts and headings without executing markup', () => {
  const result = extract('<html><head><title>Not body</title><style>skip</style></head><body><h1>Початок</h1><p>Наш &amp; ваш <b>світ</b>.</p><script>alert(1)</script><p>Другий.</p></body></html>', 'epub');
  assert.equal(result.text, 'Початок\nНаш & ваш світ.\nДругий.');
  assert.equal(result.chapters[0].start, 0);
});
test('OPF spine order, creators, URL paths and encoding discovery', () => {
  const opf = parseMetadata('<package><metadata><dc:title>Назва</dc:title><dc:creator>Автор</dc:creator></metadata><manifest><item id="two" href="text/ch%202.xhtml"/><item id="one" href="text/ch1.xhtml"/></manifest><spine><itemref idref="one"/><itemref idref="two"/><itemref idref="notes" linear="no"/></spine></package>');
  assert.equal(opf.title, 'Назва'); assert.equal(opf.author, 'Автор');
  assert.deepEqual(opf.spine, ['one', 'two']);
  assert.equal(resolveArchivePath('OPS/package.opf', opf.manifest.get('two').href), 'OPS/text/ch 2.xhtml');
  assert.throws(() => resolveArchivePath('OPS/package.opf', 'https://other.test/ch.xhtml'));
  assert.equal(detectEncoding(new TextEncoder().encode('<?xml version="1.0" encoding="windows-1251"?>')), 'windows-1251');
  assert.equal(detectEncoding(new Uint8Array([255, 254, 60, 0])), 'utf-16le');
});
test('punctuation aliases are opt-in, and chapter lookup respects exact boundaries', () => {
  assert.equal(equivalent("'", '’', true), true); assert.equal(equivalent("'", '’', false), false);
  assert.equal(equivalent('-', '—', true), true); assert.equal(equivalent('a', 'A', true), false);
  for (const quote of ['«', '»', '“', '”', '„']) {
    assert.equal(equivalent('"', quote, true), true);
    assert.equal(equivalent('"', quote, false), false);
  }
  const chapters = [{ start: 0 }, { start: 100 }, { start: 300 }];
  assert.equal(chapterAt(chapters, 100), 1); assert.equal(chapterAt(chapters, 299), 1); assert.equal(chapterAt(chapters, 300), 2);
});
test('NFC is normalized across producer chunks and soft hyphens do not invent spaces', () => {
  const chunks = [], b = new ChunkBuilder('unicode', c => chunks.push(c));
  b.text('Cafe'); b.text('\u0301 co\u00adoperate zero\u200bwidth'); b.finish();
  assert.equal(chunks.map(c => c.text).join(''), 'Café cooperate zerowidth');
});

test('EPUB navigation supplies titles for paragraph anchors, including several in one document', () => {
  const ncx = '<ncx><navMap><navPoint><navLabel><text>Частина</text></navLabel><content src="part.xhtml"/><navPoint><navLabel><text>РОЗДІЛ 1</text></navLabel><content src="part.xhtml#one"/></navPoint></navPoint><navPoint><navLabel><text>РОЗДІЛ 2</text></navLabel><content src="part.xhtml#two"/></navPoint></navMap></ncx>';
  assert.deepEqual(parseNavigation(ncx, 'ncx').map(e => e.title), ['Частина', 'РОЗДІЛ 1', 'РОЗДІЛ 2']);
  const nav = '<html><body><nav epub:type="landmarks"><a href="cover.xhtml">Cover</a></nav><nav epub:type="toc"><ol><li><a href="part.xhtml#one">Розділ <span>1</span></a></li><li><a href="part.xhtml#two">Розділ 2</a></li></ol></nav></body></html>';
  const links = parseNavigation(nav, 'nav'); assert.equal(links.length, 2);
  const chunks = [], builder = new ChunkBuilder('toc', chunk => chunks.push(chunk));
  const parser = createExtractor(builder, { format: 'epub', metadata: {}, inferChapters: false, chapterTargets: links.map(link => ({ title: link.title, ...resolveArchiveLocation('OPS/nav.xhtml', link.href) })) });
  parser.write('<html><body><p id="one">Розділ 1</p><p>Перший текст.</p><p id="two">Розділ 2</p><p>Другий текст.</p></body></html>'); parser.end();
  const result = builder.finish(), text = chunks.map(c => c.text).join('');
  assert.equal(result.chapters[0].title, 'Розділ 1');
  assert.equal(result.chapters[1].start, text.indexOf('Розділ 2'));
});
test('EPUB cover declarations, SVG cover-page references and selected FB2 base64 image', async () => {
  const opf = parseMetadata('<package><metadata><meta name="cover" content="front"/></metadata><manifest><item id="front" href="img/front.png" properties="cover-image"/></manifest><spine toc="ncx"/><guide><reference type="cover" href="cover.xhtml"/></guide></package>');
  assert.equal(opf.coverId, 'front'); assert.equal(opf.guideCover, 'cover.xhtml'); assert.equal(opf.spineToc, 'ncx');
  assert.deepEqual(imageReferences('<svg><image xlink:href="images/front.png"/></svg><img src="other.png"/>'), ['images/front.png', 'other.png']);
  const xml = '<FictionBook><description><title-info><coverpage><image l:href="#front"/></coverpage></title-info></description><body><p>Текст.</p></body><binary id="other" content-type="image/png">T1RIRVI=</binary><binary id="front" content-type="image/jpeg"> Q09W RVItREFUQQ== </binary></FictionBook>';
  const result = extract(xml, 'fb2', 3);
  assert.equal(result.text, 'Текст.'); assert.equal(result.metadata.coverBlob.type, 'image/jpeg');
  assert.equal(await result.metadata.coverBlob.text(), 'COVER-DATA');
});

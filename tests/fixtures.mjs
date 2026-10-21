import fs from 'node:fs/promises';
import path from 'node:path';
import { ZipWriter, Uint8ArrayWriter, TextReader, configure } from '@zip.js/zip.js';
configure({ useWebWorkers: false });

export const output = path.resolve('test-results');
export async function fixtures() {
  await fs.mkdir(output, { recursive: true });
  const fb2 = `<?xml version="1.0" encoding="UTF-8"?><FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0"><description><title-info><book-title>Тест української книги</book-title><author><first-name>Леся</first-name><last-name>Українка</last-name></author></title-info></description><body><section><title><p>Перший розділ</p></title><p>Привіт, світе! Це наша книга 📖.</p><p>Апостроф ’ та довге тире — працюють.</p></section><section><title><p>Другий розділ</p></title><p>Останній рядок.</p></section></body><binary id="cover">${'QUJD'.repeat(20000)}</binary></FictionBook>`;
  await fs.writeFile(path.join(output, 'small.fb2'), fb2);
  await fs.writeFile(path.join(output, 'bad.fb2'), 'Not a book <script>alert(1)</script>');
  const cp = Buffer.from('<?xml version="1.0" encoding="windows-1251"?><FictionBook><description><title-info><book-title>CP1251</book-title></title-info></description><body><p>', 'ascii');
  await fs.writeFile(path.join(output, 'cp1251.fb2'), Buffer.concat([cp, Buffer.from([0xcf, 0xf0, 0xe8, 0xe2, 0xb3, 0xf2]), Buffer.from('</p></body></FictionBook>')]));
  await fs.writeFile(path.join(output, 'utf16.fb2'), Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('<?xml version="1.0" encoding="UTF-16"?><FictionBook><body><p>Вітаю в книзі.</p></body></FictionBook>', 'utf16le')]));
  const zip = new ZipWriter(new Uint8ArrayWriter());
  await zip.add('mimetype', new TextReader('application/epub+zip'), { level: 0 });
  await zip.add('META-INF/container.xml', new TextReader('<?xml version="1.0"?><container><rootfiles><rootfile full-path="OPS/content.opf"/></rootfiles></container>'));
  await zip.add('OPS/content.opf', new TextReader('<package><metadata><dc:title>EPUB: правильний порядок</dc:title><dc:creator>Автор EPUB</dc:creator></metadata><manifest><item id="c2" href="text/ch%202.xhtml" media-type="application/xhtml+xml"/><item id="c1" href="text/ch1.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="c1"/><itemref idref="c2"/></spine></package>'));
  await zip.add('OPS/text/ch 2.xhtml', new TextReader('<html><body><h1>Другий</h1><p>Це другий розділ.</p></body></html>'));
  await zip.add('OPS/text/ch1.xhtml', new TextReader('<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Invisible</title></head><body><h1>Перший</h1><p>Це перший розділ &amp; текст.</p></body></html>'));
  await zip.add('OPS/cover.bin', new TextReader('skip image data'.repeat(100000)));
  await fs.writeFile(path.join(output, 'small.epub'), await zip.close());
  return output;
}

export async function largeFixture(megabytes = 100) {
  const name = path.join(output, `large-${megabytes}mb.fb2`);
  const handle = await fs.open(name, 'w');
  await handle.write('<?xml version="1.0" encoding="UTF-8"?><FictionBook><description><title-info><book-title>Велика книга 100 МБ</book-title></title-info></description><body><section><title><p>Великий розділ</p></title>');
  const unit = '<p>Це дуже велика книга для перевірки плавності набору, швидкості імпорту та відновлення прогресу. Українська мова, пунктуація й символи 📖 мають зберегтися.</p>\n';
  const block = unit.repeat(3000), bytes = Buffer.byteLength(block);
  for (let n = 0; n < megabytes * 1024 * 1024; n += bytes) await handle.write(block);
  await handle.write('</section></body><binary>' + 'QUJD'.repeat(2 * 1024 * 1024) + '</binary></FictionBook>');
  await handle.close(); return name;
}

export async function largeEpubFixture(megabytes = 64) {
  const name = path.join(output, 'large-single-chapter.epub');
  const zip = new ZipWriter(new Uint8ArrayWriter());
  await zip.add('mimetype', new TextReader('application/epub+zip'), { level: 0 });
  await zip.add('META-INF/container.xml', new TextReader('<container><rootfiles><rootfile full-path="content.opf"/></rootfiles></container>'));
  await zip.add('content.opf', new TextReader('<package><metadata><dc:title>Великий EPUB 64 МБ</dc:title></metadata><manifest><item id="c" href="chapter.xhtml"/></manifest><spine><itemref idref="c"/></spine></package>'));
  const encoder = new TextEncoder();
  const block = encoder.encode('Довгий текст без поділу на абзаци. Українські літери 📖 й пунктуація. '.repeat(9000));
  let sent = 0, phase = 0;
  const stream = new ReadableStream({
    pull(controller) {
      if (phase === 0) { controller.enqueue(encoder.encode('<html><body><h1>Один величезний розділ</h1><p>')); phase++; }
      else if (sent < megabytes * 1024 * 1024) { controller.enqueue(block); sent += block.length; }
      else { controller.enqueue(encoder.encode('</p></body></html>')); controller.close(); }
    },
  });
  await zip.add('chapter.xhtml', stream);
  await fs.writeFile(name, await zip.close());
  return { path: name, uncompressedTextBytes: sent };
}

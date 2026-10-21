import { ZipReader, BlobReader, TextWriter, BlobWriter, configure } from '@zip.js/zip.js';
import { ChunkBuilder } from './text.js';
import { createExtractor, detectEncoding, parseMetadata, parseNavigation, imageReferences, resolveArchiveLocation, resolveArchivePath } from './extract.js';
import { putBook, putChunks, deleteBook, reuseBookMetadata } from './db.js';

configure({ useWebWorkers: false, chunkSize: 64 * 1024 });
let cancelled = false;
self.onmessage = ({ data }) => {
  if (data.type === 'cancel') { cancelled = true; return; }
  if (data.type !== 'import') return;
  const run = () => importFile(data);
  const job = navigator.locks ? navigator.locks.request(`bt-import:${data.id}`, run) : run();
  job.catch(error => self.postMessage({ type: 'error', message: error.message }));
};
async function importFile(data) {
  cancelled = false;
  const { file, id } = data;
  const started = performance.now();
  let pending = [], lastReport = 0, processed = 0;
  const metadata = { title: file.name.replace(/\.(fb2|epub)$/i, ''), author: '', authorParts: [] };
  const writer = new ChunkBuilder(id, chunk => pending.push(chunk));
  const flush = async (percent, phase = 'Обробляємо текст') => {
    if (cancelled) throw new Error('Імпорт скасовано.');
    const batch = pending; pending = [];
    await putChunks(batch);
    if (performance.now() - lastReport > 100) {
      self.postMessage({ type: 'progress', percent, chars: writer.position, phase });
      lastReport = performance.now();
    }
  };
  const stream = async (readable, parser, percent) => {
    const reader = readable.getReader();
    let decoder;
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        decoder ||= new TextDecoder(detectEncoding(value), { fatal: true });
        // Slice even a producer's oversized chunk so parsing/transaction batches stay bounded.
        for (let i = 0; i < value.length; i += 65536) {
          const bytes = value.subarray(i, i + 65536);
          parser.write(decoder.decode(bytes, { stream: true }));
          processed += bytes.length;
          await flush(percent());
        }
      }
      if (decoder) parser.write(decoder.decode());
      parser.end();
    } finally { reader.releaseLock(); }
  };
  let zip;
  try {
    const format = file.name.toLowerCase().split('.').at(-1);
    if (!['fb2', 'epub'].includes(format)) throw new Error('Виберіть книгу у форматі .fb2 або .epub.');
    await putBook({ id, status: 'importing', createdAt: Date.now() });
    if (format === 'fb2') {
      await stream(file.stream(), createExtractor(writer, { format, metadata }), () => Math.min(98, processed / file.size * 98));
      metadata.author = metadata.authorParts.join(' ');
    } else {
      zip = new ZipReader(new BlobReader(file));
      const entries = await zip.getEntries();
      const lookup = new Map(entries.map(entry => [entry.filename, entry]));
      const smallXml = async path => {
        const entry = lookup.get(path);
        if (!entry) throw new Error(`У EPUB немає обов’язкового файла: ${path}`);
        if (entry.uncompressedSize > 16 * 1024 * 1024) throw new Error('Метадані EPUB перевищують 16 МБ.');
        return entry.getData(new TextWriter());
      };
      const container = parseMetadata(await smallXml('META-INF/container.xml'));
      if (!container.rootfile) throw new Error('EPUB не містить посилання на зміст (OPF).');
      const packagePath = resolveArchivePath('', container.rootfile);
      const opf = parseMetadata(await smallXml(packagePath));
      metadata.title = opf.title || metadata.title; metadata.author = opf.author;
      if (!opf.spine.length) throw new Error('EPUB не містить розділів для читання.');
      const manifest = [...opf.manifest.values()];
      const navItem = manifest.find(item => item.properties?.split(/\s+/).includes('nav'));
      const ncxItem = opf.manifest.get(opf.spineToc) || manifest.find(item => item['media-type'] === 'application/x-dtbncx+xml');
      const navigation = new Map();
      for (const item of [navItem, ncxItem].filter(Boolean)) {
        const navPath = resolveArchivePath(packagePath, item.href);
        const links = parseNavigation(await smallXml(navPath), item === navItem ? 'nav' : 'ncx');
        for (const link of links) {
          const target = resolveArchiveLocation(navPath, link.href);
          const targets = navigation.get(target.path) || [];
          if (!targets.some(entry => entry.fragment === target.fragment)) targets.push({ title: link.title, fragment: target.fragment });
          navigation.set(target.path, targets);
        }
        if (navigation.size) break;
      }
      const declaredCover = manifest.find(item => item.properties?.split(/\s+/).includes('cover-image')) || opf.manifest.get(opf.coverId);
      const imageItems = manifest.filter(item => item['media-type']?.startsWith('image/'));
      const coverCandidates = [declaredCover?.href, opf.guideCover, ...imageItems.filter(item => /cover|обкладинка/i.test(item.id + ' ' + item.href)).map(item => item.href), imageItems[0]?.href].filter(Boolean);
      for (const href of new Set(coverCandidates)) {
        try {
          let path = resolveArchivePath(packagePath, href);
          if (!lookup.has(path)) continue;
          if (/\.x?html?$/i.test(path)) {
            const image = imageReferences(await smallXml(path))[0];
            if (!image) continue;
            path = resolveArchivePath(path, image);
          }
          const image = lookup.get(path); if (!image) continue;
          const type = imageItems.find(item => resolveArchivePath(packagePath, item.href) === path)?.['media-type'] || 'image/jpeg';
          metadata.coverBlob = await image.getData(new BlobWriter(type));
          if (metadata.coverBlob.size) break;
        } catch { /* A broken optional cover must not hide readable text. */ }
      }
      const encrypted = lookup.has('META-INF/encryption.xml') ? parseMetadata(await smallXml('META-INF/encryption.xml')).encrypted : [];
      const chapters = opf.spine.map(ref => {
        const item = opf.manifest.get(ref);
        if (!item?.href) throw new Error('Пошкоджений порядок розділів EPUB.');
        const path = resolveArchivePath(packagePath, item.href);
        if (encrypted.some(uri => resolveArchivePath('', uri) === path)) throw new Error('Текст EPUB зашифровано (DRM). Потрібна книга без DRM.');
        const entry = lookup.get(path);
        if (!entry) throw new Error(`Не знайдено розділ: ${path}`);
        return { entry, path };
      });
      const totalBytes = chapters.reduce((sum, { entry }) => sum + entry.uncompressedSize, 0);
      let textDocuments = 0;
      for (let i = 0; i < chapters.length; i++) {
        writer.boundary();
        const start = writer.position, chapterCount = writer.chapters.length;
        const parser = createExtractor(writer, { format, metadata, chapterTargets: navigation.get(chapters[i].path) || [], inferChapters: !navigation.size });
        let decoder;
        // Decompress only spine text, one entry at a time; covers and assets stay compressed.
        await chapters[i].entry.getData(new WritableStream({
          async write(value) {
            decoder ||= new TextDecoder(detectEncoding(value), { fatal: true });
            for (let j = 0; j < value.length; j += 65536) {
              const bytes = value.subarray(j, j + 65536);
              parser.write(decoder.decode(bytes, { stream: true })); processed += bytes.length;
              await flush(Math.min(98, processed / totalBytes * 98));
            }
          },
          close() { if (decoder) parser.write(decoder.decode()); parser.end(); },
        }));
        if (writer.position > start) {
          textDocuments++;
          if (!navigation.size && writer.chapters.length === chapterCount) writer.chapters.push({ title: `Розділ ${textDocuments}`, start });
        }
      }
    }
    const result = writer.finish();
    await flush(99, 'Зберігаємо книгу');
    if (!result.totalChars) throw new Error('У книзі не знайдено тексту для набору.');
    let book = {
      id, title: metadata.title, author: metadata.author || 'Невідомий автор', format,
      sourceName: file.name, sourceSize: file.size, coverBlob: metadata.coverBlob || null, ...result,
      createdAt: Date.now(), status: 'ready', importMs: Math.round(performance.now() - started),
    };
    book = await reuseBookMetadata(book);
    await putBook(book);
    self.postMessage({ type: 'done', book });
  } catch (error) {
    await deleteBook(id).catch(() => {});
    self.postMessage({ type: 'error', message: error.name === 'QuotaExceededError' ? 'У браузері недостатньо місця. Видаліть непотрібні книги й повторіть імпорт.' : error.message, cancelled });
  } finally { await zip?.close().catch(() => {}); }
}

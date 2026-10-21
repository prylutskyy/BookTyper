import { openDB } from 'idb';

export const dbPromise = openDB('booktyper', 1, {
  upgrade(db) {
    db.createObjectStore('books', { keyPath: 'id' });
    const chunks = db.createObjectStore('chunks', { keyPath: ['bookId', 'index'] });
    chunks.createIndex('book', 'bookId');
    db.createObjectStore('progress', { keyPath: 'bookId' });
    db.createObjectStore('settings');
  },
});

export async function listBooks() {
  return (await (await dbPromise).getAll('books')).filter(b => b.status === 'ready');
}
export async function cleanupInterruptedImports() {
  const incomplete = (await (await dbPromise).getAll('books')).filter(b => b.status === 'importing');
  for (const book of incomplete) {
    if (navigator.locks) {
      await navigator.locks.request(`bt-import:${book.id}`, { ifAvailable: true }, async lock => { if (lock) await deleteBook(book.id); });
    } else if (Date.now() - book.createdAt > 86400000) await deleteBook(book.id);
  }
}
export async function putBook(book) { return (await dbPromise).put('books', book); }
export async function reuseBookMetadata(book) {
  const db = await dbPromise;
  const existing = (await listBooks()).find(other => other.id !== book.id && other.sourceName === book.sourceName && other.sourceSize === book.sourceSize && other.title === book.title && other.totalChars === book.totalChars && other.chunkCount === book.chunkCount);
  if (!existing) return book;
  // Compare bounded batches of actual text; a filename/size match alone cannot justify reuse.
  for (let index = 0; index < book.chunkCount; index += 128) {
    const range = id => IDBKeyRange.bound([id, index], [id, Math.min(index + 127, book.chunkCount - 1)]);
    const [oldChunks, newChunks] = await Promise.all([db.getAll('chunks', range(existing.id)), db.getAll('chunks', range(book.id))]);
    if (oldChunks.length !== newChunks.length || oldChunks.some((chunk, i) => chunk.start !== newChunks[i].start || chunk.text !== newChunks[i].text)) return book;
  }
  const updated = { ...book, id: existing.id, createdAt: existing.createdAt };
  const tx = db.transaction(['books', 'chunks'], 'readwrite');
  tx.objectStore('books').put(updated);
  tx.objectStore('books').delete(book.id);
  tx.objectStore('chunks').delete(IDBKeyRange.bound([book.id, 0], [book.id, Number.MAX_SAFE_INTEGER]));
  await tx.done;
  return updated;
}
export async function getChunk(bookId, index) { return (await dbPromise).get('chunks', [bookId, index]); }
export async function putChunks(chunks) {
  if (!chunks.length) return;
  const tx = (await dbPromise).transaction('chunks', 'readwrite');
  for (const chunk of chunks) tx.store.put(chunk);
  await tx.done;
}
export async function deleteBook(id) {
  const tx = (await dbPromise).transaction(['books', 'chunks', 'progress'], 'readwrite');
  tx.objectStore('books').delete(id);
  tx.objectStore('progress').delete(id);
  tx.objectStore('chunks').delete(IDBKeyRange.bound([id, 0], [id, Number.MAX_SAFE_INTEGER]));
  await tx.done;
  try { localStorage.removeItem(`bt-progress:${id}`); } catch { /* Worker has no localStorage. */ }
}
export async function loadProgress(id) {
  const stored = await (await dbPromise).get('progress', id);
  let journal;
  try { journal = JSON.parse(localStorage.getItem(`bt-progress:${id}`)); } catch { /* Storage denied. */ }
  return journal?.bookId === id && Number.isFinite(journal.position) && journal.updatedAt > (stored?.updatedAt || 0) ? journal : stored;
}
export async function saveProgress(progress) {
  const tx = (await dbPromise).transaction(['progress', 'chunks'], 'readwrite');
  tx.objectStore('progress').put(progress);
  if (progress.errors) {
    const chunk = await tx.objectStore('chunks').get([progress.bookId, progress.errors.chunkIndex]);
    if (chunk) tx.objectStore('chunks').put({ ...chunk, wrongOffsets: progress.errors.offsets });
  }
  await tx.done;
}
export async function allProgress() {
  const books = await listBooks();
  return (await Promise.all(books.map(b => loadProgress(b.id)))).filter(Boolean);
}

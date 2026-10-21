import './style.css';
import { dbPromise, listBooks, cleanupInterruptedImports, putBook, putChunks, getChunk, loadProgress, saveProgress, deleteBook, allProgress } from './db.js';
import { ChunkBuilder, equivalent, nextCharacter, previousOffset, chapterAt } from './text.js';

const icons = {
  book: '<path d="M3 4h6a3 3 0 0 1 3 3v14a4 4 0 0 0-4-3H3zM21 4h-6a3 3 0 0 0-3 3v14a4 4 0 0 1 4-3h5z"/>',
  library: '<path d="M4 4v16M9 4v16M14 4v16M18 4l4 15M2 21h21"/>',
  chart: '<path d="M4 3v18h17M9 16v-5M14 16V7M19 16V4"/>',
  settings: '<path d="M4 7h16M4 17h16M9 4v6M15 14v6"/>',
  upload: '<path d="M12 16V3m-5 5 5-5 5 5M4 15v6h16v-6"/>',
  arrow: '<path d="M4 12h16m-6-6 6 6-6 6"/>',
  back: '<path d="M20 12H4m6-6-6 6 6 6"/>',
  check: '<path d="m5 12 4 4L20 5"/>',
  lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V6a4 4 0 0 1 8 0v4M12 14v3"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1 1m12 12 1 1M5 19l1-1M18 6l1-1"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
  trash: '<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  download: '<path d="M12 3v13m-5-5 5 5 5-5M4 16v5h16v-5"/>',
};
const icon = (name, cls = '') => `<svg class="icon ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] || icons.book}</svg>`;
const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const number = value => new Intl.NumberFormat('uk-UA').format(value || 0);
const percent = (book, p) => Math.min(100, (p?.position || 0) / book.totalChars * 100);
const app = document.querySelector('#app');
let books = [], progressMap = new Map(), current = null, chunk = null, prefetched = null;
let session = { activeMs: 0, last: 0, correct: 0, attempts: 0 }, settings = { theme: 'light', fontSize: 25, relaxed: true, strict: true };
let saveTimer, viewToken = 0, renderFrame, importing = false, importWorker = null;
let importQueue = [], activeImportId = null, typingNodes = new Map();
let view = 'library', query = '', toastTimer, importTotal = 0, importDone = 0;

function toast(message, error = false) {
  const el = document.querySelector('#toast');
  el.textContent = message; el.className = `toast visible${error ? ' error' : ''}`;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { el.className = 'toast'; }, 5000);
}
function applySettings() {
  document.documentElement.dataset.theme = settings.theme;
  document.documentElement.style.setProperty('--typing-size', `${settings.fontSize}px`);
}
async function persistSettings() {
  applySettings(); await (await dbPromise).put('settings', settings, 'preferences');
}
function shell() {
  app.innerHTML = `
    <aside class="sidebar">
      <a href="#" class="brand" aria-label="BookTyper — бібліотека"><span class="brand-mark">${icon('book')}</span>BookTyper<span class="brand-dot">.</span></a>
      <span class="nav-label">ВАШ ПРОСТІР</span>
      <nav aria-label="Головна навігація">
        <button data-view="library" class="nav-item active">${icon('library')}<span>Моя бібліотека</span><span id="book-count" class="nav-count">0</span></button>
        <button data-view="stats" class="nav-item">${icon('chart')}<span>Мій прогрес</span></button>
        <button data-view="settings" class="nav-item">${icon('settings')}<span>Налаштування</span></button>
      </nav>
      <div class="sidebar-note"><span class="little-star">✳</span><p>Трохи практики.<br>Щодня — нова сторінка.</p></div>
      <div class="sidebar-bottom"><div class="local-badge"><span></span>Усе збережено локально</div><p>Ваші книги. Ваш власний темп.</p><button id="theme" class="theme-button">${icon('sun')}<span>Змінити тему</span></button></div>
    </aside>
    <main id="main"></main>
    <input id="file-input" type="file" accept=".fb2,.epub" multiple hidden />
    <input id="backup-input" type="file" accept="application/json,.json" hidden />
    <div id="toast" class="toast" role="status" aria-live="polite"></div>
    <div id="import-panel" class="import-panel" hidden><div><span class="spinner"></span><strong id="import-title"></strong><button id="cancel-import" class="icon-button" aria-label="Скасувати імпорт">${icon('close')}</button></div><progress id="import-progress" max="100" value="0"></progress><p id="import-detail"></p></div>
    <div id="drop-overlay" class="drop-overlay" hidden><div>${icon('upload')}<h2>Ваша наступна книга</h2><p>Відпустіть FB2 або EPUB, щоб додати до бібліотеки</p></div></div>
    <dialog id="dialog"><div id="dialog-content"></div></dialog>`;
  document.querySelector('.brand').onclick = event => { event.preventDefault(); navigate('library'); };
  document.querySelectorAll('[data-view]').forEach(button => button.onclick = () => navigate(button.dataset.view));
  document.querySelector('#theme').onclick = () => { settings.theme = settings.theme === 'light' ? 'dark' : 'light'; persistSettings().catch(storageError); };
  document.querySelector('#file-input').onchange = event => { queueImports([...event.target.files]); event.target.value = ''; };
  document.querySelector('#backup-input').onchange = restoreBackup;
  document.querySelector('#cancel-import').onclick = cancelImport;
  const dialog = document.querySelector('#dialog');
  dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });
  dialog.addEventListener('close', () => { if (current) document.querySelector('#typing-input')?.focus(); });
  let dragDepth = 0;
  document.addEventListener('dragenter', event => { if (event.dataTransfer?.types.includes('Files')) { event.preventDefault(); dragDepth++; document.querySelector('#drop-overlay').hidden = false; } });
  document.addEventListener('dragover', event => { if (event.dataTransfer?.types.includes('Files')) event.preventDefault(); });
  document.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; document.querySelector('#drop-overlay').hidden = true; } });
  document.addEventListener('drop', event => { event.preventDefault(); dragDepth = 0; document.querySelector('#drop-overlay').hidden = true; queueImports([...event.dataTransfer.files]); });
}
function storageError(error) { toast(`Не вдалося зберегти дані: ${error.message}`, true); }
async function refreshBooks() {
  books = (await listBooks()).sort((a, b) => b.createdAt - a.createdAt);
  progressMap = new Map((await allProgress()).map(p => [p.bookId, p]));
  document.querySelector('#book-count').textContent = books.length;
}
function snapshot() {
  if (!current) return null;
  return { ...current.progress, updatedAt: Date.now() };
}
function journal() {
  const p = snapshot(); if (!p) return;
  progressMap.set(p.bookId, p);
  try { localStorage.setItem(`bt-progress:${p.bookId}`, JSON.stringify(p)); }
  catch { document.querySelector('#save-status').textContent = 'Зберігаємо в IndexedDB'; }
  clearTimeout(saveTimer); saveTimer = setTimeout(() => commitProgress(p), 300);
}
async function commitProgress(p = snapshot()) {
  if (!p) return;
  try {
    await saveProgress(p);
    if (current?.book.id === p.bookId) document.querySelector('#save-status').textContent = 'Прогрес збережено';
  } catch (error) { storageError(error); }
}
function closeBook() {
  if (current) { clearTimeout(saveTimer); journal(); commitProgress(); }
  current = null; chunk = null; prefetched = null; queuedText = ''; viewToken++;
  document.body.classList.remove('reading', 'zen');
}
function navigate(next) {
  closeBook(); view = next;
  document.querySelectorAll('[data-view]').forEach(b => b.classList.toggle('active', b.dataset.view === view));
  if (view === 'library') renderLibrary();
  else if (view === 'stats') renderStats();
  else renderSettings();
  window.scrollTo({ top: 0, behavior: 'instant' });
}
function statsValues() {
  const values = [...progressMap.values()];
  return { chars: values.reduce((n, p) => n + (p.correct || 0), 0), ms: values.reduce((n, p) => n + (p.activeMs || 0), 0),
    attempts: values.reduce((n, p) => n + (p.attempts || 0), 0), started: values.filter(p => p.position > 0).length };
}
function renderLibrary() {
  const recent = books.filter(b => (progressMap.get(b.id)?.position || 0) < b.totalChars).sort((a, b) => (progressMap.get(b.id)?.updatedAt || 0) - (progressMap.get(a.id)?.updatedAt || 0))[0];
  const stats = statsValues();
  document.querySelector('#main').innerHTML = `
    <header class="topbar"><span>МІСЦЕ ДЛЯ ЗОСЕРЕДЖЕНОЇ ПРАКТИКИ</span><div class="private-label">${icon('lock')}Без акаунта. Без зайвого.</div></header>
    <section class="welcome"><div class="eyebrow"><span></span>ЧИТАЙТЕ. ДРУКУЙТЕ. ВІДЧУВАЙТЕ ПРОГРЕС.</div><h1>Книга за книгою.<br><em>Слово за словом.</em></h1><p>Перетворіть улюблені історії на щоденну практику.<br> Знайдіть свій ритм — і продовжуйте з того місця, де зупинились.</p><div class="welcome-art" aria-hidden="true"><span class="orbit orbit-one"></span><span class="orbit orbit-two"></span><div class="art-book art-back"></div><div class="art-book art-front"><span>THE ART<br>OF SLOW<br><i>PROGRESS</i></span><small>ONE WORD AT A TIME</small><b>✳</b></div><span class="art-spark">✦</span></div></section>
    <div class="overview"><div><span class="overview-icon">${icon('library')}</span><p><strong>${number(books.length)}</strong><span>книг у бібліотеці</span></p></div><div><span class="overview-icon">${icon('chart')}</span><p><strong>${number(stats.chars)}</strong><span>символів набрано</span></p></div><div><span class="overview-icon clock-icon">◷</span><p><strong>${Math.round(stats.ms / 60000)} <small>хв</small></strong><span>уважної практики</span></p></div></div>
    ${recent ? `<section class="continue-card"><div class="mini-cover">${icon('book')}</div><div class="continue-info"><span class="eyebrow">ВАША НАСТУПНА СТОРІНКА</span><h2>${escape(recent.title)}</h2><p>${escape(recent.author)}<span class="separator">·</span>${percent(recent, progressMap.get(recent.id)).toFixed(1)}% пройдено</p></div><button class="primary" id="continue-book">Продовжити ${icon('arrow')}</button></section>` : ''}
    <section class="library"><div class="section-heading"><div><h2>Моя бібліотека <span>${books.length}</span></h2><p>Історії, до яких хочеться повертатися.</p></div><button id="add-book" class="primary">${icon('upload')}Додати книгу</button></div><div class="library-toolbar"><div class="library-filter">Усі книги <span>${books.length}</span></div><label class="search">${icon('search')}<input id="search" placeholder="Знайти книгу чи автора" aria-label="Знайти книгу чи автора" value="${escape(query)}" /></label></div><div id="book-grid" class="book-grid"></div></section>
    <footer class="page-footer"><span>${icon('lock')}Книги та прогрес зберігаються лише у цьому браузері</span><span>Зроблено для вашого ритму <span class="footer-star">✳</span></span></footer>`;
  document.querySelector('#add-book').onclick = () => document.querySelector('#file-input').click();
  if (recent) document.querySelector('#continue-book').onclick = () => openBook(recent.id);
  document.querySelector('#search').oninput = event => { query = event.target.value; renderGrid(); };
  renderGrid();
}
function renderGrid() {
  const filtered = books.filter(b => `${b.title} ${b.author}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  document.querySelector('#book-grid').innerHTML = filtered.map(book => {
    const p = progressMap.get(book.id), value = percent(book, p);
    const color = [...book.title].reduce((n, c) => n + c.codePointAt(0), 0) % 5;
    return `<article class="book-card"><button class="book-open" data-open="${book.id}" aria-label="Відкрити ${escape(book.title)}"><div class="book-cover cover-${color}"><span class="cover-top">${escape(book.author)}</span><div class="cover-decoration">${['✳', '◈', '❋', '✦', '◎'][color]}</div><h3>${escape(book.title)}</h3><span class="cover-bottom">ВАША ОСОБИСТА БІБЛІОТЕКА</span><span class="format-tag">${book.format.toUpperCase()}</span></div><div class="book-info"><h3 title="${escape(book.title)}">${escape(book.title)}</h3><p>${escape(book.author)}</p><div class="book-progress"><div><span style="width:${value}%"></span></div><small>${value >= 100 ? 'Прочитано ✓' : `${value.toFixed(1)}%`}</small></div></div></button><button class="delete-book icon-button" data-delete="${book.id}" aria-label="Видалити ${escape(book.title)}">${icon('trash')}</button></article>`;
  }).join('') + (!query ? `<button class="upload-card" id="upload-card">${icon('upload')}<strong>Що читатимемо далі?</strong><span>Перетягніть книгу сюди<br>або виберіть файл</span><small>FB2 · EPUB · Лише на вашому пристрої</small></button>` : '');
  if (!filtered.length && query) document.querySelector('#book-grid').innerHTML = '<p class="empty-search">Книг не знайдено. Спробуйте іншу назву.</p>';
  document.querySelectorAll('[data-open]').forEach(button => button.onclick = () => openBook(button.dataset.open));
  document.querySelectorAll('[data-delete]').forEach(button => button.onclick = () => confirmDelete(button.dataset.delete));
  document.querySelector('#upload-card')?.addEventListener('click', () => document.querySelector('#file-input').click());
}
function showDialog(html) {
  const dialog = document.querySelector('#dialog');
  document.querySelector('#dialog-content').innerHTML = `<button class="dialog-close icon-button" aria-label="Закрити">${icon('close')}</button>${html}`;
  document.querySelector('.dialog-close').onclick = () => dialog.close(); dialog.showModal();
}
function confirmDelete(id) {
  const book = books.find(b => b.id === id);
  showDialog(`<h2>Видалити книгу?</h2><p>«${escape(book.title)}» і її прогрес буде видалено з цього браузера.</p><div class="dialog-actions"><button id="keep-book" class="secondary">Залишити</button><button id="delete-confirm" class="danger">Видалити</button></div>`);
  document.querySelector('#keep-book').onclick = () => document.querySelector('#dialog').close();
  document.querySelector('#delete-confirm').onclick = async () => {
    try { await deleteBook(id); await refreshBooks(); renderLibrary(); document.querySelector('#dialog').close(); toast('Книгу видалено'); } catch (error) { storageError(error); }
  };
}

async function openBook(id, target) {
  closeBook(); const token = viewToken;
  const book = books.find(b => b.id === id); if (!book) return;
  const saved = await loadProgress(id);
  if (token !== viewToken) return;
  const p = { bookId: id, position: 0, chunkIndex: 0, correct: 0, attempts: 0, activeMs: 0, ...(saved || {}) };
  p.position = Math.max(0, Math.min(book.totalChars, p.position || 0));
  if (target !== undefined) p.position = target;
  current = { book, progress: p }; session = { activeMs: 0, last: 0, correct: 0, attempts: 0 };
  document.body.classList.add('reading');
  document.querySelectorAll('[data-view]').forEach(b => b.classList.remove('active'));
  document.querySelector('#main').innerHTML = `
    <header class="reader-topbar"><button id="back-library" class="text-button">${icon('back')}До бібліотеки</button><span id="save-status">Прогрес збережено</span><button id="reader-settings" class="icon-button" aria-label="Налаштування набору">${icon('settings')}</button></header>
    <section class="reader"><div class="reader-heading"><span class="eyebrow">ЧАС ПОБУТИ МІЖ РЯДКАМИ</span><h1>${escape(book.title)}</h1><p>${escape(book.author)}</p></div><div class="reader-stats"><div><strong id="wpm">0</strong><span>слів / хв</span></div><div><strong id="accuracy">100<small>%</small></strong><span>точність</span></div><div><strong id="reader-percent">0<small>%</small></strong><span>книги пройдено</span></div><div><strong id="timer">0:00</strong><span>час практики</span></div></div>
    <div class="chapter-bar"><button id="chapters" class="text-button">${icon('book')}<span id="chapter-title"></span><span>⌄</span></button><span id="position-label"></span></div>
    <div class="typing-area" id="typing-area"><div id="text-window" class="text-window" aria-hidden="true"></div><p id="accessible-passage" class="sr-only"></p><textarea id="typing-input" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" aria-label="Поле набору тексту книги" aria-describedby="typing-help accessible-passage"></textarea><button id="focus-prompt">Натисніть тут, щоб почати друкувати ${icon('arrow')}</button><div id="completion" hidden><span>✳</span><h2>Книга пройдена!</h2><p>Слово за словом — ви дійшли до останньої сторінки.</p><button id="finish-library" class="primary">До бібліотеки ${icon('arrow')}</button></div></div>
    <div class="reader-progress"><span id="reader-progress-fill"></span></div><div class="typing-footer" id="typing-help"><span><kbd>Enter</kbd> новий абзац <span class="separator">·</span> <kbd>Backspace</kbd> назад <span class="separator">·</span> <kbd>Esc</kbd> пауза</span><button id="zen" class="text-button">Режим фокусу ⛶</button></div><p class="reader-note">Не поспішайте. Важливий не фініш, а ваш ритм.</p></section>`;
  document.querySelector('#back-library').onclick = () => navigate('library');
  document.querySelector('#reader-settings').onclick = readerSettings;
  document.querySelector('#chapters').onclick = chapterDialog;
  document.querySelector('#finish-library').onclick = () => navigate('library');
  window.scrollTo({ top: 0, behavior: 'instant' });
  document.querySelector('#zen').onclick = () => document.body.classList.toggle('zen');
  const input = document.querySelector('#typing-input');
  input.addEventListener('focus', () => { document.querySelector('#typing-area').classList.add('focused'); });
  input.addEventListener('blur', () => { document.querySelector('#typing-area')?.classList.remove('focused'); session.last = 0; });
  document.querySelector('#focus-prompt').onclick = () => input.focus();
  document.querySelector('#typing-area').addEventListener('click', event => { if (!event.target.closest('button')) input.focus(); });
  input.addEventListener('keydown', onKeydown);
  input.addEventListener('beforeinput', event => {
    if (event.inputType === 'insertFromPaste' || event.inputType === 'insertFromDrop') { event.preventDefault(); return; }
    if (event.isComposing) return;
    if (event.inputType === 'insertText' && event.data) { event.preventDefault(); typeText(event.data); }
    else if (event.inputType === 'insertLineBreak') { event.preventDefault(); typeText('\n'); }
    else if (event.inputType === 'deleteContentBackward') { event.preventDefault(); backspace(); }
  });
  input.addEventListener('compositionend', event => { typeText(event.data); input.value = ''; });
  input.addEventListener('input', event => { if (!event.isComposing) input.value = ''; });
  await seekPosition(p.position, token);
}
async function seekPosition(position, token = viewToken) {
  if (!current) return;
  const book = current.book;
  if (position >= book.totalChars) { current.progress.position = book.totalChars; completeBook(); return; }
  let low = 0, high = book.chunkCount - 1, found;
  while (low <= high) {
    const index = (low + high) >>> 1, candidate = await getChunk(book.id, index);
    if (token !== viewToken) return;
    if (!candidate) throw new Error('Не знайдено фрагмент книги. Спробуйте імпортувати її знову.');
    if (position < candidate.start) high = index - 1;
    else if (position >= candidate.start + candidate.text.length) low = index + 1;
    else { found = candidate; break; }
  }
  if (!found) return;
  current.progress.position = position; current.progress.chunkIndex = found.index;
  chunk = found; prefetched = getChunk(book.id, chunk.index + 1);
  renderText(); updateReader();
}
function renderText() {
  const window = document.querySelector('#text-window'); if (!window || !chunk || !current) return;
  typingNodes = new Map(); const fragment = document.createDocumentFragment();
  let offset = chunk.start;
  for (const char of chunk.text) {
    const span = document.createElement('span'); span.textContent = char === '\n' ? '↵\n' : char;
    if (offset < current.progress.position) span.className = 'typed';
    if (offset === current.progress.position) span.className = 'caret';
    typingNodes.set(offset, span); fragment.append(span); offset += char.length;
  }
  window.replaceChildren(fragment); window.style.transform = 'translateY(0)';
  document.querySelector('#accessible-passage').textContent = chunk.text;
  document.querySelector('#completion').hidden = true;
  document.querySelector('#focus-prompt').hidden = false;
  document.querySelector('#typing-input').disabled = false;
  scrollCaret();
}
function scrollCaret() {
  const node = typingNodes.get(current?.progress.position), window = document.querySelector('#text-window');
  if (!node || !window) return;
  const top = node.offsetTop;
  window.style.transform = `translateY(-${Math.max(0, top - 65)}px)`;
}
function onKeydown(event) {
  if (event.isComposing) return;
  if (event.key === 'Escape') { event.preventDefault(); event.target.blur(); document.body.classList.remove('zen'); }
  if (event.key === 'Backspace') { event.preventDefault(); backspace(event.ctrlKey || event.metaKey); }
  if (event.key === 'Enter') { event.preventDefault(); typeText('\n'); }
}
let advancing = false, queuedText = '';
function typeText(value) {
  if (!current || !chunk) return;
  if (advancing) { queuedText += value; return; }
  const inputChars = [...value.normalize('NFC')];
  for (let i = 0; i < inputChars.length; i++) {
    const actual = inputChars[i];
    if (!current || current.progress.position >= current.book.totalChars) break;
    const p = current.progress, localOffset = p.position - chunk.start;
    if (localOffset >= chunk.text.length) break;
    const expected = nextCharacter(chunk.text, localOffset);
    const now = performance.now(), gap = session.last ? Math.min(now - session.last, 10000) : 0;
    session.last = now; session.activeMs += gap; p.activeMs += gap; p.attempts++; session.attempts++;
    const correct = equivalent(actual, expected, settings.relaxed);
    const node = typingNodes.get(p.position);
    if (correct) { p.correct++; session.correct++; }
    if (!correct && settings.strict) { node?.classList.add('mistake'); journal(); scheduleUpdate(); continue; }
    node?.classList.remove('caret', 'mistake'); node?.classList.add(correct ? 'typed' : 'wrong');
    p.position += expected.length;
    typingNodes.get(p.position)?.classList.add('caret');
    journal(); scheduleUpdate();
    if (p.position >= current.book.totalChars) { completeBook(); break; }
    if (p.position >= chunk.start + chunk.text.length) {
      queuedText = inputChars.slice(i + 1).join('') + queuedText;
      advanceChunk(); break;
    }
  }
}
function scheduleUpdate() {
  if (renderFrame) return;
  renderFrame = requestAnimationFrame(() => { renderFrame = null; if (current) { updateReader(); scrollCaret(); } });
}
async function advanceChunk() {
  advancing = true; const token = viewToken;
  try {
    const next = await prefetched;
    if (token !== viewToken || !current) return;
    if (!next) throw new Error('Не вдалося завантажити наступний фрагмент.');
    chunk = next; current.progress.chunkIndex = next.index;
    prefetched = getChunk(current.book.id, next.index + 1);
    renderText(); journal();
  } catch (error) { queuedText = ''; toast(error.message, true); }
  finally {
    advancing = false;
    if (token === viewToken && current && queuedText) {
      const remaining = queuedText; queuedText = ''; typeText(remaining);
    }
  }
}
async function backspace(word = false) {
  if (!current || !chunk || advancing) return;
  const p = current.progress;
  const node = typingNodes.get(p.position);
  if (node?.classList.contains('mistake')) { node.classList.remove('mistake'); return; }
  if (p.position <= 0) return;
  let position = previousOffset(chunk.text, p.position - chunk.start) + chunk.start;
  if (p.position === chunk.start) {
    advancing = true; const token = viewToken;
    const previous = await getChunk(current.book.id, chunk.index - 1);
    if (token !== viewToken || !current) { advancing = false; return; }
    if (previous) { chunk = previous; prefetched = getChunk(current.book.id, chunk.index + 1); position = chunk.start + previousOffset(chunk.text, chunk.text.length); }
    advancing = false;
  }
  if (word) {
    let i = position - chunk.start;
    while (i > 0 && /\s/.test(chunk.text[i])) i = previousOffset(chunk.text, i);
    while (i > 0 && !/\s/.test(chunk.text[previousOffset(chunk.text, i)])) i = previousOffset(chunk.text, i);
    position = chunk.start + i;
  }
  p.position = Math.max(0, position); p.chunkIndex = chunk.index;
  renderText(); updateReader(); journal();
}
function updateReader() {
  if (!current) return;
  const { book, progress: p } = current;
  const value = percent(book, p), accuracy = session.attempts ? session.correct / session.attempts * 100 : 100;
  document.querySelector('#wpm').textContent = session.activeMs > 500 ? Math.round(session.correct / 5 / (session.activeMs / 60000)) : 0;
  document.querySelector('#accuracy').innerHTML = `${accuracy.toFixed(accuracy === 100 ? 0 : 1)}<small>%</small>`;
  document.querySelector('#reader-percent').innerHTML = `${value.toFixed(1)}<small>%</small>`;
  const seconds = Math.floor(session.activeMs / 1000);
  document.querySelector('#timer').textContent = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  document.querySelector('#reader-progress-fill').style.width = `${value}%`;
  const chapter = book.chapters[chapterAt(book.chapters, p.position)];
  document.querySelector('#chapter-title').textContent = chapter?.title || 'Початок книги';
  document.querySelector('#position-label').textContent = `${number(p.position)} / ${number(book.totalChars)} симв.`;
}
function completeBook() {
  if (!current) return;
  document.querySelector('#completion').hidden = false;
  document.querySelector('#text-window').replaceChildren(); document.querySelector('#focus-prompt').hidden = true;
  document.querySelector('#typing-input').disabled = true;
  updateReader(); journal(); commitProgress();
}
function chapterDialog() {
  if (!current) return;
  const chapters = current.book.chapters.length ? current.book.chapters : [{ title: 'Початок книги', start: 0 }];
  let offset = Math.max(0, Math.floor(chapterAt(chapters, current.progress.position) / 100) * 100);
  showDialog(`<span class="eyebrow">ЗМІСТ КНИГИ</span><h2>${escape(current.book.title)}</h2><p>Виберіть розділ. Позицію набору буде перенесено.</p><div class="chapter-list" id="chapter-list"></div><div class="chapter-pages"><button class="text-button" id="chapters-prev">← Попередні</button><span id="chapters-page"></span><button class="text-button" id="chapters-next">Наступні →</button></div><button class="secondary" id="start-again">Почати книгу спочатку</button>`);
  const renderPage = () => {
    document.querySelector('#chapter-list').innerHTML = chapters.slice(offset, offset + 100).map((chapter, i) => `<button data-chapter="${chapter.start}"><span>${String(offset + i + 1).padStart(2, '0')}</span>${escape(chapter.title)}${icon('arrow')}</button>`).join('');
    document.querySelector('#chapters-page').textContent = `${offset + 1}–${Math.min(offset + 100, chapters.length)} / ${chapters.length}`;
    document.querySelector('#chapters-prev').disabled = offset === 0;
    document.querySelector('#chapters-next').disabled = offset + 100 >= chapters.length;
    document.querySelectorAll('[data-chapter]').forEach(button => button.onclick = async () => { await seekPosition(Number(button.dataset.chapter)); journal(); document.querySelector('#dialog').close(); });
  };
  document.querySelector('#chapters-prev').onclick = () => { offset = Math.max(0, offset - 100); renderPage(); };
  document.querySelector('#chapters-next').onclick = () => { offset += 100; renderPage(); };
  renderPage();
  document.querySelector('#start-again').onclick = async () => { await seekPosition(0); journal(); document.querySelector('#dialog').close(); };
}
function preferencesMarkup() {
  return `<label class="preference"><span><strong>Тема</strong><small>Світлий або темний простір для практики.</small></span><select id="color-theme" aria-label="Тема"><option value="light" ${settings.theme === 'light' ? 'selected' : ''}>Світла</option><option value="dark" ${settings.theme === 'dark' ? 'selected' : ''}>Темна</option></select></label><label class="preference"><span><strong>Розмір тексту</strong><small>Знайдіть комфортний для очей масштаб.</small></span><select id="font-size" aria-label="Розмір тексту">${[20, 23, 25, 28, 32].map(n => `<option ${settings.fontSize === n ? 'selected' : ''} value="${n}">${n} px</option>`).join('')}</select></label><label class="preference"><span><strong>Зупинятися на помилках</strong><small>Введіть правильний символ, щоб рухатися далі.</small></span><input type="checkbox" id="strict" ${settings.strict ? 'checked' : ''} /></label><label class="preference"><span><strong>Зручна пунктуація</strong><small>Звичайні лапки, апостроф і дефіс замість типографських.</small></span><input type="checkbox" id="relaxed" ${settings.relaxed ? 'checked' : ''} /></label>`;
}
function bindPreferences() {
  document.querySelector('#color-theme').onchange = event => { settings.theme = event.target.value; persistSettings().catch(storageError); };
  document.querySelector('#font-size').onchange = event => { settings.fontSize = Number(event.target.value); persistSettings().catch(storageError); scrollCaret(); };
  for (const key of ['strict', 'relaxed']) document.querySelector(`#${key}`).onchange = event => { settings[key] = event.target.checked; persistSettings().catch(storageError); };
}
function readerSettings() { showDialog(`<span class="eyebrow">ВАШ РИТМ</span><h2>Налаштування набору</h2>${preferencesMarkup()}`); bindPreferences(); }
function renderStats() {
  const s = statsValues();
  document.querySelector('#main').innerHTML = `<header class="topbar"><span>КОЖНЕ СЛОВО МАЄ ЗНАЧЕННЯ</span></header><section class="inner-page"><span class="eyebrow">КРОК ЗА КРОКОМ</span><h1>Мій прогрес</h1><p class="lead">Маленькі кроки складаються у великі історії.</p><div class="stat-cards"><div><strong>${number(s.chars)}</strong><span>правильних натискань</span></div><div><strong>${s.attempts ? (s.chars / s.attempts * 100).toFixed(1) : 100}%</strong><span>точність за весь час</span></div><div><strong>${Math.round(s.ms / 60000)} хв</strong><span>активної практики</span></div></div><div class="progress-books">${books.map(b => `<button data-open="${b.id}"><span>${icon('book')}<span><strong>${escape(b.title)}</strong><small>${escape(b.author)}</small></span></span><span>${percent(b, progressMap.get(b.id)).toFixed(1)}% ${icon('arrow')}</span></button>`).join('')}</div></section>`;
  document.querySelectorAll('[data-open]').forEach(button => button.onclick = () => openBook(button.dataset.open));
}
function renderSettings() {
  document.querySelector('#main').innerHTML = `<header class="topbar"><span>ПРОСТІР, ЩО ПАСУЄ ВАМ</span></header><section class="inner-page settings-page"><span class="eyebrow">ЗРОБІТЬ СВОЇМ</span><h1>Налаштування</h1><p class="lead">Менше зайвого. Більше задоволення від практики.</p><h2>Набір тексту</h2><div class="preferences">${preferencesMarkup()}</div><h2>Ваші дані</h2><p>Книги та прогрес зберігаються в IndexedDB цього браузера. Очищення даних сайту або приватний режим можуть видалити їх. Резервна копія містить позиції й статистику; самі книги потрібно імпортувати окремо.</p><div class="backup-actions"><button class="secondary" id="export-progress">${icon('download')}Зберегти прогрес у файл</button><button class="secondary" id="restore-progress">${icon('upload')}Відновити прогрес</button><button class="secondary" id="persist-storage">${icon('lock')}Захистити локальне сховище</button></div><p id="storage-info" class="storage-info"></p><h2>Про BookTyper</h2><p>Локальний тренажер набору книжок, натхненний Typersguild. FB2 та EPUB обробляються на вашому пристрої. Імпортовані книги нікуди не надсилаються.</p></section>`;
  bindPreferences();
  document.querySelector('#export-progress').onclick = exportBackup;
  document.querySelector('#restore-progress').onclick = () => document.querySelector('#backup-input').click();
  document.querySelector('#persist-storage').onclick = async () => {
    const granted = await navigator.storage?.persist?.();
    toast(granted ? 'Браузер надав постійне сховище.' : 'Браузер поки не надав постійне сховище. Збережіть резервну копію.');
  };
  navigator.storage?.estimate?.().then(estimate => {
    const el = document.querySelector('#storage-info');
    if (el) el.textContent = `Зайнято ${(estimate.usage / 1024 / 1024).toFixed(1)} МБ із доступних ${(estimate.quota / 1024 / 1024 / 1024).toFixed(1)} ГБ`;
  });
}
async function exportBackup() {
  const progress = await allProgress();
  const data = { app: 'BookTyper', version: 1, exportedAt: new Date().toISOString(), books: books.map(b => ({ sourceName: b.sourceName, sourceSize: b.sourceSize, totalChars: b.totalChars, progress: progress.find(p => p.bookId === b.id) || null })) };
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  const a = document.createElement('a'); a.href = url; a.download = `booktyper-progress-${new Date().toISOString().slice(0, 10)}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
async function restoreBackup(event) {
  const file = event.target.files?.[0]; event.target.value = ''; if (!file) return;
  try {
    if (file.size > 8 * 1024 * 1024) throw new Error('Файл прогресу перевищує 8 МБ.');
    const backup = JSON.parse(await file.text());
    if (backup.app !== 'BookTyper' || backup.version !== 1 || !Array.isArray(backup.books)) throw new Error('Це не резервна копія BookTyper.');
    const matches = [];
    for (const entry of backup.books) {
      const b = books.find(b => b.sourceName === entry.sourceName && b.sourceSize === entry.sourceSize && b.totalChars === entry.totalChars);
      const p = entry.progress;
      if (!b || !p) continue;
      if (!['position', 'correct', 'attempts', 'activeMs'].every(k => Number.isFinite(p[k]) && p[k] >= 0) || p.position > b.totalChars || p.correct > p.attempts) throw new Error('Резервна копія містить некоректні показники прогресу.');
      matches.push({ bookId: b.id, position: p.position, correct: p.correct, attempts: p.attempts, activeMs: p.activeMs, updatedAt: Date.now() });
    }
    showDialog(`<h2>Відновити прогрес?</h2><p>Буде замінено прогрес для ${matches.length} книг. Книги зіставляються за назвою файла, розміром і довжиною тексту. Наявні позиції цих книг буде перезаписано.</p><button id="restore-confirm" class="primary">Відновити</button>`);
    document.querySelector('#restore-confirm').onclick = async () => {
      for (const p of matches) { await saveProgress(p); localStorage.setItem(`bt-progress:${p.bookId}`, JSON.stringify(p)); }
      await refreshBooks(); document.querySelector('#dialog').close(); toast(`Відновлено книг: ${matches.length}`);
    };
  } catch (error) { toast(error.message, true); }
}

function queueImports(files) {
  const valid = files.filter(file => /\.(fb2|epub)$/i.test(file.name));
  if (files.length !== valid.length) toast('Підтримуються лише файли .fb2 та .epub', true);
  if (!valid.length) return;
  importQueue.push(...valid); importTotal += valid.length;
  if (!importing) nextImport();
}
async function nextImport() {
  const file = importQueue.shift();
  if (!file) { importing = false; document.querySelector('#import-panel').hidden = true; importTotal = 0; importDone = 0; return; }
  importing = true;
  document.querySelector('#import-panel').hidden = false;
  document.querySelector('#import-title').textContent = file.name;
  document.querySelector('#import-progress').value = 0;
  document.querySelector('#import-detail').textContent = `Готуємо імпорт · ${importDone + 1} / ${importTotal}`;
  const id = crypto.randomUUID(); activeImportId = id;
  importWorker = new Worker(new URL('./import.worker.js', import.meta.url), { type: 'module' });
  importWorker.onmessage = async ({ data }) => {
    if (data.type === 'progress') {
      document.querySelector('#import-progress').value = data.percent;
      document.querySelector('#import-detail').textContent = `${data.phase} · ${Math.round(data.percent)}% · ${number(data.chars)} симв.`;
    } else if (data.type === 'done' || data.type === 'error') {
      importWorker.terminate(); importWorker = null; activeImportId = null; importDone++;
      if (data.type === 'done') {
        await refreshBooks(); if (view === 'library' && !current) renderLibrary();
        toast(`«${data.book.title}» додано до бібліотеки`);
      } else if (!data.cancelled) toast(data.message, true);
      nextImport();
    }
  };
  importWorker.onerror = async event => {
    event.preventDefault(); importWorker?.terminate(); importWorker = null; activeImportId = null;
    await deleteBook(id).catch(() => {}); toast('Помилка імпорту. Перевірте книгу та спробуйте ще раз.', true); nextImport();
  };
  importWorker.postMessage({ type: 'import', file, id });
}
async function cancelImport() {
  importQueue = [];
  // Terminate also cancels stalled decompression, then delete all partially committed chunks.
  importWorker?.terminate(); importWorker = null;
  const id = activeImportId; activeImportId = null;
  if (id) await deleteBook(id).catch(storageError);
  importing = false; importTotal = 0; importDone = 0;
  document.querySelector('#import-panel').hidden = true; toast('Імпорт скасовано');
}

async function seedDemo() {
  const id = 'booktyper-welcome-v1';
  if (await (await dbPromise).get('settings', 'demo-seeded')) return;
  const paragraphs = [
    'Кожна велика історія починається з першого слова. А кожна нова навичка — з невеликого кроку, який ми наважуємося зробити сьогодні.',
    'Це ваш простір для спокійної практики. Тут немає змагання з часом. Є лише ви, текст і приємний ритм клавіш. Друкуйте те, що бачите, і поступово знаходьте власний темп.',
    'Не бійтеся помилок. Вони допомагають помічати деталі й рухатися вперед уважніше. Якщо символ підсвітився червоним, просто введіть правильну літеру. Для нового абзацу натисніть Enter.',
    'Ваша позиція зберігається автоматично. Можна закрити вкладку, зробити перерву й повернутися до того самого рядка. Історія терпляче чекатиме на вас.',
    'Додайте свою книгу у форматі FB2 або EPUB. Знайомий роман, улюблена повість чи історія, яку давно хотіли прочитати, стануть вашою наступною практикою.',
    'Великі книги обробляються частинами, у фоновому потоці. Поки ви набираєте один фрагмент, наступний уже готується. Ніщо не повинно відволікати від тексту.',
    'Звертайте увагу на розділові знаки, дихання речень і музику слів. Коли руки поступово запам’ятовують рухи, думки отримують більше простору для самої історії.',
    'Достатньо кількох хвилин щодня. Звичка народжується з повторення, а задоволення — з відчуття власного поступу. Сьогодні ви вже зробили перший крок. До зустрічі на наступній сторінці!',
  ];
  const records = [], writer = new ChunkBuilder(id, c => records.push(c));
  writer.chapter('Знайдіть свій ритм');
  paragraphs.forEach(p => { writer.text(p); writer.boundary(); });
  const result = writer.finish(); await putChunks(records);
  await putBook({ id, title: 'Мистецтво маленьких кроків', author: 'Вітаємо у BookTyper', format: 'fb2', sourceName: 'booktyper-welcome.fb2', sourceSize: 0, createdAt: 1, status: 'ready', ...result });
  await (await dbPromise).put('settings', true, 'demo-seeded');
}
document.addEventListener('visibilitychange', () => { if (document.hidden && current) { journal(); commitProgress(); session.last = 0; } });
window.addEventListener('pagehide', () => { if (current) { journal(); commitProgress(); } });
window.addEventListener('storage', async event => {
  if (event.key?.startsWith('bt-progress:') && !current) { await refreshBooks(); if (view === 'library') renderLibrary(); }
});
async function init() {
  try {
    settings = { ...settings, ...(await (await dbPromise).get('settings', 'preferences') || {}) }; applySettings();
    shell(); await cleanupInterruptedImports(); await seedDemo(); await refreshBooks(); renderLibrary();
  } catch (error) {
    app.innerHTML = `<main class="fatal"><h1>Не вдалося відкрити локальне сховище</h1><p>Дозвольте браузеру зберігати дані для цього сайту й оновіть сторінку.</p><p>${escape(error.message)}</p></main>`;
  }
}
init();

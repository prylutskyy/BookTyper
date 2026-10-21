export const CHUNK_SIZE = 1200;

// Bounds the retained text even when a source contains one enormous paragraph.
export class ChunkBuilder {
  constructor(bookId, emit) {
    this.bookId = bookId; this.emit = emit; this.buffer = ''; this.total = 0; this.count = 0;
    this.chapters = []; this.lastSpace = true;
  }
  get position() { return this.total + this.buffer.length; }
  text(value) {
    let text = value.replace(/[\u200b\u00ad]/gu, '').replace(/\s+/gu, ' ');
    if (this.lastSpace) text = text.replace(/^ +/, '');
    if (!text) return;
    this.lastSpace = text.endsWith(' ');
    this.buffer = (this.buffer + text).normalize('NFC');
    this.drain(false);
  }
  boundary() {
    this.buffer = this.buffer.replace(/ +$/, '');
    if (this.position && !this.buffer.endsWith('\n')) this.buffer += '\n';
    this.lastSpace = true;
    this.drain(false);
  }
  chapter(title) {
    const clean = title.replace(/\s+/g, ' ').trim().slice(0, 240);
    if (!clean) return;
    const previous = this.chapters.at(-1);
    if (previous?.start === this.position) previous.title = clean;
    else if (previous?.title !== clean || this.position - previous.start > 300)
      this.chapters.push({ title: clean, start: this.position });
  }
  drain(final) {
    while (this.buffer.length > CHUNK_SIZE * 2 || (final && this.buffer.length)) {
      let cut = Math.min(CHUNK_SIZE, this.buffer.length);
      if (cut < this.buffer.length) {
        const space = Math.max(this.buffer.lastIndexOf(' ', cut - 1), this.buffer.lastIndexOf('\n', cut - 1));
        if (space > cut / 2) cut = space + 1;
        // Do not divide a surrogate pair.
        if (/[\uD800-\uDBFF]/.test(this.buffer[cut - 1])) cut--;
      }
      const text = this.buffer.slice(0, cut);
      this.emit({ bookId: this.bookId, index: this.count++, start: this.total, text });
      this.total += text.length;
      this.buffer = this.buffer.slice(cut);
    }
  }
  finish() {
    this.buffer = this.buffer.trimEnd(); this.drain(true);
    return { totalChars: this.total, chunkCount: this.count, chapters: this.chapters };
  }
}

const aliases = { '’': "'", '‘': "'", 'ʼ': "'", '“': '"', '”': '"', '„': '"', '«': '"', '»': '"', '—': '-', '–': '-', '\u00a0': ' ' };
export function equivalent(actual, expected, relaxed) {
  if (actual === expected) return true;
  return relaxed && (aliases[actual] || actual) === (aliases[expected] || expected);
}
export function nextCharacter(text, offset) { return String.fromCodePoint(text.codePointAt(offset)); }
export function previousOffset(text, offset) {
  return offset > 1 && /[\uDC00-\uDFFF]/.test(text[offset - 1]) ? offset - 2 : Math.max(0, offset - 1);
}
export function chapterAt(chapters, position) {
  let low = 0, high = chapters.length - 1, result = -1;
  while (low <= high) {
    const mid = (low + high) >>> 1;
    if (chapters[mid].start <= position) { result = mid; low = mid + 1; } else high = mid - 1;
  }
  return result;
}

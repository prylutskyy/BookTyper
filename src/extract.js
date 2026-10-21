import { Parser } from 'htmlparser2';

const local = name => name.toLowerCase().split(':').at(-1);
const blocks = new Set(['p', 'div', 'section', 'br', 'li', 'blockquote', 'subtitle', 'text-author', 'v', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6']);
const invisible = new Set(['script', 'style', 'svg', 'math', 'binary', 'nav', 'head']);

export function createExtractor(writer, { format, metadata, onTitle = () => {} }) {
  const stack = [];
  let bodyDepth = 0, skipDepth = 0, heading = null, headingStart = 0;
  let metaKind = null, metaText = '', titleSeen = false;
  let xmlRoot = false, closedRoot = false;
  const parser = new Parser({
    onopentag(name, attrs) {
      const tag = local(name); stack.push(tag);
      if (format === 'fb2' && tag === 'fictionbook') xmlRoot = true;
      if (tag === 'body' && !bodyDepth) {
        if (format === 'fb2' && ['notes', 'comments'].includes(attrs.name)) skipDepth ||= stack.length;
        else bodyDepth = stack.length;
      }
      if (invisible.has(tag) && !skipDepth) skipDepth = stack.length;
      if (format === 'fb2' && !bodyDepth && ['book-title', 'first-name', 'middle-name', 'last-name'].includes(tag) && stack.includes('title-info')) {
        metaKind = tag; metaText = '';
      }
      if (bodyDepth && !skipDepth) {
        if (blocks.has(tag) || tag === 'title') writer.boundary();
        if (tag === 'title' || /^h[1-6]$/.test(tag)) {
          heading = ''; headingStart = writer.position;
        }
      }
    },
    ontext(text) {
      if (metaKind) metaText = (metaText + text).slice(0, 1000);
      if (bodyDepth && !skipDepth) {
        if (heading !== null) heading = (heading + text).slice(0, 240);
        writer.text(text);
      }
    },
    onclosetag(name) {
      const tag = local(name);
      if (metaKind === tag) {
        const value = metaText.replace(/\s+/g, ' ').trim();
        if (tag === 'book-title' && !titleSeen && value) { metadata.title = value; titleSeen = true; }
        else if (value && tag !== 'book-title') metadata.authorParts.push(value);
        metaKind = null; metaText = '';
      }
      if (bodyDepth && !skipDepth) {
        if (heading !== null && (tag === 'title' || /^h[1-6]$/.test(tag))) {
          const title = heading.replace(/\s+/g, ' ').trim();
          if (title) {
            const last = writer.chapters.at(-1);
            if (last?.start === headingStart) last.title = title;
            else writer.chapters.push({ title, start: headingStart });
            onTitle(title);
          }
          heading = null;
        }
        if (blocks.has(tag) || tag === 'title') writer.boundary();
      }
      if (stack.length === skipDepth) skipDepth = 0;
      if (stack.length === bodyDepth) bodyDepth = 0;
      stack.pop();
      if (format === 'fb2' && tag === 'fictionbook') closedRoot = true;
    },
  }, { xmlMode: true, decodeEntities: true });
  return {
    write: text => parser.write(text),
    end() {
      parser.end();
      if (format === 'fb2' && (!xmlRoot || !closedRoot)) throw new Error('Файл не містить коректного документа FictionBook.');
    },
  };
}

// OPF/container metadata is small and never includes book bodies or image data.
export function parseMetadata(xml) {
  const result = { rootfile: null, title: '', author: '', manifest: new Map(), spine: [], encrypted: [] };
  let field = null, value = '';
  const parser = new Parser({
    onopentag(name, attrs) {
      const tag = local(name);
      if (tag === 'rootfile' && !result.rootfile) result.rootfile = attrs['full-path'];
      if (tag === 'item' && attrs.id) result.manifest.set(attrs.id, attrs);
      if (tag === 'itemref' && attrs.linear !== 'no') result.spine.push(attrs.idref);
      if (tag === 'cipherreference' && attrs.URI) result.encrypted.push(attrs.URI);
      if (['title', 'creator'].includes(tag)) { field = tag; value = ''; }
    },
    ontext(text) { if (field) value = (value + text).slice(0, 2000); },
    onclosetag(name) {
      if (local(name) === field) {
        const key = field === 'title' ? 'title' : 'author';
        if (!result[key]) result[key] = value.replace(/\s+/g, ' ').trim();
        field = null;
      }
    },
  }, { xmlMode: true, decodeEntities: true });
  parser.end(xml);
  return result;
}

export function resolveArchivePath(base, href) {
  // An EPUB href is a URL reference, never an OS filesystem path.
  const url = new URL(href, `https://epub.invalid/${base}`);
  if (url.origin !== 'https://epub.invalid') throw new Error('Книга посилається на зовнішній розділ.');
  return decodeURIComponent(url.pathname.slice(1));
}
export function detectEncoding(bytes) {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return 'utf-16le';
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return 'utf-16be';
  if (bytes[0] === 0x3c && bytes[1] === 0 && bytes[2] === 0x3f) return 'utf-16le';
  if (bytes[0] === 0 && bytes[1] === 0x3c) return 'utf-16be';
  return new TextDecoder('ascii').decode(bytes.slice(0, 1024)).match(/<\?xml[^>]*encoding\s*=\s*["']([^"']+)/i)?.[1] || 'utf-8';
}

// Optional research helper: only public scripts explicitly listed in the REA DOM capture.
// It is not imported by BookTyper and never runs during application startup.
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { Parser } from 'htmlparser2';

const evidence = JSON.parse((await fs.readFile('docs/rea-capture-final.json', 'utf8')).replace(/^\uFEFF/, ''));
const html = evidence.normalized_result.steps.at(-1).artifacts.dom.value.text;
const urls = [];
new Parser({ onopentag(name, attrs) {
  if (name !== 'script' || !attrs.src) return;
  const url = new URL(attrs.src, 'https://typersguild.com');
  if (url.origin === 'https://typersguild.com' && url.pathname.startsWith('/_next/static/chunks/')) urls.push(url.href);
} }).end(html);
const root = path.resolve('tools/typersguild-public'); await fs.mkdir(root, { recursive: true });
const manifest = [], queue = [...new Set(urls)];
await Promise.all(Array.from({ length: 4 }, async () => {
  for (;;) {
    const url = queue.shift(); if (!url) break;
    const response = await fetch(url);
    if (!response.ok) { manifest.push({ url, status: response.status }); continue; }
    const bytes = Buffer.from(await response.arrayBuffer());
    const filename = path.basename(new URL(url).pathname);
    await fs.writeFile(path.join(root, filename), bytes);
    const text = bytes.toString('utf8');
    const terms = ['Sign in to save your progress', 'stopOnError', 'indexedDB', 'localStorage', 'epub', 'chapterProgress', 'currentCharIndex', 'requestAnimationFrame'].filter(term => text.includes(term));
    manifest.push({ url, filename, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), terms });
  }
}));
manifest.sort((a, b) => a.url.localeCompare(b.url));
await fs.writeFile(path.join(root, 'manifest.json'), JSON.stringify({ capturedAt: new Date().toISOString(), parentEvidenceId: evidence.evidence_id, scripts: manifest }, null, 2));
console.log(JSON.stringify({ scripts: manifest.length, bytes: manifest.reduce((n, x) => n + (x.bytes || 0), 0), trainerCandidates: manifest.filter(x => x.terms?.includes('Sign in to save your progress') || x.terms?.includes('stopOnError') || x.terms?.includes('epub')).map(({ filename, bytes, terms }) => ({ filename, bytes, terms })) }, null, 2));

import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const root = await fs.realpath(fileURLToPath(new URL('../dist', import.meta.url))).catch(() => null);
if (!root) { console.error('Спочатку виконайте npm run build або запустіть Start-BookTyper.cmd.'); process.exit(1); }
const base = process.env.SERVE_BASE || '/';
if (!/^\/(?:[a-zA-Z0-9_-]+\/)*$/.test(base)) throw new Error('SERVE_BASE must be a directory path ending in /');
const origin = 'http://127.0.0.1:5173';
const url = origin + base;
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json; charset=utf-8', '.wasm': 'application/wasm' };
const server = http.createServer(async (request, response) => {
  try {
    if (!['GET', 'HEAD'].includes(request.method)) { response.writeHead(405).end(); return; }
    const incoming = decodeURIComponent(new URL(request.url, origin).pathname);
    if (base !== '/' && incoming === base.slice(0, -1)) { response.writeHead(301, { Location: base }).end(); return; }
    if (!incoming.startsWith(base)) { response.writeHead(404).end('Not found'); return; }
    const pathname = '/' + incoming.slice(base.length);
    const target = path.resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`);
    const real = await fs.realpath(target);
    if (!real.startsWith(root + path.sep)) { response.writeHead(403).end(); return; }
    const data = await fs.readFile(real);
    response.writeHead(200, { 'Content-Type': mime[path.extname(real)] || 'application/octet-stream', 'Cache-Control': pathname.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache', 'X-Content-Type-Options': 'nosniff' });
    response.end(request.method === 'HEAD' ? undefined : data);
  } catch { response.writeHead(404).end('Not found'); }
});
server.on('error', error => {
  if (error.code === 'EADDRINUSE') console.error(`Порт 5173 вже використовується. Відкрийте ${url} або закрийте попередній сервер.`);
  else console.error(error.message);
  process.exitCode = 1;
});
server.listen(5173, '127.0.0.1', () => {
  console.log(`BookTyper: ${url}\nЗалиште це вікно відкритим. Для зупинки натисніть Ctrl+C.\nДля книг і набору підключення до інтернету не потрібне.`);
  if (process.argv.includes('--open') && process.platform === 'win32') {
    // Fixed, local URL; no user-supplied command text.
    const opener = spawn('cmd.exe', ['/d', '/c', 'start', '', url], { windowsHide: true, stdio: 'ignore' });
    opener.on('error', () => console.log(`Відкрийте браузер самостійно: ${url}`)); opener.unref();
  }
});

import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const publicDirectory = join(dirname(fileURLToPath(import.meta.url)), 'public');
const port = Number(process.env.ARCHURA_PRACTICE_PORT || 5300);

createServer(async (request, response) => {
  const pathname = new URL(request.url ?? '/', `http://${request.headers.host}`).pathname;
  const file = pathname === '/' ? join(publicDirectory, 'index.html') : join(publicDirectory, pathname);
  if (!file.startsWith(publicDirectory)) {
    response.writeHead(400).end('Bad request');
    return;
  }
  try {
    const info = await stat(file);
    if (!info.isFile()) throw new Error('not a file');
    response.setHeader('Content-Type', file.endsWith('.html') ? 'text/html; charset=utf-8' : 'application/octet-stream');
    createReadStream(file).pipe(response);
  } catch {
    response.writeHead(404).end('Not found');
  }
}).listen(port, 'localhost', () => {
  process.stdout.write(`Archura practice client: http://localhost:${port}\n`);
});

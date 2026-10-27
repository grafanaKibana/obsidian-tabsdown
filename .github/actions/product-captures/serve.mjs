import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { realpathSync } from 'node:fs';

/** Serve an already built site on loopback without framework-specific dependencies. */
export function serveDirectory(directory, port) {
  const root = path.resolve(directory);
  const types = { '.html':'text/html; charset=utf-8', '.css':'text/css', '.js':'text/javascript', '.mjs':'text/javascript', '.json':'application/json', '.svg':'image/svg+xml', '.png':'image/png', '.webp':'image/webp', '.jpg':'image/jpeg', '.woff2':'font/woff2', '.ttf':'font/ttf', '.ico':'image/x-icon' };
  const server = createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
      const candidate = path.resolve(root, `.${pathname}`);
      if (candidate !== root && !candidate.startsWith(`${root}${path.sep}`)) {
        response.writeHead(403).end(); return;
      }
      let file = candidate;
      try { if ((await stat(file)).isDirectory()) file = path.join(file, 'index.html'); }
      catch { file = path.extname(candidate) ? candidate : `${candidate}.html`; }
      const body = await readFile(file);
      response.writeHead(200, { 'Content-Type': types[path.extname(file)] ?? 'application/octet-stream', 'Cache-Control':'no-store' });
      response.end(body);
    } catch { response.writeHead(404).end('Not found'); }
  });
  server.listen(port, '127.0.0.1', () => console.log(`Capture server: http://127.0.0.1:${port}`));
  server.on('error', error => { console.error(error.message); process.exitCode = 1; });
  for (const signal of ['SIGINT','SIGTERM']) process.once(signal, () => server.close(() => process.exit(0)));
  return server;
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options:{ dir:{type:'string'}, port:{type:'string',default:'4179'} } });
  const port = Number(values.port);
  if (!values.dir || !Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Usage: node serve.mjs --dir public --port 4179');
  serveDirectory(values.dir, port);
}

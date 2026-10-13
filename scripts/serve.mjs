// scripts/serve.mjs — dependency-free static file server (foreground).
// Serves a built static directory on PORT (default 3000).
import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve, join, extname } from 'node:path';

const root = resolve(process.argv[2] || 'dist');
if (!existsSync(join(root, 'index.html'))) {
  console.error(`Static deployment output must contain index.html (dir: ${root})`);
  process.exit(1);
}

const MIME = {
  '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.webp': 'image/webp', '.wasm': 'application/wasm',
};

const server = createServer((req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    const path = resolve(root, '.' + decodeURIComponent(url.pathname));
    if (path !== root && !path.startsWith(root + '/')) {
      res.writeHead(404); res.end('Not found'); return;
    }
    let file = path;
    try {
      if (statSync(file).isDirectory()) file = join(file, 'index.html');
    } catch { file = join(root, 'index.html'); } // SPA fallback
    res.setHeader('Content-Type', MIME[extname(file)] || 'application/octet-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.end(readFileSync(file));
  } catch { res.writeHead(404); res.end('Not found'); }
});

const port = Number(process.env.PORT || 3000);
server.listen(port, '0.0.0.0', () => console.log(`Serving ${root} on port ${port}`));

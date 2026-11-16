// Static server with brotli + SPA fallback, mimicking Cloudflare assets. Compressed bodies are cached: compressing a
// 1 MB file at brotli's maximum quality on every request takes seconds and would pass for network time.
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import zlib from 'node:zlib';
const root = process.argv[2]; const port = +process.argv[3];
const types = {'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.woff2':'font/woff2','.woff':'font/woff','.glb':'model/gltf-binary','.webmanifest':'application/manifest+json','.json':'application/json'};
const compressible = /\.(html|js|css|svg|webmanifest|json|glb)$/;
const brCache = new Map();
http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  let f = path.join(root, p); if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(root, 'index.html');
  const ext = path.extname(f); let body = fs.readFileSync(f);
  const h = {'content-type': types[ext] || 'application/octet-stream'};
  h['cache-control'] = 'public, max-age=0, must-revalidate';
  if (compressible.test(ext) && /br/.test(req.headers['accept-encoding'] || '')) { if (!brCache.has(f)) brCache.set(f, zlib.brotliCompressSync(body)); body = brCache.get(f); h['content-encoding'] = 'br'; }
  res.writeHead(200, h); res.end(body);
}).listen(port, () => console.log('listening', port));

import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {resolve, extname} from 'node:path';
const root = fileURLToPath(new URL('../../', import.meta.url));
export function revision() {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA;
  try { const sha = execFileSync('git', ['rev-parse', 'HEAD'], {cwd: root, encoding: 'utf8'}).trim(); const dirty = execFileSync('git', ['status', '--porcelain'], {cwd: root, encoding: 'utf8'}).trim(); return sha + (dirty ? '-dirty' : ''); }
  catch { return 'local-unversioned'; }
}
export async function serveLookDev(port = 4173) {
  const commit = revision();
  const server = createServer(async (req, res) => {
    try {
      if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405).end(); return; }
      const path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
      res.setHeader('Cache-Control', 'no-store');
      if (path === '/manifest.json') { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({revision: commit})); return; }
      const relative = path === '/' || path === '/index.html' ? 'tools/look-dev/index.html' : path.slice(1);
      const allowed = /^(dist\/[\w./-]+\.js|tools\/look-dev\/(index\.html|state\.mjs)|tools\/promo\/(city|actors|laboratory|shots)\.mjs|tools\/promo\/assets\/[\w-]+\.png)$/.test(relative);
      if (!allowed || relative.split('/').includes('..') || relative.includes('\\')) { res.writeHead(404).end(); return; }
      const bytes = await readFile(resolve(root, relative));
      res.setHeader('Content-Type', {'.html':'text/html; charset=utf-8', '.mjs':'text/javascript', '.js':'text/javascript', '.png':'image/png'}[extname(relative)] ?? 'application/octet-stream');
      res.end(req.method === 'HEAD' ? undefined : bytes);
    } catch (error) { res.writeHead(error.code === 'ENOENT' ? 404 : 500).end('Resource unavailable'); }
  });
  await new Promise((ok, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', ok); });
  return server;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const server = await serveLookDev(Number(process.env.PORT ?? 4173));
  console.log(`Look Dev: http://localhost:${server.address().port}/`);
}

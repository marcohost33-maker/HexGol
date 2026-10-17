// GHX PR #177: bounded, fail-closed, boot-snapshot preview server.
// Trust assumption: the build-owned dist tree is quiescent throughout snapshot creation.
// No request performs a filesystem read after the HTTP server starts.
import {
  closeSync, fstatSync, lstatSync, openSync, readdirSync, readSync,
  constants as FS,
} from 'node:fs';
import { createServer, validateHeaderName, validateHeaderValue } from 'node:http';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const MIME = new Map([
  ['.html', 'text/html; charset=utf-8'], ['.js', 'text/javascript; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'], ['.css', 'text/css; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.webmanifest', 'application/manifest+json; charset=utf-8'],
  ['.svg', 'image/svg+xml'], ['.png', 'image/png'], ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'], ['.webp', 'image/webp'], ['.ico', 'image/x-icon'],
  ['.woff', 'font/woff'], ['.woff2', 'font/woff2'],
]);

// This preview only emulates the one current wildcard CSP/security-header block.
// Reject other Pages _headers constructs rather than certify a different policy.
const PREVIEW_HEADERS = new Set([
  'content-security-policy', 'x-frame-options', 'strict-transport-security',
  'x-content-type-options', 'referrer-policy', 'permissions-policy',
]);
export function parseWildcardHeaders(text) {
  const headers = new Map();
  const seen = new Set();
  let blocks = 0;
  let within = false;
  for (const raw of String(text).split(/\r?\n/)) {
    if (Buffer.byteLength(raw, 'utf8') > 2000)
      throw new Error('Pages _headers line exceeds 2000 bytes');
    const trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    if (!/^\s/.test(raw)) {
      // Pages also supports route-specific blocks, duplicate header rules,
      // detach syntax, placeholders and splats: this oracle supports none.
      if (trimmed !== '/*' || ++blocks !== 1)
        throw new Error('unsupported Cloudflare Pages header rule');
      within = true;
      continue;
    }
    if (!within) throw new Error('orphan _headers field');
    const pos = trimmed.indexOf(':');
    if (pos < 1) throw new Error('malformed _headers field');
    const name = trimmed.slice(0, pos).trim();
    const value = trimmed.slice(pos + 1).trim();
    validateHeaderName(name);
    const normalized = name.toLowerCase();
    if (!PREVIEW_HEADERS.has(normalized) || !value || seen.has(normalized))
      throw new Error('unsupported, empty or duplicate security header');
    validateHeaderValue(name, value);
    seen.add(normalized);
    headers.set(normalized === 'content-security-policy' ? 'Content-Security-Policy' : name, value);
  }
  if (blocks !== 1) throw new Error('missing exact wildcard rule');
  if (!seen.has('content-security-policy')) throw new Error('missing wildcard CSP');
  return headers;
}

function readExactly(fd, size) {
  // Never read past the initially budgeted size, even if the file grows
  // after the first fstat. An extra-byte probe detects unexpected growth.
  const buffer = Buffer.alloc(size);
  let offset = 0;
  while (offset < size) {
    const count = readSync(fd, buffer, offset, size - offset, null);
    if (count <= 0) throw new Error('asset truncated during snapshot');
    offset += count;
  }
  const probe = Buffer.alloc(1);
  if (readSync(fd, probe, 0, 1, null) !== 0)
    throw new Error('asset grew during snapshot');
  return buffer;
}

function requireSafeFile(path, remainingBytes) {
  const st = lstatSync(path, { bigint: true });
  if (!st.isFile() || st.isSymbolicLink()) throw new Error(`non-regular asset rejected: ${path}`);
  if (st.size > BigInt(remainingBytes))
    throw new Error(`asset snapshot exceeds budget: ${path}`);
  // O_NOFOLLOW protects only the leaf; parent swap during boot requires a
  // trusted frozen-build/OS-isolation guarantee, outside this portable JS code.
  // Windows has no O_NOFOLLOW (the flag is undefined there). On every platform the
  // opened handle must be the very file lstat saw as a regular non-symlink: a link
  // swapped in between resolves to another dev/ino and is rejected.
  const fd = openSync(path, FS.O_RDONLY | (FS.O_NOFOLLOW ?? 0) | (FS.O_NONBLOCK ?? 0));
  try {
    const opened = fstatSync(fd, { bigint: true });
    if (opened.dev !== st.dev || opened.ino !== st.ino)
      throw new Error(`asset identity changed between lstat and open: ${path}`);
    if (!opened.isFile() || opened.size !== st.size || opened.size > BigInt(remainingBytes))
      throw new Error(`invalid opened file: ${path}`);
    const bytes = readExactly(fd, Number(opened.size));
    const after = fstatSync(fd, { bigint: true });
    if (opened.size !== after.size || opened.mtimeNs !== after.mtimeNs ||
        opened.ctimeNs !== after.ctimeNs || opened.ino !== after.ino || opened.dev !== after.dev)
      throw new Error(`asset changed during snapshot: ${path}`);
    return bytes;
  } finally {
    closeSync(fd);
  }
}

export function buildSnapshot(distDir, {
  maxFiles = 5000, maxBytes = 64 * 1024 * 1024, maxDirs = 1024, maxDepth = 32,
} = {}) {
  if (!Number.isSafeInteger(maxFiles) || maxFiles <= 0 ||
      !Number.isSafeInteger(maxBytes) || maxBytes <= 0 ||
      !Number.isSafeInteger(maxDirs) || maxDirs <= 0 ||
      !Number.isSafeInteger(maxDepth) || maxDepth <= 0)
    throw new Error('invalid snapshot limits');
  const base = resolve(distDir);
  const root = lstatSync(base);
  if (!root.isDirectory() || root.isSymbolicLink()) throw new Error('dist must be a real directory');
  const assets = new Map();
  const dirs = new Set(['']);
  let totalBytes = 0;
  let totalFiles = 0;
  let totalDirs = 1;
  function walk(dir, rel, depth) {
    for (const child of readdirSync(dir, { withFileTypes: true })) {
      const childRel = rel ? `${rel}/${child.name}` : child.name;
      const childPath = join(dir, child.name);
      const st = lstatSync(childPath); // ignore d_type alone: source can change
      if (st.isSymbolicLink()) throw new Error(`symlink rejected: ${childRel}`);
      if (st.isDirectory()) {
        totalDirs++;
        if (totalDirs > maxDirs || depth >= maxDepth)
          throw new Error('snapshot directory or depth budget exceeded');
        dirs.add(childRel);
        walk(childPath, childRel, depth + 1);
      } else if (st.isFile()) {
        totalFiles++;
        if (totalFiles > maxFiles) throw new Error('snapshot file-count budget exceeded');
        const bytes = requireSafeFile(childPath, maxBytes - totalBytes);
        totalBytes += bytes.length;
        assets.set(childRel, bytes);
      } else {
        throw new Error(`special asset rejected: ${childRel}`);
      }
    }
  }
  walk(base, '', 0);
  if (!assets.has('_headers')) throw new Error('missing dist/_headers');
  if (!assets.has('index.html')) throw new Error('missing dist/index.html');
  if (assets.get('_headers').length > 64 * 1024) throw new Error('_headers budget exceeded');
  const headers = parseWildcardHeaders(assets.get('_headers').toString('utf8'));
  if (headers.size > 128) throw new Error('header-count budget exceeded');
  for (const [name, value] of headers) {
    validateHeaderValue(name, value);
  }
  return { assets, dirs, headers, fileCount: totalFiles, byteCount: totalBytes };
}

function requestKey(target) {
  if (typeof target !== 'string' || !target.startsWith('/') || target.startsWith('//'))
    return null;
  const raw = target.split('?')[0];
  let decoded;
  try { decoded = decodeURIComponent(raw); } catch { return null; }
  if (decoded.includes('\\') || /[\x00-\x1f\x7f]/.test(decoded) || decoded.startsWith('//'))
    return null;
  const segments = decoded.split('/').slice(1);
  if (segments.some(s => s === '.' || s === '..')) return null;
  return segments.join('/').replace(/\/+$/, '');
}

export async function startProductionHeaderServer({
  distDir, host = '127.0.0.1', port = 4173,
  maxFiles = 5000, maxBytes = 64 * 1024 * 1024, maxDirs = 1024, maxDepth = 32,
}) {
  // Build before listening; reject all symlinks and oversize snapshots at startup.
  const snapshot = buildSnapshot(distDir, { maxFiles, maxBytes, maxDirs, maxDepth });
  const { assets, dirs, headers } = snapshot;
  const server = createServer((req, res) => {
    for (const [key, value] of headers) res.setHeader(key, value);
    res.setHeader('Cache-Control', 'no-store');
    const done = (code, body = '') => {
      res.writeHead(code);
      res.end(req.method === 'HEAD' ? undefined : body);
    };
    if (req.method !== 'HEAD' && req.method !== 'GET') {
      res.setHeader('Allow', 'GET, HEAD');
      done(405, 'method not allowed');
      return;
    }
    const key = requestKey(req.url);
    if (key === null) { done(400, 'bad path'); return; }
    if (key === '_headers' || key === '_redirects') { done(404, 'not found'); return; }
    let requested = !key ? 'index.html' : key;
    if (dirs.has(key)) requested = key ? `${key}/index.html` : 'index.html';
    let bytes = assets.get(requested);
    // Do not turn missing JS, CSS, source maps or worker scripts into 200 HTML.
    if (!bytes && !requested.split('/').at(-1).includes('.') &&
        String(req.headers.accept ?? '').includes('text/html')) {
      requested = 'index.html';
      bytes = assets.get(requested);
    }
    if (!bytes) { done(404, 'not found'); return; }
    res.setHeader('Content-Type', MIME.get(extname(requested).toLowerCase()) ?? 'application/octet-stream');
    res.setHeader('Content-Length', bytes.length);
    res.writeHead(200);
    res.end(req.method === 'HEAD' ? undefined : bytes);
  });
  await new Promise((yes, no) => {
    server.once('error', no);
    server.listen(port, host, () => { server.off('error', no); yes(); });
  });
  const addr = server.address();
  if (!addr || typeof addr === 'string') throw new Error('invalid listening address');
  return {
    origin: `http://${host}:${addr.port}`,
    csp: headers.get('Content-Security-Policy'),
    snapshot: { fileCount: snapshot.fileCount, byteCount: snapshot.byteCount },
    close: () => new Promise((yes, no) => server.close(err => err ? no(err) : yes())),
  };
}

const invoked = process.argv[1] ? resolve(process.argv[1]) : null;
if (invoked === resolve(fileURLToPath(import.meta.url))) {
  const distDir = process.env.GHX_DIST ?? resolve(process.cwd(), 'dist');
  const port = Number(process.env.PORT ?? 4173);
  const running = await startProductionHeaderServer({ distDir, port });
  console.log(`bounded preview listening at ${running.origin}`);
}

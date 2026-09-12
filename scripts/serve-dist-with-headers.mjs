// Minimal production-header server for browser security tests.
//
// Vite preview does not apply Cloudflare Pages' `dist/_headers`. This server is
// deliberately boring: it serves the already-built dist tree and applies the
// repository's `/*` header block to every response, including HTML, service
// worker scripts, module chunks and dedicated worker scripts.
import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const MIME = new Map([
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".webmanifest", "application/manifest+json; charset=utf-8"],
  [".svg", "image/svg+xml"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".webp", "image/webp"],
  [".ico", "image/x-icon"],
  [".woff", "font/woff"],
  [".woff2", "font/woff2"],
]);

export function parseWildcardHeaders(text) {
  const headers = new Map();
  let inWildcard = false;
  for (const rawLine of String(text).split(/\r?\n/)) {
    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    if (!/^\s/.test(rawLine)) {
      inWildcard = trimmed === "/*";
      continue;
    }
    if (!inWildcard) continue;
    const colon = trimmed.indexOf(":");
    if (colon <= 0) continue;
    const name = trimmed.slice(0, colon).trim();
    const value = trimmed.slice(colon + 1).trim();
    if (name && value) headers.set(name, value);
  }
  return headers;
}

function safePath(distDir, pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  const relativePath = decoded.replace(/^\/+/, "");
  const candidate = resolve(distDir, relativePath || "index.html");
  const prefix = distDir.endsWith(sep) ? distDir : `${distDir}${sep}`;
  if (candidate !== distDir && !candidate.startsWith(prefix)) return null;
  return candidate;
}

export async function startProductionHeaderServer({ distDir, host = "127.0.0.1", port = 4173 }) {
  const absoluteDist = resolve(distDir);
  const headersPath = resolve(absoluteDist, "_headers");
  if (!existsSync(headersPath)) throw new Error(`missing ${headersPath}`);
  const wildcardHeaders = parseWildcardHeaders(readFileSync(headersPath, "utf8"));
  if (!wildcardHeaders.has("Content-Security-Policy")) {
    throw new Error("dist/_headers wildcard block has no Content-Security-Policy");
  }

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", `http://${host}`);
    let filePath = safePath(absoluteDist, url.pathname);
    if (!filePath) {
      res.writeHead(400);
      res.end("bad path");
      return;
    }

    if (existsSync(filePath) && statSync(filePath).isDirectory()) {
      filePath = resolve(filePath, "index.html");
    }
    if (!existsSync(filePath) || !statSync(filePath).isFile()) {
      const acceptsHtml = String(req.headers.accept ?? "").includes("text/html");
      if (acceptsHtml) filePath = resolve(absoluteDist, "index.html");
    }
    if (!existsSync(filePath) || !statSync(filePath).isFile()) {
      res.writeHead(404);
      res.end("not found");
      return;
    }

    for (const [name, value] of wildcardHeaders) res.setHeader(name, value);
    res.setHeader(
      "Content-Type",
      MIME.get(extname(filePath).toLowerCase()) ?? "application/octet-stream",
    );
    res.setHeader("Content-Length", statSync(filePath).size);

    if (req.method === "HEAD") {
      res.writeHead(200);
      res.end();
      return;
    }
    if (req.method !== "GET") {
      res.writeHead(405, { Allow: "GET, HEAD" });
      res.end("method not allowed");
      return;
    }

    res.writeHead(200);
    createReadStream(filePath).pipe(res);
  });

  await new Promise((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      resolveListen();
    });
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("server did not expose a TCP address");
  }

  return {
    origin: `http://${host}:${address.port}`,
    csp: wildcardHeaders.get("Content-Security-Policy"),
    close: () =>
      new Promise((resolveClose, reject) =>
        server.close((error) => (error ? reject(error) : resolveClose())),
      ),
  };
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : null;
if (invokedPath && invokedPath === resolve(fileURLToPath(import.meta.url))) {
  const distDir = process.env.GHX_DIST ?? resolve(process.cwd(), "dist");
  const port = Number(process.env.PORT ?? 4173);
  const running = await startProductionHeaderServer({ distDir, port });
  console.log(`production-header preview listening at ${running.origin}`);
}

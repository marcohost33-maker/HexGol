import { createHash } from "node:crypto";

// Deterministic content identity for one complete precached shell generation.
// Paths are part of the identity and entries are sorted so caller iteration order
// cannot create spurious worker updates.
export function fingerprintEntries(entries) {
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new TypeError("PWA fingerprint requires at least one entry");
  }

  const normalized = entries.map(({ path, content }) => {
    if (typeof path !== "string" || path.length === 0) {
      throw new TypeError("PWA fingerprint entry path must be a non-empty string");
    }
    if (!(typeof content === "string" || Buffer.isBuffer(content) || ArrayBuffer.isView(content))) {
      throw new TypeError(`PWA fingerprint entry '${path}' has unsupported content`);
    }
    return { path, content };
  }).sort((a, b) => a.path.localeCompare(b.path));

  const seen = new Set();
  const hash = createHash("sha256");
  for (const entry of normalized) {
    if (seen.has(entry.path)) throw new Error(`duplicate PWA fingerprint path: ${entry.path}`);
    seen.add(entry.path);
    hash.update(entry.path, "utf8");
    hash.update("\0", "utf8");
    hash.update(entry.content);
    hash.update("\0", "utf8");
  }
  return hash.digest("hex").slice(0, 20);
}

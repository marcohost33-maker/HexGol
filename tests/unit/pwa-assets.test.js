import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");

function readJson(path) {
  return JSON.parse(readFileSync(resolve(root, path), "utf8"));
}

describe("PWA/mobile manifest assets", () => {
  it("ships an install manifest with relative scope-safe paths", () => {
    const manifest = readJson("public/manifest.webmanifest");
    expect(manifest.name).toBe("GolHex");
    expect(manifest.short_name).toBe("GolHex");
    expect(manifest.display).toBe("standalone");
    expect(manifest.start_url).toBe(".");
    expect(manifest.scope).toBe(".");
    expect(manifest.icons.map((icon) => icon.src)).toEqual([
      "icon.svg",
      "icon-192.png",
      "icon-512.png",
    ]);
  });

  it("keeps all manifest icon targets present in public/", () => {
    for (const file of ["icon.svg", "icon-192.png", "icon-512.png", "apple-touch-icon.png"]) {
      expect(existsSync(resolve(root, "public", file)), file).toBe(true);
    }
  });
});

describe("PWA service-worker registration", () => {
  const main = readFileSync(resolve(root, "src/main.jsx"), "utf8");

  it("registers public/sw.js from src/main.jsx", () => {
    expect(main).toMatch(/navigator\.serviceWorker\.register\(/);
    expect(main).toContain("sw.js");
  });

  it("registers only in Production and guards the API", () => {
    expect(main).toContain("import.meta.env.PROD");
    expect(main).toContain('"serviceWorker" in navigator');
  });

  it("uses a base-URL-safe scope so root and subpath both work", () => {
    expect(main).toContain("import.meta.env.BASE_URL");
    expect(main).toMatch(/scope:\s*base/);
  });

  it("bypasses the HTTP cache for worker and importScripts update checks", () => {
    expect(main).toMatch(/updateViaCache:\s*"none"/);
  });
});

describe("service worker cache/update strategy (#115/#159)", () => {
  const sw = readFileSync(resolve(root, "public/sw.js"), "utf8");
  const vite = readFileSync(resolve(root, "vite.config.js"), "utf8");

  it("imports build-specific metadata and derives the cache name from the build id", () => {
    expect(sw).toContain('importScripts("./sw-version.js")');
    expect(sw).toMatch(/CACHE_NAME\s*=\s*`\$\{CACHE_PREFIX\}\$\{SAFE_BUILD_ID\}`/);
    expect(vite).toContain('fileName: "sw-version.js"');
    expect(vite).toContain("generatedAssets");
    expect(vite).toContain("__GOLHEX_PRECACHE__");
  });

  it("atomically precaches generated Vite assets with the shell", () => {
    expect(sw).toContain("...GENERATED_PRECACHE");
    expect(sw).toMatch(/cache\.addAll\(APP_SHELL\)/);
  });

  it("network-firsts navigation requests and keeps HTML fallback navigation-only", () => {
    expect(sw).toMatch(/request\.mode\s*===\s*"navigate"/);
    const navigationBody = sw.slice(sw.indexOf("function networkFirstShell"), sw.indexOf("async function cacheFirst"));
    expect(navigationBody).toMatch(/fetch\(request\)/);
    expect(navigationBody).toMatch(/cache\.match\("\.\/"\)/);

    const assetBody = sw.slice(sw.indexOf("async function cacheFirst"), sw.indexOf("function authoritativeNetworkRequest"));
    expect(assetBody).not.toMatch(/match\("\.\/"\)/);
    expect(assetBody).toContain("Response.error()");
  });

  it("treats runtime cache persistence as best-effort, independent of network success", () => {
    const assetBody = sw.slice(sw.indexOf("async function cacheFirst"), sw.indexOf("function authoritativeNetworkRequest"));
    expect(assetBody).toMatch(/let cache = null/);
    expect(assetBody).toMatch(/cache\.put\(request, response\.clone\(\)\)\.catch\(\(\) => undefined\)/);
    expect(assetBody).toMatch(/event\.waitUntil\(cacheWrite\)/);
    expect(assetBody.indexOf("let response;")).toBeGreaterThan(assetBody.indexOf("cache = null"));
    expect(assetBody.lastIndexOf("return response;")).toBeGreaterThan(assetBody.indexOf("event.waitUntil(cacheWrite)"));
  });

  it("does not force a waiting worker over pages still using old hashed assets", () => {
    // Match the executable API calls used by the old worker, not explanatory
    // comments such as "No clients.claim()".
    expect(sw).not.toMatch(/\bself\.skipWaiting\s*\(/);
    expect(sw).not.toMatch(/\bself\.clients\.claim\s*\(/);
  });

  it("routes provenance metadata before navigation fallback and bypasses HTTP cache", () => {
    const fetchHandler = sw.slice(sw.indexOf('self.addEventListener("fetch"'));
    const metadataIndex = fetchHandler.indexOf('url.pathname.endsWith("/version.json")');
    const navigationIndex = fetchHandler.indexOf('request.mode === "navigate"');
    expect(metadataIndex).toBeGreaterThanOrEqual(0);
    expect(navigationIndex).toBeGreaterThanOrEqual(0);
    expect(metadataIndex).toBeLessThan(navigationIndex);
    expect(sw).toMatch(/new Request\(request, \{ cache: "no-store" \}\)/);
    expect(fetchHandler).toMatch(/event\.respondWith\(fetch\(authoritativeNetworkRequest\(request\)\)\)/);
  });
});

describe("index.html asset paths are base-URL-safe", () => {
  const html = readFileSync(resolve(root, "index.html"), "utf8");

  it("uses %BASE_URL% for manifest + all icon links", () => {
    for (const asset of [
      "manifest.webmanifest",
      "icon.svg",
      "icon-192.png",
      "apple-touch-icon.png",
    ]) {
      expect(html).toContain(`%BASE_URL%${asset}`);
    }
  });

  it("has no absolute-root href for manifest/icon assets", () => {
    expect(html).not.toMatch(/href="\/(manifest\.webmanifest|icon\.svg|icon-192\.png|apple-touch-icon\.png)"/);
  });
});

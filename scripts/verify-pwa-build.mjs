import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, relative, sep, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const dist = resolve(root, "dist");

function fail(message) {
  console.error(`[pwa-build] FAIL: ${message}`);
  process.exitCode = 1;
  throw new Error(message);
}

function readRequired(path) {
  if (!existsSync(path)) fail(`missing required build output: ${relative(root, path)}`);
  return readFileSync(path, "utf8");
}

function walkFiles(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const name of readdirSync(dir)) {
    const path = resolve(dir, name);
    if (statSync(path).isDirectory()) out.push(...walkFiles(path));
    else out.push(path);
  }
  return out;
}

function parseAssignment(source, name) {
  const re = new RegExp(`^self\\.${name}\\s*=\\s*(.+);\\s*$`, "m");
  const match = source.match(re);
  if (!match) fail(`sw-version.js missing self.${name} assignment`);
  try {
    return JSON.parse(match[1]);
  } catch (error) {
    fail(`self.${name} is not JSON-literal parseable: ${error.message}`);
  }
}

const sw = readRequired(resolve(dist, "sw.js"));
const swVersion = readRequired(resolve(dist, "sw-version.js"));
const versionJson = JSON.parse(readRequired(resolve(dist, "version.json")));

if (!sw.includes('importScripts("./sw-version.js")')) {
  fail("sw.js does not import build-specific sw-version.js");
}

const buildId = parseAssignment(swVersion, "__GOLHEX_BUILD__");
const precache = parseAssignment(swVersion, "__GOLHEX_PRECACHE__");
if (typeof buildId !== "string" || buildId.length === 0) fail("empty build id");
if (!Array.isArray(precache)) fail("precache metadata is not an array");
if (versionJson.build !== buildId) fail("version.json build id differs from sw-version.js");
if (new Set(precache).size !== precache.length) fail("precache metadata contains duplicate URLs");

const actualAssets = walkFiles(resolve(dist, "assets"))
  .map((path) => `./${relative(dist, path).split(sep).join("/")}`)
  .sort();
const listedAssets = [...precache].sort();

if (JSON.stringify(actualAssets) !== JSON.stringify(listedAssets)) {
  const missing = actualAssets.filter((path) => !precache.includes(path));
  const stale = precache.filter((path) => !actualAssets.includes(path));
  fail(`precache closure mismatch; missing=${JSON.stringify(missing)} stale=${JSON.stringify(stale)}`);
}

for (const url of precache) {
  if (!url.startsWith("./assets/")) fail(`unexpected generated precache URL: ${url}`);
  const path = resolve(dist, url.slice(2));
  if (!existsSync(path)) fail(`precache URL has no build artifact: ${url}`);
}

console.log(`[pwa-build] OK build=${buildId} generated-assets=${precache.length}`);

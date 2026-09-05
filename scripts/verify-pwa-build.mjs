import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, relative, sep, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { fingerprintEntries } from "./pwa-fingerprint.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const dist = resolve(root, "dist");
const PUBLIC_SHELL_FILES = Object.freeze([
  "manifest.webmanifest",
  "icon.svg",
  "icon-192.png",
  "icon-512.png",
  "apple-touch-icon.png",
]);

function fail(message) {
  console.error(`[pwa-build] FAIL: ${message}`);
  process.exitCode = 1;
  throw new Error(message);
}

function requiredPath(path) {
  if (!existsSync(path)) fail(`missing required build output: ${relative(root, path)}`);
  return path;
}

function readRequired(path) {
  return readFileSync(requiredPath(path), "utf8");
}

function readRequiredBytes(path) {
  return readFileSync(requiredPath(path));
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

// Recompute identity from the exact bytes that Cache.addAll(APP_SHELL) will
// persist. This proves the worker generation changes when HTML, manifest, icons,
// or any generated asset changes -- even in a dirty/non-git local build.
const shellEntries = [
  { path: "./", content: readRequiredBytes(resolve(dist, "index.html")) },
  ...actualAssets.map((url) => ({
    path: url,
    content: readRequiredBytes(resolve(dist, url.slice(2))),
  })),
  ...PUBLIC_SHELL_FILES.map((fileName) => ({
    path: `./${fileName}`,
    content: readRequiredBytes(resolve(dist, fileName)),
  })),
];
const expectedFingerprint = fingerprintEntries(shellEntries);
if (!buildId.endsWith(`-${expectedFingerprint}`)) {
  fail(`build id does not fingerprint complete precached shell; expected suffix=${expectedFingerprint} actual=${buildId}`);
}

console.log(
  `[pwa-build] OK build=${buildId} generated-assets=${precache.length} shell-fingerprint=${expectedFingerprint}`,
);

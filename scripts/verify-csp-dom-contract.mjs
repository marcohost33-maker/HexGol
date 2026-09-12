// Standards-based HTML structure gate for the CSP contract (Issue #176).
//
// This is intentionally a separate migration layer next to the legacy
// verify-csp-contract.mjs. HTML tokenization, entity decoding, element/attribute
// boundaries and script source locations are delegated to JSDOM's HTML parser
// instead of being reconstructed with regexes and a partial entity table.
//
// This gate answers only DOM/HTML questions. Directive-specific CSP source-list
// semantics remain a separate layer and the legacy guard remains temporarily in
// the build until that migration is complete.
import { strict as assert } from "node:assert";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const dist = process.env.GHX_CSP_DIST ? resolve(process.env.GHX_CSP_DIST) : resolve(root, "dist");
const htmlPath = resolve(dist, "index.html");
const failures = [];

function fail(message) {
  failures.push(message);
}

if (!existsSync(htmlPath)) {
  fail(`missing build output: ${relative(root, htmlPath)}`);
}

const html = existsSync(htmlPath) ? readFileSync(htmlPath, "utf8") : "";
const dom = new JSDOM(html, {
  includeNodeLocations: true,
  url: "https://golhex.invalid/",
});
const { document } = dom.window;

// WHATWG/JSDOM has already decoded character references in attribute values and
// constructed the DOM tree. Do not decode entities again here.
const INLINE_HANDLER_NAME = /^on[a-z]+$/i;
const SCRIPT_URL_ATTRIBUTES = new Set([
  "href",
  "src",
  "action",
  "formaction",
  "data",
  "xlink:href",
]);
const SCRIPT_PROTOCOLS = new Set([
  "javascript:",
  "vbscript:",
  "livescript:",
  "jscript:",
  "mocha:",
]);
const CSP_CONTROLLED_INLINE_SCRIPT_TYPES = new Set([
  "",
  "module",
  "text/javascript",
  "application/javascript",
  "text/ecmascript",
  "application/ecmascript",
  "importmap",
  "speculationrules",
]);

function parsedProtocol(raw) {
  try {
    return new URL(raw, dom.window.location.href).protocol.toLowerCase();
  } catch {
    // An invalid URL is not silently converted into executable JavaScript by the
    // URL parser. Directive-specific invalid/allowed resource handling belongs to
    // the policy layer, not this DOM structure layer.
    return null;
  }
}

const scripts = [...document.querySelectorAll("script")];
const executableInline = [];
let unterminatedScripts = 0;

for (const script of scripts) {
  const location = dom.nodeLocation(script);
  if (location && location.startTag && !location.endTag) {
    unterminatedScripts += 1;
    fail(
      "unterminated <script> in dist/index.html according to the standards parser; " +
        "a production build must not swallow the remaining document into script text",
    );
  }

  if (script.hasAttribute("src")) continue;
  const body = script.textContent ?? "";
  if (body.trim().length === 0) continue;
  const type = (script.getAttribute("type") ?? "").trim().toLowerCase();
  if (CSP_CONTROLLED_INLINE_SCRIPT_TYPES.has(type)) {
    executableInline.push({ type: type || "(none)", preview: body.trim().slice(0, 80) });
  }
  // Other type values are HTML data blocks, not executable classic/module script.
}

const inlineScriptSources = [];
const elements = [...document.querySelectorAll("*")];
for (const element of elements) {
  for (const attribute of [...element.attributes]) {
    const name = attribute.name.toLowerCase();
    const value = attribute.value; // already HTML-entity-decoded by the parser
    if (INLINE_HANDLER_NAME.test(name)) {
      inlineScriptSources.push(`<${element.localName} ${name}=...> inline event handler`);
      continue;
    }
    if (!SCRIPT_URL_ATTRIBUTES.has(name)) continue;
    const protocol = parsedProtocol(value);
    if (protocol && SCRIPT_PROTOCOLS.has(protocol)) {
      inlineScriptSources.push(
        `<${element.localName} ${name}=...> resolves to executable scheme "${protocol}"`,
      );
    }
  }
}

for (const hit of inlineScriptSources) {
  fail(`inline script source ${hit} in dist/index.html`);
}

const inlineStyleBlocks = [...document.querySelectorAll("style")].filter(
  (element) => (element.textContent ?? "").trim().length > 0,
);

assert(elements.length > 0 || html.trim().length === 0, "standards parser returned no elements");

console.log(
  "CSP DOM contract metrics: " +
    `dom-elements=${elements.length}, ` +
    `script-elements=${scripts.length}, ` +
    `unterminated-scripts=${unterminatedScripts}, ` +
    `executable-inline-scripts=${executableInline.length}, ` +
    `inline-script-sources=${inlineScriptSources.length}, ` +
    `inline-style-blocks=${inlineStyleBlocks.length}`,
);

if (failures.length > 0) {
  for (const message of failures) console.error(`CSP DOM contract FAIL: ${message}`);
  process.exitCode = 1;
} else {
  console.log("CSP DOM contract OK: standards parser found no prohibited inline script source");
}

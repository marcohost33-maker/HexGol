// Standards-based HTML structure gate for the CSP contract (Issue #176).
//
// This migration stage delegates HTML tokenization, entity decoding, namespaces,
// template contents and source locations to parse5 instead of reconstructing
// browser parsing with regexes. It intentionally answers DOM-structure questions
// only; directive-specific CSP source-list semantics stay in the policy layer.
//
// NOTE: parse5@8.0.1 is currently present in package-lock.json through jsdom.
// This gate imports parse5 directly so Node 20 builds do not load jsdom@30's
// Node-22-only runtime. Issue #181 tracks promotion to an explicit direct
// devDependency with a real npm-regenerated lockfile; do not hand-edit the lock.
import { strict as assert } from "node:assert";
import { existsSync, readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defaultTreeAdapter, parse } from "parse5";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const dist = process.env.GHX_CSP_DIST ? resolve(process.env.GHX_CSP_DIST) : resolve(root, "dist");
const htmlPath = resolve(dist, "index.html");
const BASE_URL = "https://golhex.invalid/";
const HTML_NS = "http://www.w3.org/1999/xhtml";
const SVG_NS = "http://www.w3.org/2000/svg";
const MAX_SRCDOC_DEPTH = 8;

const failures = [];
const metrics = {
  documents: 0,
  elements: 0,
  scripts: 0,
  unterminatedScripts: 0,
  executableInlineScripts: 0,
  inlineScriptSources: 0,
  inlineStyleBlocks: 0,
  srcdocDocuments: 0,
};

const JAVASCRIPT_MIME_ESSENCES = new Set([
  "application/ecmascript",
  "application/javascript",
  "application/x-ecmascript",
  "application/x-javascript",
  "text/ecmascript",
  "text/javascript",
  "text/javascript1.0",
  "text/javascript1.1",
  "text/javascript1.2",
  "text/javascript1.3",
  "text/javascript1.4",
  "text/javascript1.5",
  "text/jscript",
  "text/livescript",
  "text/x-ecmascript",
  "text/x-javascript",
]);

function fail(message) {
  failures.push(message);
}

function attrMap(element) {
  const result = new Map();
  for (const attribute of defaultTreeAdapter.getAttrList(element)) {
    const qualifiedName = attribute.prefix ? `${attribute.prefix}:${attribute.name}` : attribute.name;
    result.set(qualifiedName.toLowerCase(), attribute.value);
  }
  return result;
}

function nodeText(node) {
  if (defaultTreeAdapter.isTextNode(node)) {
    return defaultTreeAdapter.getTextNodeContent(node);
  }
  if (!Array.isArray(node.childNodes)) return "";
  return defaultTreeAdapter.getChildNodes(node).map(nodeText).join("");
}

function isExecutableInlineScriptType(attrs) {
  // HTML's script-type algorithm gives `type` precedence. If `type` is absent,
  // the obsolete `language` attribute still participates as `text/<language>`.
  // Missing/empty type+language is the classic-JavaScript default.
  if (attrs.has("type")) {
    const type = attrs.get("type").trim().toLowerCase();
    return (
      type === "" ||
      type === "module" ||
      type === "importmap" ||
      type === "speculationrules" ||
      JAVASCRIPT_MIME_ESSENCES.has(type)
    );
  }

  const language = (attrs.get("language") ?? "").trim().toLowerCase();
  if (language === "") return true;
  return JAVASCRIPT_MIME_ESSENCES.has(`text/${language}`);
}

function parsedProtocol(raw) {
  try {
    return new URL(raw, BASE_URL).protocol.toLowerCase();
  } catch {
    return null;
  }
}

function isJavaScriptNavigationSink(namespace, tag, attribute) {
  if (namespace === SVG_NS) {
    return tag === "a" && (attribute === "href" || attribute === "xlink:href");
  }
  if (namespace !== HTML_NS) return false;

  if ((tag === "a" || tag === "area") && attribute === "href") return true;
  if (tag === "form" && attribute === "action") return true;
  if ((tag === "iframe" || tag === "frame") && attribute === "src") return true;
  if ((tag === "button" || tag === "input") && attribute === "formaction") return true;
  return false;
}

function inspectDocument(source, depth = 0, label = "dist/index.html") {
  if (depth > MAX_SRCDOC_DEPTH) {
    fail(`${label}: nested iframe srcdoc depth exceeds ${MAX_SRCDOC_DEPTH}`);
    return;
  }

  metrics.documents += 1;
  const document = parse(source, { sourceCodeLocationInfo: true });
  walk(document, depth, label);

  function walk(node, currentDepth, currentLabel) {
    if (defaultTreeAdapter.isElementNode(node)) {
      inspectElement(node, currentDepth, currentLabel);
    }

    if (Array.isArray(node.childNodes)) {
      for (const child of defaultTreeAdapter.getChildNodes(node)) {
        walk(child, currentDepth, currentLabel);
      }
    }

    if (
      defaultTreeAdapter.isElementNode(node) &&
      defaultTreeAdapter.getNamespaceURI(node) === HTML_NS &&
      defaultTreeAdapter.getTagName(node) === "template"
    ) {
      const content = defaultTreeAdapter.getTemplateContent(node);
      for (const child of defaultTreeAdapter.getChildNodes(content)) {
        walk(child, currentDepth, `${currentLabel} <template>`);
      }
    }
  }

  function sourceStartTagIsSelfClosing(location) {
    const startTag = location?.startTag;
    if (
      !startTag ||
      !Number.isInteger(startTag.startOffset) ||
      !Number.isInteger(startTag.endOffset)
    ) {
      return false;
    }
    return /\/\s*>$/.test(source.slice(startTag.startOffset, startTag.endOffset));
  }

  function inspectElement(element, currentDepth, currentLabel) {
    metrics.elements += 1;
    const tag = defaultTreeAdapter.getTagName(element).toLowerCase();
    const namespace = defaultTreeAdapter.getNamespaceURI(element);
    const attrs = attrMap(element);

    for (const [name, value] of attrs) {
      if (/^on[a-z]+$/i.test(name)) {
        metrics.inlineScriptSources += 1;
        fail(`${currentLabel}: <${tag} ${name}=...> inline event handler`);
        continue;
      }

      if (isJavaScriptNavigationSink(namespace, tag, name) && parsedProtocol(value) === "javascript:") {
        metrics.inlineScriptSources += 1;
        fail(`${currentLabel}: <${tag} ${name}=...> is a javascript: navigation target`);
      }
    }

    if (namespace === HTML_NS && tag === "iframe" && attrs.has("srcdoc")) {
      metrics.srcdocDocuments += 1;
      inspectDocument(attrs.get("srcdoc"), currentDepth + 1, `${currentLabel} iframe[srcdoc]`);
    }

    if (tag === "script") {
      metrics.scripts += 1;
      const location = defaultTreeAdapter.getNodeSourceCodeLocation(element);

      // HTML <script/> is not self-closing. SVG foreign-content <script/> is,
      // but an SVG <script> whose source has no `/>` and no parsed end tag is
      // genuinely unterminated. Check the actual start-tag slice so fixing the
      // self-closing false positive cannot create the opposite false negative.
      if (location?.startTag && !location.endTag) {
        const isTerminatedForeignSelfClose =
          namespace === SVG_NS && sourceStartTagIsSelfClosing(location);
        if (namespace === HTML_NS || (namespace === SVG_NS && !isTerminatedForeignSelfClose)) {
          metrics.unterminatedScripts += 1;
          fail(
            `${currentLabel}: unterminated ${namespace === SVG_NS ? "SVG" : "HTML"} <script>; ` +
              "production markup must not consume input until EOF",
          );
        }
      }

      if (!attrs.has("src")) {
        const body = nodeText(element);
        if (body.trim().length > 0 && isExecutableInlineScriptType(attrs)) {
          metrics.executableInlineScripts += 1;

          // The legacy top-document policy scanner cannot see entity-decoded
          // markup embedded in iframe[srcdoc]. The deployed contract is
          // `script-src 'self'`, so an executable inline script in a recursively
          // parsed child document is a real production CSP violation, not merely
          // a metric. Fail here rather than reporting a count that no later gate
          // can authorize or reject.
          if (currentDepth > 0) {
            metrics.inlineScriptSources += 1;
            fail(
              `${currentLabel}: executable inline <script> in iframe[srcdoc] is not ` +
                "authorized by the deployed script-src 'self' contract",
            );
          }
        }
      }
    }

    if (tag === "style" && nodeText(element).trim().length > 0) {
      metrics.inlineStyleBlocks += 1;
    }
  }
}

if (!existsSync(htmlPath)) {
  fail(`missing build output: ${relative(root, htmlPath)}`);
} else {
  inspectDocument(readFileSync(htmlPath, "utf8"));
}

assert(
  metrics.elements > 0 || !existsSync(htmlPath),
  "standards parser returned no elements for a non-empty production document",
);

console.log(
  "CSP DOM structure metrics: " +
    `documents=${metrics.documents}, ` +
    `dom-elements=${metrics.elements}, ` +
    `script-elements=${metrics.scripts}, ` +
    `unterminated-scripts=${metrics.unterminatedScripts}, ` +
    `executable-inline-scripts=${metrics.executableInlineScripts}, ` +
    `inline-script-sources=${metrics.inlineScriptSources}, ` +
    `inline-style-blocks=${metrics.inlineStyleBlocks}, ` +
    `srcdoc-documents=${metrics.srcdocDocuments}`,
);

if (failures.length > 0) {
  for (const message of failures) console.error(`CSP DOM structure FAIL: ${message}`);
  process.exitCode = 1;
} else {
  console.log(
    "CSP DOM structure OK: no inline event handlers, unterminated HTML/SVG scripts, " +
      "javascript: navigation sinks, or unauthorized nested srcdoc scripts found; " +
      "top-document inline script/style authorization remains the responsibility of the CSP policy layer.",
  );
}

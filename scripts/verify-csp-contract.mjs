// Ausgabe-Waechter fuer den CSP-Vertrag (Issue #163).
//
// WOZU
// ----
// Die Produktions-CSP steht in `public/_headers` und wird als `dist/_headers`
// ausgeliefert. Ob sie zu dem passt, was die App TATSAECHLICH braucht, stand bis
// 2026-09-12 nur als Kommentar darin -- eine Behauptung ueber ein Artefakt, das
// niemand las. Zwei Fehlerrichtungen sind dabei moeglich, und beide bleiben ohne
// Waechter still:
//
//   * Die Richtlinie ist ZU ENG fuer die Ausgabe -- die App bricht live, waehrend
//     lokal (ohne Header-Server) alles laeuft.
//   * Die Richtlinie ist ZU WEIT fuer die Ausgabe -- nichts bricht, niemand merkt
//     es, und eine Erlaubnis wie `script-src 'unsafe-inline'` bleibt stehen, lange
//     nachdem der Grund dafuer weg ist. Genau dieser Fall lag hier vor: der
//     Kommentar behauptete, Vite lege den Bootstrap inline; das erzeugte
//     dist/index.html enthielt aber nur ein externes <script src=...>.
//
// Dieser Waechter laeuft als Teil von `npm run build` (und damit im CI-Schritt
// "Build production bundle"). Er prueft das ERZEUGTE Buendel, nicht die Quelle,
// und schlaegt fail-closed fehl: im Zweifel roter Build statt stiller Drift.
//
// GEPRUEFT WIRD
// -------------
//   1. Null Referenzen auf fremde Schrift-Origins in irgendeiner Textdatei in dist/.
//   2. dist/index.html enthaelt kein ausfuehrbares Inline-<script> -- gezaehlt ueber
//      das OEFFNENDE Tag, nicht ueber ein Auf/Zu-Paar. Ein <script> ohne </script>
//      ist fuer den Parser kein defektes Element, sondern eines, dessen Rumpf bis
//      zum Dateiende reicht; das restliche Markup verschwindet darin.
//   3. dist/index.html traegt keine Ausfuehrungsstelle NEBEN dem <script>-Element:
//      weder ein Inline-Event-Handler-Attribut (onload, onerror, onclick ...) noch
//      eine URI mit einem Schema, das nicht als harmlos bekannt ist. Der Browser
//      wendet script-src auf beide an -- unabhaengig davon, ob irgendwo ein
//      Inline-<script>-Rumpf steht.
//
//      Geprueft wird dabei der DEKODIERTE Wert, nicht der Rohtext. Der Parser
//      loest Zeichenreferenzen auf, bevor er navigiert: `href="&#106;avascript:..."`
//      wird zu `javascript:...`. Ein Textvergleich auf dem Rohwert sieht davon
//      nichts -- gemessen 2026-09-12 auf 1ba42f1, Exit 0 (Befund N1).
//
//      Dieser Punkt ist zweimal gewachsen, und das zweite Mal ist die Lehre. Der
//      Review-Befund T4 nannte die Handler-Attribute; die Haertung dagegen war
//      gruen -- und stand daneben weiter offen gegen `javascript:`. Ein Waechter
//      gegen "behauptet fail-closed, ist offen" enthielt also genau diese Klasse.
//      Gegenprobe am eigenen Ergebnis, bevor sie jemand anders fuehrt:
//      script-src regelt <script>, Handler-Attribute und javascript:-URIs; alle
//      drei stehen im Markup, also gehoeren alle drei hierher.
//   4. Die CSP in dist/_headers passt zu 1. und 2.:
//        - font-src bleibt ausschliesslich 'self'
//        - script-src traegt 'unsafe-inline' GENAU DANN, wenn die Ausgabe ein
//          ausfuehrbares Inline-<script> enthaelt
//        - style-src traegt 'unsafe-inline' GENAU DANN, wenn die Ausgabe einen
//          Inline-<style>-Block enthaelt (heute: ja -- #163 Punkt 7 laesst die
//          Stil-Migration ausdruecklich aus diesem Schritt heraus)
//
// Punkt 4 ist bewusst in BEIDE Richtungen formuliert. Ein Waechter, der nur "zu
// eng" faengt, haette den Ist-Befund aus #163 nicht gefunden.
//
// Punkt 3 faellt dagegen NUR in eine Richtung: ein gefundener Inline-Handler ist
// immer ein roter Build, nie eine Erlaubnis. Die Alternative waere, Handler wie
// einen Inline-Rumpf zu zaehlen und daraufhin script-src 'unsafe-inline' zu
// VERLANGEN -- dann zoege ein einziges nachlaessig erzeugtes onerror= die Erlaubnis
// wieder auf, die #163 gerade geschlossen hat.
//
// WIE WEIT DIESE BEGRUENDUNG TRAEGT (Review #168, Runde 2, Befund N4). Hier stand
// bis 2026-09-12 der Satz "der Waechter darf die Richtlinie nicht selbsttaetig
// weiten; er darf nur haltmachen". Als allgemeine Aussage ist er FALSCH, und das
// ist nachgemessen: ein Inline-<script> zusammen mit einem von Hand gesetzten
// script-src 'unsafe-inline' ergibt hier Exit 0. Fuer die <script>-Klasse ist das
// Weiten der Richtlinie also sehr wohl ein Weg zu gruen -- absichtlich, denn genau
// die Beidseitigkeit von Punkt 4 hat den Ist-Befund aus #163 gefunden.
//
// Der Satz gilt nur fuer Punkt 3, die Handler- und URI-Klasse: dort gibt es keinen
// Weg zu gruen ausser den Fund zu entfernen. Ob script-src ueberdies NIE
// 'unsafe-inline' tragen darf, ist eine Aussage ueber die RICHTLINIE und nicht
// ueber den Waechter; sie steht offen und gehoert entschieden, nicht hier
// stillschweigend eingezogen.
import { strict as assert } from "node:assert";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, relative, dirname, extname, sep } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const dist = resolve(root, "dist");

// Fremde Schrift-Origins. Wortwoertliche Suche, keine Heuristik: ein Waechter, der
// clever ist, laesst sich austricksen, und dieser hier soll stumpf und unbestechlich
// sein. Deshalb stehen diese Hostnamen im ganzen Produktionscode NUR an dieser einen
// Stelle und in tests/unit/csp-fonts.test.js -- nicht einmal in einem Kommentar.
const REMOTE_FONT_HOSTS = Object.freeze(["fonts.googleapis.com", "fonts.gstatic.com"]);

// Binaerformate tragen keinen Quelltext; sie zu dekodieren erzeugt nur Rauschen.
// Alles Uebrige wird als Text gelesen -- unbekannte Endungen eingeschlossen, damit
// eine neue Dateiart nicht still aus der Pruefung faellt.
const BINARY_EXTENSIONS = Object.freeze([".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".woff", ".woff2", ".ttf", ".otf", ".eot", ".mp4", ".webm"]);

// Inline-<script>-Typen, die der Browser als Skript behandelt und die deshalb unter
// script-src fallen. `importmap` und `speculationrules` sind kein JavaScript, werden
// aber ebenfalls von script-src kontrolliert -- sie gehoeren also in diese Liste.
const EXECUTABLE_SCRIPT_TYPES = Object.freeze([
  "", "module", "text/javascript", "application/javascript", "text/ecmascript",
  "application/ecmascript", "importmap", "speculationrules",
]);

// Inline-Event-Handler-Attribute. Der Browser behandelt ihren Inhalt als Skript und
// unterwirft ihn script-src -- ein <img onerror="..."> bricht unter script-src 'self'
// genauso wie ein Inline-<script>. Das Muster ist bewusst leicht zu weit: HTML kennt
// kein nicht-ausfuehrbares Attribut, das mit "on" beginnt, und ein falsch gemeldetes
// Attribut kostet eine benannte Nachfrage, ein uebersehenes einen stillen Bruch live.
const INLINE_HANDLER_NAME = /^on[a-z]+$/;

// Ein Attribut-Name ist ein TOKEN, kein Teilstring. Die alte Fassung fragte hier
// /\bsrc\s*=/ -- und weil \b auch zwischen "-" und "s" liegt, galt
// <script data-src="..."> als externes Skript, obwohl sein Rumpf ausgefuehrt wird.
// Deshalb wird die Attributliste zerlegt und der Name verglichen, nicht gesucht.
const ATTRIBUTE_TOKEN = /([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]*)))?/g;

function parseAttributes(attrs) {
  const out = [];
  for (const match of String(attrs).matchAll(ATTRIBUTE_TOKEN)) {
    out.push({ name: match[1].toLowerCase(), value: match[2] ?? match[3] ?? match[4] ?? "" });
  }
  return out;
}

function hasAttribute(attrs, name) {
  return parseAttributes(attrs).some((attribute) => attribute.name === name);
}

// Alle oeffnenden Tags mit ihrer Attributliste. Kommentare und die RUMPFE von
// <script>/<style> werden vorher entfernt: dort steht kein Markup, aber sehr wohl
// Zeichen wie `a<b`, die sonst als Tag durchgingen. Die Tags selbst bleiben stehen.
function markupTags(html) {
  // Die zweite Ersetzung nimmt BEIDE Faelle: den Rumpf bis zur schliessenden Marke
  // -- und, wenn keine mehr kommt, den Rumpf bis EOF. Ohne den zweiten Ast haette
  // ein unabgeschlossenes <script> seinen Rumpf als Markup eingespeist.
  const scrubbed = String(html)
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/(<(script|style)\b(?:"[^"]*"|'[^']*'|[^>"'])*>)(?:[\s\S]*?<\/\2\s*>|[\s\S]*$)/gi, "$1");
  const out = [];
  for (const match of scrubbed.matchAll(/<([a-zA-Z][^\s/>]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>/g)) {
    out.push({ tag: match[1].toLowerCase(), attrs: match[2] });
  }
  return out;
}

// ZEICHENREFERENZEN (Review #168, Runde 2, Befund N1). Der Parser dekodiert den
// Attributwert, BEVOR navigiert wird -- `href="&#106;avascript:window.__boot()"`
// ist fuer ihn `javascript:window.__boot()`. Die alte Pruefung verglich den
// Rohtext und war deshalb gruen (gemessen 2026-09-12 auf 1ba42f1, Exit 0, in
// dezimaler, hexadezimaler, semikolonloser und benannter Form).
//
// Die volle HTML5-Tabelle hat ueber 2000 benannte Referenzen. Hier steht die
// Teilmenge, die sich zu ASCII aufloest und damit IN einem Schema stehen kann.
// Was nicht in der Tabelle steht, bleibt undekodiert -- und dafuer gibt es unten
// die fail-closed-Klausel: eine nicht aufloesbare Referenz VOR dem Pfadbeginn
// macht den Wert unentscheidbar, und unentscheidbar zaehlt als Verstoss.
//
// `Object.create(null)` und nicht `{}`: das ist keine Stilfrage. Ein gewoehnliches
// Objekt erbt von Object.prototype, und `NAMED_REFERENCES["constructor"]` liefert
// dann eine FUNKTION statt undefined. `&constructor;javascript:alert(1)` wurde
// damit zu `function Object() { [native code] }javascript:alert(1)`, trug an
// Position 0 kein Schema mehr -- und galt als harmlos. Exit 0, gemessen an der
// eigenen Fassung dieses Laufs, bevor sie jemand anders gefunden hat.
//
// Das ist wortwoertlich die Klasse, gegen die dieser Waechter gebaut ist: was er
// nicht aufloesen kann, meldete er still als Abwesenheit. Wer einen Waechter gegen
// eine Fehlerklasse baut, hat deren eben erlebte Erscheinungsform vor Augen -- ob
// die eigene Umsetzung dieselbe Klasse eine Ebene hoeher wiederholt, beurteilt
// dieselbe Faehigkeit, die eben versagt hat. Deshalb die Selbstprobe.
const NAMED_REFERENCES = Object.freeze(Object.assign(Object.create(null), {
  tab: "\t", newline: "\n", colon: ":", semi: ";", amp: "&", sol: "/", bsol: "\\",
  quot: '"', apos: "'", lt: "<", gt: ">", nbsp: "\u00a0", nonbreakingspace: "\u00a0",
  lpar: "(", rpar: ")", excl: "!", num: "#", percnt: "%", period: ".", comma: ",",
  lowbar: "_", verbar: "|", plus: "+", equals: "=", quest: "?", ast: "*", commat: "@",
  dollar: "$", grave: "'", hyphen: "-", dash: "-", sp: " ", space: " ",
}));

function decodeCharacterReferences(value) {
  let unresolved = false;
  const decoded = String(value).replace(
    /&(#[xX][0-9a-fA-F]+|#[0-9]+|[a-zA-Z][a-zA-Z0-9]*);?/g,
    (whole, ref) => {
      if (ref[0] === "#") {
        const hex = ref[1] === "x" || ref[1] === "X";
        const code = Number.parseInt(hex ? ref.slice(2) : ref.slice(1), hex ? 16 : 10);
        // Ersatzzeichen-Halbpaare (D800-DFFF) wuerfe fromCodePoint als Fehler --
        // ein abstuerzender Waechter ist kein urteilender. Sie bleiben stehen.
        if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return whole;
        if (code >= 0xd800 && code <= 0xdfff) return whole;
        return String.fromCodePoint(code);
      }
      const named = NAMED_REFERENCES[ref.toLowerCase()];
      if (named !== undefined) return named;
      unresolved = true;
      return whole;
    },
  );
  return { decoded, unresolved };
}

// Der Browser entfernt Tab, LF und CR UEBERALL aus einer URL und schneidet
// fuehrende wie schliessende C0-Steuerzeichen und Leerzeichen ab (WHATWG URL,
// "URL parsing"). `jav&Tab;ascript:` und "\u0001javascript:" sind danach beide
// wieder `javascript:` -- ein Vergleich ohne diesen Schritt sieht sie nicht.
function normalizeUriValue(value) {
  return value.replace(/[\t\n\r]/g, "").replace(/^[\u0000-\u0020]+|[\u0000-\u0020]+$/g, "");
}

// Attribute, deren Wert der Browser als URL aufloest. Nur fuer sie gilt die
// strenge Einstufung unten; ein `style="background:url(x)"` traegt sonst ein
// vermeintliches Schema "background:" und waere ein Fehlalarm.
const URI_ATTRIBUTES = Object.freeze([
  "href", "src", "action", "formaction", "data", "poster", "cite", "ping",
  "background", "longdesc", "usemap", "manifest", "icon", "codebase", "xlink:href",
]);

// POSITIV-Liste statt Sperrliste -- fuer die Attribute, auf die KEINE
// Fetch-Direktive wirkt (Navigation, Metadaten). Eine Sperrliste faengt die
// Schemata, die man schon kennt; sie hat `livescript:`, `mocha:` und das naechste
// nicht. Hier gilt umgekehrt: ohne Schema harmlos, mit Schema nur diese hier.
const HARMLESS_SCHEMES = Object.freeze(["http", "https", "mailto", "tel", "blob"]);

// Fuer Attribute AUSSERHALB der URI-Liste bleibt es bei einer Sperrliste: dort
// darf keine strenge Form verlangt werden, aber ein bekannt ausfuehrbares Schema
// soll trotzdem auffallen.
const EXECUTABLE_SCHEMES = Object.freeze(["javascript", "vbscript", "livescript", "jscript", "mocha", "data"]);

// Schemata, die eine AUSFUEHRUNGSSTELLE im Markup sind und keine Ressource. Fuer
// sie gibt es keinen Weg zu gruen ausser den Fund zu entfernen -- keine Direktive
// kann sie erlauben (ausser 'unsafe-inline', und das ist eine Entscheidung ueber
// die Richtlinie, nicht ueber den Waechter). `data:` steht bewusst NICHT hier:
// unter img-src ist es erlaubt und unter script-src verboten, also entscheidet es
// die Direktive und nicht eine feste Liste.
const SCRIPTING_SCHEMES = Object.freeze(["javascript", "vbscript", "livescript", "jscript", "mocha"]);
const SCHEME_HEAD = /^([a-zA-Z][a-zA-Z0-9+.-]*):/;

// WELCHE DIREKTIVE REGELT WAS (Review #168, Runde 3, Befund N1).
//
// Bis 2026-09-12 lag hier EINE Schema-Positivliste ueber allen URI-Attributen.
// Das ist die falsche Bauform, und zwar in beide Richtungen -- nachgemessen auf
// fe5e7b2 am echten dist/:
//
//   * `<script src="https://cdn.example/app.js">` galt als harmlos, weil https
//     auf der Liste steht. Unter `script-src 'self'` blockt der Browser genau das:
//     der Waechter meldete Exit 0 fuer eine Ausgabe, die live nicht startet.
//   * `<img src="data:image/png;base64,...">` galt als Verstoss, obwohl die CSP
//     `img-src 'self' data: blob:` ausdruecklich erlaubt -- Exit 1 auf etwas
//     Korrektem.
//   * `<img src="//cdn.example/x.png">` galt als harmlos, weil vor dem ersten `/`
//     kein Schema steht. Eine schema-relative URL ist aber eine FREMDE Origin;
//     das ist derselbe Fehler wie der erste, nur ohne Schema. (Nicht aus dem
//     Review -- Gegenprobe am eigenen Ergebnis.)
//
// Eine URL ist also nicht an sich harmlos oder gefaehrlich. Sie ist erlaubt oder
// verboten RELATIV zu der Direktive, die der Browser auf sie anwendet. Ab hier
// wird deshalb erst die zustaendige Direktive bestimmt und dann die URL gegen
// DEREN Quellliste geprueft.
const RESOURCE_DIRECTIVE = Object.freeze(Object.assign(Object.create(null), {
  "script:src": "script-src",
  "img:src": "img-src", "img:srcset": "img-src", "input:src": "img-src",
  "source:srcset": "img-src", "video:poster": "img-src",
  "iframe:src": "frame-src", "frame:src": "frame-src",
  "audio:src": "media-src", "video:src": "media-src",
  "source:src": "media-src", "track:src": "media-src",
  "object:data": "object-src", "embed:src": "object-src",
  "form:action": "form-action", "base:href": "base-uri",
}));

// Attribute, die unabhaengig vom Tag dieselbe Direktive ziehen.
const ATTRIBUTE_DIRECTIVE = Object.freeze(Object.assign(Object.create(null), {
  formaction: "form-action", ping: "connect-src", poster: "img-src",
  background: "img-src", manifest: "manifest-src", "xlink:href": "img-src",
}));

// Attribute, auf die KEINE Fetch-Direktive wirkt: sie navigieren oder verweisen,
// sie laden nichts. Ein `javascript:` darin faellt trotzdem unter script-src --
// das faengt SCRIPTING_SCHEMES oben, nicht diese Liste.
const NAVIGATION_ATTRIBUTES = Object.freeze(["href", "cite", "longdesc", "usemap"]);

// <link> haengt am rel-Wert: dasselbe href traegt ein Stylesheet, ein Icon oder
// ein Manifest -- drei verschiedene Direktiven.
const LINK_REL_DIRECTIVE = Object.freeze(Object.assign(Object.create(null), {
  stylesheet: "style-src", icon: "img-src", "shortcut icon": "img-src",
  "apple-touch-icon": "img-src", "apple-touch-startup-image": "img-src",
  manifest: "manifest-src", modulepreload: "script-src",
  preconnect: null, "dns-prefetch": null, canonical: null, alternate: null,
  author: null, license: null, next: null, prev: null,
}));
const PRELOAD_AS_DIRECTIVE = Object.freeze(Object.assign(Object.create(null), {
  script: "script-src", style: "style-src", image: "img-src", font: "font-src",
  fetch: "connect-src", track: "media-src", audio: "media-src", video: "media-src",
  worker: "worker-src", document: "frame-src",
}));

// Rueckfall-Kette. Eine fehlende Fetch-Direktive erbt von default-src; worker-src
// von script-src, frame-src von child-src. `form-action` und `base-uri` erben
// NICHT -- fehlen sie, ist nichts eingeschraenkt.
const DIRECTIVE_FALLBACK = Object.freeze(Object.assign(Object.create(null), {
  "worker-src": ["script-src", "default-src"],
  "frame-src": ["child-src", "default-src"],
  "form-action": [], "base-uri": [],
}));

function governingDirective(tag, attrName, attributes) {
  if (tag === "link" && attrName === "href") {
    const rel = (attributes.find((a) => a.name === "rel")?.value ?? "").trim().toLowerCase();
    if (rel === "preload" || rel === "prefetch") {
      const as = (attributes.find((a) => a.name === "as")?.value ?? "").trim().toLowerCase();
      // Unbekanntes `as` -> fail-closed auf default-src statt stiller Freigabe.
      return PRELOAD_AS_DIRECTIVE[as] ?? "default-src";
    }
    if (rel in LINK_REL_DIRECTIVE) return LINK_REL_DIRECTIVE[rel];
    return "default-src";
  }
  const byTag = RESOURCE_DIRECTIVE[`${tag}:${attrName}`];
  if (byTag !== undefined) return byTag;
  const byAttr = ATTRIBUTE_DIRECTIVE[attrName];
  if (byAttr !== undefined) return byAttr;
  if (NAVIGATION_ATTRIBUTES.includes(attrName)) return null;
  return "default-src";
}

function effectiveDirective(name) {
  for (const candidate of [name, ...(DIRECTIVE_FALLBACK[name] ?? ["default-src"])]) {
    const tokens = directive(candidate);
    if (tokens) return { name: candidate, tokens };
  }
  return null;
}

// Die Gestalt einer URL, soweit eine Quellliste sie braucht: relativ (und damit
// gleiche Origin), Netzwerk-URL mit Host, oder undurchsichtig (data:, mailto:).
// `//host/x` ist KEINE relative URL -- das ist die schema-relative Form und
// zeigt auf eine fremde Origin.
function urlShape(value) {
  if (value.startsWith("//")) {
    const authority = value.slice(2).split(/[/?#]/)[0];
    return { kind: "network", scheme: null, host: authority.split(":")[0].toLowerCase() };
  }
  const head = value.split(/[/?#]/)[0];
  const scheme = head.match(SCHEME_HEAD);
  if (!scheme) return { kind: "relative", scheme: null, host: null };
  const name = scheme[1].toLowerCase();
  const rest = value.slice(scheme[0].length);
  if (rest.startsWith("//")) {
    const authority = rest.slice(2).split(/[/?#]/)[0];
    return { kind: "network", scheme: name, host: authority.split(":")[0].toLowerCase() };
  }
  return { kind: "opaque", scheme: name, host: null };
}

// Eine einzelne Quell-Angabe gegen eine URL. Was diese Funktion nicht versteht,
// erlaubt sie NICHT -- eine unverstandene Angabe ist keine Erlaubnis.
//
// `'self'` gilt hier nur fuer relative URLs. Die Auslieferungs-Origin steht
// nirgends im Buendel, also kann der Waechter fuer eine absolute URL nicht
// BEWEISEN, dass sie dieselbe ist. Fail-closed: er sagt es, statt zu raten.
function sourceAllows(token, shape) {
  const lower = token.trim().toLowerCase();
  if (!lower) return false;
  if (lower === "'none'") return false;
  if (lower === "'self'") return shape.kind === "relative";
  if (lower.startsWith("'")) return false; // nonce-/sha-/unsafe-* betreffen keine URL
  if (lower === "*") return shape.kind === "network";
  const schemeOnly = lower.match(/^([a-z][a-z0-9+.-]*):$/);
  if (schemeOnly) return shape.scheme === schemeOnly[1];
  const hostSource = lower.match(/^(?:([a-z][a-z0-9+.-]*):\/\/)?(\*\.[^/:*]+|\*|[^/:*]+)(?::(?:\d+|\*))?(?:\/.*)?$/);
  if (!hostSource) return false;
  if (shape.kind !== "network" || !shape.host) return false;
  if (hostSource[1] && shape.scheme && hostSource[1] !== shape.scheme) return false;
  const pattern = hostSource[2];
  if (pattern === "*") return true;
  if (pattern.startsWith("*.")) return shape.host.endsWith(pattern.slice(1));
  return shape.host === pattern;
}

function describeShape(shape) {
  if (shape.kind === "relative") return "the same-origin URL";
  if (shape.kind === "network") return `origin ${shape.scheme ? `${shape.scheme}:` : "(scheme-relative)"}//${shape.host}`;
  return `scheme "${shape.scheme}:"`;
}

function classifyUriAttribute(raw, tag, attrName, attributes) {
  const { decoded, unresolved } = decodeCharacterReferences(raw);
  const value = normalizeUriValue(decoded);
  // Alles vor dem ersten /, ? oder # -- nur dort kann noch ein Schema stehen.
  const head = value.split(/[/?#]/)[0];
  if (unresolved && /&[a-zA-Z][a-zA-Z0-9]*;?/.test(head)) {
    // Eine Referenz, die wir nicht aufloesen konnten, und sie steht an einer
    // Stelle, an der sie ein Schema bilden koennte. Hinter dem Pfadbeginn waere
    // dasselbe `&` ein gewoehnliches Argument-Trennzeichen und harmlos.
    return { verdict: "undecided", detail: "carries a character reference this guard cannot resolve" };
  }
  const shape = urlShape(value);
  if (shape.scheme && SCRIPTING_SCHEMES.includes(shape.scheme)) {
    return { verdict: "violation", detail: `resolves to scheme "${shape.scheme}:"` };
  }
  const governing = governingDirective(tag, attrName, attributes);
  if (governing === null) {
    // Keine Fetch-Direktive zustaendig. Dann bleibt es bei der Positivliste:
    // ohne Schema harmlos, mit Schema nur die bekannten.
    if (!shape.scheme && shape.kind !== "network") return { verdict: "harmless", detail: "" };
    if (shape.scheme && HARMLESS_SCHEMES.includes(shape.scheme)) return { verdict: "harmless", detail: "" };
    if (shape.kind === "network" && !shape.scheme) return { verdict: "harmless", detail: "" };
    return { verdict: "violation", detail: `resolves to scheme "${shape.scheme}:"` };
  }
  const applicable = effectiveDirective(governing);
  // Die Richtlinie regelt diese Art gar nicht -- dann schraenkt sie auch nichts ein.
  if (!applicable) return { verdict: "harmless", detail: "" };
  if (applicable.tokens.some((token) => sourceAllows(token, shape))) return { verdict: "harmless", detail: "" };
  return {
    verdict: "blocked",
    detail: `${describeShape(shape)} is not allowed by ${applicable.name} ${applicable.tokens.join(" ")}`,
  };
}

function executableSchemeIn(raw) {
  const { decoded } = decodeCharacterReferences(raw);
  for (const token of normalizeUriValue(decoded).split(/[\s,;=]+/)) {
    const scheme = token.match(SCHEME_HEAD);
    if (scheme && EXECUTABLE_SCHEMES.includes(scheme[1].toLowerCase())) return scheme[1].toLowerCase();
  }
  return null;
}

const failures = [];
function fail(message) {
  failures.push(message);
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

function readRequired(path) {
  if (!existsSync(path)) {
    fail(`missing build output: ${relative(root, path)}`);
    return null;
  }
  return readFileSync(path, "utf8");
}

// --- 0. Die ausgelieferte Richtlinie lesen -----------------------------------
// Vorgezogen (Review #168, Runde 3, Befund N1). Punkt 3 unten kann eine
// Ressourcen-URL ueberhaupt nur beurteilen, wenn er die Richtlinie kennt, die der
// Browser auf sie anwendet -- "harmlos" ist keine Eigenschaft eines Schemas,
// sondern eine Beziehung zwischen Ressource und zustaendiger Direktive.
const headers = readRequired(resolve(dist, "_headers")) ?? "";
const cspLine = headers.split("\n").map((l) => l.trim()).find((l) => l.toLowerCase().startsWith("content-security-policy:"));
if (!cspLine) fail("dist/_headers carries no Content-Security-Policy line");

function directive(name) {
  if (!cspLine) return null;
  const policy = cspLine.slice(cspLine.indexOf(":") + 1);
  for (const part of policy.split(";")) {
    const tokens = part.trim().split(/\s+/).filter(Boolean);
    if (tokens.length && tokens[0].toLowerCase() === name) return tokens.slice(1);
  }
  return null;
}

// --- 1. Keine fremden Schrift-Origins in der Ausgabe -------------------------
const distFiles = walkFiles(dist);
if (distFiles.length === 0) fail("dist/ is empty or missing -- run `vite build` first");

let scannedTextFiles = 0;
for (const path of distFiles) {
  if (BINARY_EXTENSIONS.includes(extname(path).toLowerCase())) continue;
  const bytes = readFileSync(path);
  if (bytes.includes(0)) continue; // Binaerdatei ohne bekannte Endung (Git-Heuristik)
  const text = bytes.toString("utf8");
  scannedTextFiles += 1;
  for (const host of REMOTE_FONT_HOSTS) {
    if (text.includes(host)) {
      const line = text.split("\n").findIndex((l) => l.includes(host)) + 1;
      fail(`remote font origin "${host}" in build output: ${relative(root, path).split(sep).join("/")}:${line}`);
    }
  }
}

// --- 2. Ausfuehrbares Inline-<script> in dist/index.html? --------------------
const html = readRequired(resolve(dist, "index.html")) ?? "";

// Warum hier KEIN Auf/Zu-Paar mehr gesucht wird (Review #168, Runde 2, Befund N2).
// Die alte Fassung verlangte `<script ...>RUMPF</script>`. Ein oeffnendes Tag OHNE
// schliessendes war damit unsichtbar -- an jeder Position, nicht nur am Dateiende.
// `<script>window.__boot=1` ohne Abschluss lief mit Exit 0 durch (gemessen
// 2026-09-12 auf 1ba42f1, im Kopf wie mitten im Dokument).
//
// WAS DABEI WIRKLICH PASSIERT -- nachgemessen, nicht uebernommen. Der Review-Befund
// sagte, der Parser fuehre den Rumpf bis EOF aus. In Chromium 2026-09-12 (echte
// Navigation auf eine Datei, nicht setContent) ist das NICHT so: das Element
// entsteht mit dem Rumpf, wird aber nicht ausgefuehrt; die Gegenprobe mit
// </script> im selben Lauf lief. Firefox und WebKit sind hier nicht gemessen.
//
// Der Schaden ist trotzdem real und sogar groesser: steht das unabgeschlossene Tag
// MITTEN im Dokument, verschwindet alles danach im Rumpf -- im Versuch war
// #root nicht mehr da, die App haette also gar nicht erst gemountet.
//
// Deshalb ist ein unabgeschlossener Rumpf hier ein Verstoss, aber aus dem
// belegten Grund: kein korrekter Build erzeugt so etwas, und die Ausgabe ist
// nachweislich kaputt. Ob eine Engine ihn zusaetzlich ausfuehrt, ist eine offene
// Frage und keine Voraussetzung fuer das Urteil.
//
// Die Bauform bleibt der eigentliche Punkt: eine Paar-Suche kann das unpaarige
// Vorkommen prinzipiell nicht sehen -- das ist dieselbe Klasse wie die
// javascript:-Luecke der ersten Runde, nur eine Ebene tiefer. Deshalb wird ab hier
// das OEFFNENDE Tag gesucht und der Rumpf danach bestimmt, so wie der Parser es tut.
//
// Kommentare werden dabei bewusst NICHT vorher entfernt. Ein `<script` in einem
// HTML-Kommentar meldet dieser Scan also als Verstoss, obwohl der Browser ihn
// nicht ausfuehrt -- eine Ueber-Meldung. Sie ist die guenstigere Seite: das
// Kommentar-Ende korrekt zu bestimmen ist selbst eine Parser-Aufgabe mit Kanten
// (`<!->`, `--!>`), und wer sie falsch macht, baut sich damit die naechste
// Umgehung. Eine Ueber-Meldung kostet eine benannte Nachfrage, eine Unter-
// Meldung einen stillen Bruch live.
const SCRIPT_OPEN_TAG = /<script\b((?:"[^"]*"|'[^']*'|[^>"'])*)>/gi;
const SCRIPT_CLOSE_TAG = /<\/script\s*>/i;

function scanScriptElements(source) {
  const out = [];
  let cursor = 0;
  while (cursor <= source.length) {
    SCRIPT_OPEN_TAG.lastIndex = cursor;
    const open = SCRIPT_OPEN_TAG.exec(source);
    if (!open) break;
    const bodyStart = open.index + open[0].length;
    const rest = source.slice(bodyStart);
    const closeAt = rest.search(SCRIPT_CLOSE_TAG);
    if (closeAt < 0) {
      // Der Rumpf reicht bis EOF; danach kann kein weiteres Element folgen.
      out.push({ attrs: open[1], body: rest, terminated: false });
      break;
    }
    out.push({ attrs: open[1], body: rest.slice(0, closeAt), terminated: true });
    cursor = bodyStart + closeAt;
  }
  return out;
}

const scriptElements = scanScriptElements(html);

// Gegenprobe gegen den eigenen Zerleger. Jedes `<script` im Text muss auch als
// Element angekommen sein; bleibt eines uebrig -- etwa ein oeffnendes Tag, dessen
// `>` fehlt --, dann hat der Zerleger nicht "nichts gefunden", sondern weggesehen.
// Fail-closed: was hier nicht eindeutig als Element erkannt ist, ist ein Verstoss
// und keine Abwesenheit. Eine blinde Suche liest sich sonst wie eine Abwesenheit.
const rawScriptOpeners = (html.match(/<script/gi) ?? []).length;
if (rawScriptOpeners !== scriptElements.length) {
  fail(
    `script scan accounted for ${scriptElements.length} of ${rawScriptOpeners} "<script" occurrences in ` +
    "dist/index.html -- the remainder is undecided, and undecided counts as a violation here",
  );
}

const executableInline = [];
for (const { attrs, body, terminated } of scriptElements) {
  if (!terminated) {
    // Nie eine Erlaubnis, immer ein Verstoss: kein korrekter Build erzeugt ein
    // unabgeschlossenes <script>. Diesen Fall als "braucht 'unsafe-inline'" zu
    // verbuchen hiesse, die Richtlinie wegen eines Defekts zu weiten.
    fail(
      "unterminated <script> in dist/index.html -- everything to EOF becomes its body, so the rest of " +
      `the markup is swallowed (${JSON.stringify(body.trim().slice(0, 60))}); no correct build emits this`,
    );
    continue;
  }
  if (hasAttribute(attrs, "src")) continue;      // externes Skript: nicht 'unsafe-inline'
  if (body.trim().length === 0) continue;        // leerer Rumpf fuehrt nichts aus
  const typeMatch = attrs.match(/\btype\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i);
  const type = (typeMatch ? (typeMatch[2] ?? typeMatch[3] ?? typeMatch[4]) : "").trim().toLowerCase();
  if (EXECUTABLE_SCRIPT_TYPES.includes(type)) {
    executableInline.push({ type: type || "(none)", preview: body.trim().slice(0, 80) });
  } else {
    // Fail-closed: ein unbekannter Typ koennte ausfuehrbar sein. Lieber ein roter
    // Build und eine bewusste Entscheidung als eine stille Annahme.
    fail(`inline <script type="${type}"> of unknown kind in dist/index.html -- classify it by hand before shipping`);
  }
}
const needsScriptUnsafeInline = executableInline.length > 0;
const hasInlineStyleBlock = /<style\b[^>]*>[\s\S]*?\S[\s\S]*?<\/style\s*>/i.test(html);

// --- 3. Inline-Event-Handler in dist/index.html? ----------------------------
// Diese Pruefung ist von Punkt 2 UNABHAENGIG. Ein Markup ohne jeden Inline-Rumpf,
// aber mit <img onerror="..."> laesst executableInline leer -- der Handler wird
// live trotzdem von script-src geblockt. Wer den Handler wirklich braucht, hebt
// ihn in die externe Bundle-Datei oder entscheidet die Richtlinie bewusst neu.
const scannedTags = markupTags(html);
const inlineHandlers = [];
const blockedResources = [];
for (const { tag, attrs } of scannedTags) {
  const attributes = parseAttributes(attrs);
  for (const { name, value } of attributes) {
    // Attribut-NAMEN werden vom Parser nicht dekodiert -- hier genuegt der Rohtext.
    if (INLINE_HANDLER_NAME.test(name)) {
      inlineHandlers.push(`<${tag} ${name}=...>`);
      continue;
    }
    // Attribut-WERTE dagegen schon. Deshalb wird ab hier der dekodierte und
    // normalisierte Wert eingestuft, nicht der Rohtext (Runde 2, Befund N1).
    if (URI_ATTRIBUTES.includes(name)) {
      const { verdict, detail } = classifyUriAttribute(value, tag, name, attributes);
      // Zwei Klassen, zwei Meldungen -- und das ist kein Stil. Eine
      // Ausfuehrungsstelle im Markup gehoert ins Buendel; eine Ressource, die
      // ihre Direktive nicht erlaubt, ist entweder die falsche Ressource oder
      // die falsche Richtlinie. Wer beides gleich meldet, schickt den Leser in
      // die falsche Reparatur.
      if (verdict === "blocked") blockedResources.push(`<${tag} ${name}="${value}"> ${detail}`);
      else if (verdict !== "harmless") inlineHandlers.push(`<${tag} ${name}=...> ${detail}`);
      continue;
    }
    const scheme = executableSchemeIn(value);
    if (scheme) inlineHandlers.push(`<${tag} ${name}="${scheme}:..."> (non-URI attribute)`);
  }
}
// Eine blinde Suche liest sich wie eine Abwesenheit: findet der Tag-Zerleger gar
// nichts, ist "null Handler" keine Aussage, sondern ein kaputter Waechter.
if (html.trim().length > 0 && scannedTags.length === 0) {
  fail("markup scan found zero tags in dist/index.html -- the scanner is broken, not the output clean");
}
for (const hit of inlineHandlers) {
  fail(`inline script source ${hit} in dist/index.html -- script-src applies to it; move it into the bundle instead of widening the policy`);
}
for (const hit of blockedResources) {
  fail(`blocked resource ${hit} in dist/index.html -- the browser will refuse to load it; ship it from the bundle or decide the policy change by name`);
}

// --- 4. Passt die ausgelieferte CSP zur Ausgabe? -----------------------------

const fontSrc = directive("font-src");
if (!fontSrc) fail("CSP has no font-src directive -- it must stay explicitly self-only");
else if (fontSrc.join(" ") !== "'self'") fail(`font-src must stay exactly 'self', found: ${fontSrc.join(" ")}`);

const scriptSrc = directive("script-src");
if (!scriptSrc) {
  fail("CSP has no script-src directive");
} else {
  const allowsInline = scriptSrc.includes("'unsafe-inline'");
  if (needsScriptUnsafeInline && !allowsInline) {
    fail(`dist/index.html contains ${executableInline.length} executable inline script(s) but script-src forbids them -- the app would break live`);
  }
  if (!needsScriptUnsafeInline && allowsInline) {
    fail("script-src allows 'unsafe-inline' but dist/index.html has no executable inline script -- drop the permission instead of carrying it");
  }
}

const styleSrc = directive("style-src");
if (!styleSrc) {
  fail("CSP has no style-src directive");
} else {
  const allowsInline = styleSrc.includes("'unsafe-inline'");
  // #163 Punkt 7: die Stil-Migration ist ausdruecklich NICHT Teil dieses Schritts.
  // React setzt style-Attribute und index.html traegt einen Inline-<style>-Block --
  // solange das so ist, ist 'unsafe-inline' hier kein Rueckstand, sondern noetig.
  if (hasInlineStyleBlock && !allowsInline) {
    fail("dist/index.html has an inline <style> block but style-src forbids inline styles");
  }
  if (!hasInlineStyleBlock && allowsInline) {
    fail("style-src allows 'unsafe-inline' but dist/index.html has no inline <style> block -- re-check whether React still needs it, then drop it");
  }
}

if (failures.length > 0) {
  for (const message of failures) console.error(`[csp-contract] FAIL: ${message}`);
  // `assert.fail` statt `process.exit(1)`: der Abbruch traegt damit die
  // Standard-Marke AssertionError. Das ist nicht Kosmetik -- ein roter Exit-Code
  // allein sagt nicht, ob der Waechter GEURTEILT hat oder unterwegs abgestuerzt
  // ist, und genau diese beiden Faelle muss eine Umkehrprobe unterscheiden koennen.
  assert.fail(`[csp-contract] ${failures.length} violation(s) -- see the lines above`);
}

console.log(
  `[csp-contract] OK text-files=${scannedTextFiles} remote-font-refs=0 ` +
  `script-elements=${scriptElements.length}/${rawScriptOpeners} ` +
  `executable-inline-scripts=${executableInline.length} markup-tags=${scannedTags.length} ` +
  `inline-script-sources=${inlineHandlers.length} blocked-resources=${blockedResources.length} ` +
  `inline-style-block=${hasInlineStyleBlock} ` +
  `script-src-unsafe-inline=${(directive("script-src") ?? []).includes("'unsafe-inline'")}`,
);

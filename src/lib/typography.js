// Typografie-Tokens -- EINE Quelle fuer die Schriftstapel der App (Issue #163).
//
// GolHex liefert KEINE Schriftdatei aus und laedt bewusst keine fremde. Die
// Produktions-CSP in `public/_headers` setzt `font-src 'self'`; ein Offline-Start
// der PWA haette ohnehin keinen Zugriff auf einen fremden Schrift-Server.
//
// Bis 2026-09-12 standen hier benannte Webfonts ('Space Grotesk', 'JetBrains
// Mono', 'IBM Plex Mono'), nachgeladen ueber zwei unabhaengige Google-Fonts-Pfade
// (Link in index.html, Laufzeit-Injektion in App.tsx). In Produktion blockierte
// die CSP beide, lokal/dev nicht -- dieselbe App sah live anders aus als auf dem
// Entwicklungsrechner, und die beiden Pfade forderten nicht einmal denselben
// Schriftsatz an. Genau dieser Drift ist der Befund aus #163.
//
// Deshalb: ausschliesslich Familien, die das Betriebssystem mitbringt. Keine
// benannte Schrift, die nicht ausgeliefert wird (#163 Punkt 3). `system-ui` und
// `ui-monospace` waehlen die Plattformschrift; die folgenden Namen sind die
// Ruecklinie fuer Browser, die diese generischen Familien nicht kennen, und die
// abschliessende generische Familie ist die letzte Garantie.
//
// SPIEGELUNG: dieselben Zeichenketten stehen als CSS-Custom-Properties
// (--ghx-font-sans / --ghx-font-mono) im Inline-<style> von index.html, damit der
// erste Frame vor dem React-Mount bereits richtig setzt. Dass beide Stellen
// zeichengleich bleiben, prueft tests/unit/csp-fonts.test.js -- ohne diesen Test
// driften zwei Kopien derselben Entscheidung auseinander.
export const FONT_SANS =
  'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
export const FONT_MONO =
  'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace';

// GolHex 9-Regel-Modell — RuleSpec-Schema + vierwertiger Evaluator.
//
// Quelle der Spezifikation: 007acc-Wissenstransfer "GolHex — 9-Regel-Modell:
// SOTA Review, Formalisierung und Wissenstransfer", Stand 11.08.2026
// (Status dort: DESIGN BASELINE / NICHT SELBST-ZERTIFIZIERT).
//
// Das 9-Regel-Modell ist ein SEMANTIC PROFILE neben der kanonischen 5-Axiomatik --
// ausdruecklich KEINE "Weltformel" und keine 9-Bit-Ontologie. Der Entwurf davor
// hatte genau diesen Fehler und wurde verworfen: neun unabhaengige Bits koennen
// temporale Aussagen ("es war", "es endet") gar nicht ausdruecken.
//
// DREI GELTUNGSBEREICHE -- das ist der Schluessel des ganzen Modells:
//   STATE       gilt in EINEM Zustand            (R1, R4, R5)
//   TRANSITION  gilt zwischen ZWEI Zustaenden    (R6, R8)
//   TRACE       gilt ueber einen VERLAUF         (R2, R3, R7, R9)
// Wer diese Klassifikation ueberspringt, landet zwangslaeufig bei Scheingenauigkeit.
//
// VIER STATUS statt boolesch:
//   PASS        durch vorliegende Evidenz erfuellt
//   FAIL        durch vorliegende Evidenz falsifiziert
//   UNOBSERVED  noch nicht entscheidbar (typisch fuer TRACE-Regeln auf laufendem Trace)
//   NA          notwendige Semantik/Konfiguration fehlt
//
// Warum vier und nicht zwei: "Es endet" ist waehrend eines laufenden Experiments
// weder wahr noch falsch -- es ist unentschieden. Ein boolescher Evaluator muesste
// sich fuer eine Luege entscheiden. Das ist die Ursache falscher Gewissheit.
//
// ENDLICHE TRACES (der heikelste Punkt): Die Regeln benutzen G ("immer") und
// F ("irgendwann"). Auf einem endlichen, womoeglich noch laufenden Trace haben
// diese Operatoren NICHT die Semantik der klassischen unendlichen LTL. Wir werten
// deshalb nach dem Praefix-Prinzip der Laufzeitverifikation aus:
//   - laesst sich die Aussage durch KEINE Fortsetzung mehr retten -> FAIL
//   - ist sie durch das bereits Gesehene bereits gesichert            -> PASS
//   - sonst                                                          -> UNOBSERVED
// Erst wenn ein Trace als abgeschlossen markiert ist (traceComplete), darf ein
// unerfuelltes F zu FAIL werden. Vorher waere FAIL schlicht falsch.

// KORREKTUR 2026-08-11 nach externer Fachrecherche (Runtime Verification, LTL3/RV-LTL,
// Bauer/Leucker/Schallhart TOSEM 2011). Die Spezifikation nennt vier Status. Vier
// reichen nachweislich NICHT, und der Grund ist strukturell:
//
//   Eine SAFETY-Eigenschaft ("immer", G) kann auf einem laufenden Trace niemals
//   endgueltig bestaetigt werden -- der naechste Schritt koennte sie brechen.
//   Eine CO-SAFETY-Eigenschaft ("irgendwann", F) kann niemals endgueltig widerlegt
//   werden -- der naechste Schritt koennte sie erfuellen.
//
// Mit nur PASS/FAIL/UNOBSERVED muesste R2 ("Es wird" = G(...) AND F(...)) entweder
// PASS behaupten, was logisch unerreichbar ist, oder fuer immer UNOBSERVED bleiben,
// was informationslos ist. Beides ist falsch. Deshalb zwei zusaetzliche Werte, die
// "bisher gehalten" von "endgueltig belegt" trennen.
//
// Anmerkung zur Benennung: Das hier ist NICHT Belnaps vierwertige Logik. Belnaps
// vierter Wert ist WIDERSPRUCH ("both"), nicht "nicht anwendbar". Es ist eine
// Kleene-Ordnung plus ein vorgeschalteter Anwendbarkeits-Filter (N/A) -- wer
// "Belnap" sagt, importiert die Falle n AND b = f.
export const STATUS = Object.freeze({
  PASS: "PASS",                       // definitiv: keine Fortsetzung kann es zerstoeren
  PASS_VORLAEUFIG: "PASS_VORLAEUFIG", // bisher gehalten; eine Fortsetzung koennte es brechen
  UNOBSERVED: "UNOBSERVED",           // unentschieden, bewusst kein vorlaeufiges Urteil
  FAIL_VORLAEUFIG: "FAIL_VORLAEUFIG", // bisher nicht eingetreten; koennte noch eintreten
  FAIL: "FAIL",                       // definitiv: keine Fortsetzung kann es retten
  NA: "N/A",                          // KEIN Wahrheitswert -- Regel ist hier nicht anwendbar
  CONFIG_ERROR: "CONFIG_ERROR",       // Pflichtparameter FEHLT -- das ist ein Bedienfehler
});

// Warum CONFIG_ERROR von N/A getrennt ist (Spec v2.1, §20.4):
// "Diese Regel ist auf ein mathematisches Objekt nicht anwendbar" und "du hast vergessen,
// die Progressvariable zu konfigurieren" sind grundverschiedene Sachverhalte. Der erste
// ist ein legitimes Ergebnis, der zweite ein Fehler, der behoben gehoert. Wirft man
// beides in N/A, verschwinden Konfigurationsfehler lautlos in einer Kategorie, die wie
// ein normales Resultat aussieht -- und niemand merkt, dass die Pruefung nie lief.
// Nach aussen (UI) darf CONFIG_ERROR als Konfigurationshinweis erscheinen, aber niemals
// als Regel-Urteil.

// Ordnung fuer die Aggregation (Kleene-stark, AND = Minimum).
// FAIL < FAIL_VORLAEUFIG < UNOBSERVED < PASS_VORLAEUFIG < PASS
const RANG = Object.freeze({
  [STATUS.FAIL]: 0,
  [STATUS.FAIL_VORLAEUFIG]: 1,
  [STATUS.UNOBSERVED]: 2,
  [STATUS.PASS_VORLAEUFIG]: 3,
  [STATUS.PASS]: 4,
});

/**
 * true, wenn das Verdikt fuer SEINEN Geltungsbereich endgueltig ist.
 *
 * KORREKTUR 2026-08-11 nach unabhaengiger Pruefung: Die erste Fassung sicherte global zu,
 * ein PASS koenne "durch keine Fortsetzung zerstoert werden". Das ist nur fuer TRACE-Regeln
 * wahr. Ein STATE-Urteil ("die Orientierung ist gueltig") gilt fuer DIESEN Zustand, ein
 * TRANSITION-Urteil ("die Position hat sich geaendert") fuer DIESEN Uebergang -- beide
 * duerfen im naechsten Schritt anders ausfallen, ohne dass etwas kaputt ist. Die Pruefung
 * fand genau das: bei 6 von 9 Regeln kippte ein "definitives" PASS bei Trace-Verlaengerung.
 *
 * Der Fehler lag nicht im Urteil, sondern in der Zusicherung darueber. Wer Endgueltigkeit
 * ohne Geltungsbereich behauptet, behauptet zu viel.
 *
 * @param {string} status
 * @param {string} [scope] Geltungsbereich der Regel. Ohne ihn wird nur die
 *   Status-Eigenschaft geprueft -- fuer die Trace-Monotonie IMMER den Scope mitgeben.
 */
export function istDefinitiv(status, scope) {
  const endgueltigerWert = status === STATUS.PASS || status === STATUS.FAIL;
  if (!endgueltigerWert) return false;
  if (scope === undefined) return true;
  // Nur ueber einen Verlauf gefaellte Urteile sind ueber den Verlauf hinweg stabil.
  return scope === SCOPE.TRACE;
}

export const SCOPE = Object.freeze({
  STATE: "STATE",
  TRANSITION: "TRANSITION",
  TRACE: "TRACE",
  RELATION: "RELATION",     // gilt zwischen Entitaeten, nicht ueber die Zeit (Spec v2.1 §20.3)
  CLASSIFIER: "CLASSIFIER", // verlangt eine Unterscheidungs-LEISTUNG des Systems
});

// Betriebsmodi einzelner Regeln (Spec v2.1 §20.1/§20.2). Der Modus ist Teil der
// Konfiguration, nicht der Regel -- dieselbe Regel bedeutet je nach Modus etwas anderes,
// und genau das muss sichtbar sein statt implizit.
export const R2_MODUS = Object.freeze({
  MINIMAL: "MINIMAL",   // es existiert ueberhaupt ein gerichteter Entwicklungsschritt
  ORDERED: "ORDERED",   // Netto-Fortschritt ueber ein Fenster, Rueckschritte erlaubt
  MONOTONE: "MONOTONE", // strikt monoton -- das schaerfste Profil, NICHT der Default
});
export const R4_MODUS = Object.freeze({
  STRUCTURAL: "STRUCTURAL", // ein externer Vergleich findet einen Unterschied
  ACTIVE: "ACTIVE",         // das SYSTEM selbst unterscheidet (Default im 9-Regel-Profil)
});

// --- Vierwertige Konjunktion -------------------------------------------------
// Die Spezifikation nennt die vier Status, sagt aber nicht, wie man sie
// zusammenfasst ("sind alle Regeln erfuellt?"). Ohne festgelegte Tafel wuerde
// jede Aufrufstelle sich ihre eigene ausdenken. Festgelegt gilt:
//
//   FAIL       dominiert alles          -- ein Gegenbeispiel kippt die Konjunktion
//   UNOBSERVED schlaegt PASS            -- Unwissen darf nicht zu Zustimmung werden
//   N/A        wird UEBERSPRUNGEN       -- eine nicht konfigurierte Regel ist keine Aussage
//   PASS       nur wenn alles Uebrige PASS ist
//
// Sind ALLE Regeln N/A, ist das Ergebnis N/A und nicht PASS -- "nichts geprueft"
// darf nie wie "alles in Ordnung" aussehen.
export function andAll(statuses) {
  // N/A wird VOR der Logik herausgefiltert -- es ist kein Wahrheitswert, sondern
  // die Aussage "diese Regel ist hier nicht anwendbar". Genau so trennen es auch
  // die etablierten Testframeworks (pytest skip, TAP # SKIP, JUnit disabled):
  // Anwendbarkeit ist eine Ausfuehrungs-Eigenschaft, kein Logikwert.
  // Ein Konfigurationsfehler ist kein Urteil, sondern ein Defekt am Aufbau der Pruefung.
  // Er schlaegt deshalb alles: solange er besteht, ist das Gesamtergebnis nicht deutbar.
  if (statuses.includes(STATUS.CONFIG_ERROR)) return STATUS.CONFIG_ERROR;
  const bewertbar = statuses.filter((s) => s !== STATUS.NA);
  if (bewertbar.length === 0) return STATUS.NA; // nichts geprueft ist NICHT "alles gut"

  // AND = Minimum in der Ordnung. Damit gilt automatisch das Wichtigste:
  // ein FAIL dominiert alles, und ein vorlaeufiges PASS kann ein definitives
  // PASS niemals hochziehen.
  let min = STATUS.PASS;
  for (const s of bewertbar) {
    if (RANG[s] === undefined) throw new TypeError(`unbekannter Status: ${s}`);
    if (RANG[s] < RANG[min]) min = s;
  }
  return min;
}

// --- Hex-Geometrie -----------------------------------------------------------
// Axiale Koordinaten (q,r). Die Distanz ist die Cube-Distanz, ausgedrueckt in
// axialen Termen: mit s = -q-r gilt d = (|dq| + |dr| + |ds|)/2, und
// ds = -(dq+dr). Daher die Form (|dq| + |dr| + |dq+dr|)/2.
export function hexDistance(a, b) {
  const dq = a.q - b.q;
  const dr = a.r - b.r;
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
}

// Die sechs axialen Richtungen. Reihenfolge ist Konvention und Teil des Vertrags:
// Wer Index 0 als "Ost" liest, muss sich darauf verlassen koennen.
export const D6 = Object.freeze([
  Object.freeze({ q: 1, r: 0 }), Object.freeze({ q: 1, r: -1 }), Object.freeze({ q: 0, r: -1 }),
  Object.freeze({ q: -1, r: 0 }), Object.freeze({ q: -1, r: 1 }), Object.freeze({ q: 0, r: 1 }),
]);

export function isValidDirection(d) {
  if (!d || typeof d.q !== "number" || typeof d.r !== "number") return false;
  return D6.some((x) => x.q === d.q && x.r === d.r);
}

// --- Hilfen ------------------------------------------------------------------
function res(status, evidence, extra = {}) {
  return { status, evidence, ...extra };
}
// Number.isFinite schliesst NaN UND Infinity aus. Beides muss raus: die Pruefung fand
// ein definitives FAIL aus NaN-Koordinaten (NaN > 0 ist false, also "unbewegt") und ein
// PASS aus NaN-Werten (NaN !== NaN, also "geaendert"). Muell-Eingaben duerfen kein
// Urteil erzeugen, sondern muessen als Konfigurations-/Datenfehler sichtbar werden.
const isNum = (x) => typeof x === "number" && Number.isFinite(x);

// KORREKTUR 2026-08-11 (Befund B1 der unabhaengigen Pruefung): Diese Funktion verlangte
// eine Position -- und machte R1 damit fuer JEDE ortlose Entitaet zu einem definitiven
// FAIL. Da FAIL die Aggregation dominiert, war `overall` eine Konstante: 40'000 von
// 40'000 geprueften Zustaenden ergaben FAIL. Im ausgelieferten UI sah der Nutzer ein
// dauerhaftes, als endgueltig deklariertes Fehlurteil ueber seine Simulation.
//
// Der Fehler war ein Widerspruch in der eigenen Konstruktion: Fuer R5/R6 wurde sauber
// entschieden, dass eine Population keinen Ort hat und die Regeln deshalb entfallen --
// und dann verlangte die Gueltigkeitspruefung von R1 genau diesen Ort.
//
// R1 ("Es ist") fragt nach GUELTIGER INSTANZIIERUNG, nicht nach Verortung. Ein Zustand
// ist gueltig, wenn er einen intrinsischen Wert traegt. Wenn er eine Position FUEHRT,
// muss sie brauchbar sein -- fehlt sie ganz, ist das kein Defekt, sondern eine Aussage
// ueber die Art der Entitaet. Die Positionspruefung gehoert zu R6, wo sie bereits steht.
function validState(s) {
  if (!s || typeof s !== "object") return false;
  if (s.u === undefined) return false;
  if (s.q === undefined || s.q === null) return true; // ortlose Entitaet -- zulaessig
  return typeof s.q === "object" && isNum(s.q.q) && isNum(s.q.r);
}

/** Werte-Gleichheit, die NaN wie sich selbst behandelt (SameValueZero statt ===). */
function gleich(a, b) {
  if (typeof a === "number" && typeof b === "number") return Object.is(a, b) || a === b;
  return a === b;
}

// --- Die neun RuleSpecs ------------------------------------------------------
// Jede Regel deklariert ihre Abhaengigkeiten. Fehlt eine, ist das Ergebnis N/A --
// NIEMALS stillschweigend PASS. Das ist die zentrale fail-closed-Eigenschaft:
// eine nicht konfigurierte Regel darf nicht wie eine erfuellte aussehen.

export const RULES = Object.freeze([
  {
    id: "R1", label: "Ist", scope: SCOPE.STATE, deps: [],
    claim: "Modell-Existenz -- ausdruecklich KEINE ontologische Existenzbehauptung.",
    evaluate(ctx) {
      const s = ctx.last;
      if (!s) return res(STATUS.UNOBSERVED, "kein Zustand vorhanden");
      return validState(s)
        ? res(STATUS.PASS, "Zustand ist gueltig instanziiert")
        : res(STATUS.FAIL, "Zustand unvollstaendig (u oder q fehlt/ungueltig)");
    },
  },
  {
    id: "R2", label: "Wird", scope: SCOPE.TRACE, deps: ["progressVariable"],
    claim: "Gerichtete Entwicklung, nicht blosse Variation. Der Modus bestimmt die Strenge: "
      + "MINIMAL (ein gerichteter Schritt genuegt) | ORDERED (Netto-Fortschritt, Rueckschritte "
      + "toleriert) | MONOTONE (strikt, schaerfstes Profil).",
    evaluate(ctx) {
      // KORREKTUR nach Spec v2.1 (§20.1): Die erste Fassung erzwang strikte Monotonie.
      // Das ist fuer reale Entwicklungsprozesse zu streng -- Entwicklung kennt Pausen,
      // Rueckschritte und Oszillationen. Ein Kind, das eine Woche nicht waechst, "wird"
      // trotzdem. Strikte Monotonie ist deshalb nur noch das optionale Profil MONOTONE.
      if (!ctx.config.progressVariable) {
        // Bedienfehler, nicht Nichtanwendbarkeit: die Regel ist aktiv, aber unkonfiguriert.
        return res(STATUS.CONFIG_ERROR, "R2 ist aktiv, aber keine progressVariable konfiguriert");
      }
      const modus = ctx.config.r2Modus || R2_MODUS.ORDERED;
      const get = ctx.config.progressVariable;
      const vals = ctx.trace.map(get);
      if (vals.some((v) => !isNum(v))) {
        return res(STATUS.CONFIG_ERROR, "progressVariable liefert keine Zahl fuer jeden Zustand");
      }
      // Anwendbarkeits-Guard VOR der Logik: Ein G ueber einer leeren Uebergangsmenge
      // ist vakuum-wahr. Ein Trace mit einem einzigen Zustand wuerde also "monoton"
      // melden, obwohl gar nichts beobachtet wurde. Das faengt der Guard ab, nicht
      // die Logik -- sonst entsteht ein PASS aus Nichtbeobachtung.
      if (vals.length < 2) {
        return res(STATUS.NA, "weniger als zwei Zustaende -- kein Uebergang beobachtbar");
      }
      const stieg = vals.some((v, i) => i > 0 && v > vals[i - 1]);

      if (modus === R2_MODUS.MONOTONE) {
        // Schaerfstes Profil: G(a_next >= a) ist SAFETY -- eine einzige Abnahme
        // widerlegt sie endgueltig, keine Fortsetzung repariert das.
        for (let i = 1; i < vals.length; i++) {
          if (vals[i] < vals[i - 1]) {
            return res(STATUS.FAIL, `MONOTONE: Monotonie verletzt bei t=${i}: ${vals[i]} < ${vals[i - 1]}`,
              { counterexample: { t: i, prev: vals[i - 1], next: vals[i] } });
          }
        }
        if (stieg) {
          return ctx.traceComplete
            ? res(STATUS.PASS, "MONOTONE: abgeschlossen, durchgehend monoton und echt gewachsen")
            : res(STATUS.PASS_VORLAEUFIG, "MONOTONE: bisher monoton und gewachsen; der G-Teil bleibt widerlegbar");
        }
        return ctx.traceComplete
          ? res(STATUS.FAIL, "MONOTONE: abgeschlossen, nie echt gewachsen")
          : res(STATUS.FAIL_VORLAEUFIG, "MONOTONE: bisher konstant; ein Anstieg ist noch moeglich");
      }

      if (modus === R2_MODUS.MINIMAL) {
        // Es genuegt EIN gerichteter Entwicklungsschritt irgendwo im Trace. Rueckschritte
        // sind unerheblich -- gefragt ist, ob Entwicklung ueberhaupt stattfindet.
        // Co-Safety: einmal gesehen, nie mehr widerlegbar.
        if (stieg) return res(STATUS.PASS, "MINIMAL: mindestens ein gerichteter Entwicklungsschritt belegt");
        return ctx.traceComplete
          ? res(STATUS.FAIL, "MINIMAL: abgeschlossen, kein einziger Entwicklungsschritt")
          : res(STATUS.FAIL_VORLAEUFIG, "MINIMAL: bisher kein Entwicklungsschritt; noch moeglich");
      }

      // ORDERED (Default): Netto-Fortschritt ueber das Bewertungsfenster, Rueckschritte
      // bis zur konfigurierten Toleranz erlaubt. Das bildet reale Entwicklung ab.
      const fenster = ctx.config.r2Fenster || vals.length;
      const delta = ctx.config.r2Delta ?? 0;
      const reversalToleranz = ctx.config.r2ReversalToleranz ?? Infinity;
      const ab = Math.max(0, vals.length - fenster);
      const netto = vals[vals.length - 1] - vals[ab];

      let groessterRueckschritt = 0;
      for (let i = ab + 1; i < vals.length; i++) {
        const rueck = vals[i - 1] - vals[i];
        if (rueck > groessterRueckschritt) groessterRueckschritt = rueck;
      }
      if (groessterRueckschritt > reversalToleranz) {
        // KORREKTUR 2026-08-11 (Befund K3): Wird ein GLEITENDES Fenster benutzt, faellt
        // der Rueckschritt spaeter aus dem Fenster heraus und das "definitive" FAIL
        // verschwand. Nur ohne Fenster (also ueber den ganzen Trace) ist es endgueltig.
        const ueberGanzenTrace = ab === 0;
        return res(ueberGanzenTrace ? STATUS.FAIL : STATUS.FAIL_VORLAEUFIG,
          `ORDERED: Rueckschritt ${groessterRueckschritt} ueberschreitet die Toleranz ${reversalToleranz}`
            + (ueberGanzenTrace ? "" : " (im gleitenden Fenster -- kann herausfallen)"),
          { counterexample: { groessterRueckschritt, reversalToleranz } });
      }
      if (netto > delta) {
        return ctx.traceComplete
          ? res(STATUS.PASS, `ORDERED: abgeschlossen, Netto-Fortschritt ${netto} > ${delta}`)
          : res(STATUS.PASS_VORLAEUFIG, `ORDERED: Netto-Fortschritt ${netto} > ${delta}; noch umkehrbar`);
      }
      return ctx.traceComplete
        ? res(STATUS.FAIL, `ORDERED: abgeschlossen, Netto-Fortschritt ${netto} <= ${delta}`)
        : res(STATUS.FAIL_VORLAEUFIG, `ORDERED: Netto-Fortschritt ${netto} <= ${delta}; noch erreichbar`);
    },
  },
  {
    id: "R3", label: "War", scope: SCOPE.TRACE, deps: ["trace"],
    claim: "Der aktuelle Zustand besitzt eine Vorgeschichte.",
    evaluate(ctx) {
      // Am initialen Frame gibt es keine Vergangenheit. Das ist kein Defekt,
      // sondern schlicht noch nicht beobachtet -- Vergangenheit vortaeuschen waere
      // der schwerere Fehler.
      // Einmal vorhandene Vergangenheit verschwindet nicht wieder -> definitives PASS.
      if (ctx.trace.length > 1) return res(STATUS.PASS, `Historie mit ${ctx.trace.length - 1} Vorgaenger(n)`);
      // KORREKTUR 2026-08-11 (Befund K3): Hier stand ein definitives FAIL, das bei der
      // naechsten Generation zu PASS wurde -- ein "endgueltiges" Urteil, das kippte.
      // Fehlende Vergangenheit am Startframe ist nie endgueltig: der Trace waechst.
      return ctx.config.requirePriorHistory
        ? res(STATUS.FAIL_VORLAEUFIG, "Spec fordert Vergangenheit; bisher nur der Startframe")
        : res(STATUS.UNOBSERVED, "initialer Frame -- noch keine Vergangenheit beobachtet");
    },
  },
  {
    id: "R4", label: "Unterscheidet", scope: SCOPE.CLASSIFIER, deps: ["population"],
    claim: "STRUCTURAL: ein externer Vergleich findet einen Unterschied. ACTIVE (Default): "
      + "das SYSTEM SELBST unterscheidet. Die Verbform 'es unterscheidet' meint eine "
      + "Leistung des Systems, nicht blosse Verschiedenheit zweier Werte.",
    evaluate(ctx) {
      // KORREKTUR nach Spec v2.1 (§20.2): D(x,y) > eps zeigt nur, dass ein AUSSENSTEHENDER
      // zwei Werte auseinanderhalten kann. Das ist die ontologische Minimallesart. Die
      // aktive Lesart verlangt einen Discriminator des modellierten Systems -- ein Stein
      // ist von einem anderen unterscheidbar, aber er unterscheidet nicht.
      const modus = ctx.config.r4Modus || R4_MODUS.ACTIVE;
      const pop = ctx.config.population ? ctx.config.population(ctx.last) : null;
      if (!Array.isArray(pop)) {
        return res(STATUS.CONFIG_ERROR, "keine population() konfiguriert -- Vergleichsraum unbestimmt");
      }
      if (pop.length < 2) {
        return res(STATUS.UNOBSERVED, `Vergleichsraum hat nur ${pop.length} Element(e)`);
      }

      if (modus === R4_MODUS.ACTIVE) {
        const disc = ctx.config.discriminator;
        if (typeof disc !== "function") {
          // Kein stilles Zurueckfallen auf STRUCTURAL: das waere eine andere Aussage,
          // die aber gleich aussieht. Genau solche stillen Modus-Wechsel erzeugen
          // Ergebnisse, denen man ihre Bedeutung nicht mehr ansieht.
          return res(STATUS.CONFIG_ERROR,
            "Modus ACTIVE verlangt einen discriminator(a,b) des Systems; STRUCTURAL waere eine andere Aussage");
        }
        for (let i = 0; i < pop.length; i++) {
          for (let j = i + 1; j < pop.length; j++) {
            if (disc(pop[i], pop[j]) === true) {
              return res(STATUS.PASS, `ACTIVE: System unterscheidet Element ${i} von ${j}`);
            }
          }
        }
        return res(STATUS.FAIL, `ACTIVE: System unterscheidet keines der ${pop.length} Elemente`);
      }

      const eq = ctx.config.comparator || ((a, b) => a === b);
      for (let i = 0; i < pop.length; i++) {
        for (let j = i + 1; j < pop.length; j++) {
          if (!eq(pop[i], pop[j])) {
            return res(STATUS.PASS, `STRUCTURAL: Unterschied zwischen Element ${i} und ${j}`);
          }
        }
      }
      return res(STATUS.FAIL, `STRUCTURAL: alle ${pop.length} Elemente sind ununterscheidbar`);
    },
  },
  {
    id: "R5", label: "Richtung", scope: SCOPE.STATE, deps: ["orientationDomain"],
    claim: "Eine gueltige Orientierung ist definiert. Ein Tensor ist dafuer nicht noetig.",
    evaluate(ctx) {
      const s = ctx.last;
      if (!s || s.d === undefined || s.d === null) {
        return res(STATUS.NA, "keine Orientierung im Zustand gefuehrt");
      }
      return isValidDirection(s.d)
        ? res(STATUS.PASS, `Orientierung (${s.d.q},${s.d.r}) liegt in D6`)
        : res(STATUS.FAIL, `Orientierung (${s.d.q},${s.d.r}) liegt NICHT in D6`);
    },
  },
  {
    id: "R6", label: "Bewegt", scope: SCOPE.TRANSITION, deps: ["position"],
    claim: "Die Position aendert sich. Bewusst getrennt von R8.",
    evaluate(ctx) {
      // Schwaches Next: am Trace-Ende existiert kein Nachfolger, also ist die Regel
      // nicht ANWENDBAR (N/A) statt verletzt. Ein FAIL waere hier erfunden.
      if (ctx.trace.length < 2) return res(STATUS.NA, "kein Uebergang vorhanden (weniger als zwei Zustaende)");
      const a = ctx.trace[ctx.trace.length - 2], b = ctx.last;
      if (!a?.q || !b?.q) return res(STATUS.NA, "keine Position im Zustand gefuehrt");
      // Muell-Koordinaten duerfen KEIN Urteil erzeugen: mit NaN liefert hexDistance NaN,
      // und NaN > 0 ist false -- das ergab frueher ein definitives FAIL "unbewegt" aus
      // reinem Datenmuell, das anschliessend die ganze Aggregation dominierte.
      if (![a.q.q, a.q.r, b.q.q, b.q.r].every(isNum)) {
        return res(STATUS.CONFIG_ERROR, "Positionskoordinaten sind nicht endlich (NaN/Infinity)");
      }
      const d = hexDistance(a.q, b.q);
      return d > 0
        ? res(STATUS.PASS, `Hex-Distanz ${d} > 0`)
        : res(STATUS.FAIL, "Position unveraendert (Hex-Distanz 0)");
    },
  },
  {
    id: "R7", label: "Endet", scope: SCOPE.TRACE, deps: ["terminalPredicate"],
    claim: "Die Trajektorie erreicht einen endlichen Terminalzustand. Der Terminalzustand "
      + "muss NICHT numerisch 0 sein -- Ende ist nicht dasselbe wie Nullwert.",
    evaluate(ctx) {
      const term = ctx.config.terminalPredicate;
      if (typeof term !== "function") {
        return res(STATUS.NA, "kein terminalPredicate konfiguriert");
      }
      // F terminal ist CO-SAFETY: positiv endgueltig entscheidbar. Ein einmal
      // gesehener Terminalzustand kann durch keine Fortsetzung verschwinden --
      // deshalb definitives PASS, und ab hier monoton stabil.
      const hit = ctx.trace.findIndex((s) => term(s));
      if (hit >= 0) return res(STATUS.PASS, `Terminalzustand bei t=${hit}`);
      // Hier sitzt die haeufigste Fehlerquelle bei endlichen Traces. Unter reiner
      // LTLf-Semantik gilt ein Trace als abgeschlossenes Objekt, und "F terminal"
      // waere schlicht FALSE. Auf einem noch LAUFENDEN Trace ist das falsch: es
      // hiesse nur "ich habe noch nicht lange genug hingesehen".
      return ctx.traceComplete
        ? res(STATUS.FAIL, "Trace abgeschlossen, nie terminal geworden")
        : res(STATUS.FAIL_VORLAEUFIG, "bisher nicht terminal; der Trace laeuft noch");
    },
  },
  {
    id: "R8", label: "Aendert", scope: SCOPE.TRANSITION, deps: [],
    claim: "Der intrinsische Zustand aendert sich, unabhaengig von Ortsbewegung.",
    evaluate(ctx) {
      // Schwaches Next, siehe R6: kein Nachfolger heisst nicht anwendbar, nicht verletzt.
      if (ctx.trace.length < 2) return res(STATUS.NA, "kein Uebergang vorhanden (weniger als zwei Zustaende)");
      const a = ctx.trace[ctx.trace.length - 2], b = ctx.last;
      // Default ist SameValueZero, nicht ===. Mit === meldete NaN -> NaN eine Aenderung,
      // weil NaN !== NaN gilt: ein PASS aus einem unveraenderten Zustand.
      const eq = ctx.config.valueEquals || gleich;
      return !eq(a.u, b.u)
        ? res(STATUS.PASS, `intrinsischer Zustand geaendert: ${a.u} -> ${b.u}`)
        : res(STATUS.FAIL, `intrinsischer Zustand unveraendert (${b.u})`);
    },
  },
  {
    id: "R9", label: "Lebt", scope: SCOPE.TRACE, deps: ["lifeModel"],
    // CLAIM-SPERRE (bewusst in EINER Zeile, damit sie greppbar bleibt):
    // Ergebnis eines explizit gewaehlten LifeModel-Praedikats, gekennzeichnet als
    // MODEL/PROXY. Dies ist keine biologische, medizinische oder diagnostische Behauptung.
    claim: "MODEL/PROXY-Ergebnis eines gewaehlten LifeModel-Praedikats. Kein universeller Lebensbeweis und keine biologische, medizinische oder diagnostische Behauptung.",
    evaluate(ctx) {
      const lm = ctx.config.lifeModel;
      if (!lm || typeof lm.predicate !== "function") {
        return res(STATUS.NA, "kein lifeModel konfiguriert");
      }
      // KORREKTUR 2026-08-11 (Befund B2): Ohne Evidenz gab es hier ein DEFINITIVES
      // "not alive" -- aus einem leeren Trace, ohne einen einzigen Zustand. Das ist
      // dieselbe Klasse wie ein PASS aus fehlender Konfiguration, nur mit umgekehrtem
      // Vorzeichen: "keine Daten" sah aus wie "widerlegt".
      if (ctx.trace.length < 2) {
        return res(STATUS.UNOBSERVED, "zu wenig Verlauf fuer ein Lebensurteil",
          { claimTier: "MODEL/PROXY" });
      }
      const alive = lm.predicate(ctx.last, ctx.trace);
      // Und: ein LifeModel wertet ueber ein FENSTER des Verlaufs. Sein Urteil kann
      // durch Fortsetzung kippen (Befund K3: PASS -> FAIL beobachtet) und ist deshalb
      // NIE definitiv, solange der Trace laeuft.
      const st = ctx.traceComplete
        ? (alive ? STATUS.PASS : STATUS.FAIL)
        : (alive ? STATUS.PASS_VORLAEUFIG : STATUS.FAIL_VORLAEUFIG);
      return res(st,
        `LifeModel '${lm.name || "unbenannt"}' v${lm.version || "?"}: ${alive ? "alive" : "not alive"}`,
        { claimTier: "MODEL/PROXY", lifeModel: { name: lm.name, version: lm.version } });
    },
  },
]);

// --- Evaluator ---------------------------------------------------------------
/**
 * Wertet alle neun Regeln gegen einen Trace aus.
 *
 * @param {Array<object>} trace  Zustaende s_t = {u, q:{q,r}, a?, d?, z?}, aelteste zuerst.
 * @param {object} config        RuleSpec-Parameter (progressVariable, population,
 *                               comparator, terminalPredicate, lifeModel, ...).
 * @param {object} opts          { traceComplete: boolean, enabled: string[] }
 * @returns {{overall:string, rules:Array, specVersion:string, counts:object}}
 */
export function evaluateNineRules(trace, config = {}, opts = {}) {
  if (!Array.isArray(trace)) throw new TypeError("trace muss ein Array sein");
  const traceComplete = opts.traceComplete === true;
  const enabled = opts.enabled || RULES.map((r) => r.id);

  const ctx = {
    trace,
    last: trace.length ? trace[trace.length - 1] : null,
    config,
    traceComplete,
  };

  const letzter = Math.max(0, trace.length - 1);
  const rules = RULES.filter((r) => enabled.includes(r.id)).map((r) => {
    let out;
    // Fehler-Isolation je Regel: eine werfende Konfigurations-Funktion (oder ein
    // kaputter Zustand) riss frueher ALLE neun Regeln mit. Ein einzelner Defekt darf
    // die uebrigen acht Urteile nicht ungueltig machen -- er wird zum Befund dieser
    // einen Regel.
    try {
      out = r.evaluate(ctx);
    } catch (e) {
      out = res(STATUS.CONFIG_ERROR, `Auswertung warf: ${e && e.message ? e.message : String(e)}`);
    }
    // Geltungsbereich EHRLICH ausweisen. Vorher stand ueberall [0, len-1] -- auch bei
    // Uebergangsregeln, die nur die letzten ZWEI Zustaende ansehen. Das ueberzeichnete
    // die Reichweite des Urteils in jedem Report.
    const range =
      r.scope === SCOPE.TRACE ? [0, letzter]
        : r.scope === SCOPE.TRANSITION ? [Math.max(0, letzter - 1), letzter]
          : [letzter, letzter];
    return {
      id: r.id, label: r.label, scope: r.scope, deps: r.deps,
      status: out.status, evidence: out.evidence,
      counterexample: out.counterexample ?? null,
      claimTier: out.claimTier ?? "MODEL",
      traceRange: range,
      // Endgueltig NUR im eigenen Geltungsbereich -- siehe istDefinitiv().
      stabilUeberTrace: istDefinitiv(out.status, r.scope),
      specVersion: SPEC_VERSION,
    };
  });

  // Alle Status muessen vorkommen, sonst zaehlt der Report an neuen Werten vorbei.
  const counts = Object.fromEntries(Object.values(STATUS).map((s) => [s, 0]));
  for (const r of rules) counts[r.status] += 1;

  return {
    overall: andAll(rules.map((r) => r.status)),
    rules,
    counts,
    specVersion: SPEC_VERSION,
    traceComplete,
    traceLength: trace.length,
  };
}

export const SPEC_VERSION = "9R-v1.0.0";

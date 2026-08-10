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
  NA: "N/A",                          // KEIN Wahrheitswert -- Regel ist nicht anwendbar
});

// Ordnung fuer die Aggregation (Kleene-stark, AND = Minimum).
// FAIL < FAIL_VORLAEUFIG < UNOBSERVED < PASS_VORLAEUFIG < PASS
const RANG = Object.freeze({
  [STATUS.FAIL]: 0,
  [STATUS.FAIL_VORLAEUFIG]: 1,
  [STATUS.UNOBSERVED]: 2,
  [STATUS.PASS_VORLAEUFIG]: 3,
  [STATUS.PASS]: 4,
});

/** true, wenn das Verdikt endgueltig ist und durch keine Fortsetzung kippen darf. */
export function istDefinitiv(status) {
  return status === STATUS.PASS || status === STATUS.FAIL;
}

export const SCOPE = Object.freeze({
  STATE: "STATE",
  TRANSITION: "TRANSITION",
  TRACE: "TRACE",
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
const isNum = (x) => typeof x === "number" && Number.isFinite(x);

function validState(s) {
  return !!s && typeof s === "object" && s.u !== undefined && !!s.q
    && isNum(s.q.q) && isNum(s.q.r);
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
    claim: "Gerichtete Entwicklung, nicht blosse Variation. Braucht eine explizit "
      + "konfigurierte geordnete Groesse -- ohne sie ist die Regel N/A, nicht PASS.",
    evaluate(ctx) {
      if (!ctx.config.progressVariable) {
        return res(STATUS.NA, "keine progressVariable konfiguriert");
      }
      const get = ctx.config.progressVariable;
      const vals = ctx.trace.map(get);
      if (vals.some((v) => !isNum(v))) {
        return res(STATUS.NA, "progressVariable liefert keine Zahl fuer jeden Zustand");
      }
      // Anwendbarkeits-Guard VOR der Logik: Ein G ueber einer leeren Uebergangsmenge
      // ist vakuum-wahr. Ein Trace mit einem einzigen Zustand wuerde also "monoton"
      // melden, obwohl gar nichts beobachtet wurde. Das faengt der Guard ab, nicht
      // die Logik -- sonst entsteht ein PASS aus Nichtbeobachtung.
      if (vals.length < 2) {
        return res(STATUS.NA, "weniger als zwei Zustaende -- kein Uebergang beobachtbar");
      }
      // G(a_next >= a) ist SAFETY: eine einzige Abnahme widerlegt sie endgueltig,
      // keine Fortsetzung repariert das. Deshalb definitives FAIL.
      for (let i = 1; i < vals.length; i++) {
        if (vals[i] < vals[i - 1]) {
          return res(STATUS.FAIL, `Monotonie verletzt bei t=${i}: ${vals[i]} < ${vals[i - 1]}`,
            { counterexample: { t: i, prev: vals[i - 1], next: vals[i] } });
        }
      }
      const grew = vals.some((v, i) => i > 0 && v > vals[i - 1]);
      if (grew) {
        // Beide Teile bisher erfuellt -- aber NICHT definitiv. Der G-Teil bleibt fuer
        // immer widerlegbar, solange der Trace weiterlaeuft. Ein definitives PASS
        // waere hier logisch unerreichbar; wer es druckt, behauptet zu viel.
        return ctx.traceComplete
          ? res(STATUS.PASS, "Trace abgeschlossen: durchgehend monoton und echt gewachsen")
          : res(STATUS.PASS_VORLAEUFIG, "bisher monoton und echt gewachsen; der G-Teil bleibt widerlegbar");
      }
      // F(a_next > a) noch nicht eingetreten. Das ist CO-SAFETY: nie endgueltig
      // widerlegbar, solange der Trace laeuft.
      return ctx.traceComplete
        ? res(STATUS.FAIL, "Trace abgeschlossen, nie echt gewachsen (nur konstant)")
        : res(STATUS.FAIL_VORLAEUFIG, "bisher konstant; ein Anstieg ist noch moeglich");
    },
  },
  {
    id: "R3", label: "War", scope: SCOPE.TRACE, deps: ["trace"],
    claim: "Der aktuelle Zustand besitzt eine Vorgeschichte.",
    evaluate(ctx) {
      // Am initialen Frame gibt es keine Vergangenheit. Das ist kein Defekt,
      // sondern schlicht noch nicht beobachtet -- Vergangenheit vortaeuschen waere
      // der schwerere Fehler.
      if (ctx.trace.length > 1) return res(STATUS.PASS, `Historie mit ${ctx.trace.length - 1} Vorgaenger(n)`);
      return ctx.config.requirePriorHistory
        ? res(STATUS.FAIL, "Spec fordert vorhandene Vergangenheit, Trace hat nur den Startframe")
        : res(STATUS.UNOBSERVED, "initialer Frame -- noch keine Vergangenheit beobachtet");
    },
  },
  {
    id: "R4", label: "Unterscheidet", scope: SCOPE.STATE, deps: ["comparator"],
    claim: "Im gewaehlten Vergleichsraum existiert ein Unterschied. Der Vergleichsraum "
      + "ist Teil der Spec, keine versteckte Universalannahme.",
    evaluate(ctx) {
      const pop = ctx.config.population ? ctx.config.population(ctx.last) : null;
      if (!Array.isArray(pop)) {
        return res(STATUS.NA, "keine population() konfiguriert -- Vergleichsraum unbestimmt");
      }
      if (pop.length < 2) {
        return res(STATUS.UNOBSERVED, `Vergleichsraum hat nur ${pop.length} Element(e)`);
      }
      const eq = ctx.config.comparator || ((a, b) => a === b);
      for (let i = 0; i < pop.length; i++) {
        for (let j = i + 1; j < pop.length; j++) {
          if (!eq(pop[i], pop[j])) {
            return res(STATUS.PASS, `Unterschied zwischen Element ${i} und ${j}`);
          }
        }
      }
      return res(STATUS.FAIL, `alle ${pop.length} Elemente sind ununterscheidbar`);
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
      if (!a.q || !b.q) return res(STATUS.NA, "keine Position im Zustand gefuehrt");
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
      const eq = ctx.config.valueEquals || ((x, y) => x === y);
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
      const alive = lm.predicate(ctx.last, ctx.trace);
      return res(alive ? STATUS.PASS : STATUS.FAIL,
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

  const rules = RULES.filter((r) => enabled.includes(r.id)).map((r) => {
    const out = r.evaluate(ctx);
    return {
      id: r.id, label: r.label, scope: r.scope, deps: r.deps,
      status: out.status, evidence: out.evidence,
      counterexample: out.counterexample ?? null,
      claimTier: out.claimTier ?? "MODEL",
      traceRange: [0, Math.max(0, trace.length - 1)],
      specVersion: SPEC_VERSION,
    };
  });

  const counts = { PASS: 0, FAIL: 0, UNOBSERVED: 0, "N/A": 0 };
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

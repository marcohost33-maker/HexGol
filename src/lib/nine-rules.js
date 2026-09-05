// GolHex 9-Regel-Modell — RuleSpec-Schema + finite-trace evaluator.
//
// Das 9-Regel-Modell ist ein SEMANTIC PROFILE neben der kanonischen 5-Axiomatik.
// Es ist weder eine "Weltformel" noch mit den Watzlawick-Axiomen gleichzusetzen.
// Regeln gelten auf unterschiedlichen Scopes (STATE/TRANSITION/TRACE/...); fuer
// endliche, noch wachsende Traces werden vorlaeufige von finalen Urteilen getrennt.
//
// WICHTIG: Die kompakten STATUS-Labels bleiben aus Rueckwaertskompatibilitaet
// erhalten. Intern/extern werden sie aber in drei orthogonale Dimensionen zerlegt:
//   applicability: APPLICABLE | N/A | CONFIG_ERROR
//   verdict:       TRUE | FALSE | UNKNOWN
//   finality:      FINAL | PROVISIONAL
// Damit ist `andAll()` keine Minimum-Operation auf einer kuenstlichen Wahrheitsrang-
// achse mehr. Das vermeidet insbesondere die Vermischung von Unwissen, vorlaeufiger
// Falschheit und endgueltiger Falschheit (Issue #143).

export const STATUS = Object.freeze({
  PASS: "PASS",
  PASS_VORLAEUFIG: "PASS_VORLAEUFIG",
  UNOBSERVED: "UNOBSERVED",
  FAIL_VORLAEUFIG: "FAIL_VORLAEUFIG",
  FAIL: "FAIL",
  NA: "N/A",
  CONFIG_ERROR: "CONFIG_ERROR",
});

export const APPLICABILITY = Object.freeze({
  APPLICABLE: "APPLICABLE",
  NA: "N/A",
  CONFIG_ERROR: "CONFIG_ERROR",
});

export const VERDICT = Object.freeze({
  TRUE: "TRUE",
  FALSE: "FALSE",
  UNKNOWN: "UNKNOWN",
});

export const FINALITY = Object.freeze({
  FINAL: "FINAL",
  PROVISIONAL: "PROVISIONAL",
});

const STATUS_SEMANTICS = Object.freeze({
  [STATUS.PASS]: Object.freeze({
    applicability: APPLICABILITY.APPLICABLE,
    verdict: VERDICT.TRUE,
    finality: FINALITY.FINAL,
  }),
  [STATUS.PASS_VORLAEUFIG]: Object.freeze({
    applicability: APPLICABILITY.APPLICABLE,
    verdict: VERDICT.TRUE,
    finality: FINALITY.PROVISIONAL,
  }),
  [STATUS.UNOBSERVED]: Object.freeze({
    applicability: APPLICABILITY.APPLICABLE,
    verdict: VERDICT.UNKNOWN,
    finality: FINALITY.PROVISIONAL,
  }),
  [STATUS.FAIL_VORLAEUFIG]: Object.freeze({
    applicability: APPLICABILITY.APPLICABLE,
    verdict: VERDICT.FALSE,
    finality: FINALITY.PROVISIONAL,
  }),
  [STATUS.FAIL]: Object.freeze({
    applicability: APPLICABILITY.APPLICABLE,
    verdict: VERDICT.FALSE,
    finality: FINALITY.FINAL,
  }),
  [STATUS.NA]: Object.freeze({
    applicability: APPLICABILITY.NA,
    verdict: null,
    finality: null,
  }),
  [STATUS.CONFIG_ERROR]: Object.freeze({
    applicability: APPLICABILITY.CONFIG_ERROR,
    verdict: null,
    finality: null,
  }),
});

/** Liefert die dimensionsgetreue Semantik eines kompatiblen STATUS-Labels. */
export function statusSemantics(status) {
  const out = STATUS_SEMANTICS[status];
  if (!out) throw new TypeError(`unbekannter Status: ${status}`);
  return out;
}

function statusFromSemantics(applicability, verdict, finality) {
  if (applicability === APPLICABILITY.CONFIG_ERROR) return STATUS.CONFIG_ERROR;
  if (applicability === APPLICABILITY.NA) return STATUS.NA;
  if (applicability !== APPLICABILITY.APPLICABLE) {
    throw new TypeError(`unbekannte Anwendbarkeit: ${applicability}`);
  }
  if (verdict === VERDICT.UNKNOWN) {
    if (finality === FINALITY.FINAL) {
      throw new TypeError("UNKNOWN kann nicht FINAL sein");
    }
    return STATUS.UNOBSERVED;
  }
  if (verdict === VERDICT.TRUE) {
    return finality === FINALITY.FINAL ? STATUS.PASS : STATUS.PASS_VORLAEUFIG;
  }
  if (verdict === VERDICT.FALSE) {
    return finality === FINALITY.FINAL ? STATUS.FAIL : STATUS.FAIL_VORLAEUFIG;
  }
  throw new TypeError(`unbekanntes Verdikt: ${verdict}`);
}

export const SCOPE = Object.freeze({
  STATE: "STATE",
  TRANSITION: "TRANSITION",
  TRACE: "TRACE",
  RELATION: "RELATION",
  CLASSIFIER: "CLASSIFIER",
});

export const R2_MODUS = Object.freeze({
  MINIMAL: "MINIMAL",
  ORDERED: "ORDERED",
  MONOTONE: "MONOTONE",
});

export const R4_MODUS = Object.freeze({
  STRUCTURAL: "STRUCTURAL",
  ACTIVE: "ACTIVE",
});

/**
 * Ist ein kompaktes Urteil final? Bei Angabe des Scopes bedeutet `true` zusaetzlich,
 * dass die Finalitaet ueber Trace-Verlaengerungen hinweg gilt. STATE/TRANSITION-
 * Urteile gelten nur fuer ihren lokalen Scope und koennen im naechsten Schritt anders
 * ausfallen, ohne dass das fruehere Urteil falsch war.
 */
export function istDefinitiv(status, scope) {
  const sem = statusSemantics(status);
  if (sem.finality !== FINALITY.FINAL) return false;
  if (scope === undefined) return true;
  return scope === SCOPE.TRACE;
}

/**
 * Dimensionsgetreue Konjunktion fuer Rule-Verdikte.
 *
 * - CONFIG_ERROR dominiert, weil das Gesamtergebnis dann nicht interpretierbar ist.
 * - N/A ist ein Anwendbarkeitswert und wird aus der Wahrheitslogik herausgehalten.
 * - Wahrheit folgt starker Kleene-Konjunktion: FALSE > UNKNOWN > TRUE als
 *   Entscheidungsregel, aber NICHT als globaler Wahrheitsrang.
 * - FALSE ist final, sobald mindestens ein final falscher Operand existiert.
 * - TRUE ist nur final, wenn alle anwendbaren Operanden final wahr sind.
 * - UNKNOWN bleibt notwendigerweise vorlaeufig.
 */
export function andAllSemantic(statuses) {
  if (!Array.isArray(statuses)) throw new TypeError("statuses muss ein Array sein");
  const semantics = statuses.map(statusSemantics);

  if (semantics.some((s) => s.applicability === APPLICABILITY.CONFIG_ERROR)) {
    return {
      status: STATUS.CONFIG_ERROR,
      applicability: APPLICABILITY.CONFIG_ERROR,
      verdict: null,
      finality: null,
    };
  }

  const applicable = semantics.filter((s) => s.applicability === APPLICABILITY.APPLICABLE);
  if (applicable.length === 0) {
    return {
      status: STATUS.NA,
      applicability: APPLICABILITY.NA,
      verdict: null,
      finality: null,
    };
  }

  let verdict = VERDICT.TRUE;
  if (applicable.some((s) => s.verdict === VERDICT.FALSE)) verdict = VERDICT.FALSE;
  else if (applicable.some((s) => s.verdict === VERDICT.UNKNOWN)) verdict = VERDICT.UNKNOWN;

  let finality = FINALITY.PROVISIONAL;
  if (verdict === VERDICT.FALSE) {
    // Ein finales Gegenbeispiel reicht, um eine Konjunktion dauerhaft zu falsifizieren.
    if (applicable.some((s) => s.verdict === VERDICT.FALSE && s.finality === FINALITY.FINAL)) {
      finality = FINALITY.FINAL;
    }
  } else if (verdict === VERDICT.TRUE) {
    // Zustimmung ist erst final, wenn jeder anwendbare Operand final wahr ist.
    if (applicable.every((s) => s.verdict === VERDICT.TRUE && s.finality === FINALITY.FINAL)) {
      finality = FINALITY.FINAL;
    }
  }

  return {
    status: statusFromSemantics(APPLICABILITY.APPLICABLE, verdict, finality),
    applicability: APPLICABILITY.APPLICABLE,
    verdict,
    finality,
  };
}

/** Kompatibler String-Adapter fuer bestehende UI-/Test-Aufrufer. */
export function andAll(statuses) {
  return andAllSemantic(statuses).status;
}

// --- Hex-Geometrie -----------------------------------------------------------
export function hexDistance(a, b) {
  const dq = a.q - b.q;
  const dr = a.r - b.r;
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
}

export const D6 = Object.freeze([
  Object.freeze({ q: 1, r: 0 }), Object.freeze({ q: 1, r: -1 }), Object.freeze({ q: 0, r: -1 }),
  Object.freeze({ q: -1, r: 0 }), Object.freeze({ q: -1, r: 1 }), Object.freeze({ q: 0, r: 1 }),
]);

export function isValidDirection(d) {
  if (!d || typeof d.q !== "number" || typeof d.r !== "number") return false;
  return D6.some((x) => x.q === d.q && x.r === d.r);
}

function res(status, evidence, extra = {}) {
  return { status, ...statusSemantics(status), evidence, ...extra };
}

const isNum = (x) => typeof x === "number" && Number.isFinite(x);

function validState(s) {
  if (!s || typeof s !== "object") return false;
  if (s.u === undefined) return false;
  if (s.q === undefined || s.q === null) return true;
  return typeof s.q === "object" && isNum(s.q.q) && isNum(s.q.r);
}

/** SameValueZero-artige Gleichheit: NaN bleibt gegen NaN unveraendert. */
function gleich(a, b) {
  if (typeof a === "number" && typeof b === "number") return Object.is(a, b) || a === b;
  return a === b;
}

// --- Die neun RuleSpecs ------------------------------------------------------
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
    claim: "Gerichtete Entwicklung: MINIMAL (ein Schritt), ORDERED (Netto-Fortschritt) oder MONOTONE (strikt monoton).",
    evaluate(ctx) {
      if (!ctx.config.progressVariable) {
        return res(STATUS.CONFIG_ERROR, "R2 ist aktiv, aber keine progressVariable konfiguriert");
      }
      const modus = ctx.config.r2Modus || R2_MODUS.ORDERED;
      if (!Object.values(R2_MODUS).includes(modus)) {
        return res(STATUS.CONFIG_ERROR, `unbekannter R2-Modus: ${modus}`);
      }
      const get = ctx.config.progressVariable;
      const vals = ctx.trace.map(get);
      if (vals.some((v) => !isNum(v))) {
        return res(STATUS.CONFIG_ERROR, "progressVariable liefert keine Zahl fuer jeden Zustand");
      }
      if (vals.length < 2) {
        return res(STATUS.NA, "weniger als zwei Zustaende -- kein Uebergang beobachtbar");
      }
      const stieg = vals.some((v, i) => i > 0 && v > vals[i - 1]);

      if (modus === R2_MODUS.MONOTONE) {
        for (let i = 1; i < vals.length; i++) {
          if (vals[i] < vals[i - 1]) {
            return res(
              STATUS.FAIL,
              `MONOTONE: Monotonie verletzt bei t=${i}: ${vals[i]} < ${vals[i - 1]}`,
              { counterexample: { t: i, prev: vals[i - 1], next: vals[i] } },
            );
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
        if (stieg) return res(STATUS.PASS, "MINIMAL: mindestens ein gerichteter Entwicklungsschritt belegt");
        return ctx.traceComplete
          ? res(STATUS.FAIL, "MINIMAL: abgeschlossen, kein einziger Entwicklungsschritt")
          : res(STATUS.FAIL_VORLAEUFIG, "MINIMAL: bisher kein Entwicklungsschritt; noch moeglich");
      }

      const rawFenster = ctx.config.r2Fenster ?? vals.length;
      if (!Number.isInteger(rawFenster) || rawFenster < 2) {
        return res(STATUS.CONFIG_ERROR, "r2Fenster muss eine ganze Zahl >= 2 sein");
      }
      const delta = ctx.config.r2Delta ?? 0;
      const reversalToleranz = ctx.config.r2ReversalToleranz ?? Infinity;
      if (!isNum(delta) || !(isNum(reversalToleranz) || reversalToleranz === Infinity) || reversalToleranz < 0) {
        return res(STATUS.CONFIG_ERROR, "r2Delta/r2ReversalToleranz sind ungueltig");
      }
      const fenster = Math.min(rawFenster, vals.length);
      const ab = Math.max(0, vals.length - fenster);
      const netto = vals[vals.length - 1] - vals[ab];
      let groessterRueckschritt = 0;
      for (let i = ab + 1; i < vals.length; i++) {
        const rueck = vals[i - 1] - vals[i];
        if (rueck > groessterRueckschritt) groessterRueckschritt = rueck;
      }
      if (groessterRueckschritt > reversalToleranz) {
        const ueberGanzenTrace = ab === 0;
        return res(
          ueberGanzenTrace ? STATUS.FAIL : STATUS.FAIL_VORLAEUFIG,
          `ORDERED: Rueckschritt ${groessterRueckschritt} ueberschreitet die Toleranz ${reversalToleranz}`
            + (ueberGanzenTrace ? "" : " (im gleitenden Fenster -- kann herausfallen)"),
          { counterexample: { groessterRueckschritt, reversalToleranz } },
        );
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
      if (ctx.trace.length > 1) return res(STATUS.PASS, `Historie mit ${ctx.trace.length - 1} Vorgaenger(n)`);
      return ctx.config.requirePriorHistory
        ? res(STATUS.FAIL_VORLAEUFIG, "Spec fordert Vergangenheit; bisher nur der Startframe")
        : res(STATUS.UNOBSERVED, "initialer Frame -- noch keine Vergangenheit beobachtet");
    },
  },
  {
    id: "R4", label: "Unterscheidet", scope: SCOPE.CLASSIFIER, deps: ["population"],
    claim: "STRUCTURAL: externer Unterschied. ACTIVE (Default): das System selbst unterscheidet.",
    evaluate(ctx) {
      const modus = ctx.config.r4Modus || R4_MODUS.ACTIVE;
      if (!Object.values(R4_MODUS).includes(modus)) {
        return res(STATUS.CONFIG_ERROR, `unbekannter R4-Modus: ${modus}`);
      }
      const pop = ctx.config.population ? ctx.config.population(ctx.last) : null;
      if (!Array.isArray(pop)) {
        return res(STATUS.CONFIG_ERROR, "keine population() konfiguriert -- Vergleichsraum unbestimmt");
      }
      if (pop.length < 2) return res(STATUS.UNOBSERVED, `Vergleichsraum hat nur ${pop.length} Element(e)`);

      if (modus === R4_MODUS.ACTIVE) {
        const disc = ctx.config.discriminator;
        if (typeof disc !== "function") {
          return res(
            STATUS.CONFIG_ERROR,
            "Modus ACTIVE verlangt einen discriminator(a,b) des Systems; STRUCTURAL waere eine andere Aussage",
          );
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
          if (!eq(pop[i], pop[j])) return res(STATUS.PASS, `STRUCTURAL: Unterschied zwischen Element ${i} und ${j}`);
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
      if (!s || s.d === undefined || s.d === null) return res(STATUS.NA, "keine Orientierung im Zustand gefuehrt");
      return isValidDirection(s.d)
        ? res(STATUS.PASS, `Orientierung (${s.d.q},${s.d.r}) liegt in D6`)
        : res(STATUS.FAIL, `Orientierung (${s.d.q},${s.d.r}) liegt NICHT in D6`);
    },
  },
  {
    id: "R6", label: "Bewegt", scope: SCOPE.TRANSITION, deps: ["position"],
    claim: "Die Position aendert sich. Bewusst getrennt von R8.",
    evaluate(ctx) {
      if (ctx.trace.length < 2) return res(STATUS.NA, "kein Uebergang vorhanden (weniger als zwei Zustaende)");
      const a = ctx.trace[ctx.trace.length - 2];
      const b = ctx.last;
      if (!a?.q || !b?.q) return res(STATUS.NA, "keine Position im Zustand gefuehrt");
      if (![a.q.q, a.q.r, b.q.q, b.q.r].every(isNum)) {
        return res(STATUS.CONFIG_ERROR, "Positionskoordinaten sind nicht endlich (NaN/Infinity)");
      }
      const d = hexDistance(a.q, b.q);
      return d > 0 ? res(STATUS.PASS, `Hex-Distanz ${d} > 0`) : res(STATUS.FAIL, "Position unveraendert (Hex-Distanz 0)");
    },
  },
  {
    id: "R7", label: "Endet", scope: SCOPE.TRACE, deps: ["terminalPredicate"],
    claim: "Die Trajektorie erreicht einen endlichen Terminalzustand; Ende ist nicht dasselbe wie Nullwert.",
    evaluate(ctx) {
      const term = ctx.config.terminalPredicate;
      if (typeof term !== "function") return res(STATUS.NA, "kein terminalPredicate konfiguriert");
      const hit = ctx.trace.findIndex((s) => term(s));
      if (hit >= 0) return res(STATUS.PASS, `Terminalzustand bei t=${hit}`);
      return ctx.traceComplete
        ? res(STATUS.FAIL, "Trace abgeschlossen, nie terminal geworden")
        : res(STATUS.FAIL_VORLAEUFIG, "bisher nicht terminal; der Trace laeuft noch");
    },
  },
  {
    id: "R8", label: "Aendert", scope: SCOPE.TRANSITION, deps: [],
    claim: "Der intrinsische Zustand aendert sich, unabhaengig von Ortsbewegung.",
    evaluate(ctx) {
      if (ctx.trace.length < 2) return res(STATUS.NA, "kein Uebergang vorhanden (weniger als zwei Zustaende)");
      const a = ctx.trace[ctx.trace.length - 2];
      const b = ctx.last;
      const eq = ctx.config.valueEquals || gleich;
      return !eq(a.u, b.u)
        ? res(STATUS.PASS, `intrinsischer Zustand geaendert: ${a.u} -> ${b.u}`)
        : res(STATUS.FAIL, `intrinsischer Zustand unveraendert (${b.u})`);
    },
  },
  {
    id: "R9", label: "Lebt", scope: SCOPE.TRACE, deps: ["lifeModel"],
    claim: "MODEL/PROXY-Ergebnis eines gewaehlten LifeModel-Praedikats. Kein universeller Lebensbeweis und keine biologische, medizinische oder diagnostische Behauptung.",
    evaluate(ctx) {
      const lm = ctx.config.lifeModel;
      if (!lm || typeof lm.predicate !== "function") return res(STATUS.NA, "kein lifeModel konfiguriert");
      if (ctx.trace.length < 2) {
        return res(STATUS.UNOBSERVED, "zu wenig Verlauf fuer ein Lebensurteil", { claimTier: "MODEL/PROXY" });
      }
      const alive = lm.predicate(ctx.last, ctx.trace);
      const st = ctx.traceComplete
        ? (alive ? STATUS.PASS : STATUS.FAIL)
        : (alive ? STATUS.PASS_VORLAEUFIG : STATUS.FAIL_VORLAEUFIG);
      return res(
        st,
        `LifeModel '${lm.name || "unbenannt"}' v${lm.version || "?"}: ${alive ? "alive" : "not alive"}`,
        { claimTier: "MODEL/PROXY", lifeModel: { name: lm.name, version: lm.version } },
      );
    },
  },
]);

/**
 * Wertet die aktivierten Regeln gegen einen endlichen Trace aus.
 * Rueckwaertskompatibel bleibt `overall` ein STATUS-String; `overallSemantics`
 * transportiert zusaetzlich Anwendbarkeit, Wahrheitswert und Finalitaet separat.
 */
export function evaluateNineRules(trace, config = {}, opts = {}) {
  if (!Array.isArray(trace)) throw new TypeError("trace muss ein Array sein");
  const traceComplete = opts.traceComplete === true;
  const enabled = opts.enabled || RULES.map((r) => r.id);
  if (!Array.isArray(enabled)) throw new TypeError("enabled muss ein Array sein");

  const ctx = {
    trace,
    last: trace.length ? trace[trace.length - 1] : null,
    config,
    traceComplete,
  };

  const letzter = Math.max(0, trace.length - 1);
  const rules = RULES.filter((r) => enabled.includes(r.id)).map((r) => {
    let out;
    try {
      out = r.evaluate(ctx);
    } catch (e) {
      out = res(STATUS.CONFIG_ERROR, `Auswertung warf: ${e && e.message ? e.message : String(e)}`);
    }
    const range = r.scope === SCOPE.TRACE
      ? [0, letzter]
      : r.scope === SCOPE.TRANSITION
        ? [Math.max(0, letzter - 1), letzter]
        : [letzter, letzter];
    return {
      id: r.id,
      label: r.label,
      scope: r.scope,
      deps: r.deps,
      status: out.status,
      applicability: out.applicability,
      verdict: out.verdict,
      finality: out.finality,
      evidence: out.evidence,
      counterexample: out.counterexample ?? null,
      claimTier: out.claimTier ?? "MODEL",
      traceRange: range,
      stabilUeberTrace: istDefinitiv(out.status, r.scope),
      specVersion: SPEC_VERSION,
    };
  });

  const counts = Object.fromEntries(Object.values(STATUS).map((s) => [s, 0]));
  for (const r of rules) counts[r.status] += 1;
  const overallSemantics = andAllSemantic(rules.map((r) => r.status));

  return {
    overall: overallSemantics.status,
    overallSemantics,
    rules,
    counts,
    specVersion: SPEC_VERSION,
    traceComplete,
    traceLength: trace.length,
  };
}

export const SPEC_VERSION = "9R-v1.1.0";

// GolHex Lab core: exact integer classification + conservative scalar transport.
// Pure module: no React, DOM, renderer, timers, or platform-specific hooks.

const SQRT3 = Math.sqrt(3);
export const DEFAULT_WORLD_CELL_CAP = 250000;
const AXIAL_DIRS = Object.freeze([
  [1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1],
]);

function assertNonNegativeInteger(value, name) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative safe integer`);
  }
}

function coerceExactBigInt(value, name) {
  if (typeof value === "bigint") return value;
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) {
      throw new RangeError(`${name} number input must be a safe integer; pass bigint or a base-10 integer string for larger values`);
    }
    return BigInt(value);
  }
  if (typeof value === "string") {
    const normalized = value.trim();
    if (!/^[+-]?\d+$/.test(normalized)) {
      throw new TypeError(`${name} string input must be a base-10 integer`);
    }
    return BigInt(normalized);
  }
  throw new TypeError(`${name} must be a bigint, safe integer number, or base-10 integer string`);
}

function asPositiveOddBigInt(value) {
  const n = coerceExactBigInt(value, "n");
  if (n <= 0n || (n & 1n) === 0n) {
    throw new RangeError("n must be a positive odd integer");
  }
  return n;
}

/** Return the 2-adic valuation v2(n) for a non-zero integer. */
export function v2BigInt(value) {
  let n = coerceExactBigInt(value, "value");
  if (n === 0n) throw new RangeError("v2(0) is not finite");
  if (n < 0n) n = -n;
  let k = 0;
  while ((n & 1n) === 0n) {
    n >>= 1n;
    k++;
  }
  return k;
}

/** Exact Collatz layer for positive odd n: k = v2(3n + 1). */
export function collatzClassOdd(value) {
  const n = asPositiveOddBigInt(value);
  return v2BigInt(3n * n + 1n);
}

/** Number of cells in an axial hex disk of radius R. */
export function hexDiskCellCount(radius) {
  assertNonNegativeInteger(radius, "radius");
  const count = 1 + 3 * radius * (radius + 1);
  if (!Number.isSafeInteger(count)) throw new RangeError("hex disk cell count exceeds the safe integer range");
  return count;
}

function axialKey(q, r, z) {
  return `${q},${r},${z}`;
}

/**
 * Build a dense deterministic stack of axial hex disks.
 * Neighbor slots 0..5 are lateral axial directions; 6 is z-1; 7 is z+1.
 * The coordinate map is construction/query metadata; hot solver loops use neighbors.
 */
export function buildHexPrismStack({
  radius,
  layers = 1,
  maxCells = DEFAULT_WORLD_CELL_CAP,
} = {}) {
  assertNonNegativeInteger(radius, "radius");
  if (!Number.isSafeInteger(layers) || layers < 1) {
    throw new RangeError("layers must be a positive safe integer");
  }
  if (!Number.isSafeInteger(maxCells) || maxCells < 1) {
    throw new RangeError("maxCells must be a positive safe integer");
  }

  const perLayer = hexDiskCellCount(radius);
  const count = perLayer * layers;
  if (!Number.isSafeInteger(count)) throw new RangeError("world cell count exceeds the safe integer range");
  if (count > maxCells) {
    throw new RangeError(`world requires ${count} cells, exceeding maxCells=${maxCells}`);
  }

  const q = new Int32Array(count);
  const r = new Int32Array(count);
  const z = new Int32Array(count);
  const indexByCoord = new Map();

  let i = 0;
  for (let layer = 0; layer < layers; layer++) {
    // Lexicographic order is deterministic and keeps rows contiguous.
    for (let rr = -radius; rr <= radius; rr++) {
      const qMin = Math.max(-radius, -rr - radius);
      const qMax = Math.min(radius, -rr + radius);
      for (let qq = qMin; qq <= qMax; qq++) {
        q[i] = qq;
        r[i] = rr;
        z[i] = layer;
        indexByCoord.set(axialKey(qq, rr, layer), i);
        i++;
      }
    }
  }

  const neighbors = new Int32Array(count * 8);
  neighbors.fill(-1);
  for (let cell = 0; cell < count; cell++) {
    const base = cell * 8;
    for (let d = 0; d < 6; d++) {
      const [dq, dr] = AXIAL_DIRS[d];
      const found = indexByCoord.get(axialKey(q[cell] + dq, r[cell] + dr, z[cell]));
      if (found !== undefined) neighbors[base + d] = found;
    }
    const below = indexByCoord.get(axialKey(q[cell], r[cell], z[cell] - 1));
    const above = indexByCoord.get(axialKey(q[cell], r[cell], z[cell] + 1));
    if (below !== undefined) neighbors[base + 6] = below;
    if (above !== undefined) neighbors[base + 7] = above;
  }

  return { radius, layers, perLayer, count, q, r, z, neighbors, indexByCoord };
}

/** Exact geometric factors for a regular pointy/flat hexagonal prism. */
export function hexPrismGeometry({ edgeLength, height } = {}) {
  if (!(edgeLength > 0) || !Number.isFinite(edgeLength)) {
    throw new RangeError("edgeLength must be finite and > 0");
  }
  if (!(height > 0) || !Number.isFinite(height)) {
    throw new RangeError("height must be finite and > 0");
  }
  const baseArea = (3 * SQRT3 / 2) * edgeLength * edgeLength;
  const volume = baseArea * height;
  const lateralFaceArea = edgeLength * height;
  const lateralCenterDistance = SQRT3 * edgeLength;
  const verticalFaceArea = baseArea;
  const verticalCenterDistance = height;
  const lateralGeometricConductance = lateralFaceArea / lateralCenterDistance;
  const verticalGeometricConductance = verticalFaceArea / verticalCenterDistance;
  const derived = [
    baseArea,
    volume,
    lateralFaceArea,
    lateralCenterDistance,
    verticalFaceArea,
    verticalCenterDistance,
    lateralGeometricConductance,
    verticalGeometricConductance,
  ];
  if (derived.some((value) => !(value > 0) || !Number.isFinite(value))) {
    throw new RangeError("derived prism geometry must remain finite and > 0");
  }
  return {
    edgeLength,
    height,
    baseArea,
    volume,
    lateralFaceArea,
    lateralCenterDistance,
    verticalFaceArea,
    verticalCenterDistance,
    lateralGeometricConductance,
    verticalGeometricConductance,
  };
}

function validateField(field, count, name = "field") {
  if (!(field instanceof Float64Array) || field.length !== count) {
    throw new TypeError(`${name} must be a Float64Array of length ${count}`);
  }
  for (let i = 0; i < field.length; i++) {
    if (!Number.isFinite(field[i])) throw new RangeError(`${name}[${i}] is not finite`);
  }
}

function validateWorld(world) {
  if (!world || !Number.isSafeInteger(world.count) || world.count < 1) {
    throw new TypeError("world.count must be a positive safe integer");
  }
  const expectedNeighborSlots = world.count * 8;
  if (!Number.isSafeInteger(expectedNeighborSlots)
      || !(world.neighbors instanceof Int32Array)
      || world.neighbors.length !== expectedNeighborSlots) {
    throw new TypeError(`world.neighbors must be an Int32Array of length ${expectedNeighborSlots}`);
  }
}

function validateDiffusionGeometry(geometry) {
  if (!geometry || typeof geometry !== "object") {
    throw new TypeError("geometry is required");
  }
  for (const key of [
    "volume",
    "lateralGeometricConductance",
    "verticalGeometricConductance",
  ]) {
    if (!(geometry[key] > 0) || !Number.isFinite(geometry[key])) {
      throw new RangeError(`geometry.${key} must be finite and > 0`);
    }
  }
}

function assertValidNeighbor(neighbor, cell, count) {
  if (neighbor < -1 || neighbor >= count) {
    throw new RangeError(`world.neighbors contains out-of-range index ${neighbor} for cell ${cell}`);
  }
  if (neighbor === cell) {
    throw new RangeError(`world.neighbors contains a self-neighbor for cell ${cell}`);
  }
}

function typedArrayViewsOverlap(a, b) {
  if (a.buffer !== b.buffer) return false;
  const aEnd = a.byteOffset + a.byteLength;
  const bEnd = b.byteOffset + b.byteLength;
  return a.byteOffset < bEnd && b.byteOffset < aEnd;
}

/**
 * Positivity-safe explicit time-step ceiling for du/dt = sum_j rate_ij (u_j-u_i).
 * The bound is conservative, not an accuracy guarantee.
 * Current scope: uniform regular cells and one non-negative scalar diffusivity.
 */
export function explicitDiffusionDtMax({ world, geometry, diffusivity = 1 } = {}) {
  validateWorld(world);
  validateDiffusionGeometry(geometry);
  if (!(diffusivity >= 0) || !Number.isFinite(diffusivity)) {
    throw new RangeError("diffusivity must be finite and >= 0");
  }
  const lateralRate = diffusivity * geometry.lateralGeometricConductance / geometry.volume;
  const verticalRate = diffusivity * geometry.verticalGeometricConductance / geometry.volume;
  if (!(lateralRate >= 0) || !Number.isFinite(lateralRate)
      || !(verticalRate >= 0) || !Number.isFinite(verticalRate)) {
    throw new RangeError("derived diffusion rates must be finite and >= 0");
  }

  let maxRateSum = 0;
  for (let i = 0; i < world.count; i++) {
    const base = i * 8;
    let sum = 0;
    for (let d = 0; d < 8; d++) {
      const neighbor = world.neighbors[base + d];
      assertValidNeighbor(neighbor, i, world.count);
      if (neighbor >= 0) sum += d < 6 ? lateralRate : verticalRate;
    }
    if (!Number.isFinite(sum)) throw new RangeError(`diffusion rate sum for cell ${i} is not finite`);
    if (sum > maxRateSum) maxRateSum = sum;
  }
  return maxRateSum === 0 ? Infinity : 1 / maxRateSum;
}

/**
 * One conservative explicit finite-volume diffusion step with no-flux outer boundary.
 * Pairwise fluxes are applied once and with opposite signs, preserving total content.
 * `source`, when present, is a per-cell rate du/dt rather than an integrated amount.
 */
export function stepConservativeDiffusion({
  world,
  geometry,
  field,
  dt,
  diffusivity = 1,
  source = null,
  out = null,
  enforceStableStep = true,
} = {}) {
  validateWorld(world);
  validateDiffusionGeometry(geometry);
  validateField(field, world.count);
  if (!(dt >= 0) || !Number.isFinite(dt)) throw new RangeError("dt must be finite and >= 0");
  if (!(diffusivity >= 0) || !Number.isFinite(diffusivity)) {
    throw new RangeError("diffusivity must be finite and >= 0");
  }
  if (source !== null) validateField(source, world.count, "source");
  if (out === null) out = new Float64Array(world.count);
  validateField(out, world.count, "out");
  if (typedArrayViewsOverlap(out, field)) {
    throw new TypeError("out must not overlap field");
  }
  if (source !== null && typedArrayViewsOverlap(out, source)) {
    throw new TypeError("out must not overlap source");
  }

  const dtMax = explicitDiffusionDtMax({ world, geometry, diffusivity });
  if (enforceStableStep && dt > dtMax * (1 + 1e-12)) {
    throw new RangeError(`dt=${dt} exceeds explicit positivity bound ${dtMax}`);
  }

  out.set(field);
  const lateralFluxFactor = diffusivity * geometry.lateralGeometricConductance * dt / geometry.volume;
  const verticalFluxFactor = diffusivity * geometry.verticalGeometricConductance * dt / geometry.volume;
  if (!(lateralFluxFactor >= 0) || !Number.isFinite(lateralFluxFactor)
      || !(verticalFluxFactor >= 0) || !Number.isFinite(verticalFluxFactor)) {
    throw new RangeError("derived diffusion flux factors must be finite and >= 0");
  }

  for (let i = 0; i < world.count; i++) {
    const base = i * 8;
    for (let d = 0; d < 8; d++) {
      const j = world.neighbors[base + d];
      assertValidNeighbor(j, i, world.count);
      if (j <= i) continue; // missing or already processed pair
      const factor = d < 6 ? lateralFluxFactor : verticalFluxFactor;
      const transfer = factor * (field[j] - field[i]);
      if (!Number.isFinite(transfer)) {
        throw new RangeError(`diffusion transfer between cells ${i} and ${j} is not finite`);
      }
      out[i] += transfer;
      out[j] -= transfer;
    }
  }

  if (source !== null && dt !== 0) {
    for (let i = 0; i < world.count; i++) out[i] += dt * source[i];
  }
  validateField(out, world.count, "out result");
  return { out, dtMax };
}

export function totalContent(field, cellVolume = 1) {
  if (!(field instanceof Float64Array)) throw new TypeError("field must be Float64Array");
  if (!(cellVolume > 0) || !Number.isFinite(cellVolume)) {
    throw new RangeError("cellVolume must be finite and > 0");
  }
  // Kahan summation limits order-dependent loss without pretending cross-platform bit identity.
  let sum = 0;
  let correction = 0;
  for (let i = 0; i < field.length; i++) {
    if (!Number.isFinite(field[i])) throw new RangeError(`field[${i}] is not finite`);
    const y = field[i] - correction;
    const t = sum + y;
    correction = (t - sum) - y;
    sum = t;
  }
  const total = sum * cellVolume;
  if (!Number.isFinite(total)) throw new RangeError("total content is not finite");
  return total;
}

export function compareStates(a, b) {
  if (!(a instanceof Float64Array) || !(b instanceof Float64Array) || a.length !== b.length) {
    throw new TypeError("a and b must be equally sized Float64Array values");
  }
  let maxAbs = 0;
  let l1 = 0;
  let l2sq = 0;
  for (let i = 0; i < a.length; i++) {
    if (!Number.isFinite(a[i]) || !Number.isFinite(b[i])) {
      throw new RangeError(`state value at index ${i} is not finite`);
    }
    const d = Math.abs(a[i] - b[i]);
    if (d > maxAbs) maxAbs = d;
    l1 += d;
    l2sq += d * d;
  }
  if (!Number.isFinite(l1) || !Number.isFinite(l2sq)) {
    throw new RangeError("state difference norms are not finite");
  }
  return { maxAbs, l1, l2: Math.sqrt(l2sq), rms: Math.sqrt(l2sq / Math.max(1, a.length)) };
}

function fnv1aByte(hash, byte) {
  return ((hash ^ BigInt(byte)) * 0x100000001b3n) & 0xffffffffffffffffn;
}

function hashFloat64ValueCanonical(hash, value, scratchView) {
  // Explicit little-endian encoding makes the fingerprint independent of host byte order.
  scratchView.setFloat64(0, value, true);
  for (let b = 0; b < 8; b++) hash = fnv1aByte(hash, scratchView.getUint8(b));
  return hash;
}

/** Canonical-byte-order exact bit hash. It is an integrity/replay fingerprint, not a signature. */
export function hashFloat64Bits(field) {
  if (!(field instanceof Float64Array)) throw new TypeError("field must be Float64Array");
  let hash = 0xcbf29ce484222325n;
  const scratchView = new DataView(new ArrayBuffer(8));
  for (let i = 0; i < field.length; i++) {
    const value = field[i];
    if (!Number.isFinite(value)) throw new RangeError(`field[${i}] is not finite`);
    hash = hashFloat64ValueCanonical(hash, value, scratchView);
  }
  return hash.toString(16).padStart(16, "0");
}

/**
 * Tolerance-aware fingerprint for semantic regression tests.
 * Fails closed when value/quantum cannot be represented as an exact safe integer.
 */
export function hashQuantizedState(field, quantum = 1e-12) {
  if (!(field instanceof Float64Array)) throw new TypeError("field must be Float64Array");
  if (!(quantum > 0) || !Number.isFinite(quantum)) throw new RangeError("quantum must be finite and > 0");
  let hash = 0xcbf29ce484222325n;
  for (let i = 0; i < field.length; i++) {
    const value = field[i];
    if (!Number.isFinite(value)) throw new RangeError(`field[${i}] is not finite`);
    const scaled = value / quantum;
    const roundedNumber = Math.round(scaled);
    if (!Number.isSafeInteger(roundedNumber)) {
      throw new RangeError(`field[${i}] / quantum exceeds the exact safe-integer range; use a larger quantum`);
    }
    let x = BigInt.asUintN(64, BigInt(roundedNumber));
    for (let b = 0; b < 8; b++) {
      hash = fnv1aByte(hash, Number(x & 0xffn));
      x >>= 8n;
    }
  }
  return hash.toString(16).padStart(16, "0");
}

export { AXIAL_DIRS };

// GolHex Lab core: exact integer classification + conservative scalar transport.
// Pure module: no React, DOM, renderer, timers, or platform-specific hooks.

const SQRT3 = Math.sqrt(3);
const AXIAL_DIRS = Object.freeze([
  [1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1],
]);

function assertNonNegativeInteger(value, name) {
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative integer`);
  }
}

function asPositiveOddBigInt(value) {
  let n;
  try {
    n = typeof value === "bigint" ? value : BigInt(value);
  } catch {
    throw new TypeError("n must be coercible to BigInt");
  }
  if (n <= 0n || (n & 1n) === 0n) {
    throw new RangeError("n must be a positive odd integer");
  }
  return n;
}

/** Return the 2-adic valuation v2(n) for a non-zero integer. */
export function v2BigInt(value) {
  let n;
  try {
    n = typeof value === "bigint" ? value : BigInt(value);
  } catch {
    throw new TypeError("value must be coercible to BigInt");
  }
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
  return 1 + 3 * radius * (radius + 1);
}

function axialKey(q, r, z) {
  return `${q},${r},${z}`;
}

/**
 * Build a dense deterministic stack of axial hex disks.
 * Neighbor slots 0..5 are lateral axial directions; 6 is z-1; 7 is z+1.
 */
export function buildHexPrismStack({ radius, layers = 1 } = {}) {
  assertNonNegativeInteger(radius, "radius");
  if (!Number.isInteger(layers) || layers < 1) {
    throw new RangeError("layers must be a positive integer");
  }

  const perLayer = hexDiskCellCount(radius);
  const count = perLayer * layers;
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
  return {
    edgeLength,
    height,
    baseArea,
    volume,
    lateralFaceArea,
    lateralCenterDistance,
    verticalFaceArea,
    verticalCenterDistance,
    lateralGeometricConductance: lateralFaceArea / lateralCenterDistance,
    verticalGeometricConductance: verticalFaceArea / verticalCenterDistance,
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

/**
 * Positivity-safe explicit time-step ceiling for du/dt = sum_j rate_ij (u_j-u_i).
 * The bound is conservative, not an accuracy guarantee.
 */
export function explicitDiffusionDtMax({ world, geometry, diffusivity = 1 } = {}) {
  if (!world || !geometry) throw new TypeError("world and geometry are required");
  if (!(diffusivity >= 0) || !Number.isFinite(diffusivity)) {
    throw new RangeError("diffusivity must be finite and >= 0");
  }
  if (diffusivity === 0) return Infinity;

  const lateralRate = diffusivity * geometry.lateralGeometricConductance / geometry.volume;
  const verticalRate = diffusivity * geometry.verticalGeometricConductance / geometry.volume;
  let maxRateSum = 0;
  for (let i = 0; i < world.count; i++) {
    const base = i * 8;
    let sum = 0;
    for (let d = 0; d < 6; d++) if (world.neighbors[base + d] >= 0) sum += lateralRate;
    if (world.neighbors[base + 6] >= 0) sum += verticalRate;
    if (world.neighbors[base + 7] >= 0) sum += verticalRate;
    if (sum > maxRateSum) maxRateSum = sum;
  }
  return maxRateSum === 0 ? Infinity : 1 / maxRateSum;
}

/**
 * One conservative explicit finite-volume diffusion step with no-flux outer boundary.
 * Pairwise fluxes are applied once and with opposite signs, preserving total content.
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
  if (!world || !geometry) throw new TypeError("world and geometry are required");
  validateField(field, world.count);
  if (!(dt >= 0) || !Number.isFinite(dt)) throw new RangeError("dt must be finite and >= 0");
  if (!(diffusivity >= 0) || !Number.isFinite(diffusivity)) {
    throw new RangeError("diffusivity must be finite and >= 0");
  }
  if (source !== null) validateField(source, world.count, "source");
  if (out === null) out = new Float64Array(world.count);
  validateField(out, world.count, "out");
  if (out === field) throw new TypeError("out must not alias field");

  const dtMax = explicitDiffusionDtMax({ world, geometry, diffusivity });
  if (enforceStableStep && dt > dtMax * (1 + 1e-12)) {
    throw new RangeError(`dt=${dt} exceeds explicit positivity bound ${dtMax}`);
  }

  out.set(field);
  const lateralFluxFactor = diffusivity * geometry.lateralGeometricConductance * dt / geometry.volume;
  const verticalFluxFactor = diffusivity * geometry.verticalGeometricConductance * dt / geometry.volume;

  for (let i = 0; i < world.count; i++) {
    const base = i * 8;
    for (let d = 0; d < 8; d++) {
      const j = world.neighbors[base + d];
      if (j <= i) continue; // missing, self impossible, or already processed pair
      const factor = d < 6 ? lateralFluxFactor : verticalFluxFactor;
      const transfer = factor * (field[j] - field[i]);
      out[i] += transfer;
      out[j] -= transfer;
    }
  }

  if (source !== null && dt !== 0) {
    for (let i = 0; i < world.count; i++) out[i] += dt * source[i];
  }
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
    const y = field[i] - correction;
    const t = sum + y;
    correction = (t - sum) - y;
    sum = t;
  }
  return sum * cellVolume;
}

export function compareStates(a, b) {
  if (!(a instanceof Float64Array) || !(b instanceof Float64Array) || a.length !== b.length) {
    throw new TypeError("a and b must be equally sized Float64Array values");
  }
  let maxAbs = 0;
  let l1 = 0;
  let l2sq = 0;
  for (let i = 0; i < a.length; i++) {
    const d = Math.abs(a[i] - b[i]);
    if (d > maxAbs) maxAbs = d;
    l1 += d;
    l2sq += d * d;
  }
  return { maxAbs, l1, l2: Math.sqrt(l2sq), rms: Math.sqrt(l2sq / Math.max(1, a.length)) };
}

/** Backend-local exact bit hash. It is an integrity/replay fingerprint, not a signature. */
export function hashFloat64Bits(field) {
  if (!(field instanceof Float64Array)) throw new TypeError("field must be Float64Array");
  const bytes = new Uint8Array(field.buffer, field.byteOffset, field.byteLength);
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const mask64 = 0xffffffffffffffffn;
  for (let i = 0; i < bytes.length; i++) {
    hash ^= BigInt(bytes[i]);
    hash = (hash * prime) & mask64;
  }
  return hash.toString(16).padStart(16, "0");
}

/** Tolerance-aware fingerprint for semantic regression tests. */
export function hashQuantizedState(field, quantum = 1e-12) {
  if (!(field instanceof Float64Array)) throw new TypeError("field must be Float64Array");
  if (!(quantum > 0) || !Number.isFinite(quantum)) throw new RangeError("quantum must be finite and > 0");
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const mask64 = 0xffffffffffffffffn;
  for (let i = 0; i < field.length; i++) {
    const value = field[i];
    if (!Number.isFinite(value)) throw new RangeError(`field[${i}] is not finite`);
    const rounded = BigInt(Math.round(value / quantum));
    let x = BigInt.asUintN(64, rounded);
    for (let b = 0; b < 8; b++) {
      hash ^= x & 0xffn;
      hash = (hash * prime) & mask64;
      x >>= 8n;
    }
  }
  return hash.toString(16).padStart(16, "0");
}

export { AXIAL_DIRS };

#!/usr/bin/env python3
"""Consumer-side reference check for contracts/golhex-planar-water-golden-v1 (stdlib only).

This is NOT the producer and not a second engine for the app. It is what a downstream
repository has to do: re-implement the water step in its own language from the documented
arithmetic and reproduce every checkpoint bit for bit. It exists to turn the arithmetic
recipe in the fixture ("binary64 intermediates, binary32 store, no fused multiply-add")
from a claim into a measured fact, in a language other than the producer's.

Not part of CI (the repository's CI is Node only). Run by hand:

    python3 -I scripts/verify-planar-water-golden.py contracts/golhex-planar-water-golden-v1

Exit 0: every checkpoint of every profile reproduced. Exit 1: first mismatch is printed.
"""
import hashlib
import json
import struct
import sys
from pathlib import Path


def f32(x):
    """Round a binary64 value to binary32 (nearest-even), like a Float32Array store."""
    return struct.unpack("<f", struct.pack("<f", x))[0]


def bits_to_float(b):
    return struct.unpack("<f", struct.pack("<I", b))[0]


def float_to_bits(x):
    return struct.unpack("<I", struct.pack("<f", x))[0]


def step_water(w, nl, cols):
    """One tick. `w` holds binary32 values (as Python floats); returns the new field."""
    n = len(w)
    nw = list(w)
    for i in range(n - 1, -1, -1):
        amt = nw[i]
        if amt <= 1e-6:
            continue
        row = i // cols
        j4, j5 = nl[i * 6 + 4], nl[i * 6 + 5]
        d4 = j4 if (j4 >= 0 and j4 // cols > row) else -1
        d5 = j5 if (j5 >= 0 and j5 // cols > row) else -1
        r4 = max(0.0, 1 - nw[d4]) if d4 >= 0 else 0.0
        r5 = max(0.0, 1 - nw[d5]) if d5 >= 0 else 0.0
        total_room = r4 + r5
        if total_room <= 0:
            continue
        flow = min(amt, total_room) * 0.5
        if flow <= 0:
            continue
        if r4 > 0:
            nw[d4] = f32(nw[d4] + flow * (r4 / total_room))
        if r5 > 0:
            nw[d5] = f32(nw[d5] + flow * (r5 / total_room))
        nw[i] = f32(nw[i] - flow)
    snap = list(nw)  # post-gravity snapshot; lateral flows are computed from it
    for i in range(n):
        j = nl[i * 6 + 3]
        if j < 0:
            continue
        diff = (snap[i] - snap[j]) * 0.25
        nw[i] = f32(nw[i] - diff)
        nw[j] = f32(nw[j] + diff)
    return nw


def state_sha256(tick, bits):
    return hashlib.sha256(struct.pack("<I", tick) + struct.pack("<%dI" % len(bits), *bits)).hexdigest()


def verify(path):
    fx = json.loads(path.read_text(encoding="utf-8"))
    if fx["schema"] != "golhex-planar-water-golden-v1":
        return "%s: unknown schema %r" % (path.name, fx["schema"])
    rows, cols = fx["topology"]["rows"], fx["topology"]["cols"]
    nl = fx["topology"]["neighborTable"]
    w = [0.0] * (rows * cols)
    for r, c, v in fx["initial"]["cells"]:
        w[r * cols + c] = f32(v)
    for cp in fx["checkpoints"]:
        if cp["tick"] > 0:
            w = step_water(w, nl, cols)
        bits = [float_to_bits(x) for x in w]
        if bits != cp["wBits"]:
            cell = next(i for i, (a, b) in enumerate(zip(bits, cp["wBits"])) if a != b)
            return "%s: tick %d cell %d: got 0x%08x, fixture 0x%08x" % (
                path.name, cp["tick"], cell, bits[cell], cp["wBits"][cell])
        if state_sha256(cp["tick"], bits) != cp["stateSha256"]:
            return "%s: tick %d: state hash mismatch" % (path.name, cp["tick"])
    return None


def main(argv):
    directory = Path(argv[1] if len(argv) > 1 else "contracts/golhex-planar-water-golden-v1")
    files = sorted(directory.glob("*.json"))
    if not files:
        print("no fixtures in %s" % directory)
        return 1
    failed = 0
    for path in files:
        error = verify(path)
        print("%s: %s" % (path.name, "reproduced" if error is None else "MISMATCH"))
        if error:
            print("  " + error)
            failed += 1
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))

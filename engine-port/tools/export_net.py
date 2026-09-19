"""Turn the engine's weights/net.npz into the flat binary the C port reads.

    python engine-port/tools/export_net.py PATH/TO/net.npz assets/wasm/ransom-net.bin

Layout (little-endian): "RNET", u32 version = 1, u32 l1, u32 n_buckets, f32 scale,
then w1 f32[768 * l1] row-major, b1 f32[l1], w2 f32[n_buckets * 2 * l1], b2 f32[n_buckets].
Nothing is rounded or quantised: the numbers are the original float32 values.
"""
import hashlib
import struct
import sys

import numpy as np


def main() -> None:
    src, dst = sys.argv[1], sys.argv[2]
    net = np.load(src)
    w1 = np.ascontiguousarray(net["w1"], dtype="<f4")
    b1 = np.ascontiguousarray(net["b1"], dtype="<f4")
    w2 = np.ascontiguousarray(net["w2"], dtype="<f4")
    b2 = np.ascontiguousarray(net["b2"], dtype="<f4")
    l1 = int(net["l1"])
    scale = float(net["scale"])
    assert net["w1"].dtype == np.float32 and net["w2"].dtype == np.float32, "weights are not float32"
    assert w1.shape == (768, l1) and b1.shape == (l1,), (w1.shape, b1.shape)
    assert w2.ndim == 2 and w2.shape[1] == 2 * l1 and b2.shape == (w2.shape[0],), (w2.shape, b2.shape)
    blob = b"RNET" + struct.pack("<IIIf", 1, l1, w2.shape[0], scale) + w1.tobytes() + b1.tobytes() + w2.tobytes() + b2.tobytes()
    with open(dst, "wb") as f:
        f.write(blob)
    print(f"{dst}: {len(blob)} bytes, l1={l1}, buckets={w2.shape[0]}, scale={scale}")
    print("source sha256:", hashlib.sha256(open(src, "rb").read()).hexdigest())
    print("output sha256:", hashlib.sha256(blob).hexdigest())


if __name__ == "__main__":
    main()

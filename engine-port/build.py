"""Build the C port into WebAssembly.

    python engine-port/build.py

Writes two files into assets/wasm/:
  ransom.wasm        runs in every browser that has WebAssembly
  ransom-simd.wasm   the same code, with the compiler allowed to use WebAssembly SIMD
                     (about a fifth faster; the page picks it when the browser can load it)

Needs the `ziglang` Python package (it carries a C compiler): pip install ziglang

The flags matter for correctness, not just speed:
  -ffp-contract=off   never fuse a multiply and an add into one rounded operation
  no -ffast-math      float sums stay in source order, so evaluations match the original
SIMD only changes element-by-element loops (adding weight rows to the accumulator),
which give the same numbers in any order; the ordered sums are left alone. Both files
are run through tests/run_fidelity.py and must give identical results.
"""
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUT_DIR = HERE.parent / "assets" / "wasm"
SOURCES = ["tables.c", "position.c", "movegen.c", "nnue.c", "search.c", "api.c"]


def build(name: str, extra: list[str]) -> None:
    out = OUT_DIR / name
    cmd = [
        sys.executable, "-m", "ziglang", "cc",
        "--target=wasm32-freestanding", *extra,
        "-O2", "-ffp-contract=off", "-fno-builtin", "-nostdlib",
        "-Wall", "-Wextra", "-Wno-unused-function",
        "-Wl,--no-entry", "-Wl,--strip-all", "-Wl,-z,stack-size=2097152",
        "-o", str(out),
    ]
    cmd += [str(HERE / "src" / s) for s in SOURCES]
    subprocess.run(cmd, check=True)
    print(f"{out}: {out.stat().st_size} bytes")


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    build("ransom.wasm", [])
    build("ransom-simd.wasm", ["-msimd128"])


if __name__ == "__main__":
    main()

"""Shrink the Story posters (and the page skyline) in assets/img/story/.

The pictures use only a handful of colours, so they are saved again as
palette PNGs, which are several times smaller and look the same. Saving a
picture again also drops any extra data stored inside the file.

    python tools/pack_posters.py
"""
from pathlib import Path
from PIL import Image

FOLDER = Path(__file__).resolve().parent.parent / "assets" / "img" / "story"

# The skyline along the bottom of every page: transparent except for white at 3.5%, so a four-colour palette holds it exactly.
horizon = FOLDER / "horizon.png"
if horizon.exists():
    before = horizon.stat().st_size
    picture = Image.open(horizon).convert("RGBA")
    picture.quantize(colors=4, method=Image.Quantize.FASTOCTREE).save(horizon, optimize=True)
    print(f"horizon.png: {before // 1024} KB -> {horizon.stat().st_size // 1024} KB")

for path in sorted(FOLDER.glob("slide-*.png")):
    before = path.stat().st_size
    picture = Image.open(path).convert("RGB")
    colours = picture.getcolors(maxcolors=256)
    if colours is None:  # more than 256 colours: leave it alone
        print(f"{path.name}: too many colours, skipped")
        continue
    packed = picture.quantize(colors=max(2, len(colours)), method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)
    packed.save(path, optimize=True)
    print(f"{path.name}: {len(colours)} colours, {before // 1024} KB -> {path.stat().st_size // 1024} KB")

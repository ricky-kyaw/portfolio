"""Draws the link-preview card and the PNG icons.

    python tools/make_images.py

Needs Pillow (pip install pillow). The site itself does not need this; run it
only if you want to change the name or the look of the preview card. Output:

    assets/img/og.png               1200 x 630, shown when the site is shared
    assets/img/apple-touch-icon.png 180 x 180, the iPhone home-screen icon
    favicon.ico                     16/32/48, for browsers that skip the SVG
"""
import os
import random
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
IMG = os.path.join(ROOT, 'assets', 'img')

BG, FG, MUTED, ACCENT = '#F8F7F2', '#14161A', '#5F636E', '#2453D6'
GRID_MINOR, GRID_MAJOR, LINE = '#ECEFF4', '#DDE2EA', '#D9DEE7'

NAME = 'Ricky Kyaw'
STATEMENT = 'I write software and solve math problems.'
DOMAIN = 'rickydx.dev'


def font(names, size):
    for n in names:
        for folder in (r'C:\Windows\Fonts', '/usr/share/fonts/truetype/ibm-plex', '/Library/Fonts'):
            path = os.path.join(folder, n)
            if os.path.exists(path):
                return ImageFont.truetype(path, size)
    return ImageFont.load_default()


def walk(seed, n=240, step=0.1):
    rnd = random.Random(seed)
    w = [0.0]
    for _ in range(n):
        w.append(round(w[-1] + (step if rnd.random() < 0.5 else -step), 1))
    return w


def grid(draw, w, h, minor, major, offset_x, k):
    for x in range(offset_x % minor, w, minor):
        draw.line([(x, 0), (x, h)], fill=GRID_MINOR, width=k)
    for y in range(0, h, minor):
        draw.line([(0, y), (w, y)], fill=GRID_MINOR, width=k)
    for x in range(offset_x % major, w, major):
        draw.line([(x, 0), (x, h)], fill=GRID_MAJOR, width=k)
    for y in range(0, h, major):
        draw.line([(0, y), (w, y)], fill=GRID_MAJOR, width=k)


def og_card():
    k = 2  # draw at double size, then shrink, so lines come out smooth
    W, H = 1200 * k, 630 * k
    im = Image.new('RGB', (W, H), BG)
    d = ImageDraw.Draw(im)
    left = 96 * k
    grid(d, W, H, 24 * k, 120 * k, left, k)

    mono = ['IBMPlexMono-Regular.ttf', 'consola.ttf']
    sans = ['IBMPlexSans-Regular.ttf', 'segoeui.ttf']
    bold = ['IBMPlexSans-SemiBold.ttf', 'seguisb.ttf']
    d.text((left, 70 * k), DOMAIN, font=font(mono, 26 * k), fill=MUTED)
    d.text((left - 4 * k, 112 * k), NAME, font=font(bold, 112 * k), fill=FG)
    d.text((left, 262 * k), STATEMENT, font=font(sans, 40 * k), fill=FG)

    # Figure 1: the same walk the Home page ships as its no-script fallback.
    w = walk(20260913)
    x0, x1, top, bottom = left, (1200 - 96) * k, 372 * k, 540 * k
    lo, hi = min(min(w), 0), max(max(w), 0)
    pad = (hi - lo) * 0.1
    lo, hi = lo - pad, hi + pad
    sx = lambda i: x0 + i / (len(w) - 1) * (x1 - x0)
    sy = lambda v: top + (hi - v) / (hi - lo) * (bottom - top)
    d.line([(x0, sy(0)), (x1, sy(0))], fill=LINE, width=2 * k)
    pts = [(sx(i), sy(v)) for i, v in enumerate(w)]
    d.line(pts, fill=ACCENT, width=3 * k, joint='curve')
    ex, ey = pts[-1]
    r = 7 * k
    d.ellipse([ex - r, ey - r, ex + r, ey + r], fill=ACCENT)
    d.text((left, 566 * k), 'Fig. 1: 240 coin flips.', font=font(mono, 22 * k), fill=MUTED)

    im = im.resize((1200, 630), Image.LANCZOS)
    im.save(os.path.join(IMG, 'og.png'), optimize=True)


def icon(size, rounded):
    k = 8
    S = 32 * k
    im = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    if rounded:
        d.rounded_rectangle([0, 0, S - 1, S - 1], radius=6 * k, fill=BG)
    else:
        d.rectangle([0, 0, S, S], fill=BG)
    for v in (8, 16, 24):
        d.line([(v * k, 0), (v * k, S)], fill=LINE, width=k)
        d.line([(0, v * k), (S, v * k)], fill=LINE, width=k)
    pts = [(4, 20), (8, 16), (12, 18), (16, 12), (20, 14), (24, 9), (28, 11)]
    d.line([(x * k, y * k) for x, y in pts], fill=ACCENT, width=2 * k, joint='curve')
    r = 2.5 * k
    d.ellipse([28 * k - r, 11 * k - r, 28 * k + r, 11 * k + r], fill=ACCENT)
    if rounded:
        # keep the corners clean after drawing the grid over them
        mask = Image.new('L', (S, S), 0)
        ImageDraw.Draw(mask).rounded_rectangle([0, 0, S - 1, S - 1], radius=6 * k, fill=255)
        im.putalpha(mask)
    return im.resize((size, size), Image.LANCZOS)


def main():
    os.makedirs(IMG, exist_ok=True)
    og_card()
    icon(180, rounded=False).convert('RGB').save(os.path.join(IMG, 'apple-touch-icon.png'), optimize=True)
    big = icon(48, rounded=True)
    big.save(os.path.join(ROOT, 'favicon.ico'), sizes=[(16, 16), (32, 32), (48, 48)])
    for name in ('assets/img/og.png', 'assets/img/apple-touch-icon.png', 'favicon.ico'):
        print('%-34s %7d bytes' % (name, os.path.getsize(os.path.join(ROOT, name))))


if __name__ == '__main__':
    main()

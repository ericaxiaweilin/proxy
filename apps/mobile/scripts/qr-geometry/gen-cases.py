"""Step 2 of the QR geometry verification: render decode cases.

Every constant below is copied from apps/mobile/src/components/proxy-qr-code.tsx.
**If you change a constant there, change it here too** — that is the whole point of
this directory: the sweep has to render what the component actually draws.

Renders 3 payloads x 6 sizes x 4 logo ratios x {1x, 3x} = 144 cases.
`ratio=0` is the no-logo CONTROL: any failure there is not the logo's fault.

usage: python3 gen-cases.py <matrixdir> <outdir>
"""

import os
import shutil
import sys
from PIL import Image, ImageDraw

# --- copied from apps/mobile/src/components/proxy-qr-code.tsx -------------------------
DOT_RADIUS = 0.22
DOT_INSET = 0.065
FINDER_RADIUS = 0.30
FINDER_HOLE_INSET = 0.55
FINDER_CORE_RADIUS = 0.40
LOGO_RATIO = 0.24
LOGO_RING_RATIO = 0.032
# -------------------------------------------------------------------------------------

HERE = os.path.dirname(os.path.abspath(__file__))
LOGO = os.path.join(HERE, "..", "..", "assets", "proxy-qr-logo.png")

INK = (23, 19, 31)  # color.ink
WHITE = (255, 255, 255)

# sizes the app actually uses: storefront card 104, personalmanage card 160,
# invite 168, personalqr page 208, zoom overlay ~296
SIZES = [88, 104, 128, 168, 208, 296]
RATIOS = [0.0, 0.20, 0.24, 0.28]


def in_finder(x, y, n):
    return (x <= 6 and y <= 6) or (x >= n - 7 and y <= 6) or (x <= 6 and y >= n - 7)


def rr(d, x, y, w, h, r, fill):
    d.rounded_rectangle([x, y, x + w, y + h], radius=max(0.0, r), fill=fill)


def render(size, matrix, logo, ratio):
    n = len(matrix)
    s = size / n
    img = Image.new("RGB", (size, size), WHITE)
    d = ImageDraw.Draw(img)

    dot = 1 - DOT_INSET * 2
    for y, row in enumerate(matrix):
        for x, cell in enumerate(row):
            if not cell or in_finder(x, y, n):
                continue
            rr(d, (x + DOT_INSET) * s, (y + DOT_INSET) * s,
               dot * s, dot * s, DOT_RADIUS * s, INK)

    for ox, oy in ((0, 0), (n - 7, 0), (0, n - 7)):
        outer = 7 * FINDER_RADIUS
        px, py = ox * s, oy * s
        rr(d, px, py, 7 * s, 7 * s, outer * s, INK)
        rr(d, px + s, py + s, 5 * s, 5 * s, (outer - FINDER_HOLE_INSET) * s, WHITE)
        rr(d, px + 2 * s, py + 2 * s, 3 * s, 3 * s, 3 * FINDER_CORE_RADIUS * s, INK)

    if logo is None or ratio <= 0:
        return img

    logo_size = round(size * LOGO_RATIO) if ratio == LOGO_RATIO else round(size * ratio)
    ring_pad = round(size * LOGO_RING_RATIO)
    badge = logo_size + ring_pad * 2
    pos = (size - badge) // 2

    bd = Image.new("RGBA", (badge, badge), (0, 0, 0, 0))
    ImageDraw.Draw(bd).ellipse([0, 0, badge - 1, badge - 1], fill=(255, 255, 255, 255))
    mark = logo.resize((logo_size, logo_size), Image.LANCZOS).convert("RGBA")
    mask = Image.new("L", (logo_size, logo_size), 0)
    ImageDraw.Draw(mask).ellipse([0, 0, logo_size - 1, logo_size - 1], fill=255)
    bd.paste(mark, (ring_pad, ring_pad), mask)
    img.paste(bd, (pos, pos), bd)
    return img


def main():
    if len(sys.argv) < 3:
        print(__doc__)
        sys.exit(2)
    matrix_dir, out = sys.argv[1], sys.argv[2]
    shutil.rmtree(out, ignore_errors=True)
    os.makedirs(out, exist_ok=True)
    logo = Image.open(LOGO).convert("RGB")

    matrices = {}
    for name in ("profile", "invite", "store"):
        with open(os.path.join(matrix_dir, f"matrix-{name}.txt")) as fh:
            matrices[name] = [
                [1 if c == "1" else 0 for c in line] for line in fh.read().strip().splitlines()
            ]

    count = 0
    for scale in (1, 3):
        for name, matrix in matrices.items():
            for size in SIZES:
                for ratio in RATIOS:
                    render(size * scale, matrix, logo if ratio > 0 else None, ratio).save(
                        os.path.join(out, f"{name}_{size}px_{int(ratio * 100):02d}_{scale}x.png")
                    )
                    count += 1
    print(f"rendered {count} cases to {out}")


main()

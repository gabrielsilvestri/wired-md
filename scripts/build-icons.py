# Builds every icon the app, the installer and the landing page use from one
# source: docs/branding/icones/cabo-hash-source.png (the cable drawn as a hash,
# generated with ChatGPT Images, teal on a transparent background).
#
# Dev only, needs Pillow (`pip install pillow`). Run from the repo root:
#   python scripts/build-icons.py
#
# The tile is drawn here, not generated, so its color and corner radius are
# exact: the generator is good at the symbol and loose with flat fills.

from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / 'docs' / 'branding' / 'icones' / 'cabo-hash-source.png'

TILE = (20, 24, 30, 255)        # a step above the app's --bg, so it holds on a dark taskbar
EDGE = (43, 50, 60, 255)        # --rule of the wired theme
PAGE = (25, 29, 35, 255)        # --bg-2
FOLD = (43, 50, 60, 255)

ICO_SIZES = [16, 20, 24, 32, 40, 48, 64, 96, 128, 256]


def symbol():
    im = Image.open(SRC).convert('RGBA')
    r, g, b, a = im.split()
    # The generator leaves near invisible alpha specks across the canvas; they
    # would widen the crop box and tint the tile.
    a = a.point(lambda v: 0 if v < 40 else v)
    im = Image.merge('RGBA', (r, g, b, a))
    return im.crop(a.getbbox())


def fit(sym, box):
    w, h = sym.size
    s = box / max(w, h)
    return sym.resize((max(1, round(w * s)), max(1, round(h * s))), Image.LANCZOS)


def app_icon(size=1024, scale=0.66):
    # Drawn at 4x and reduced, so the rounded edge is antialiased.
    big = size * 4
    im = Image.new('RGBA', (big, big), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    rad = round(big * 0.225)
    d.rounded_rectangle((0, 0, big - 1, big - 1), rad, fill=EDGE)
    inset = max(4, big // 128)
    d.rounded_rectangle((inset, inset, big - 1 - inset, big - 1 - inset), rad - inset, fill=TILE)
    im = im.resize((size, size), Image.LANCZOS)
    sym = fit(symbol(), round(size * scale))
    # Optical center: the plug hangs bottom right, so the mark sits a hair up and left.
    x = (size - sym.width) // 2 - round(size * 0.01)
    y = (size - sym.height) // 2 - round(size * 0.005)
    im.alpha_composite(sym, (x, y))
    return im


def doc_icon(size=1024, scale=0.52):
    big = size * 4
    im = Image.new('RGBA', (big, big), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    left, right = round(big * 0.16), round(big * 0.84)
    top, bottom = round(big * 0.06), round(big * 0.94)
    fold = round(big * 0.2)
    rad = round(big * 0.05)
    page = [(left + rad, top), (right - fold, top), (right, top + fold), (right, bottom - rad),
            (right - rad, bottom), (left + rad, bottom), (left, bottom - rad), (left, top + rad)]
    d.polygon(page, fill=EDGE)
    inset = max(4, big // 128)
    inner = [(left + rad, top + inset), (right - fold - inset // 2, top + inset), (right - inset, top + fold + inset // 2),
             (right - inset, bottom - rad), (right - rad, bottom - inset), (left + rad, bottom - inset),
             (left + inset, bottom - rad), (left + inset, top + rad)]
    d.polygon(inner, fill=PAGE)
    d.polygon([(right - fold, top), (right - fold, top + fold), (right, top + fold)], fill=FOLD)
    im = im.resize((size, size), Image.LANCZOS)
    sym = fit(symbol(), round(size * scale))
    im.alpha_composite(sym, ((size - sym.width) // 2, round(size * 0.56) - sym.height // 2))
    return im


# At 32px and below the mark at its normal size is a blur of strokes, so the
# small frames are drawn on their own with the symbol filling more of the tile.
SMALL = [16, 20, 24, 32]


def save_ico(make, path, small_scale):
    # Pillow writes only the frames it is handed, so every size gets one.
    big = make(1024)
    frames = [make(s, small_scale) if s in SMALL else big.resize((s, s), Image.LANCZOS) for s in ICO_SIZES]
    frames[-1].save(path, format='ICO', sizes=[(s, s) for s in ICO_SIZES], append_images=frames[:-1])


def main():
    app = app_icon(1024)
    doc = doc_icon(1024)
    app.save(ROOT / 'docs' / 'branding' / 'icones' / 'wired-md-icon.png')
    doc.save(ROOT / 'docs' / 'branding' / 'icones' / 'wired-md-doc-icon.png')
    save_ico(app_icon, ROOT / 'packaging' / 'wired-md.ico', 0.84)
    save_ico(doc_icon, ROOT / 'packaging' / 'wired-md-doc.ico', 0.66)
    # The window icon (dev runs; the installed exe takes the .ico).
    app.resize((256, 256), Image.LANCZOS).save(ROOT / 'src' / 'renderer' / 'icon.png')
    site = ROOT / 'site' / 'assets'
    site.mkdir(parents=True, exist_ok=True)
    app.resize((512, 512), Image.LANCZOS).save(site / 'icon-512.png')
    app.resize((180, 180), Image.LANCZOS).save(site / 'apple-touch-icon.png')
    app.resize((64, 64), Image.LANCZOS).save(site / 'favicon-64.png')
    app_icon(32, 0.84).save(site / 'favicon-32.png')
    print('icons written')


if __name__ == '__main__':
    main()

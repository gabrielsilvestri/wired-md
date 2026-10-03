# wired-md landing page

The landing page, published at <https://gabrielsilvestri.github.io/wired-md/>.
`site/` is the whole site: `index.html` (CSS and JavaScript inline), `fonts/`
(Geist and Geist Mono, OFL) and `assets/` (icon, share image, screenshots). No
CDN, no network fetch, no build step.

## Publishing

`.github/workflows/pages.yml` uploads `site/` to GitHub Pages on every push to
`main` that touches it. Open `index.html` directly in a browser to preview.

## Assets

- `assets/app.png`, `assets/theme-*.png`, `assets/empty.png` are real
  screenshots of the app, written by `tests/e2e/checks/95-site-shots.js` with
  `WIRED_SHOTS=1` (`$env:WIRED_SHOTS='1'; $env:WIRED_ONLY='95-'; node scripts/test.js`).
- `assets/icon-512.png`, the favicons and the touch icon come from
  `python scripts/build-icons.py`.
- `assets/og.png` (1200x630) is the share card: the icon, the title and
  `app.png`, rendered from a small HTML card with Playwright.

## What is on the page

The hero (icon, title, the Minecraft-style splash line that changes on every
load, the app screenshot), four feature bands (the first one is a live demo
where typed markdown renders line by line; it pauses off screen and shows the
finished state under reduced motion), a theme switcher over real screenshots,
the toolkit grid, an install section that is honest about the missing release,
and the coffee link.

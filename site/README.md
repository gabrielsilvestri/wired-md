# wired-md landing page

The marketing landing for wired-md: a single, self-contained `index.html` (CSS and JavaScript inline, no CDN, no network fetch, no external fonts). It mirrors the app's own palette so the page reads as the product itself.

## What it is

- One hero with a Minecraft-style splash line that reshuffles from a pool of flavor texts on every page load.
- Feature sections drawn from the real product (inline rendering, frontmatter validation, palette and full-text search, the claude bridge, focus and typewriter modes, sliding panes, templates, themes).
- An install section that is honest: cloning and running works today, packaged installers are marked as roadmap, not as live links.
- A "buy me a coffee" banner and GitHub links.

## Screenshot

The hero references `../docs/screenshot.png` (the app's own end-to-end screenshot). Serve the page from a context where that relative path resolves.

## Serving on GitHub Pages

Two ways:

1. **Pages from the repo root** (branch `main`, folder `/`): the page lives at `/site/`, and `../docs/screenshot.png` resolves to the published `/docs/screenshot.png`. This is the simplest option and keeps the screenshot reference working.
2. **Pages from `/site` or a `gh-pages` branch**: `/site` becomes the site root, so `../docs/` no longer resolves. In that case, copy `docs/screenshot.png` into `site/` and change the `<img src>` to `screenshot.png`.

No build step. Open `index.html` directly in a browser to preview.

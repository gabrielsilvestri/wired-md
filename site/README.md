# wired-md landing page

The marketing landing for wired-md: a single, self-contained `index.html` (CSS and JavaScript inline, no CDN, no network fetch, no external fonts). It mirrors the app's own palette so the page reads as the product itself.

## What it is

- One hero with a Minecraft-style splash line that reshuffles from a pool of flavor texts on every page load.
- Feature sections drawn from the real product (inline rendering, frontmatter validation, what a CLAUDE.md costs in tokens with its imports, the claude bridge, open notes that follow the disk, the first run AI CLI picker, the theme gallery, links and images, palette and full-text search, focus and typewriter modes, tabs with drag to split, templates).
- An install section that is honest: cloning and running is the main path, the per user installer can be built from source with `npm run dist`, and a signed installer, a published release and winget are marked as roadmap, not as live links.
- A "buy me a coffee" banner and GitHub links.

## Screenshot

The hero references `../docs/screenshot.png` (the app's own end-to-end screenshot). Serve the page from a context where that relative path resolves.

## Serving on GitHub Pages

Two ways:

1. **Pages from the repo root** (branch `main`, folder `/`): the page lives at `/site/`, and `../docs/screenshot.png` resolves to the published `/docs/screenshot.png`. This is the simplest option and keeps the screenshot reference working.
2. **Pages from `/site` or a `gh-pages` branch**: `/site` becomes the site root, so `../docs/` no longer resolves. In that case, copy `docs/screenshot.png` into `site/` and change the `<img src>` to `screenshot.png`.

No build step. Open `index.html` directly in a browser to preview.

/**
 * measure-contrast.mjs
 *
 * Measures every theme in themes/ and fails on its own. Run it after touching
 * any color in any theme file, and after adding a theme.
 *
 *   node scripts/measure-contrast.mjs
 *   node scripts/measure-contrast.mjs themes/wired.css   (one file)
 *
 * Why it exists: "check the contrast" as a checklist item is a promise, not a
 * gate. Three of the colors in this app were guessed once and only got caught
 * because someone measured them by hand months later. A number that nobody
 * measures is a number that drifts.
 *
 * The thresholds, and the reason for each:
 *
 *   TEXT   floor 4.5:1   WCAG 2.2 AA (1.4.3) for body text.
 *          ceiling 11:1  The maintainer has astigmatism: above that the stroke
 *                        scatters light and every letter grows a ghost. WCAG
 *                        defines no ceiling, and optimizing only the floor is
 *                        exactly what produces "the white is glaring, I cannot
 *                        read it". Both ends are hard failures here.
 *
 * Structure (rules, separators, surface steps) and decoration (markers, dim
 * accent) are MEASURED AND PRINTED but never fail the run: a 1px divider is not
 * reading text, and forcing 3:1 on it turns a quiet panel into a wire cage.
 *
 * Loosening a threshold is the same as deleting the gate, since the person
 * editing the palette is the person who wants it to pass. If a number is wrong,
 * argue it here in this comment with the reason, never lower it in silence.
 *
 * Exit code: 0 pass, 1 a theme failed, 2 could not run.
 */

import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { dirname, join, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const THEMES_DIR = join(HERE, '..', 'themes');

const TEXT_FLOOR = 4.5;
const TEXT_CEILING = 11;

// ---------------------------------------------------------------- color math

function hex(value) {
  const m = String(value ?? '').trim().match(/^#([0-9a-f]{6})$/i);
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// Relative luminance, the official WCAG 2.x formula.
function luminance(rgb) {
  const [r, g, b] = rgb.map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function ratio(a, b) {
  const la = luminance(a);
  const lb = luminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

// A translucent fill over an opaque surface: what the eye actually receives.
function composite(fg, alpha, bg) {
  return fg.map((v, i) => v * alpha + bg[i] * (1 - alpha));
}

const n2 = (x) => x.toFixed(2).padStart(5);

// ------------------------------------------------------------------ parsing

// Cuts out the body of a CSS block by counting braces. A lazy regex up to the
// first "}" would eat the wrong thing as soon as a block nests.
function blockBody(css, selector) {
  const i = css.indexOf(selector);
  if (i < 0) return null;
  const open = css.indexOf('{', i);
  if (open < 0) return null;
  let depth = 0;
  for (let j = open; j < css.length; j++) {
    if (css[j] === '{') depth++;
    else if (css[j] === '}') {
      depth--;
      if (depth === 0) return css.slice(open + 1, j);
    }
  }
  return null;
}

function varsOf(body) {
  const out = {};
  // Comments carry measured numbers like "4.66:1" and example hex codes; left
  // in, they would be parsed as declarations.
  const clean = body.replace(/\/\*[\s\S]*?\*\//g, '');
  for (const m of clean.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/gi)) out[m[1]] = m[2].trim();
  return out;
}

function die(msg) {
  console.error('cannot run: ' + msg);
  process.exit(2);
}

// ------------------------------------------------------- the pairs we assert
//
// Every entry is a pairing that really happens in styles.css. The surface is
// named because the same ink sits on three different backgrounds across the
// app, and measuring only against the darkest one is precisely how washed out
// tokens hide: half the text in this editor lives inside a panel, not on the
// page.

const SURFACES = ['--bg', '--bg-2', '--bg-3'];

// Ink that appears on all three surfaces.
const INK_EVERYWHERE = ['--ink', '--ink-dim', '--ink-faint'];

// Ink that appears on specific surfaces only, with where it is used.
const INK_PLACED = [
  ['--accent', '--bg', 'link in the document'],
  ['--accent-soft', '--bg', 'headings'],
  ['--accent-soft', '--bg-2', 'table header, settings title'],
  ['--accent-soft', '--bg-3', 'active tree row, inline code'],
  ['--accent-ink', '--bg', 'h4 to h6'],
  ['--accent-ink', '--bg-2', 'small accent text in panels'],
  ['--amber', '--bg-2', 'unsaved marker in the pane title'],
  ['--red', '--bg-2', 'destructive item in the context menu'],
  ['--green', '--bg-2', 'positive state in panels'],
  ['--green', '--bg', 'positive state on the page'],
  ['--amber', '--bg', 'warning on the page'],
  ['--red', '--bg', 'error on the page'],
  ['--warn-ink', '--bg-2', 'frontmatter schema warning'],
  ['--warn-ink', '--bg-3', 'theme variable panel warning row'],
  ['--schema-ink', '--bg-3', 'frontmatter schema badge'],
  ['--win-close-ink', '--red', 'glyph of the close button on hover']
];

// Ink over a translucent fill: the number the eye gets is the composite, not
// the declared surface.
const INK_OVER_FILL = [
  ['--search-hit-ink', '--accent', 0.18, '--bg-2', 'search highlight in a row'],
  ['--search-hit-ink', '--accent', 0.18, '--bg-3', 'search highlight in the selected row'],
  // The text selection in the editor. The browser default is a saturated blue
  // slab; this is the accent instead, and it has to leave selected text
  // readable on the page and on the surface of a code block.
  ['--ink', '--accent', 0.26, '--bg', 'selected text in the document'],
  ['--ink', '--accent', 0.26, '--bg-2', 'selected text inside a code block']
];

// Printed, never failed: a divider is not reading text.
const STRUCTURE = [
  ['--rule', '--bg-2', 'border of panel and overlay'],
  ['--rule-row', '--bg', 'separator between table cells'],
  ['--rule-soft', '--bg-2', 'internal divider and scrollbar thumb'],
  ['--leader', '--bg', 'guide line'],
  ['--accent-dim', '--bg', 'list marker, syntax marker, focus border'],
  ['--bg-2', '--bg', 'surface step: panel over page'],
  ['--bg-3', '--bg-2', 'surface step: control over panel']
];

// -------------------------------------------------------------- measurement

function measureTheme(name, css) {
  const body = blockBody(css, ':root');
  if (body === null) die(':root block not found in ' + name);
  const t = varsOf(body);

  const failures = [];
  const missing = [];

  const color = (key) => {
    const v = hex(t[key]);
    if (!v) {
      missing.push(key + (t[key] ? ' (not a 6 digit hex: ' + t[key] + ')' : ' (absent)'));
      return null;
    }
    return v;
  };

  const assertText = (label, value) => {
    const bad = value < TEXT_FLOOR || value > TEXT_CEILING;
    if (value < TEXT_FLOOR) {
      failures.push(label + ': ' + value.toFixed(2) + ':1, below the ' + TEXT_FLOOR + ' floor (unreadable)');
    }
    if (value > TEXT_CEILING) {
      failures.push(label + ': ' + value.toFixed(2) + ':1, above the ' + TEXT_CEILING + ' ceiling (halation)');
    }
    return bad;
  };

  console.log('');
  console.log('=== theme: ' + name);
  console.log('');
  console.log('  INK ON EVERY SURFACE          --bg   --bg-2   --bg-3');
  for (const k of INK_EVERYWHERE) {
    const c = color(k);
    if (!c) continue;
    const values = SURFACES.map((s) => {
      const bg = color(s);
      return bg ? ratio(c, bg) : NaN;
    });
    let bad = false;
    values.forEach((v, i) => {
      if (Number.isFinite(v) && assertText(k + ' on ' + SURFACES[i], v)) bad = true;
    });
    console.log(
      '    ' + (k + ' ' + t[k]).padEnd(26) +
      values.map((v) => (Number.isFinite(v) ? n2(v) : '  ?  ')).join('    ') +
      (bad ? '   <<< outside ' + TEXT_FLOOR + ' to ' + TEXT_CEILING : '')
    );
  }

  console.log('');
  console.log('  INK IN ITS PLACE');
  for (const [ink, surface, where] of INK_PLACED) {
    const a = color(ink);
    const b = color(surface);
    if (!a || !b) continue;
    const v = ratio(a, b);
    const bad = assertText(ink + ' on ' + surface, v);
    console.log('    ' + (ink + ' on ' + surface).padEnd(38) + n2(v) + '   ' + where + (bad ? '   <<< outside range' : ''));
  }

  console.log('');
  console.log('  INK OVER A TRANSLUCENT FILL');
  for (const [ink, fill, alpha, surface, where] of INK_OVER_FILL) {
    const a = color(ink);
    const f = color(fill);
    const b = color(surface);
    if (!a || !f || !b) continue;
    const v = ratio(a, composite(f, alpha, b));
    const label = ink + ' on ' + fill + '@' + alpha + ' over ' + surface;
    const bad = assertText(label, v);
    console.log('    ' + label.padEnd(38) + n2(v) + '   ' + where + (bad ? '   <<< outside range' : ''));
  }

  console.log('');
  console.log('  STRUCTURE AND SURFACE (printed, never fails)');
  for (const [a, b, where] of STRUCTURE) {
    const x = color(a);
    const y = color(b);
    if (!x || !y) continue;
    console.log('    ' + (a + ' on ' + b).padEnd(38) + n2(ratio(x, y)) + '   ' + where);
  }

  // The focus mode opacity a theme declares has to match what the math says,
  // otherwise dimmed text silently drops under the floor in that theme.
  const bg = color('--bg');
  const ink = color('--ink');
  if (bg && ink && t['--focus-dim']) {
    const declared = Number(t['--focus-dim']);
    let needed = 0.95;
    for (let a = 0.4; a <= 0.95; a += 0.01) {
      const composed = ink.map((v, i) => bg[i] + (v - bg[i]) * a);
      if (ratio(bg, composed) >= 4.6) { needed = Math.round(a * 100) / 100; break; }
    }
    const composed = ink.map((v, i) => bg[i] + (v - bg[i]) * declared);
    const got = ratio(bg, composed);
    console.log('');
    console.log('  FOCUS MODE DIM');
    console.log('    --focus-dim ' + declared.toFixed(2) + ' gives ' + n2(got) + '   (the math wants ' + needed.toFixed(2) + ')');
    if (got < TEXT_FLOOR) {
      failures.push('--focus-dim ' + declared + ' leaves dimmed text at ' + got.toFixed(2) + ':1, below the floor; use ' + needed.toFixed(2));
    }
  }

  if (missing.length) {
    for (const m of missing) failures.push('variable ' + m);
  }

  console.log('');
  if (!failures.length) {
    console.log('  passed.');
  } else {
    console.log('  FAILED, ' + failures.length + ' problem(s):');
    for (const f of failures) console.log('    - ' + f);
  }
  return failures.length === 0;
}

// -------------------------------------------------------------------- main

const arg = process.argv[2];
let files;
if (arg) {
  const p = resolve(arg);
  if (!existsSync(p)) die('file not found: ' + p);
  files = [p];
} else {
  if (!existsSync(THEMES_DIR) || !statSync(THEMES_DIR).isDirectory()) die('themes folder not found at ' + THEMES_DIR);
  files = readdirSync(THEMES_DIR)
    .filter((f) => f.toLowerCase().endsWith('.css'))
    .sort((a, b) => a.localeCompare(b))
    .map((f) => join(THEMES_DIR, f));
  if (!files.length) die('no .css theme in ' + THEMES_DIR);
}

let allPassed = true;
for (const f of files) {
  const ok = measureTheme(basename(f), readFileSync(f, 'utf8'));
  if (!ok) allPassed = false;
}

console.log('');
console.log(allPassed ? 'all themes passed.' : 'FAILED.');
process.exit(allPassed ? 0 : 1);

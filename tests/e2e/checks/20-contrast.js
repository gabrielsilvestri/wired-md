// The search highlight, the schema warning and the schema badge stay between
// 4.5:1 and 11:1 in BOTH themes (the owner's contrast floor and ceiling).
//
// This is pure arithmetic over the theme files in the repo, with alpha
// composition for the highlight (accent at 0.18 over the row). No live theme
// switching, which was flaky.

const fs = require('fs');
const path = require('path');

const THEMES_DIR = path.join(__dirname, '..', '..', '..', 'themes');

function luminance(r, g, b) {
  const c = [r, g, b].map((v) => {
    const x = v / 255;
    return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}

function ratio(a, b) {
  const la = luminance.apply(null, a);
  const lb = luminance.apply(null, b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

function hex(s) {
  const n = parseInt(s.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function composite(fg, alpha, bg) {
  return fg.map((v, i) => v * alpha + bg[i] * (1 - alpha));
}

function readVars(text) {
  const out = {};
  const re = /--([\w-]+)\s*:\s*([^;]+);/g;
  let m;
  while ((m = re.exec(text))) out[m[1]] = m[2].trim();
  return out;
}

function measure(file) {
  const v = readVars(fs.readFileSync(path.join(THEMES_DIR, file), 'utf8'));
  const rgb = v['accent-rgb'].split(',').map(Number);
  const ink = hex(v['search-hit-ink']);
  const bg2 = hex(v['bg-2']);
  const bg3 = hex(v['bg-3']);
  return {
    hitOnBg2: ratio(ink, composite(rgb, 0.18, bg2)),
    hitOnBg3: ratio(ink, composite(rgb, 0.18, bg3)),
    warn: ratio(hex(v['warn-ink']), bg2),
    schema: ratio(hex(v['schema-ink']), bg3)
  };
}

async function run(ctx) {
  const measured = { wired: measure('wired.css'), light: measure('light.css') };
  const inRange = (x) => x >= 4.5 && x <= 11;
  const all = [
    measured.wired.hitOnBg2, measured.wired.hitOnBg3, measured.wired.warn, measured.wired.schema,
    measured.light.hitOnBg2, measured.light.hitOnBg3, measured.light.warn, measured.light.schema
  ];
  ctx.check(
    'contrast of the search highlight, the warning and the schema badge stays in 4.5:1 to 11:1 in both themes',
    all.every(inRange),
    JSON.stringify(measured)
  );
}

module.exports = { run };

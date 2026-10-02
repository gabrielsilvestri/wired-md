// Read only diff overlay: it opens with the added line visible, its colors sit
// inside the owner's 4.5:1 to 11:1 window in BOTH themes, and Esc closes it.
//
// The contrast is measured twice on purpose. Once at RUNTIME against the theme
// that is live, because the diff ink is a color-mix() and only the browser knows
// what that resolves to. Once as arithmetic over both theme files, because the
// suite cannot switch themes without flakiness and the light theme is exactly
// where the raw --green fell under the floor.

const fs = require('fs');
const path = require('path');

const THEMES_DIR = path.join(__dirname, '..', '..', '..', 'themes');

function luminance(rgb) {
  const c = rgb.map((v) => {
    const x = v / 255;
    return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}

function ratio(a, b) {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

function hex(s) {
  const n = parseInt(s.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function mix(a, b, t) {
  return a.map((v, i) => v + (b[i] - v) * t);
}

function readVars(text) {
  const out = {};
  const re = /--([\w-]+)\s*:\s*([^;]+);/g;
  let m;
  while ((m = re.exec(text))) out[m[1]] = m[2].trim();
  return out;
}

// The pairing the stylesheet builds: ink is 50% status color plus 50% theme ink,
// over a row background of 12% status color over --bg-2.
function measure(file) {
  const v = readVars(fs.readFileSync(path.join(THEMES_DIR, file), 'utf8'));
  const bg2 = hex(v['bg-2']);
  const ink = hex(v.ink);
  const out = {};
  for (const [name, color] of [['add', v.green], ['del', v.red]]) {
    const row = mix(bg2, hex(color), 0.12);
    out[name] = ratio(mix(hex(color), ink, 0.5), row);
  }
  out.badgeM = ratio(mix(hex(v.amber), ink, 0.5), bg2);
  return out;
}

// TRAP: a color-mix() does NOT come back from getComputedStyle as rgb(). Chromium
// resolves it to `color(srgb 0.55 0.77 0.67)`, with 0 to 1 components, so a
// parser that only knows rgb() silently returns null and the assertion measures
// nothing at all.
function parseRgb(s) {
  const str = String(s || '');
  const srgb = /color\(\s*srgb\s+([\d.eE+-]+)\s+([\d.eE+-]+)\s+([\d.eE+-]+)/.exec(str);
  if (srgb) return [Number(srgb[1]) * 255, Number(srgb[2]) * 255, Number(srgb[3]) * 255];
  const m = /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/.exec(str);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

const inRange = (x) => x >= 4.5 && x <= 11;

async function run(ctx) {
  const { js, check, sleep, until, demoPath } = ctx;

  const before = fs.readFileSync(demoPath, 'utf8');
  fs.writeFileSync(demoPath, before + '\nan added line the diff must show\n', 'utf8');
  await js('void refreshSidebar()');
  await sleep(300);
  await js('void gitRefresh()');
  await sleep(900);

  await js(`void openDiff(${JSON.stringify(demoPath)})`);
  // `git diff` is a spawn: poll until the overlay has read it.
  await sleep(300);
  await until(`isDiffOpen()&&document.querySelectorAll('#diff-body .diff-add').length>0`, { ceiling: 10000 });

  const view = await js(
    `(function(){if(!isDiffOpen())return {open:false};` +
      `var adds=[].slice.call(document.querySelectorAll('#diff-body .diff-add'));` +
      `var dels=document.querySelectorAll('#diff-body .diff-del').length;` +
      `var row=adds[adds.length-1]||null;var cs=row?getComputedStyle(row):null;` +
      `return {open:true,status:document.getElementById('diff-status').textContent,` +
      `title:document.getElementById('diff-title').textContent,adds:adds.length,dels:dels,` +
      `text:row?row.querySelector('.diff-text').textContent:null,` +
      `ink:cs?cs.color:null,bg:cs?cs.backgroundColor:null};})()`
  );

  check(
    'git diff: the overlay opens read only and shows the added line',
    !!view && view.open && view.adds >= 1 && /an added line the diff must show/.test(view.text || '') && /demo\.md/.test(view.title || ''),
    JSON.stringify(view)
  );

  // Runtime contrast of what the browser actually painted.
  const ink = parseRgb(view && view.ink);
  const bg = parseRgb(view && view.bg);
  const live = ink && bg ? await js(`contrastRatio(${JSON.stringify(ink)}, ${JSON.stringify(bg)})`) : null;

  const measured = { wired: measure('wired.css'), light: measure('light.css') };
  const all = [
    measured.wired.add, measured.wired.del, measured.wired.badgeM,
    measured.light.add, measured.light.del, measured.light.badgeM
  ];
  check(
    'git diff: added and removed line ink stays in 4.5:1 to 11:1, live and in both theme files',
    live !== null && inRange(live) && all.every(inRange),
    JSON.stringify({ live, measured })
  );

  await ctx.key('Escape');
  await sleep(400);
  const closed = await js('isDiffOpen()');
  check('git diff: Escape closes the overlay', closed === false, 'open=' + closed);

  // No residue: the note goes back exactly as it was.
  fs.writeFileSync(demoPath, before, 'utf8');
  await js('void refreshSidebar()');
  await sleep(300);
  await js('void gitRefresh()');
  await sleep(700);
}

module.exports = { run };

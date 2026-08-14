// The three new themes, the imported theme showing up in the selector, and the
// close button glyph coming from a variable instead of a hardcoded hex.
//
// The contrast spot check runs LIVE (apply the theme, read the computed value,
// measure with the renderer's own contrastRatio) rather than by re-parsing the
// files, which is what scripts/measure-contrast.mjs already does exhaustively
// at build time. The point here is that what the browser actually computes
// matches what the file promised.

const fs = require('fs');
const path = require('path');

const NEW_THEMES = ['carbon', 'parchment', 'ash'];

// The name is a marker: if this file is ever seen in the owner's real profile,
// it came from a test run, not from them.
const IMPORT_NAME = 'zz-e2e-imported.css';
const IMPORT_CSS = ':root{--bg:#0d0f12;--ink:#c0c6cd;}\n';

async function run(ctx) {
  const { js, sleep, check, userDir } = ctx;

  // Reset first: this check switches themes, and the theme is config state.
  await js(`(async()=>{config.theme='wired';config.accent=null;config.themeOverrides={};await applyTheme('wired');})()`);
  await sleep(250);

  // --- every new theme is listed and applies ---
  const listed = await js(`window.wired.listThemes()`);
  check(
    'the three new themes are seeded and listed',
    Array.isArray(listed) && NEW_THEMES.every((t) => listed.includes(t)),
    JSON.stringify(listed)
  );

  // --- live contrast spot check, per theme ---
  // One pairing per theme is not the whole gate (the build time script is),
  // it is the proof that the theme file the app LOADED produces the numbers the
  // file claims once the browser has resolved it.
  const measured = {};
  for (const theme of NEW_THEMES) {
    await js(`(async()=>{config.theme=${JSON.stringify(theme)};await applyTheme(${JSON.stringify(theme)});})()`);
    await sleep(250);
    measured[theme] = await js(
      `(function(){var s=getComputedStyle(document.documentElement);` +
      `var hex=function(n){return s.getPropertyValue(n).trim();};` +
      `var r=function(a,b){return contrastRatio(hexToRgbCompat(hex(a)),hexToRgbCompat(hex(b)));};` +
      `function hexToRgbCompat(h){var m=/^#?([0-9a-f]{6})$/i.exec(h);if(!m)return [0,0,0];` +
      `var n=parseInt(m[1],16);return [(n>>16)&255,(n>>8)&255,n&255];}` +
      `return {ink:r('--ink','--bg'),dim:r('--ink-dim','--bg-2'),faint:r('--ink-faint','--bg-3'),` +
      `close:r('--win-close-ink','--red'),bg:hex('--bg')};})()`
    );
  }

  const inBand = (x) => typeof x === 'number' && x >= 4.5 && x <= 11;
  const allOk = NEW_THEMES.every((t) => {
    const m = measured[t];
    return m && inBand(m.ink) && inBand(m.dim) && inBand(m.faint) && inBand(m.close);
  });
  check(
    'carbon, parchment and ash each keep ink, ink-dim, ink-faint and the close glyph inside 4.5:1 to 11:1 live',
    allOk,
    JSON.stringify(measured)
  );

  // --- the close button glyph is a theme variable, not a hardcoded hex ---
  // Measured per theme, and it has to actually CHANGE between themes, which is
  // the whole reason it stopped being a constant.
  const closeInk = {};
  for (const theme of ['wired', 'light']) {
    await js(`(async()=>{config.theme=${JSON.stringify(theme)};await applyTheme(${JSON.stringify(theme)});})()`);
    await sleep(250);
    closeInk[theme] = await js(
      `getComputedStyle(document.documentElement).getPropertyValue('--win-close-ink').trim()`
    );
  }
  const cssText = fs.readFileSync(
    path.join(__dirname, '..', '..', '..', 'src', 'renderer', 'styles.css'), 'utf8'
  );
  const usesVar = /#win-close:hover\s*\{[^}]*color:\s*var\(--win-close-ink\)/.test(cssText);
  const noHardcoded = !/#win-close:hover\s*\{[^}]*color:\s*#[0-9a-f]{3,8}/i.test(cssText);
  check(
    'the close button hover glyph comes from --win-close-ink and differs per theme (no hardcoded hex left)',
    usesVar && noHardcoded && /^#[0-9a-f]{6}$/i.test(closeInk.wired || '') &&
      /^#[0-9a-f]{6}$/i.test(closeInk.light || '') && closeInk.wired !== closeInk.light,
    JSON.stringify({ ...closeInk, usesVar, noHardcoded })
  );

  // --- an imported theme shows up in the selector ---
  // The picker itself is a native dialog the driver cannot click, so what is
  // exercised here is everything after it: a .css landing in the themes folder
  // is listed, selectable and applies. The bridge is asserted separately.
  const bridged = await js(`typeof window.wired.importTheme === 'function'`);
  check('the import theme bridge is exposed to the renderer', bridged === true, String(bridged));

  const target = path.join(userDir('themes'), IMPORT_NAME);
  fs.writeFileSync(target, IMPORT_CSS, 'utf8');

  await js(`void openSettings()`);
  await sleep(500);
  const inSelector = await js(
    `(function(){var s=document.getElementById('sel-theme');` +
    `return [...s.options].map(function(o){return o.value;});})()`
  );
  const importedName = IMPORT_NAME.replace(/\.css$/, '');
  check(
    'a theme file dropped into the themes folder appears in the selector when the panel refreshes',
    Array.isArray(inSelector) && inSelector.includes(importedName),
    JSON.stringify(inSelector)
  );

  const appliedImport = await js(
    `(async()=>{config.theme=${JSON.stringify(importedName)};` +
    `await applyTheme(${JSON.stringify(importedName)});` +
    `return getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();})()`
  );
  check(
    'the imported theme applies',
    appliedImport === '#0d0f12',
    String(appliedImport)
  );

  await js(`closeSettings()`);
  try { fs.unlinkSync(target); } catch {}

  // Back to wired before anything downstream measures a color.
  await js(`(async()=>{config.theme='wired';await applyTheme('wired');await saveConfig();})()`);
  await sleep(300);
}

module.exports = { run };

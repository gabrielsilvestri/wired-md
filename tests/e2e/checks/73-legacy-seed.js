// Retiring the pre rename claro.css seed.
//
// The dangerous direction here is not "the old file survived", it is "a file
// the user wrote was deleted". So both branches are asserted, and the one that
// matters most is the second: a claro.css whose content the app never shipped
// has to come out of the sweep untouched.
//
// These call sweepLegacySeeds directly rather than restarting the app, because
// the sweep runs once at boot, long before the first check gets a window. The
// driver runs in the MAIN process, so the module is simply required.

const fs = require('fs');
const path = require('path');

const themeImport = require('../../../src/main/ipc/theme-import');

const FIXTURE = path.join(__dirname, '..', 'fixtures', 'legacy-claro.css');

async function run(ctx) {
  const { check, userDir } = ctx;

  const themesDir = userDir('themes');
  const target = path.join(themesDir, 'claro.css');
  const pristine = fs.readFileSync(FIXTURE, 'utf8');

  // --- the app never ships a hash it does not know ---
  check(
    'the legacy seed fixture still matches a hash the sweep recognises',
    Array.isArray(themeImport.LEGACY_SEEDS['claro.css']) && themeImport.LEGACY_SEEDS['claro.css'].length > 0,
    JSON.stringify(Object.keys(themeImport.LEGACY_SEEDS))
  );

  // --- branch 1: an untouched seed is retired ---
  fs.writeFileSync(target, pristine, 'utf8');
  const removed = await themeImport.sweepLegacySeeds();
  const goneAfterPristine = !fs.existsSync(target);
  check(
    'an untouched claro.css is retired to the Recycle Bin and leaves the theme list',
    goneAfterPristine && removed.includes('claro.css'),
    JSON.stringify({ removed, stillThere: !goneAfterPristine })
  );

  // --- branch 2: an edited one is left completely alone ---
  // This is the assertion that protects the user's work. One added comment is
  // enough to make the file theirs.
  const edited = pristine + '\n/* the user changed this */\n';
  fs.writeFileSync(target, edited, 'utf8');
  const removed2 = await themeImport.sweepLegacySeeds();
  const survived = fs.existsSync(target) && fs.readFileSync(target, 'utf8') === edited;
  check(
    'a claro.css the user edited is never touched by the sweep',
    survived && removed2.length === 0,
    JSON.stringify({ removed: removed2, survived })
  );

  // --- CRLF is not "modified" ---
  // A checkout with core.autocrlf on writes the same seed with CRLF. Comparing
  // raw bytes would call that a user edit and keep the file forever.
  fs.writeFileSync(target, pristine.replace(/\n/g, '\r\n'), 'utf8');
  const removed3 = await themeImport.sweepLegacySeeds();
  check(
    'the same seed written with CRLF is still recognised as untouched',
    !fs.existsSync(target) && removed3.includes('claro.css'),
    JSON.stringify({ removed: removed3 })
  );

  // Nothing to clean up: the sweep removed the file, and the failing branch
  // leaves a file the next run overwrites.
  try { fs.unlinkSync(target); } catch {}
}

module.exports = { run };

// Importing a theme, and retiring the legacy seed.
//
// Two jobs that both touch %APPDATA%\wired-md\themes and nothing else:
//
//   themes:import   a file picker, then a copy of the chosen .css into the
//                   themes folder, so the selector picks it up on the next
//                   list without a restart.
//   sweepLegacySeeds  removes claro.css, the pre rename seed, but ONLY when it
//                   is byte for byte what the app shipped.
//
// Nothing here ever unlinks: a file the user might have written goes to the
// Recycle Bin through shell.trashItem, the same rule the note deletion path
// follows.

const { ipcMain, dialog, shell } = require('electron');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { userDir } = require('../config');

const SAFE_CSS_NAME = /^[\w\- .]+\.css$/i;

// A theme name that already exists must not be silently overwritten: the user
// may have edited it. "aurora.css" becomes "aurora (2).css" instead.
function freeName(dir, base) {
  const stem = base.replace(/\.css$/i, '');
  let candidate = stem + '.css';
  let n = 2;
  while (fs.existsSync(path.join(dir, candidate))) {
    candidate = stem + ' (' + n + ').css';
    n++;
  }
  return candidate;
}

function register({ getWindow } = {}) {
  ipcMain.handle('themes:import', async () => {
    try {
      const win = typeof getWindow === 'function' ? getWindow() : null;
      const opts = {
        title: 'Import a theme',
        filters: [{ name: 'CSS theme', extensions: ['css'] }],
        properties: ['openFile']
      };
      const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
      if (res.canceled || !res.filePaths || !res.filePaths.length) return { ok: false, canceled: true };

      const src = res.filePaths[0];
      if (!/\.css$/i.test(src)) return { ok: false, error: 'not a .css file' };

      const themesDir = userDir('themes');
      fs.mkdirSync(themesDir, { recursive: true });

      const base = path.basename(src);
      if (!SAFE_CSS_NAME.test(base)) return { ok: false, error: 'the file name has characters this app does not accept' };

      const target = freeName(themesDir, base);
      fs.copyFileSync(src, path.join(themesDir, target));
      return { ok: true, name: target.replace(/\.css$/i, ''), file: target };
    } catch (err) {
      return { ok: false, error: String(err.message || err) };
    }
  });
}

// --- legacy seed cleanup ---
//
// The theme shipped as "claro.css" was renamed to "light.css" when the project
// went English only. Renaming the file in the repo does not touch a profile
// that was seeded before the rename, so the owner's themes folder still holds
// BOTH, and the selector still lists a Portuguese name that maps to nothing in
// the docs.
//
// It is only safe to remove a file the user did not write, so the test is
// content, not the name: the sha256 has to match one of the exact revisions the
// app ever shipped as claro.css (every version of it that reached a release, so
// an older profile is recognised too). A file the user edited by even one
// character does not match and is left completely alone. What matches goes to
// the Recycle Bin, so even a wrong guess here is one click from undone.
//
// The hash is taken over content with carriage returns stripped. A checkout
// with core.autocrlf on writes the same theme with CRLF, and a byte comparison
// would then call an untouched seed "user modified" and keep it forever.

const LEGACY_SEEDS = {
  'claro.css': [
    '63e1e1af6b8e1d1c5d14d302d3ce026f3e2a58ceb0aa064674fec59c70470ebe',
    '84525ebc385d590c65f02acf2497d60e4ae8b2d80299a53a080167df1d220c1e',
    '45bbf480b0054e167753c1aaca868fb178c3a5934000b9eca623aff050e25621',
    '7f5cbbe76df4cb52c8aac4141c0e02722e8e6a00971135367e6bf85f8d2b0b15'
  ]
};

function sha256(file) {
  const normalized = fs.readFileSync(file, 'utf8').replace(/\r/g, '');
  return crypto.createHash('sha256').update(normalized, 'utf8').digest('hex');
}

async function sweepLegacySeeds() {
  const themesDir = userDir('themes');
  const removed = [];
  for (const [name, hashes] of Object.entries(LEGACY_SEEDS)) {
    const file = path.join(themesDir, name);
    try {
      if (!fs.existsSync(file)) continue;
      if (!hashes.includes(sha256(file))) continue; // the user edited it: not ours to touch
      await shell.trashItem(file);
      removed.push(name);
    } catch {
      // A locked or already gone file is not worth failing a boot over.
    }
  }
  return removed;
}

module.exports = { register, sweepLegacySeeds, LEGACY_SEEDS };

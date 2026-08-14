// Copies the third party browser assets the renderer loads at runtime from
// node_modules into src/renderer/vendor, so index.html never has to reach
// outside src/ with a relative ../../node_modules path.
//
// Vditor is copied WHOLE (dist/): it lazy loads css, language packs, highlight
// themes and math assets relative to its `cdn` option at runtime, so cherry
// picking files breaks features that only show up later.
//
// Runs on postinstall and prestart. The vendor folder is generated and is
// listed in .gitignore.

import { cp, mkdir, rm, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const modules = join(root, 'node_modules');
const vendor = join(root, 'src', 'renderer', 'vendor');

const JOBS = [
  { from: join(modules, 'vditor', 'dist'), to: join(vendor, 'vditor', 'dist') },
  { from: join(modules, '@xterm', 'xterm', 'lib'), to: join(vendor, 'xterm', 'lib') },
  { from: join(modules, '@xterm', 'xterm', 'css'), to: join(vendor, 'xterm', 'css') },
  { from: join(modules, '@xterm', 'addon-fit', 'lib'), to: join(vendor, 'addon-fit', 'lib') }
];

async function exists(p) {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  let copied = 0;
  for (const job of JOBS) {
    if (!(await exists(job.from))) {
      console.log('[vendor] skipped (not installed): ' + job.from);
      continue;
    }
    await rm(job.to, { recursive: true, force: true });
    await mkdir(dirname(job.to), { recursive: true });
    await cp(job.from, job.to, { recursive: true });
    copied++;
  }
  console.log('[vendor] synced ' + copied + ' of ' + JOBS.length + ' asset trees into src/renderer/vendor');
}

main().catch((err) => {
  console.error('[vendor] failed: ' + (err && err.message ? err.message : err));
  process.exit(1);
});

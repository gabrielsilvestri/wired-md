// Final shot for the README: a wide window, the sidebar visible and three
// editor groups side by side, each with its own tab bar. The third one holds
// the file with frontmatter, so the properties panel is in frame.
//
// OPT IN: the PNG is only written with WIRED_SHOTS=1. Re-encoding it on every
// run made a plain `npm test` leave the working tree dirty. The layout it sets
// up still runs, since the checks after it inherit that state.

const path = require('path');

const SHOTS = process.env.WIRED_SHOTS === '1';

async function run(ctx) {
  const { js, sleep, check, fs, win, fixtures } = ctx;

  await js('toggleTerminal(false)');
  win.setSize(1360, 840);
  win.center();
  await js(`void openPath(${JSON.stringify(fixtures.notes)}, true)`);
  await sleep(1000);
  await js(`void openPath(${JSON.stringify(fixtures.skill)}, true)`);
  await sleep(1500);

  const docsDir = path.join(__dirname, '..', '..', '..', 'docs');
  if (!SHOTS) {
    check('screenshot skipped (set WIRED_SHOTS=1 to write docs/screenshot.png)', true);
    return;
  }
  const img = await win.webContents.capturePage();
  fs.mkdirSync(docsDir, { recursive: true });
  fs.writeFileSync(path.join(docsDir, 'screenshot.png'), img.toPNG());
  check('screenshot saved to docs/screenshot.png', fs.existsSync(path.join(docsDir, 'screenshot.png')));
}

module.exports = { run };

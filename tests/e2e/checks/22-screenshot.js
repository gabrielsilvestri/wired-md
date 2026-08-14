// Final shot for the README: a wide window, the sidebar visible and three panes
// (with the sidebar at 320px the ruler leaves two open and one as a spine). The
// third pane is the file with frontmatter, so the properties panel is in frame.

const path = require('path');

async function run(ctx) {
  const { js, sleep, check, fs, win, fixtures } = ctx;

  await js('toggleTerminal(false)');
  win.setSize(1360, 840);
  win.center();
  await js(`void openPath(${JSON.stringify(fixtures.notes)}, true)`);
  await sleep(1000);
  await js(`void openPath(${JSON.stringify(fixtures.skill)}, true)`);
  await sleep(1500);

  const img = await win.webContents.capturePage();
  const docsDir = path.join(__dirname, '..', '..', '..', 'docs');
  fs.mkdirSync(docsDir, { recursive: true });
  fs.writeFileSync(path.join(docsDir, 'screenshot.png'), img.toPNG());
  check('screenshot saved to docs/screenshot.png', fs.existsSync(path.join(docsDir, 'screenshot.png')));
}

module.exports = { run };

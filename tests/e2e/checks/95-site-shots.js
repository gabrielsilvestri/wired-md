// Screenshots for the landing page (site/assets): the app in two editor
// groups and the same note in four themes.
//
// OPT IN, like 22 and 79: the PNGs are only written with WIRED_SHOTS=1, so a
// plain `npm test` never dirties the tree. It runs last, so the states it sets
// (tabs closed, theme switched) are inherited by nothing.
//
// The sidebar shows the folder path, which in a test run is the repository
// path on the machine that ran it. The shots show a neutral path instead.

const path = require('path');

const OUT = path.join(__dirname, '..', '..', '..', 'site', 'assets');
const SHOTS = process.env.WIRED_SHOTS === '1';
const THEMES = ['wired', 'rosewood', 'moss', 'parchment'];

async function run(ctx) {
  const { js, sleep, check, fs, win, fixtures } = ctx;

  if (!SHOTS) {
    check('site screenshots skipped (set WIRED_SHOTS=1 to write site/assets)', true);
    return;
  }
  fs.mkdirSync(OUT, { recursive: true });

  const shoot = async (name) => {
    const img = await win.webContents.capturePage();
    const file = path.join(OUT, name + '.png');
    fs.writeFileSync(file, img.toPNG());
    return file;
  };

  // Same reset as 79: no focus dimming, no live selection, no terminal.
  const settle = () => js(
    `(function(){config.focusMode=false;config.typewriterMode=false;` +
    `applyFocusMode();applyTypewriterMode();toggleTerminal(false);` +
    `if(document.activeElement&&document.activeElement.blur)document.activeElement.blur();` +
    `var s=window.getSelection();if(s)s.removeAllRanges();` +
    `var p=document.getElementById('sidebar-root-path');if(p){p.textContent='~\\\\projects\\\\agent-notes';p.title='';}` +
    `document.body.focus();return null;})()`
  );
  const closeAll = () => js(
    `(function(){panes.slice().forEach(function(p){p.dirty=false;closePane(p);});return panes.length;})()`
  );

  const written = [];

  // 1. The app: a note and a SKILL.md side by side, properties panel in frame.
  await closeAll();
  await js(`(async()=>{config.theme='wired';config.themeOverrides={};await applyTheme('wired');})()`);
  win.setSize(1360, 840);
  win.center();
  await js(`void openPath(${JSON.stringify(fixtures.demo)})`);
  await sleep(900);
  await js(`void openPath(${JSON.stringify(fixtures.skill)}, true)`);
  await sleep(1200);
  await settle();
  await sleep(400);
  written.push(await shoot('app'));

  // 2. One note, four themes. Catalog themes are installed first; installing
  //    one that is already there is a no-op.
  await closeAll();
  win.setSize(1200, 760);
  win.center();
  await js(`void openPath(${JSON.stringify(fixtures.demo)})`);
  await sleep(900);
  for (const t of THEMES) {
    await js(`(async()=>{try{await window.wired.installCatalogTheme(${JSON.stringify(t)});}catch(e){}` +
      `config.theme=${JSON.stringify(t)};config.themeOverrides={};await applyTheme(${JSON.stringify(t)});})()`);
    await sleep(700);
    await settle();
    await sleep(500);
    written.push(await shoot('theme-' + t));
  }

  check(
    'site screenshots written to site/assets',
    written.every((f) => fs.existsSync(f) && fs.statSync(f).size > 10000),
    JSON.stringify(written.map((f) => path.basename(f)))
  );
}

module.exports = { run };

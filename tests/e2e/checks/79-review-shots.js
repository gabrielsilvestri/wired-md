// Review screenshots for this work package: the settings panel, the theme
// variable panel, and each new theme.
//
// Kept as a check rather than a separate script because the app is already
// booted, laid out and holding a real note here, which is the state worth
// looking at. It writes into docs/review-wp2 and asserts only that the files
// were produced.

const path = require('path');

const OUT = path.join(__dirname, '..', '..', '..', 'docs', 'review-wp2');

async function run(ctx) {
  const { js, sleep, check, fs, win } = ctx;

  fs.mkdirSync(OUT, { recursive: true });

  // A settings panel photographed in a 1360px window is a small box in a large
  // empty frame, so the window is sized to what the panel needs.
  win.setSize(1180, 900);
  win.center();
  await sleep(400);

  // Earlier checks leave the app in states that are correct for them and
  // misleading in a screenshot: focus mode dims every paragraph that does not
  // hold the caret (which reads as "the theme has washed out text"), and the
  // search and palette checks leave a live text selection behind (which reads
  // as "the code block is blue"). Both are cleared before anything is shot.
  // The selection also has to lose the focus that keeps redrawing it: clearing
  // the ranges while the contenteditable still holds focus leaves the painted
  // highlight behind.
  await js(
    `(function(){config.focusMode=false;config.typewriterMode=false;` +
    `applyFocusMode();applyTypewriterMode();` +
    `if(document.activeElement&&document.activeElement.blur)document.activeElement.blur();` +
    `var s=window.getSelection();if(s)s.removeAllRanges();` +
    `document.body.focus();return null;})()`
  );
  await sleep(400);

  const shoot = async (name) => {
    const img = await win.webContents.capturePage();
    fs.writeFileSync(path.join(OUT, name + '.png'), img.toPNG());
  };

  const written = [];

  // 1. Settings v2, Appearance tab, showing the theme variable panel.
  await js(`(async()=>{config.theme='wired';config.themeOverrides={};await applyTheme('wired');})()`);
  await sleep(250);
  await js(`void openSettings()`);
  await sleep(600);
  await js(`document.getElementById('tab-appearance').click()`);
  await sleep(300);
  await shoot('01-settings-appearance');
  written.push('01-settings-appearance.png');

  // 2. The variable panel scrolled to the rows, with an override live and the
  //    inline contrast warning showing (the state that is hard to describe in
  //    prose and obvious in a picture).
  await js(
    `(function(){var i=document.querySelector('.tvar-row[data-name="--ink-faint"] input[type=color]');` +
    `i.value='#141619';i.dispatchEvent(new Event('change',{bubbles:true}));` +
    `document.getElementById('theme-vars').scrollIntoView({block:'center'});})()`
  );
  await sleep(500);
  await shoot('02-theme-variables-with-warning');
  written.push('02-theme-variables-with-warning.png');

  await js(`(function(){document.getElementById('btn-vars-reset-all').click();})()`);
  await sleep(300);

  // 3. Shortcuts tab.
  await js(`document.getElementById('tab-shortcuts').click()`);
  await sleep(300);
  await shoot('03-settings-shortcuts');
  written.push('03-settings-shortcuts.png');

  await js(`closeSettings()`);
  await sleep(300);

  // 4. Each new theme on the real document.
  for (const theme of ['carbon', 'parchment', 'ash']) {
    await js(`(async()=>{config.theme=${JSON.stringify(theme)};await applyTheme(${JSON.stringify(theme)});})()`);
    await sleep(500);
    await shoot('04-theme-' + theme);
    written.push('04-theme-' + theme + '.png');
  }

  await js(`(async()=>{config.theme='wired';await applyTheme('wired');await saveConfig();})()`);
  await sleep(300);

  const onDisk = written.filter((f) => fs.existsSync(path.join(OUT, f)));
  check(
    'review screenshots written to docs/review-wp2',
    onDisk.length === written.length,
    JSON.stringify(onDisk)
  );
}

module.exports = { run };

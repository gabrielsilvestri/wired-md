// The theme gallery and the reading controls.
//
// Gallery: every theme in themes/catalog gets a card (superset: a user may have
// more themes of their own), installing writes the file into the profile's
// themes folder and the selector offers it, "use" switches the live theme, and
// a second install never overwrites a file that is already there. The catalog
// is also held to the contrast gate here, so a theme that leaves 4.5:1 to 11:1
// turns the suite red instead of shipping.
//
// Reading: line height and text width change the computed style of the
// document column live and persist in config.json.
//
// WIRED_GALLERY_SHOT=<folder> also writes review screenshots there (dark and
// light, wide and narrow). Opt in, so a normal run never writes a file.

const { spawnSync } = require('child_process');

async function run(ctx) {
  const { js, key, sleep, check, userDir, readConfigFile, openPath, forget, fs, path, win, demoPath } = ctx;

  const repo = path.join(__dirname, '..', '..', '..');
  const catalogDir = path.join(repo, 'themes', 'catalog');
  const catalog = fs.readdirSync(catalogDir).filter((f) => /\.css$/i.test(f)).map((f) => f.replace(/\.css$/i, ''));

  // Polls `code` until it returns truthy, with a ceiling. Returns the last value.
  const waitFor = async (code, ceiling) => {
    const started = Date.now();
    let v = null;
    while (Date.now() - started < (ceiling || 5000)) {
      v = await js(code);
      if (v) return v;
      await sleep(100);
    }
    return v;
  };

  const shotDir = process.env.WIRED_GALLERY_SHOT || '';
  // One capture per width (narrow 900, wide 1400); the window goes back to its
  // own bounds afterwards.
  const shot = async (name) => {
    if (!shotDir) return;
    const bounds = win.getBounds();
    for (const [suffix, width] of [['narrow', 900], ['wide', 1400]]) {
      win.setBounds({ x: bounds.x, y: bounds.y, width, height: 860 });
      await sleep(450);
      const image = await win.webContents.capturePage();
      fs.writeFileSync(path.join(shotDir, name + '-' + suffix + '.png'), image.toPNG());
    }
    win.setBounds(bounds);
    await sleep(250);
  };

  // Reset what this check reads: the theme and the two reading settings are
  // config state an earlier check (or the owner) may have left anywhere.
  await js(
    `(async()=>{config.theme='wired';config.accent=null;config.themeOverrides={};` +
    `config.lineHeight=1.65;config.textWidth=860;await applyTheme('wired');await saveConfig();})()`
  );
  await sleep(250);

  // --- the catalog itself passes the contrast gate ---
  // Electron runs the script as plain Node, the same way the packaged CLI runs.
  const gate = spawnSync(process.execPath, [path.join(repo, 'scripts', 'measure-contrast.mjs')], {
    env: Object.assign({}, process.env, { ELECTRON_RUN_AS_NODE: '1' }),
    encoding: 'utf8'
  });
  const gateOut = String(gate.stdout || '');
  check(
    'every catalog theme passes the 4.5:1 to 11:1 contrast gate (scripts/measure-contrast.mjs)',
    catalog.length >= 8 && gate.status === 0 && catalog.every((n) => gateOut.includes('catalog/' + n + '.css')),
    JSON.stringify({ themes: catalog.length, status: gate.status, tail: gateOut.trim().split('\n').slice(-2).join(' | ') })
  );

  check(
    'the command palette offers "browse themes"',
    (await js(`PALETTE_ACTIONS.some(function(a){return (typeof a.label==='function'?a.label():a.label)==='browse themes';})`)) === true
  );

  // Opened from the palette while settings sat on another tab, the gallery
  // still shows Appearance as the selected tab.
  await js(`void openSettings()`);
  await sleep(200);
  await js(`document.getElementById('tab-ai').click()`);
  await js(`(function(){var a=PALETTE_ACTIONS.find(function(x){return (typeof x.label==='function'?x.label():x.label)==='browse themes';});a.run();})()`);
  await sleep(400);
  const tabOn = await js(`(document.querySelector('.settings-tab.is-active')||{}).id`);
  check('the gallery opened from another settings tab marks Appearance as the selected tab', tabOn === 'tab-appearance', String(tabOn));
  await js(`void closeSettings()`);
  await sleep(200);

  // --- the gallery lists every catalog theme ---
  await js(`void openSettings()`);
  await sleep(300);
  const button = await js(
    `(function(){var b=document.getElementById('btn-theme-gallery');` +
    `return b?{title:b.title,label:b.getAttribute('aria-label'),icon:!!b.querySelector('svg')}:null;})()`
  );
  check(
    'the Appearance pane has a "browse themes" icon button with a tooltip and an accessible name',
    !!button && button.icon && button.title.length > 0 && (button.label || '').length > 0,
    JSON.stringify(button)
  );

  await js(`document.getElementById('btn-theme-gallery').click()`);
  const listed = await waitFor(
    `(function(){var c=[...document.querySelectorAll('#gallery-grid .gallery-card')];` +
    `return c.length>=${catalog.length}?c.map(function(x){return x.dataset.theme;}):null;})()`
  );
  check(
    'the gallery shows a card for every catalog theme',
    Array.isArray(listed) && catalog.every((n) => listed.includes(n)),
    JSON.stringify({ catalog, listed })
  );

  const preview = await js(
    `(function(){var c=document.querySelector('#gallery-grid .gallery-card');if(!c)return null;` +
    `var p=c.querySelector('.gallery-preview');var s=getComputedStyle(p);` +
    `return {theme:c.dataset.theme,bg:p.style.getPropertyValue('--gp-bg'),painted:s.backgroundColor,` +
    `kind:c.querySelector('.gallery-kind').textContent,parts:['.gp-h','.gp-a','.gp-code'].every(function(q){return !!p.querySelector(q);})};})()`
  );
  check(
    'a card paints its preview from that theme\'s own variables and says dark or light',
    !!preview && /^#[0-9a-f]{6}$/i.test(preview.bg) && preview.parts && /^(dark|light)$/.test(preview.kind) &&
      preview.painted !== '' && preview.painted !== 'rgba(0, 0, 0, 0)',
    JSON.stringify(preview)
  );

  await shot('gallery-dark');

  // --- install ---
  // A theme this profile does not have yet; whatever was already there stays.
  const target = catalog.find((n) => !fs.existsSync(userDir('themes', n + '.css')));
  const targetFile = target ? userDir('themes', target + '.css') : null;
  if (!target) {
    check('a catalog theme not yet installed exists to exercise the install', false, 'every catalog theme is already in the profile');
  } else {
    await js(`document.querySelector('.gallery-card[data-theme="${target}"] .gallery-install').click()`);
    const installed = await waitFor(
      `(function(){var c=document.querySelector('.gallery-card[data-theme="${target}"]');` +
      `return c&&c.querySelector('.gallery-use')?true:null;})()`
    );
    const sameBytes = fs.existsSync(targetFile) &&
      fs.readFileSync(targetFile).equals(fs.readFileSync(path.join(catalogDir, target + '.css')));
    const offered = await js(
      `[...document.getElementById('sel-theme').options].some(function(o){return o.value===${JSON.stringify(target)};})`
    );
    check(
      'install writes the catalog file into the profile themes folder, the card flips to "use" and the selector offers it',
      installed === true && sameBytes && offered === true,
      JSON.stringify({ target, installed, sameBytes, offered })
    );

    // --- use ---
    await js(`document.querySelector('.gallery-card[data-theme="${target}"] .gallery-use').click()`);
    const want = (fs.readFileSync(targetFile, 'utf8').match(/--bg\s*:\s*(#[0-9a-f]{6})/i) || [])[1];
    const live = await waitFor(
      `(function(){var bg=getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();` +
      `var cur=document.querySelector('.gallery-card[data-theme="${target}"] .gallery-state.is-current');` +
      `return config.theme===${JSON.stringify(target)}&&bg.toLowerCase()===${JSON.stringify(String(want).toLowerCase())}&&cur` +
      `?{theme:config.theme,bg:bg,select:document.getElementById('sel-theme').value}:null;})()`
    );
    let saved = null;
    for (let i = 0; i < 30 && !(saved && saved.theme === target); i++) {
      await sleep(100);
      saved = readConfigFile();
    }
    check(
      '"use" switches the live theme, marks the card "in use", updates the selector and persists',
      !!live && live.select === target && !!saved && saved.theme === target,
      JSON.stringify({ live, saved: saved && saved.theme })
    );

    // --- a second install never overwrites ---
    const marker = '\n/* e2e: edited by the user */\n';
    fs.appendFileSync(targetFile, marker, 'utf8');
    const again = await js(`window.wired.installCatalogTheme(${JSON.stringify(target)})`);
    const kept = fs.readFileSync(targetFile, 'utf8').includes(marker);
    check(
      'installing a theme that is already there reports it and leaves the file alone',
      !!again && again.ok === true && again.already === true && kept,
      JSON.stringify({ again, kept })
    );

    // A name that is not in the catalog is refused rather than resolved as a path.
    const refused = await js(`window.wired.installCatalogTheme('..\\\\config')`);
    check('install refuses a name that is not a catalog theme', !!refused && refused.ok === false, JSON.stringify(refused));

    // Light theme shot, for the review pass only.
    if (shotDir) {
      const light = catalog.find((n) => /day|paper|fog/.test(n));
      if (light) {
        await js(`(async()=>{config.theme=${JSON.stringify(light)};await window.wired.installCatalogTheme(${JSON.stringify(light)});})()`);
        await js(`(async()=>{await applyTheme(${JSON.stringify(light)});})()`);
        await js(`document.getElementById('btn-gallery-back').click()`);
        await js(`document.getElementById('btn-theme-gallery').click()`);
        await shot('gallery-light');
        try { fs.unlinkSync(userDir('themes', light + '.css')); } catch {}
        await js(`(async()=>{config.theme='wired';await applyTheme('wired');})()`);
      }
    }
  }

  // --- Esc steps back from the gallery to Appearance, it does not close settings ---
  await js(`document.getElementById('btn-theme-gallery').click()`);
  await waitFor(`!document.getElementById('pane-gallery').hidden`);
  key('Escape');
  const back = await waitFor(
    `(function(){var g=document.getElementById('pane-gallery');var a=document.getElementById('pane-appearance');` +
    `var open=!document.getElementById('settings-overlay').classList.contains('hidden');` +
    `return g.hidden&&!a.hidden&&open?{wide:document.getElementById('settings-panel').classList.contains('is-wide')}:null;})()`
  );
  check('Esc inside the gallery goes back to Appearance and keeps settings open', !!back && back.wide === false, JSON.stringify(back));

  // --- reading: line height and text width ---
  // The fixture lives in the profile, so opening it re-roots the tree; the root
  // is put back at the end for the checks that come after this one.
  const rootBefore = await js(`treeRoot`);
  // Own fixture in front, so the column measured is one this check opened.
  const fixture = userDir('reading-check.md');
  fs.writeFileSync(fixture, '# Reading\n\nA paragraph long enough to wrap across the column so the width and the leading both matter on screen.\n', 'utf8');
  await openPath(fixture);
  await waitFor(`!!(currentPath&&currentPath.indexOf('reading-check.md')!==-1&&activePane().el.querySelector('.vditor-ir pre.vditor-reset p'))`);

  await js(`document.getElementById('tab-editor').click()`);
  await sleep(150);
  // The computed max width is the assertion, not the rendered width: the test
  // window can be narrower than any of the values.
  const column = `(function(){var pre=activePane().el.querySelector('.vditor-ir pre.vditor-reset');` +
    `var p=pre.querySelector('p');var s=getComputedStyle(pre);var ps=getComputedStyle(p);` +
    `return {lh:parseFloat(ps.lineHeight)/parseFloat(ps.fontSize),maxWidth:s.maxWidth,width:pre.getBoundingClientRect().width};})()`;
  const before = await js(column);

  await js(
    `(function(){var r=document.getElementById('inp-line-height');r.value='1.9';` +
    `r.dispatchEvent(new Event('input'));r.dispatchEvent(new Event('change'));` +
    `var w=document.getElementById('inp-text-width');w.value='600';` +
    `w.dispatchEvent(new Event('input'));w.dispatchEvent(new Event('change'));})()`
  );
  await sleep(200);
  const narrow = await js(column);
  const shown = await js(
    `({lh:document.getElementById('out-line-height').textContent,w:document.getElementById('out-text-width').textContent})`
  );
  check(
    'line height and text width change the document column live',
    Math.abs(before.lh - 1.65) < 0.02 && before.maxWidth === '860px' &&
      Math.abs(narrow.lh - 1.9) < 0.02 && narrow.maxWidth === '600px' &&
      shown.lh === '1.90' && shown.w === '600px',
    JSON.stringify({ before, narrow, shown })
  );

  await shot('reading-editor');
  if (shotDir) {
    await js(`closeSettings()`);
    await shot('reading-document');
    await js(`void openSettings()`);
    await sleep(300);
    await js(`document.getElementById('tab-editor').click()`);
  }

  await js(`(function(){var c=document.getElementById('chk-text-width-full');c.click();})()`);
  await sleep(200);
  const full = await js(column);
  let saved = null;
  for (let i = 0; i < 30 && !(saved && saved.textWidth === 'full'); i++) {
    await sleep(100);
    saved = readConfigFile();
  }
  check(
    '"full" lifts the max width and both settings persist in config.json',
    full.maxWidth === 'none' && !!saved && saved.textWidth === 'full' && saved.lineHeight === 1.9,
    JSON.stringify({ full, saved: saved && { lineHeight: saved.lineHeight, textWidth: saved.textWidth } })
  );

  await js(`document.getElementById('btn-reading-reset').click()`);
  await sleep(200);
  const reset = await js(column);
  check(
    'reading defaults puts the column back at 1.65 and 860px',
    Math.abs(reset.lh - 1.65) < 0.02 && reset.maxWidth === '860px',
    JSON.stringify(reset)
  );

  // --- cleanup: back to wired, the installed copy and the fixture removed ---
  await js(`closeSettings()`);
  await forget(['reading-check.md']);
  try { fs.unlinkSync(fixture); } catch {}
  if (targetFile) {
    try { fs.unlinkSync(targetFile); } catch {}
  }
  await js(
    `(async()=>{config.theme='wired';config.lineHeight=1.65;config.textWidth=860;await applyTheme('wired');await saveConfig();})()`
  );
  await sleep(250);
  if (demoPath) {
    await openPath(demoPath);
    await waitFor(`treeRoot===${JSON.stringify(rootBefore)}`);
  }
  const rootAfter = await js(`treeRoot`);
  check('the tree root is back where it was before the reading fixture', rootAfter === rootBefore, JSON.stringify({ rootBefore, rootAfter }));
}

module.exports = { run };

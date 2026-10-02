// First run welcome and the AI CLI picker.
//
// The suite boots a fresh profile every run, so the welcome must NOT open on
// its own here (it would cover every other check); the palette action still
// opens it. Which CLIs are on this machine's PATH is never asserted: only the
// shape of the answer. The check owns aiCliCommand, theme, fontBody and
// onboarded, and puts all four back at the end (92 and others read them).
//
// WIRED_ONB_SHOT=<folder> writes review screenshots there (never in the repo).

const FAKE = 'wired-e2e-onboarding-cli';
const KNOWN = ['claude', 'codex', 'gemini', 'aider', 'opencode', 'cursor-agent', 'qwen'];
const BUNDLED_THEMES = ['wired', 'carbon', 'ash', 'light', 'parchment'];

async function run(ctx) {
  const { js, key, sleep, check, readConfigFile, win, fs, path } = ctx;

  const poll = async (expr, ceiling) => {
    const start = Date.now();
    let v = null;
    while (Date.now() - start < (ceiling || 4000)) {
      v = await js(expr);
      if (v) return v;
      await sleep(100);
    }
    return v;
  };

  const pollDisk = async (pred, ceiling) => {
    const start = Date.now();
    let cfg = null;
    while (Date.now() - start < (ceiling || 4000)) {
      cfg = readConfigFile();
      if (cfg && pred(cfg)) return cfg;
      await sleep(100);
    }
    return cfg;
  };

  const shotDir = process.env.WIRED_ONB_SHOT || '';
  const shot = async (name) => {
    if (!shotDir) return;
    await sleep(350);
    const image = await win.webContents.capturePage();
    fs.mkdirSync(shotDir, { recursive: true });
    fs.writeFileSync(path.join(shotDir, name + '.png'), image.toPNG());
  };

  const prev = await js(
    `({ai:config.aiCliCommand,theme:config.theme,fontBody:config.fontBody,onboarded:config.onboarded})`
  );

  // Own the state this check reads: not onboarded, the shipped CLI and theme.
  await js(
    `void (async function(){config.onboarded=false;config.aiCliCommand='claude';config.fontBody='';config.theme='wired';` +
      `await applyTheme('wired');await saveConfig();})()`
  );
  await sleep(300);

  // --- the test mode gate ---
  const gate = await js(
    `window.wired.onboardingAutoOpen().then(function(auto){var o=document.getElementById('onboarding-overlay');` +
      `return {auto:auto,exists:!!o,hidden:!!o&&o.classList.contains('hidden')};})`
  );
  check(
    'onboarding: the welcome does not open on its own under WIRED_E2E',
    !!gate && gate.auto === false && gate.exists && gate.hidden,
    JSON.stringify(gate)
  );

  // --- detection answers a well formed list, whatever is installed ---
  const det = await js('window.wired.detectAiClis()');
  const wellFormed =
    !!det && typeof det.complete === 'boolean' && Array.isArray(det.clis) &&
    det.clis.every((c) => c && typeof c.name === 'string' && typeof c.label === 'string' &&
      typeof c.found === 'boolean' && (c.found ? typeof c.path === 'string' && c.path.length > 0 : c.path === null)) &&
    KNOWN.every((n) => det.clis.some((c) => c.name === n));
  check(
    'onboarding: the PATH detection returns every known CLI with a found flag and a path when found',
    wellFormed,
    JSON.stringify(det && det.clis ? det.clis.map((c) => c.name + ':' + c.found) : det)
  );

  // --- the links handler refuses anything that is not one of its two URLs ---
  const links = await js(
    `Promise.all([window.wired.openProjectLink('https://example.com/'),` +
      `window.wired.openProjectLink('https://github.com/gabrielsilvestri/wired-md/../evil'),` +
      `window.wired.openProjectLink('file:///C:/Windows/notepad.exe')]).then(function(r){return r.map(function(x){return !!(x&&x.ok);});})`
  );
  check(
    'onboarding: the link handler refuses URLs outside its allowlist',
    Array.isArray(links) && links.every((ok) => ok === false),
    JSON.stringify(links)
  );

  // --- the palette opens it ---
  await js(`openPalette('commands')`);
  await sleep(150);
  await js(
    `(function(){var i=document.getElementById('palette-input');i.value='welcome and setup';i.dispatchEvent(new Event('input'));})()`
  );
  await sleep(150);
  key('Return');
  const opened = await poll(
    `(function(){var o=document.getElementById('onboarding-overlay');return !!o&&!o.classList.contains('hidden')&&` +
      `document.querySelectorAll('#onb-cli .cli-card').length>=${KNOWN.length}&&document.querySelectorAll('.onb-theme').length>0&&` +
      `document.querySelectorAll('.onb-font').length>0;})()`,
    6000
  );
  const surface = await js(
    `(function(){var r=document.getElementById('onb-link-repo'),c=document.getElementById('onb-link-coffee');` +
      `var sel=document.querySelector('#onb-cli .cli-card.is-selected');` +
      `return {selected:sel?sel.dataset.cli:null,repo:!!r&&!!r.title&&!!r.getAttribute('aria-label'),` +
      `coffee:!!c&&!!c.title&&!!c.getAttribute('aria-label'),anchors:document.querySelectorAll('#onboarding a[href]').length,` +
      `finish:!!document.getElementById('onb-finish'),skip:!!document.getElementById('onb-skip'),` +
      `focusInside:document.getElementById('onboarding').contains(document.activeElement)};})()`
  );
  check(
    'onboarding: "welcome and setup" in the palette opens the welcome with the CLI, theme and font picks',
    !!opened && !!surface && surface.selected === 'claude' && surface.finish && surface.skip && surface.focusInside,
    JSON.stringify(surface)
  );
  check(
    'onboarding: the footer carries the GitHub and coffee links as buttons, never anchors',
    !!surface && surface.repo && surface.coffee && surface.anchors === 0,
    JSON.stringify(surface)
  );
  await shot('welcome-wired-700');

  // --- a custom command reaches config, the bridge tooltips and config.json ---
  await js(
    `(function(){var i=document.getElementById('onb-cli-custom');i.value=${JSON.stringify(FAKE)};i.dispatchEvent(new Event('input'));})()`
  );
  const custom = await poll(
    `(function(){var t=document.getElementById('btn-claude');var b=document.querySelector('.pane-header .pane-claude');` +
      `var sel=document.querySelectorAll('#onb-cli .cli-card.is-selected').length;` +
      `return config.aiCliCommand===${JSON.stringify(FAKE)}&&t&&t.textContent===${JSON.stringify(FAKE)}?` +
      `{cfg:config.aiCliCommand,term:t.title,pane:b?b.title:null,selectedCards:sel}:null;})()`
  );
  const diskCustom = await pollDisk((c) => c.aiCliCommand === FAKE);
  check(
    'onboarding: a custom command updates config.aiCliCommand, the bridge tooltips and config.json',
    !!custom && custom.term.indexOf(FAKE) !== -1 && (custom.pane === null || custom.pane.indexOf(FAKE) !== -1) &&
      custom.selectedCards === 0 && !!diskCustom && diskCustom.aiCliCommand === FAKE,
    JSON.stringify({ custom, disk: diskCustom ? diskCustom.aiCliCommand : null })
  );

  // --- a card pick replaces it and clears the custom field ---
  await js(`document.querySelector('#onb-cli .cli-card[data-cli="codex"]').click()`);
  const card = await poll(
    `(function(){var c=document.querySelector('#onb-cli .cli-card[data-cli="codex"]');var i=document.getElementById('onb-cli-custom');` +
      `return config.aiCliCommand==='codex'?{pressed:c.getAttribute('aria-pressed'),field:i.value,` +
      `term:document.getElementById('btn-claude').textContent}:null;})()`
  );
  check(
    'onboarding: picking a CLI card sets the command, marks the card and empties the custom field',
    !!card && card.pressed === 'true' && card.field === '' && card.term === 'codex',
    JSON.stringify(card)
  );

  // --- theme: hover previews, click keeps, leaving restores the kept one ---
  const bgOf = (name) => `document.querySelector('.onb-theme[data-theme="${name}"] .onb-swatch').style.getPropertyValue('--sw-bg').trim()`;
  const liveBg = `getComputedStyle(document.documentElement).getPropertyValue('--bg').trim()`;
  await js(`document.querySelector('.onb-theme[data-theme="light"]').click()`);
  const kept = await poll(`(${liveBg}===${bgOf('light')}&&config.theme==='light')?{bg:${liveBg},theme:config.theme}:null`);
  const diskTheme = await pollDisk((c) => c.theme === 'light');
  check(
    'onboarding: clicking a theme card switches the live theme and keeps it in config',
    !!kept && !!diskTheme,
    JSON.stringify({ kept, disk: diskTheme ? diskTheme.theme : null })
  );
  await shot('welcome-light-700');

  await js(`document.querySelector('.onb-theme[data-theme="carbon"]').dispatchEvent(new MouseEvent('mouseenter'))`);
  const hovered = await poll(`${liveBg}===${bgOf('carbon')}?{bg:${liveBg},theme:config.theme}:null`);
  await js(`document.querySelector('.onb-themes').dispatchEvent(new MouseEvent('mouseleave'))`);
  const restored = await poll(`${liveBg}===${bgOf('light')}?{bg:${liveBg},theme:config.theme}:null`);
  check(
    'onboarding: hovering a theme previews it without keeping it, and leaving the row restores the kept theme',
    !!hovered && hovered.theme === 'light' && !!restored && restored.theme === 'light',
    JSON.stringify({ hovered, restored })
  );

  // --- font: a card pick sets the document font ---
  await js(`document.querySelector('.onb-font[data-font="Geist"]').click()`);
  const font = await poll(
    `config.fontBody==='Geist'?{font:getComputedStyle(document.documentElement).getPropertyValue('--font-body'),` +
      `pressed:document.querySelector('.onb-font[data-font="Geist"]').getAttribute('aria-pressed')}:null`
  );
  check(
    'onboarding: picking a font card sets the document font live',
    !!font && font.font.indexOf('Geist') !== -1 && font.pressed === 'true',
    JSON.stringify(font)
  );

  // --- every text color of the welcome sits inside 4.5:1 to 11:1, in every bundled theme ---
  // The background is the first opaque one up the tree, which is what the eye
  // gets behind the glyphs here (no translucent fills under text).
  const measure =
    `(function(){function rgb(s){var m=/rgba?\\(([^)]+)\\)/.exec(s||'');if(!m)return null;var p=m[1].split(',').map(Number);` +
    `if(p.length>3&&p[3]===0)return null;return [p[0],p[1],p[2]];}` +
    `function bgOf(n){while(n&&n.nodeType===1){var b=rgb(getComputedStyle(n).backgroundColor);if(b)return b;n=n.parentElement;}return null;}` +
    `var sel=['#onb-title','.onb-lede','.onb-hint','.onb-step','#onb-cli .cli-name','#onb-cli .cli-label','#onb-cli .cli-mark.is-found',` +
    `'#onb-cli .cli-mark:not(.is-found)','#onb-cli .cli-custom label','#onb-cli .cli-custom-input','#onb-cli .cli-status','.onb-card-name',` +
    `'.onb-font-sample','.onb-link','#onb-skip','#onb-finish'];var out=[];` +
    `sel.forEach(function(s){var n=document.querySelector(s);if(!n)return;var cs=getComputedStyle(n);var ink=rgb(cs.color);var bg=bgOf(n);` +
    `if(!ink||!bg){out.push({s:s,r:null});return;}out.push({s:s,r:Math.round(contrastRatio(ink,bg)*100)/100});});return out;})()`;
  const themes = (await js('window.wired.listThemes()')).filter((t) => BUNDLED_THEMES.includes(t));
  const bad = [];
  for (const t of themes) {
    await js(`void applyTheme(${JSON.stringify(t)})`);
    await poll(`${liveBg}===${bgOf(t)}`);
    // Colors ease over --t-fast after a theme switch, so the reading is taken
    // once two in a row agree (polled, with a ceiling).
    let rows = await js(measure);
    const settleStart = Date.now();
    while (Date.now() - settleStart < 3000) {
      await sleep(120);
      const again = await js(measure);
      const same = JSON.stringify(again) === JSON.stringify(rows);
      rows = again;
      if (same) break;
    }
    for (const r of rows) if (r.r === null || r.r < 4.5 || r.r > 11) bad.push(t + ' ' + r.s + ' ' + r.r);
  }
  check(
    'onboarding: every text color of the welcome sits between 4.5:1 and 11:1 in the five bundled themes',
    themes.length === BUNDLED_THEMES.length && bad.length === 0,
    JSON.stringify({ themes, bad })
  );
  await js(`void applyTheme(config.theme)`);
  await poll(`${liveBg}===${bgOf('light')}`);

  if (shotDir) {
    const [w, h] = win.getSize();
    win.setSize(900, 760);
    await shot('welcome-light-900');
    win.setSize(1360, 900);
    await shot('welcome-light-1360');
    await js(`void applyTheme('wired')`);
    await poll(`${liveBg}===${bgOf('wired')}`);
    await shot('welcome-wired-1360');
    win.setSize(900, 760);
    await shot('welcome-wired-900');
    await js(`void applyTheme(config.theme)`);
    win.setSize(w, h);
    await sleep(300);
  }

  // --- Esc closes it and counts as done ---
  key('Escape');
  const escaped = await poll(
    `document.getElementById('onboarding-overlay').classList.contains('hidden')&&config.onboarded===true?{onboarded:config.onboarded}:null`
  );
  const diskEsc = await pollDisk((c) => c.onboarded === true);
  check(
    'onboarding: Esc closes the welcome and marks it done',
    !!escaped && !!diskEsc,
    JSON.stringify({ escaped, disk: diskEsc ? diskEsc.onboarded : null })
  );

  // --- the primary button finishes it ---
  await js(`void (async function(){config.onboarded=false;await saveConfig();})()`);
  await sleep(200);
  await js(`openPalette('commands')`);
  await sleep(150);
  await js(
    `(function(){var i=document.getElementById('palette-input');i.value='welcome and setup';i.dispatchEvent(new Event('input'));})()`
  );
  await sleep(150);
  key('Return');
  await poll(`!document.getElementById('onboarding-overlay').classList.contains('hidden')`);
  await js(`document.getElementById('onb-finish').click()`);
  const finished = await poll(
    `document.getElementById('onboarding-overlay').classList.contains('hidden')&&config.onboarded===true`
  );
  const diskFinish = await pollDisk((c) => c.onboarded === true);
  check(
    'onboarding: "start writing" closes the welcome and writes onboarded: true',
    !!finished && !!diskFinish,
    JSON.stringify({ finished, disk: diskFinish ? diskFinish.onboarded : null })
  );

  // --- the settings pane carries the same picker, bound to the same key ---
  await js(`void openSettings()`);
  await sleep(300);
  await js(`document.getElementById('tab-ai').click()`);
  const pane = await poll(
    `(function(){var p=document.getElementById('pane-ai');var cards=p.querySelectorAll('#ai-cli-picker .cli-card');` +
      `var sel=p.querySelector('#ai-cli-picker .cli-card.is-selected');` +
      `return !p.hidden&&cards.length>=${KNOWN.length}?{cards:cards.length,selected:sel?sel.dataset.cli:null,` +
      `hint:p.textContent.indexOf('never presses Enter')!==-1}:null;})()`
  );
  await shot('settings-ai-light');
  if (shotDir) {
    await js(`void applyTheme('wired')`);
    await poll(`${liveBg}===${bgOf('wired')}`);
    await shot('settings-ai-wired');
    await js(`void applyTheme(config.theme)`);
    await poll(`${liveBg}===${bgOf('light')}`);
  }
  await js(`document.querySelector('#ai-cli-picker .cli-card[data-cli="gemini"]').click()`);
  const fromPane = await poll(
    `config.aiCliCommand==='gemini'?{term:document.getElementById('btn-claude').textContent,` +
      `welcome:(document.querySelector('#onb-cli .cli-card.is-selected')||{dataset:{}}).dataset.cli}:null`
  );
  check(
    'onboarding: the terminal and AI settings pane shows the picker, marks the current CLI and says Enter is never pressed',
    !!pane && pane.selected === 'codex' && pane.hint,
    JSON.stringify(pane)
  );
  check(
    'onboarding: a pick in the settings pane updates the bridge and the welcome picker alike',
    !!fromPane && fromPane.term === 'gemini' && fromPane.welcome === 'gemini',
    JSON.stringify(fromPane)
  );
  await js(`(function(){document.getElementById('tab-appearance').click();closeSettings();return null;})()`);

  // --- reset everything this check touched ---
  const back = {
    ai: prev && typeof prev.ai === 'string' ? prev.ai : 'claude',
    theme: prev && prev.theme ? prev.theme : 'wired',
    fontBody: prev && typeof prev.fontBody === 'string' ? prev.fontBody : '',
    onboarded: !!(prev && prev.onboarded)
  };
  await js(
    `void (async function(){config.aiCliCommand=${JSON.stringify(back.ai)};config.theme=${JSON.stringify(back.theme)};` +
      `config.fontBody=${JSON.stringify(back.fontBody)};config.onboarded=${back.onboarded};` +
      `await applyTheme(config.theme);await saveConfig();})()`
  );
  await pollDisk((c) => c.theme === back.theme && c.aiCliCommand === back.ai && c.onboarded === back.onboarded);
}

module.exports = { run };

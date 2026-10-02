// Settings v2: icon tabs, one panel at a time, every icon carrying both a
// tooltip and an accessible name, and the gear still living in the sidebar
// footer rather than the title bar.

const TABS = ['appearance', 'editor', 'ai', 'shortcuts'];

async function run(ctx) {
  const { js, sleep, check } = ctx;

  await js(`void openSettings()`);
  await sleep(400);

  // --- the tabs exist, are icons, and are named twice over ---
  const tabs = await js(
    `(function(){var t=[...document.querySelectorAll('.settings-tab')];` +
    `return {names:t.map(function(b){return b.dataset.tab;}),` +
    `allIcons:t.every(function(b){return !!b.querySelector('svg');}),` +
    `noText:t.every(function(b){return b.textContent.trim()==='';}),` +
    `titled:t.every(function(b){return (b.title||'').length>0;}),` +
    `labelled:t.every(function(b){return (b.getAttribute('aria-label')||'').length>0;}),` +
    `roles:t.every(function(b){return b.getAttribute('role')==='tab'&&!!b.getAttribute('aria-controls');})};})()`
  );
  check(
    'settings v2: four icon tabs, no text menu, each with title, aria-label and tab semantics',
    !!tabs && TABS.every((n) => tabs.names.includes(n)) && tabs.allIcons && tabs.noText &&
      tabs.titled && tabs.labelled && tabs.roles,
    JSON.stringify(tabs)
  );

  // --- exactly one panel visible at a time, and clicking a tab switches it ---
  const switching = [];
  for (const name of TABS) {
    await js(`document.getElementById('tab-${name}').click()`);
    await sleep(150);
    switching.push(
      await js(
        `(function(){var panes=[...document.querySelectorAll('.settings-pane')];` +
        `var vis=panes.filter(function(p){return !p.hidden;});` +
        `var tabs=[...document.querySelectorAll('.settings-tab')];` +
        `return {visible:vis.length,id:vis.length?vis[0].id:null,` +
        `selected:tabs.filter(function(t){return t.getAttribute('aria-selected')==='true';}).length};})()`
      )
    );
  }
  check(
    'exactly one settings panel is visible at a time and the selected tab tracks it',
    switching.every((s, i) => s && s.visible === 1 && s.id === 'pane-' + TABS[i] && s.selected === 1),
    JSON.stringify(switching)
  );

  // --- the terminal and AI section holds the AI CLI picker (75-onboarding drives it) ---
  const ai = await js(
    `(function(){var p=document.getElementById('pane-ai');` +
    `return {exists:!!p,picker:!!(p&&p.querySelector('#ai-cli-picker .cli-custom-input'))};})()`
  );
  check(
    'the terminal and AI section holds the AI CLI picker',
    !!ai && ai.exists && ai.picker,
    JSON.stringify(ai)
  );

  // --- shortcuts are a read only list ---
  await js(`document.getElementById('tab-shortcuts').click()`);
  await sleep(150);
  const shortcuts = await js(
    `(function(){var l=document.getElementById('shortcut-list');` +
    `return {dt:l.querySelectorAll('dt').length,dd:l.querySelectorAll('dd').length,` +
    `groups:l.querySelectorAll('.shortcut-group').length,` +
    `editable:l.querySelectorAll('input,select,textarea').length,` +
    `hasSave:l.textContent.indexOf('Ctrl+S')>=0};})()`
  );
  check(
    'the shortcuts section is a read only list with no editable control',
    !!shortcuts && shortcuts.dt >= 10 && shortcuts.dt === shortcuts.dd &&
      shortcuts.groups >= 3 && shortcuts.editable === 0 && shortcuts.hasSave,
    JSON.stringify(shortcuts)
  );

  // --- the gear stays in the sidebar footer ---
  const gear = await js(
    `(function(){var b=document.getElementById('btn-config');` +
    `return {inFooter:!!b&&!!b.closest('#sidebar-footer'),` +
    `inTitlebar:!!b&&!!b.closest('#titlebar'),` +
    `icon:!!b&&!!b.querySelector('svg'),title:(b&&b.title)||''};})()`
  );
  check(
    'the settings gear is still an icon in the sidebar footer, never the title bar',
    !!gear && gear.inFooter && !gear.inTitlebar && gear.icon && gear.title.length > 0,
    JSON.stringify(gear)
  );

  // --- Esc closes the panel (the shortcut path, not the button) ---
  // The dispatch runs inside a try in the RENDERER and reports the message,
  // because the global keydown listener runs in the capture phase and anything
  // it throws would otherwise reach the driver as an opaque "script failed to
  // execute" with no line and no stack.
  const escErr = await js(
    `(function(){try{window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}));return null;}` +
    `catch(e){return String(e && e.message ? e.message : e);}})()`
  );
  check('Esc reaches the global handler without throwing', escErr === null, String(escErr));
  await sleep(200);
  // Read the overlay itself, not isSettingsOpen(): app.js exposes openSettings
  // and closeSettings to the suite but NOT the predicate, so calling it here is
  // a ReferenceError that surfaces as an opaque driver abort.
  const closed = await js(
    `document.getElementById('settings-overlay').classList.contains('hidden')`
  );
  check('Esc closes the settings overlay', closed === true, String(closed));

  // Leave the panel on Appearance so the next run starts where a human would.
  // Wrapped: a cleanup step is not worth aborting the whole suite over, and an
  // unreported throw here would surface as the driver's generic "ran without an
  // exception" failure with no clue which line produced it.
  try {
    await js(`(function(){var t=document.getElementById('tab-appearance');if(t)t.click();return null;})()`);
  } catch (err) {
    check('settings cleanup (back to the Appearance tab)', false, String(err && err.message ? err.message : err));
  }
}

module.exports = { run };

// The theme variable panel: an override applies live, survives to disk, and
// resets back to the theme value.
//
// TRAP (docs/dev/lessons.md): a check that reads config.json state has to RESET
// that state first. This one owns config.themeOverrides, so it wipes the key,
// puts the theme back to wired, and leaves both clean at the end. Otherwise a
// leftover override from a previous run would make the "reset restores the
// theme value" assertion compare a color against itself.

async function run(ctx) {
  const { js, sleep, check, readConfigFile } = ctx;

  // --- clean slate ---
  await js(
    `(async()=>{config.theme='wired';config.accent=null;config.themeOverrides={};` +
    `await applyTheme('wired');await saveConfig();})()`
  );
  await sleep(300);

  await js(`void openSettings()`);
  await sleep(400);

  const themeInk = await js(
    `getComputedStyle(document.documentElement).getPropertyValue('--ink').trim()`
  );

  // --- the panel rendered the variables, grouped ---
  const panel = await js(
    `(function(){var el=document.getElementById('theme-vars');` +
    `return {groups:el.querySelectorAll('.tvar-group').length,` +
    `rows:el.querySelectorAll('.tvar-row').length,` +
    `hasInk:!!el.querySelector('.tvar-row[data-name="--ink"] input[type=color]'),` +
    `hasBg:!!el.querySelector('.tvar-row[data-name="--bg"] input[type=color]'),` +
    `labelled:[...el.querySelectorAll('input[type=color]')].every(function(i){return !!i.getAttribute('aria-label')&&!!i.title;})};})()`
  );
  check(
    'theme variable panel: the active theme is parsed into grouped color rows, every input labelled',
    !!panel && panel.groups >= 4 && panel.rows >= 12 && panel.hasInk && panel.hasBg && panel.labelled,
    JSON.stringify(panel)
  );

  // --- an override applies live ---
  const OVERRIDE = '#c8ced6';
  await js(
    `(function(){var i=document.querySelector('.tvar-row[data-name="--ink"] input[type=color]');` +
    `i.value=${JSON.stringify(OVERRIDE)};i.dispatchEvent(new Event('change',{bubbles:true}));})()`
  );
  await sleep(300);

  const applied = await js(
    `(function(){var s=getComputedStyle(document.documentElement);` +
    `return {ink:s.getPropertyValue('--ink').trim(),` +
    `custom:document.getElementById('custom-style').textContent,` +
    `marked:!!document.querySelector('.tvar-row[data-name="--ink"].is-overridden')};})()`
  );
  check(
    'theme variable override applies live through the #custom-style layer and marks its row',
    !!applied && applied.ink === OVERRIDE && applied.custom.indexOf('--ink:' + OVERRIDE) >= 0 && applied.marked,
    JSON.stringify({ ink: applied && applied.ink, marked: applied && applied.marked })
  );

  // --- it persists to config.json, keyed by theme ---
  await sleep(300);
  const disk = readConfigFile();
  check(
    'theme variable override persists in config.themeOverrides, keyed by theme name',
    !!disk && !!disk.themeOverrides && !!disk.themeOverrides.wired && disk.themeOverrides.wired['--ink'] === OVERRIDE,
    JSON.stringify(disk && disk.themeOverrides)
  );

  // --- focusDimFor recomputes after an override, it does not lag one step ---
  // --ink went lighter, so the dim opacity that still clears 4.6:1 has to move
  // with it. The point is that the value matches the NEW palette, not the one
  // that was live when the override was committed.
  const dim = await js(
    `(function(){var s=getComputedStyle(document.documentElement);` +
    `var live=s.getPropertyValue('--focus-dim').trim();` +
    `var want=focusDimFor(s.getPropertyValue('--bg').trim(),s.getPropertyValue('--ink').trim());` +
    `return {live:live,want:want};})()`
  );
  check(
    'focus dim is recomputed against the overridden palette, not the previous one',
    !!dim && Math.abs(Number(dim.live) - Number(dim.want)) < 0.005,
    JSON.stringify(dim)
  );

  // --- per row reset goes back to the theme value ---
  await js(
    `document.querySelector('.tvar-row[data-name="--ink"] .tvar-reset').click()`
  );
  await sleep(300);
  const afterReset = await js(
    `(function(){var s=getComputedStyle(document.documentElement);` +
    `return {ink:s.getPropertyValue('--ink').trim(),` +
    `marked:!!document.querySelector('.tvar-row[data-name="--ink"].is-overridden')};})()`
  );
  check(
    'per row reset drops the override and the theme value comes back',
    !!afterReset && afterReset.ink === themeInk && !afterReset.marked,
    JSON.stringify({ got: afterReset && afterReset.ink, theme: themeInk })
  );

  // --- the inline contrast warning appears, and never as a popup ---
  // --ink-faint dragged almost onto the background is unreadable by definition,
  // so the panel has to say so in a row and still accept the edit.
  await js(
    `(function(){var i=document.querySelector('.tvar-row[data-name="--ink-faint"] input[type=color]');` +
    `i.value='#131519';i.dispatchEvent(new Event('change',{bubbles:true}));})()`
  );
  await sleep(300);
  const warned = await js(
    `(function(){var w=document.querySelectorAll('#theme-vars .tvar-warn');` +
    `return {n:w.length,text:w.length?w[0].textContent:'',` +
    `applied:getComputedStyle(document.documentElement).getPropertyValue('--ink-faint').trim()};})()`
  );
  check(
    'an unreadable override raises an inline amber warning row and is still applied (never a popup, never blocked)',
    !!warned && warned.n > 0 && /4\.5/.test(warned.text) && warned.applied === '#131519',
    JSON.stringify({ n: warned && warned.n, applied: warned && warned.applied })
  );

  // --- reset all clears the whole theme ---
  await js(`document.getElementById('btn-vars-reset-all').click()`);
  await sleep(300);
  const cleared = await js(
    `(function(){var s=getComputedStyle(document.documentElement);` +
    `return {ink:s.getPropertyValue('--ink').trim(),` +
    `overrides:JSON.stringify(config.themeOverrides||{}),` +
    `warns:document.querySelectorAll('#theme-vars .tvar-warn').length,` +
    `marked:document.querySelectorAll('#theme-vars .tvar-row.is-overridden').length};})()`
  );
  check(
    'reset all to theme drops every override for the active theme and clears the warnings',
    !!cleared && cleared.ink === themeInk && cleared.marked === 0 && cleared.warns === 0 &&
      !JSON.parse(cleared.overrides).wired,
    JSON.stringify(cleared)
  );

  await js(`closeSettings()`);
  await js(`(async()=>{config.themeOverrides={};await saveConfig();})()`);
  await sleep(200);
}

module.exports = { run };

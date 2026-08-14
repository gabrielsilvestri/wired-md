// Sidebar: resizing with the clamp, hide and show with persistence, and the cd
// button in the terminal panel.

async function run(ctx) {
  const { js, sleep, check } = ctx;

  await js(`setSidebarWidth(320); saveConfig();`);
  await sleep(200);
  const width = await js(`(function(){return {css:document.getElementById('sidebar').style.width,cfg:config.sidebarWidth};})()`);
  const clamp = await js(
    `(function(){setSidebarWidth(90);var min=document.getElementById('sidebar').style.width;setSidebarWidth(900);var max=document.getElementById('sidebar').style.width;setSidebarWidth(320);saveConfig();return {min:min,max:max};})()`
  );
  check(
    'sidebar resizes within its limits (180 to 480)',
    !!width && width.css === '320px' && width.cfg === 320 && !!clamp && clamp.min === '180px' && clamp.max === '480px',
    JSON.stringify({ width, clamp })
  );

  await js(`document.getElementById('btn-toggle-sidebar').click()`);
  await sleep(200);
  const hidden = await js(`(function(){return {hid:document.getElementById('sidebar').classList.contains('hidden'),cfg:config.sidebarVisible};})()`);
  await js(`document.getElementById('btn-toggle-sidebar').click()`);
  await sleep(200);
  const shown = await js(`(function(){return {hid:document.getElementById('sidebar').classList.contains('hidden'),cfg:config.sidebarVisible};})()`);
  check(
    'sidebar hides and comes back from the button, persisted in the config',
    hidden.hid && hidden.cfg === false && !shown.hid && shown.cfg === true,
    JSON.stringify({ hidden, shown })
  );

  const cdBtn = await js(`(function(){var b=document.getElementById('btn-term-cd');return !!b && !!b.querySelector('svg') && (b.title||'').length>0;})()`);
  check('cd button in the terminal panel', cdBtn === true, String(cdBtn));
}

module.exports = { run };

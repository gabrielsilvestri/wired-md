// Frameless window: icon only title bar, working custom controls, and the
// window state persisted to userData.

const { Menu } = require('electron');

async function run(ctx) {
  const { js, sleep, check, win, userDir, readJson } = ctx;

  const noMenu = Menu.getApplicationMenu() === null;
  const bar = await js(
    `(function(){var t=document.getElementById('titlebar');if(!t)return null;var lean=['btn-new','btn-open','btn-open-side','btn-save','btn-claude-file','btn-claude-sel'].every(function(id){return !document.getElementById(id);});return {drag:getComputedStyle(t).webkitAppRegion==='drag',controls:['win-min','win-max','win-close'].every(function(id){return !!document.getElementById(id);}),icons:['btn-toggle-sidebar','btn-terminal'].every(function(id){var b=document.getElementById(id);return !!b && !!b.querySelector('svg') && (b.title||'').length>0 && t.contains(b);}),settings:(function(){var b=document.getElementById('btn-config');return !!b && !t.contains(b);})(),lean:lean,textMenus:document.querySelectorAll('#titlebar .menu-root').length,title:(document.getElementById('titlebar-title')||{}).textContent||''};})()`
  );
  check(
    'frameless window: lean bar (sidebar, terminal), settings in the sidebar footer, AI bridge out of the title bar',
    noMenu && !!bar && bar.drag && bar.controls && bar.icons && bar.settings && bar.lean && bar.textMenus === 0 && bar.title.includes('demo.md'),
    JSON.stringify(bar)
  );

  await js(`document.getElementById('win-max').click()`);
  await sleep(600);
  const maxOn = win.isMaximized();
  const restoreIcon = await js(`document.getElementById('win-max').classList.contains('is-max')`);
  await js(`document.getElementById('win-max').click()`);
  await sleep(600);
  const maxOff = win.isMaximized();
  check('custom controls: maximize and restore both respond', maxOn && restoreIcon && !maxOff, 'max=' + maxOn + ' restored=' + !maxOff);

  await sleep(700);
  const winState = readJson(userDir('window-state.json'));
  check(
    'window state saved (window-state.json)',
    !!winState && typeof winState.width === 'number' && typeof winState.height === 'number',
    JSON.stringify(winState)
  );
}

module.exports = { run };

// Focus mode and typewriter mode: two independent toggles, the measured dim
// opacity, the caret block marker, real centering while typing, F8/F9, and
// turning both off again.

const EDITOR = '#panes .pane.active .vditor-ir .vditor-reset';

async function run(ctx) {
  const { js, type, sleep, check, fs, path, win, forget, openPath, readConfigFile, demoPath, rootDir } = ctx;

  // Both modes are zeroed first: the user's real config may have either one on,
  // and then the palette label would read "turn off" and Enter would turn the
  // mode off instead of on (the same trap as setFontZoom(15) in the zoom check).
  await js('toggleFocusMode(false)');
  await js('toggleTypewriterMode(false)');
  await sleep(300);

  await js(`(function(){openPalette('commands');var i=document.getElementById('palette-input');i.value='focus mode';i.dispatchEvent(new Event('input'));})()`);
  await sleep(250);
  const label = await js(`(function(){var r=document.querySelector('#palette-list .palette-row.selected .palette-label');return r?r.textContent:null;})()`);
  await js(`document.getElementById('palette-input').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))`);
  await sleep(700);
  const onDisk = readConfigFile();
  const state = await js(`(function(){var p=document.querySelector('#panes .pane.active');return {cfg:config.focusMode,cls:!!p&&p.classList.contains('focus-mode')};})()`);
  check(
    'focus: the palette action turns the mode on (label shows the current state) and config.json records it',
    label === 'focus mode: turn on' && !!state && state.cfg === true && state.cls && !!onDisk && onDisk.focusMode === true,
    JSON.stringify({ label, state, disk: onDisk && onDisk.focusMode })
  );

  await js(
    `(function(){var root=document.querySelector('${EDITOR}');var kids=[...root.children];var r=document.createRange();r.selectNodeContents(kids[1]);r.collapse(true);var s=getSelection();s.removeAllRanges();s.addRange(r);document.dispatchEvent(new Event('selectionchange'));})()`
  );
  await sleep(600);
  const marked = await js(
    `(function(){var root=document.querySelector('${EDITOR}');var kids=[...root.children];var idx=kids.findIndex(function(k){return k.classList.contains('focus-current');});var n=kids.filter(function(k){return k.classList.contains('focus-current');}).length;var other=kids[idx===0?1:0];return {n:kids.length,idx:idx,marked:n,opCurrent:getComputedStyle(kids[idx]).opacity,opOther:getComputedStyle(other).opacity,themeVar:getComputedStyle(document.documentElement).getPropertyValue('--focus-dim').trim()};})()`
  );
  // The opacity is MEASURED per theme, never guessed: focusDimFor returns the
  // lowest opacity that still keeps dimmed ink above the contrast floor. The
  // math is pure, so the light theme value is computed straight from its palette
  // (bg #f2f0ea, ink #3c424a) without switching themes live, which was flaky.
  const dimLight = await js(`String(focusDimFor('#f2f0ea','#3c424a'))`);
  check(
    'focus: only the caret block is marked, the siblings sit at the measured opacity (0.62 in wired, 0.76 in light)',
    !!marked && marked.n > 2 && marked.idx === 1 && marked.marked === 1 && marked.opCurrent === '1' &&
      Math.abs(Number(marked.opOther) - 0.62) < 0.02 && marked.themeVar === '0.62' && dimLight === '0.76',
    JSON.stringify({ marked, dimLight })
  );

  await js(
    `(function(){var root=document.querySelector('${EDITOR}');var kids=[...root.children];var r=document.createRange();r.selectNodeContents(kids[2]);r.collapse(true);var s=getSelection();s.removeAllRanges();s.addRange(r);document.dispatchEvent(new Event('selectionchange'));})()`
  );
  await sleep(500);
  const moved = await js(
    `(function(){var root=document.querySelector('${EDITOR}');var kids=[...root.children];return {idx:kids.findIndex(function(k){return k.classList.contains('focus-current');}),marked:kids.filter(function(k){return k.classList.contains('focus-current');}).length,opPrevious:getComputedStyle(kids[1]).opacity};})()`
  );
  check(
    'focus: moving the caret to another block moves the marker and dims the previous one',
    !!moved && moved.idx === 2 && moved.marked === 1 && Math.abs(Number(moved.opPrevious) - 0.62) < 0.02,
    JSON.stringify(moved)
  );

  const longPath = path.join(rootDir, 'focus-e2e.md');
  const lines = [];
  for (let i = 1; i <= 90; i++) lines.push('line ' + i + ' of the typewriter test.');
  fs.writeFileSync(longPath, '# focus e2e\n\n' + lines.join('\n\n') + '\n', 'utf8');
  await sleep(1300);
  await js(`void openPath(${JSON.stringify(longPath)}, true)`);
  await sleep(1600);
  await js('toggleTypewriterMode(true)');
  await sleep(400);
  win.focus();
  // vditor.focus() puts the caret at the START of the document: to test the last
  // line, the range is moved to the end of the last block by hand.
  await js('vditor.focus()');
  await sleep(300);
  await js(
    `(function(){var root=document.querySelector('${EDITOR}');var kids=[...root.children];var r=document.createRange();r.selectNodeContents(kids[kids.length-1]);r.collapse(false);var s=getSelection();s.removeAllRanges();s.addRange(r);})()`
  );
  await sleep(400);
  await type('zz', 80);
  await sleep(1200);
  const tw = await js(
    `(function(){var p=activePane();var b=caretBlock(p);if(!b)return {error:'no block'};var c=scrollContainerOf(b,p);if(!c)return {error:'no container'};var rb=b.getBoundingClientRect(),rc=c.getBoundingClientRect();var others=panes.filter(function(x){return x.id!==p.id;});return {delta:Math.round(Math.abs((rb.top+rb.height/2)-(rc.top+rc.height/2))),containerHeight:Math.round(rc.height),scroll:Math.round(c.scrollTop),cls:p.el.classList.contains('typewriter-mode'),nPanes:panes.length,otherFocus:others.some(function(x){return x.el.classList.contains('focus-mode');}),otherTypewriter:others.some(function(x){return x.el.classList.contains('typewriter-mode');})};})()`
  );
  check(
    'typewriter: typing on the last line keeps the block vertically centered in the pane, and the inactive pane stays normal',
    !!tw && !tw.error && tw.cls && tw.nPanes === 2 && tw.scroll > 0 && tw.delta <= 40 && !tw.otherFocus && !tw.otherTypewriter,
    JSON.stringify(tw)
  );

  await js(`window.dispatchEvent(new KeyboardEvent('keydown',{key:'F8'}))`);
  await sleep(500);
  const onlyTw = await js(
    `(function(){var p=document.querySelector('#panes .pane.active');return {focus:config.focusMode,tw:config.typewriterMode,cFocus:p.classList.contains('focus-mode'),cTw:p.classList.contains('typewriter-mode')};})()`
  );
  await js(`window.dispatchEvent(new KeyboardEvent('keydown',{key:'F9'}))`);
  await sleep(300);
  await js(`window.dispatchEvent(new KeyboardEvent('keydown',{key:'F8'}))`);
  await sleep(500);
  const onlyFocus = await js(
    `(function(){var p=document.querySelector('#panes .pane.active');return {focus:config.focusMode,tw:config.typewriterMode,cFocus:p.classList.contains('focus-mode'),cTw:p.classList.contains('typewriter-mode')};})()`
  );
  check(
    'focus and typewriter: independent of each other, and F8 and F9 toggle one each',
    !!onlyTw && onlyTw.focus === false && onlyTw.tw === true && !onlyTw.cFocus && onlyTw.cTw &&
      !!onlyFocus && onlyFocus.focus === true && onlyFocus.tw === false && onlyFocus.cFocus && !onlyFocus.cTw,
    JSON.stringify({ onlyTw, onlyFocus })
  );

  await js('toggleFocusMode(false)');
  await sleep(600);
  const offDisk = readConfigFile();
  const normal = await js(
    `(function(){var p=document.querySelector('#panes .pane.active');var root=document.querySelector('${EDITOR}');var kids=[...root.children];return {marked:kids.filter(function(k){return k.classList.contains('focus-current');}).length,opacities:[...new Set(kids.map(function(k){return getComputedStyle(k).opacity;}))],cFocus:p.classList.contains('focus-mode'),cTw:p.classList.contains('typewriter-mode'),cfg:[config.focusMode,config.typewriterMode]};})()`
  );
  check(
    'focus and typewriter off: no marker, full opacity on every block and both false on disk',
    !!normal && normal.marked === 0 && normal.opacities.length === 1 && normal.opacities[0] === '1' && !normal.cFocus && !normal.cTw &&
      normal.cfg[0] === false && normal.cfg[1] === false && !!offDisk && offDisk.focusMode === false && offDisk.typewriterMode === false,
    JSON.stringify({ normal, disk: offDisk && [offDisk.focusMode, offDisk.typewriterMode] })
  );

  await forget(['focus-e2e']);
  await openPath(demoPath);
  fs.rmSync(longPath, { force: true });
  await sleep(900);
}

module.exports = { run };

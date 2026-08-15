// The empty state: with no file in the editor the void carries the Lain
// portrait and one line of instruction, the title bar carries the product name
// (read from the app, not spelled out in the renderer), and the layer never
// steals the pointer from the editor under it.

async function run(ctx) {
  const { js, sleep, check, win, openPath, demoPath } = ctx;

  win.setSize(1360, 840);
  await sleep(300);

  // Close every tab: the state the app boots into with nothing to open.
  await js(`(function(){[...panes].forEach(function(p){setPaneDirty(p,false);closePane(p);});})()`);
  await sleep(800);

  const empty = await js(
    `(function(){var e=document.getElementById('editor-empty');var art=document.getElementById('lain-art');var hint=document.getElementById('empty-hint');` +
    `var cs=getComputedStyle(art);var hs=getComputedStyle(hint);var body=getComputedStyle(document.body);` +
    `var rgb=function(s){var m=String(s).match(/[\\d.]+/g);return [Number(m[0]),Number(m[1]),Number(m[2])];};` +
    `var lines=art.textContent.split('\\n');` +
    `var faint=getComputedStyle(document.documentElement).getPropertyValue('--ink-faint').trim();` +
    `return {panes:panes.length,groups:groups.length,hidden:e.classList.contains('hidden'),` +
    `lines:lines.length,width:Math.max.apply(null,lines.map(function(l){return l.length;})),` +
    `plain:/^[\\s\\u2580-\\u259f]+$/.test(art.textContent),` +
    `artColor:cs.color,faint:faint,mono:cs.fontFamily.indexOf('Mono')!==-1||cs.fontFamily.indexOf('mono')!==-1,` +
    `pointer:cs.pointerEvents==='none'||getComputedStyle(e).pointerEvents==='none',` +
    `hintText:hint.textContent,hintRatio:contrastRatio(rgb(hs.color),rgb(body.backgroundColor)),` +
    `tabs:document.querySelectorAll('#panes .tab').length,plus:!!document.querySelector('#panes .tab-new')};})()`
  );
  check(
    'empty state: with no tab open the void shows the Lain portrait in monospace, drawn in the faint ink and never taking the pointer',
    !!empty && empty.panes === 0 && empty.groups === 1 && !empty.hidden &&
      empty.lines >= 10 && empty.lines <= 40 && empty.width >= 20 && empty.width <= 40 && empty.plain &&
      empty.mono && empty.pointer && empty.tabs === 0 && empty.plus,
    JSON.stringify(empty)
  );

  check(
    'empty state: the hint under the art reads as text (4.5:1 to 11:1), not as decoration',
    !!empty && empty.hintText === 'open a .md file or just start writing...' &&
      empty.hintRatio >= 4.5 && empty.hintRatio <= 11,
    JSON.stringify({ hint: empty && empty.hintText, ratio: empty && empty.hintRatio })
  );

  const named = await js(
    `(function(){var t=document.getElementById('titlebar-title');return {bar:t.textContent,product:APP_NAME,osTitle:document.title};})()`
  );
  check(
    'empty state: the title bar carries the product name instead of "no file"',
    !!named && named.product.length > 0 && named.bar === named.product && win.getTitle() === named.product,
    JSON.stringify({ named, os: win.getTitle() })
  );

  // A new untitled tab keeps the art up (there is still nothing written), and
  // the first characters retire it.
  await js(`(function(){document.querySelector('#panes .tab-new').click();})()`);
  await sleep(900);
  const untitled = await js(
    `(function(){var e=document.getElementById('editor-empty');var lab=document.querySelector('#panes .tab.active .tab-label');return {panes:panes.length,label:lab?lab.textContent:null,stillEmpty:!e.classList.contains('hidden'),bar:document.getElementById('titlebar-title').textContent};})()`
  );
  await js(`(function(){activePane().vditor.setValue('# written\\n');updateEmptyState();})()`);
  await sleep(400);
  const written = await js(`document.getElementById('editor-empty').classList.contains('hidden')`);
  check(
    'empty state: the new file button opens an untitled tab with the art still up, and writing retires it',
    !!untitled && untitled.panes === 1 && untitled.label === 'untitled' && untitled.stillEmpty &&
      untitled.bar === (named && named.product) && written === true,
    JSON.stringify({ untitled, written })
  );

  await js(`(function(){var p=activePane();setPaneDirty(p,false);closePane(p);})()`);
  await sleep(500);
  await openPath(demoPath);
  await sleep(600);
  const back = await js(
    `(function(){return {hidden:document.getElementById('editor-empty').classList.contains('hidden'),active:currentPath,bar:document.getElementById('titlebar-title').textContent};})()`
  );
  check(
    'empty state: opening a file puts the art away and the file name back in the title bar',
    !!back && back.hidden && back.active === demoPath && back.bar === 'demo.md',
    JSON.stringify(back)
  );
}

module.exports = { run };

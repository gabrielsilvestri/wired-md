// The right click menu inside a note: it exists (Electron draws none), offers
// the clipboard according to the selection, copy and paste really go through the
// system clipboard into Vditor, a link adds its own entries, and a click outside
// closes it.

async function run(ctx) {
  const { js, sleep, check, fs, win, userDir, openPath, until, forget, demoPath } = ctx;
  const { clipboard } = require('electron');

  const fixture = userDir('menu-check.md');
  fs.writeFileSync(fixture, '# Menu\n\nalpha beta gamma\n\n[site](https://example.com)\n', 'utf8');

  const labels = () => js(`[...document.querySelectorAll('#ctx-menu:not(.hidden) .ctx-item')].map(function(r){return r.textContent;})`);
  const clickItem = (label) => js(`(function(){var r=[...document.querySelectorAll('#ctx-menu .ctx-item')].find(function(x){return x.textContent===${JSON.stringify(label)};});if(r)r.click();return !!r;})()`);
  // Right click at the middle of the first element matching a selector, as a
  // real contextmenu event with coordinates.
  const rightClick = (selector) => js(`(function(){var el=activePane().el.querySelector(${JSON.stringify(selector)});if(!el)return false;var b=el.getBoundingClientRect();el.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:b.left+8,clientY:b.top+b.height/2,button:2}));return true;})()`);
  const selectWord = (word) => js(`(function(){var root=activePane().el.querySelector('.vditor-ir .vditor-reset');var wk=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);var n;while((n=wk.nextNode())){var i=n.nodeValue.indexOf(${JSON.stringify(word)});if(i!==-1){var r=document.createRange();r.setStart(n,i);r.setEnd(n,i+${word.length});var s=getSelection();s.removeAllRanges();s.addRange(r);return true;}}return false;})()`);

  try {
    await openPath(fixture);
    await until(`activePane()&&activePane().path===${JSON.stringify(fixture)}&&!!activePane().el.querySelector('.vditor-ir .vditor-reset p')`);
    await js(`activePane().vditor.focus();getSelection().removeAllRanges()`);

    await rightClick('.vditor-ir .vditor-reset p');
    const plain = await labels();
    check(
      'editor menu: a right click in the text opens the app menu with paste, select all, find and export, and no copy without a selection',
      plain.includes('paste') && plain.includes('select all') && plain.includes('find in note') && !plain.includes('copy') && !plain.includes('cut') &&
        plain.includes('export as PDF') && plain.includes('export as HTML'),
      JSON.stringify(plain)
    );
    await js(`document.body.dispatchEvent(new MouseEvent('mousedown',{bubbles:true}))`);
    check('editor menu: a click outside closes it', await until(`document.getElementById('ctx-menu').classList.contains('hidden')`));

    await selectWord('beta');
    await rightClick('.vditor-ir .vditor-reset p');
    const picked = await labels();
    const cli = (await js('config.aiCliCommand')) || 'claude';
    check(
      'editor menu: with a selection it offers cut, copy and sending the selection to the configured AI CLI',
      picked.includes('cut') && picked.includes('copy') && picked.includes('send selection to ' + cli),
      JSON.stringify(picked)
    );
    clipboard.writeText('before-copy');
    await clickItem('copy');
    let copied = '';
    for (let i = 0; i < 40 && copied !== 'beta'; i++) {
      await sleep(50);
      copied = clipboard.readText();
    }
    check('editor menu: copy puts the selection on the system clipboard', copied === 'beta', copied);

    // Paste at the end of the paragraph: a real paste event, through Vditor.
    clipboard.writeText(' pasted-e2e');
    await js(`(function(){var p=activePane().el.querySelector('.vditor-ir .vditor-reset p');var n=p.lastChild;while(n&&n.nodeType!==3)n=n.lastChild||n.previousSibling;var r=document.createRange();r.setStart(n,n.nodeValue.length);r.collapse(true);var s=getSelection();s.removeAllRanges();s.addRange(r);})()`);
    await rightClick('.vditor-ir .vditor-reset p');
    // A real mouse click on the row: mousedown included, which is what used to
    // take the focus away from the editor before the paste.
    const row = await js(`(function(){var r=[...document.querySelectorAll('#ctx-menu .ctx-item')].find(function(x){return x.textContent==='paste';});if(!r)return null;var b=r.getBoundingClientRect();return {x:Math.round(b.left+b.width/2),y:Math.round(b.top+b.height/2)};})()`);
    if (row) {
      win.focus();
      win.webContents.sendInputEvent({ type: 'mouseDown', x: row.x, y: row.y, button: 'left', clickCount: 1 });
      win.webContents.sendInputEvent({ type: 'mouseUp', x: row.x, y: row.y, button: 'left', clickCount: 1 });
    }
    // Chromium drops the leading space of a paste at the end of a text run.
    const pasted = await until(`/gamma ?pasted-e2e/.test(activePane().vditor.getValue())&&activePane().dirty`);
    check('editor menu: paste inserts the clipboard text at the caret and marks the note unsaved', pasted && (await js('activePane().dirty')), JSON.stringify(await js(`({v:activePane().vditor.getValue(),ae:document.activeElement.className,sel:String(getSelection().anchorNode&&getSelection().anchorNode.nodeValue)})`)));

    await rightClick('.vditor-ir [data-type="a"]');
    const onLink = await labels();
    check('editor menu: on a link it adds open link and copy link address', onLink.includes('open link') && onLink.includes('copy link address'), JSON.stringify(onLink));
    await js(`document.body.dispatchEvent(new MouseEvent('mousedown',{bubbles:true}))`);
  } finally {
    await js(`(function(){var p=panes.find(function(x){return x.path===${JSON.stringify(fixture)};});if(p){setPaneDirty(p,false);closePane(p);}})()`);
    await forget(['menu-check.md']);
    fs.rmSync(fixture, { force: true });
    await openPath(demoPath);
  }
}

module.exports = { run };

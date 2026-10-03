// Links that go somewhere, images that render, pasting and dropping an image.
// External URLs never reach a real browser here: in the test env main records
// them in assets.externalLog instead of calling shell.openExternal.
const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFklEQVR4nGP8z8Dwn4GBgYEBRABTAwBnJgP1NfJHqAAAAABJRU5ErkJggg==';

async function run(ctx) {
  const { js, sleep, check, fs, path, userDir, openPath, win, app, forget, demoPath } = ctx;
  const assetsMod = require(path.join(app.getAppPath(), 'src', 'main', 'ipc', 'assets.js'));
  const png = Buffer.from(PNG_B64, 'base64');
  const dir = userDir('links-check');
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(path.join(dir, 'assets'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'assets', 'pic.png'), png);

  const filler = Array.from({ length: 60 }, (_, i) => 'Filler paragraph number ' + i + '.').join('\n\n');
  const noteA = path.join(dir, 'a.md');
  const noteB = path.join(dir, 'b.md');
  const mdA = '# Top\n\n[ext](https://example.com/x) [mail](mailto:me@example.com) [rel](b.md#second-part) [anc](#later-section) [gone](nope.md) [js](javascript:alert(1))\n\n![x](assets/pic.png)\n\n' + filler + '\n\n## Later section\n\nEnd.\n\n' + filler + '\n';
  fs.writeFileSync(noteA, mdA);
  fs.writeFileSync(noteB, '# B\n\n' + filler + '\n\n## Second part\n\nTarget.\n\n' + filler + '\n');

  const waitFor = async (fn, ceiling) => {
    const t0 = Date.now();
    while (Date.now() - t0 < (ceiling || 4000)) {
      if (await fn()) return true;
      await sleep(80);
    }
    return false;
  };
  const ctrlClickLink = async (text) => {
    const pt = await js(`(() => {
      const e = [...activePane().el.querySelectorAll('.vditor-ir [data-type="a"] .vditor-ir__link')].find((x) => x.textContent === ${JSON.stringify(text)});
      if (!e) return null;
      e.scrollIntoView({ block: 'center' });
      const b = e.getBoundingClientRect();
      return { x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height / 2) };
    })()`);
    if (!pt) return false;
    await sleep(100);
    win.focus();
    const base = { x: pt.x, y: pt.y, button: 'left', clickCount: 1, modifiers: ['control'] };
    win.webContents.sendInputEvent({ type: 'mouseMove', x: pt.x, y: pt.y, modifiers: ['control'] });
    win.webContents.sendInputEvent(Object.assign({ type: 'mouseDown' }, base));
    win.webContents.sendInputEvent(Object.assign({ type: 'mouseUp' }, base));
    await sleep(250);
    return true;
  };
  const headingNearTop = (text) => js(`(() => {
    const ir = activePane().el.querySelector('.pane-editor');
    const h = [...ir.querySelectorAll('h1,h2,h3,h4,h5,h6')].find((x) => x.textContent.includes(${JSON.stringify(text)}));
    if (!h) return false;
    const r = h.getBoundingClientRect(), v = ir.getBoundingClientRect();
    return r.top >= v.top - 4 && r.top < v.top + v.height / 2;
  })()`);
  const resetScroll = () => js(`(() => { const h = activePane().el.querySelector('.vditor-ir h1'); const c = scrollContainerOf(h, activePane()); if (c) c.scrollTop = 0; })()`);
  const status = () => js(`(() => { const s = activePane().el.querySelector(':scope > .pane-status'); return s ? s.textContent : ''; })()`);

  await openPath(noteA);
  await js('activePane().vditor.focus()');

  // --- link ink follows the theme, not Vditor's fixed #4285f4 ---
  const ink = await js(`(() => {
    const e = activePane().el.querySelector('.vditor-ir [data-type="a"] .vditor-ir__link');
    const probe = document.createElement('span');
    probe.style.color = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
    document.body.appendChild(probe);
    const want = getComputedStyle(probe).color;
    probe.remove();
    return e ? { got: getComputedStyle(e).color, want } : null;
  })()`);
  check('links: the link text takes the theme accent', !!ink && ink.got === ink.want && ink.got !== 'rgb(66, 133, 244)', JSON.stringify(ink));

  // --- navigation safety ---
  const home = win.webContents.getURL();
  await js(`setTimeout(() => { location.href = 'https://example.com/away'; }, 0)`);
  await sleep(700);
  const afterWeb = win.webContents.getURL();
  await js(`setTimeout(() => { location.href = 'file:///C:/Windows/win.ini'; }, 0)`);
  await sleep(700);
  check('navigation: the window never leaves index.html (https and file targets)', afterWeb === home && win.webContents.getURL() === home, win.webContents.getURL());

  const windowsBefore = require('electron').BrowserWindow.getAllWindows().length;
  assetsMod.externalLog.length = 0;
  await js(`void window.open('https://example.com/w', '_blank')`);
  await js(`void window.open('file:///C:/Windows/win.ini', '_blank')`);
  await js(`void window.open('javascript:alert(1)', '_blank')`);
  await sleep(500);
  check('navigation: window.open opens no window and hands only https to the browser',
    require('electron').BrowserWindow.getAllWindows().length === windowsBefore &&
      assetsMod.externalLog.length === 1 && assetsMod.externalLog[0] === 'https://example.com/w', JSON.stringify(assetsMod.externalLog));
  check('navigation: openExternal refuses file:, javascript: and garbage',
    !assetsMod.openExternal('file:///C:/Windows/win.ini') && !assetsMod.openExternal('javascript:alert(1)') && !assetsMod.openExternal('not a url') && assetsMod.externalLog.length === 1);

  // --- relative image, Markdown untouched ---
  check('images: a relative image renders (naturalWidth > 0)',
    await waitFor(() => js(`(() => { const i = activePane().el.querySelector('.vditor-ir img'); return !!i && i.complete && i.naturalWidth > 0; })()`)),
    await js(`(() => { const i = activePane().el.querySelector('.vditor-ir img'); return i ? i.src : 'no img'; })()`));
  check('images: the Markdown keeps the relative path and the note stays clean',
    await js(`activePane().vditor.getValue().includes('![x](assets/pic.png)') && !activePane().dirty`));

  // --- link tooltip ---
  const tip = await js(`(() => {
    const n = activePane().el.querySelector('.vditor-ir [data-type="a"]');
    n.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    return n.title;
  })()`);
  check('links: the tooltip says Ctrl+click to open', tip === 'Ctrl+click to open', tip);

  // --- external links ---
  assetsMod.externalLog.length = 0;
  check('links: Ctrl+click on an https link hands it to the browser',
    await ctrlClickLink('ext') && await waitFor(() => assetsMod.externalLog.includes('https://example.com/x'), 2000), JSON.stringify(assetsMod.externalLog));
  check('links: Ctrl+click on a mailto link hands it to the browser',
    await ctrlClickLink('mail') && await waitFor(() => assetsMod.externalLog.includes('mailto:me@example.com'), 2000), JSON.stringify(assetsMod.externalLog));
  const logged = assetsMod.externalLog.length;
  // Vditor may refuse to render a javascript: link at all, so follow it directly.
  await js(`void window.wiredLinks.followLink(activePane(), 'javascript:alert(1)')`);
  await sleep(200);
  check('links: a javascript: link goes nowhere and says so inline',
    assetsMod.externalLog.length === logged && (await status()).length > 0, await status());
  await js(`activePane().el.querySelector(':scope > .pane-status') && activePane().el.querySelector(':scope > .pane-status').remove()`);

  // --- a plain click does not follow anything ---
  const before = assetsMod.externalLog.length;
  await js(`(() => { const e = [...activePane().el.querySelectorAll('.vditor-ir [data-type="a"] .vditor-ir__link')].find((x) => x.textContent === 'ext'); e.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); })()`);
  await sleep(250);
  check('links: a plain click does not open the link', assetsMod.externalLog.length === before);

  // --- anchors and notes ---
  await resetScroll();
  await resetScroll();
  check('links: Ctrl+click on #anchor scrolls to the heading in the same note',
    await ctrlClickLink('anc') && await waitFor(() => headingNearTop('Later section'), 3000));
  await resetScroll();
  check('links: a missing note shows an inline status and no popup',
    await ctrlClickLink('gone') && await waitFor(async () => /not found/i.test(await status()), 2000), await status());
  if (process.env.WIRED_LINKS_SHOT) {
    // Opt in screenshots of the status row and the image: dark and light, wide and narrow.
    const keep = await js('config.theme');
    const shot = async (name) => {
      await js(`void window.wiredLinks.paneStatus(activePane(), 'Note not found: C:\\\\notes\\\\nope.md')`);
      await sleep(400);
      fs.writeFileSync(path.join(process.env.WIRED_LINKS_SHOT, name + '.png'), (await win.webContents.capturePage()).toPNG());
    };
    const [w, h] = win.getContentSize();
    await js('window.scrollTo(0,0)');
    await resetScroll();
    for (const [theme, size] of [['wired', [w, h]], ['light', [w, h]], ['wired', [900, 700]], ['light', [900, 700]]]) {
      await js(`void applyTheme(${JSON.stringify(theme)})`);
      win.setContentSize(size[0], size[1]);
      await sleep(500);
      await shot(theme + '-' + size[0]);
    }
    win.setContentSize(w, h);
    await js(`void applyTheme(${JSON.stringify(keep)})`);
  }
  await js(`activePane().el.querySelector(':scope > .pane-status') && activePane().el.querySelector(':scope > .pane-status').remove()`);
  await ctrlClickLink('rel');
  const opened = await waitFor(() => js(`activePane().path && activePane().path.endsWith('b.md')`), 3000);
  check('links: Ctrl+click on a relative .md link opens it in a tab', opened && await js(`panes.some((p) => p.path && p.path.endsWith('a.md'))`));
  check('links: the #heading suffix scrolls the opened note to that heading', await waitFor(() => headingNearTop('Second part'), 3000));

  // --- paste ---
  await openPath(noteA);
  await js('activePane().vditor.focus()');
  await js(`(() => {
    const bytes = Uint8Array.from(atob(${JSON.stringify(PNG_B64)}), (c) => c.charCodeAt(0));
    const dt = new DataTransfer();
    dt.items.add(new File([bytes], 'image.png', { type: 'image/png' }));
    const target = activePane().el.querySelector('.vditor-ir .vditor-reset');
    target.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  })()`);
  const pastedOk = await waitFor(() => js(`/!\\[\\]\\(assets\\/a-\\d{8}-\\d{6}(-\\d+)?\\.png\\)/.test(activePane().vditor.getValue())`), 4000);
  const files = fs.readdirSync(path.join(dir, 'assets')).filter((f) => /^a-\d{8}-\d{6}(-\d+)?\.png$/.test(f));
  check('paste: an image on the clipboard is linked at the caret', pastedOk && await js('activePane().dirty'), await js('activePane().vditor.getValue().slice(-200)'));
  check('paste: the file lands in assets/ next to the note, byte for byte',
    files.length === 1 && fs.readFileSync(path.join(dir, 'assets', files[0])).equals(png), JSON.stringify(files));
  check('paste: the inserted image renders',
    await waitFor(() => js(`[...activePane().el.querySelectorAll('.vditor-ir img')].some((i) => i.src.includes('/assets/a-') && i.naturalWidth > 0)`), 3000));
  const second = assetsMod.savePasted(noteA, 'image/png', png);
  const third = assetsMod.savePasted(noteA, 'image/png', png);
  check('paste: an existing asset is never overwritten', second.ok && third.ok && second.path !== third.path && fs.existsSync(second.path) && fs.existsSync(third.path));
  check('paste: only images count (unknown types are refused)', !assetsMod.savePasted(noteA, 'application/x-evil', png).ok && !assetsMod.savePasted('relative.md', 'image/png', png).ok);

  // --- paste into an untitled note ---
  await js('void newFile()');
  await sleep(900);
  await js(`(() => {
    const dt = new DataTransfer();
    dt.items.add(new File([new Uint8Array([1])], 'image.png', { type: 'image/png' }));
    const p = activePane();
    p.el.querySelector('.vditor-ir .vditor-reset').dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  })()`);
  check('paste: an untitled note shows an inline hint to save first',
    await waitFor(async () => /save the note first/i.test(await status()), 2000) && await js(`activePane().vditor.getValue().trim() === ''`), await status());
  await js(`(() => { const p = activePane(); setPaneDirty(p, false); closePane(p); })()`);
  await sleep(300);

  // --- drop ---
  await openPath(noteA);
  await js(`void window.wiredLinks.handleDroppedFiles([new File(['# C'], 'b.md', { type: '' })], () => ${JSON.stringify(noteB)}, activePane())`);
  check('drop: a dropped .md file opens in a tab instead of becoming text',
    await waitFor(() => js(`activePane().path && activePane().path.endsWith('b.md')`), 3000) && await js(`!activePane().vditor.getValue().includes('# C')`));
  await openPath(noteA);
  const filesBefore = fs.readdirSync(path.join(dir, 'assets')).length;
  await js(`void window.wiredLinks.handleDroppedFiles([new File([Uint8Array.from(atob(${JSON.stringify(PNG_B64)}), (c) => c.charCodeAt(0))], 'dropped.png', { type: 'image/png' })], () => '', activePane())`);
  check('drop: a dropped image is saved next to the note and linked',
    await waitFor(() => fs.readdirSync(path.join(dir, 'assets')).length === filesBefore + 1, 3000));

  // --- the real dragover keeps the browser from opening the file ---
  const prevented = await js(`(() => {
    const dt = new DataTransfer();
    dt.items.add(new File(['x'], 'x.md'));
    const ev = new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true });
    document.getElementById('panes').dispatchEvent(ev);
    return ev.defaultPrevented;
  })()`);
  check('drop: dragging a file over the window is accepted (no navigation)', prevented === true);

  // forget() closes ONE pane per key, and this check leaves several notes of
  // its folder open (a.md, b.md). A survivor would put the deleted folder back
  // at the tree root the next time a later check closes a tab.
  await js(`[...panes].filter((x) => x.path && x.path.indexOf('links-check') !== -1).forEach((x) => { setPaneDirty(x, false); closePane(x); })`);
  await forget(['links-check']);
  await openPath(demoPath);
  fs.rmSync(dir, { recursive: true, force: true });
}

module.exports = { run };

// New file from a template: the picker, the variables resolved on disk, a
// template dropped in the folder while the app runs, cancelling without leaving
// anything behind, and both entry points.

async function run(ctx) {
  const { js, sleep, check, fs, path, forget, openPath, userDir, demoPath, rootDir } = ctx;

  const templatesDir = userDir('templates');
  await js('selectedDir = null'); // earlier clicks pointed at folders already deleted

  await js(`(function(){openPalette('commands');var i=document.getElementById('palette-input');i.value='template';i.dispatchEvent(new Event('input'));})()`);
  await sleep(250);
  const action = await js(`(function(){var r=document.querySelector('#palette-list .palette-row.selected .palette-label');return r?r.textContent:null;})()`);
  await js(`document.getElementById('palette-input').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))`);
  await sleep(600);
  const picker = await js(
    `(function(){var o=document.getElementById('template-overlay');return {open:!o.classList.contains('hidden'),items:[...document.querySelectorAll('#template-list .palette-row .palette-label')].map(function(l){return l.textContent;}),sel:(document.querySelector('#template-list .palette-row.selected .palette-label')||{}).textContent};})()`
  );
  await js(`(function(){window.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown'}));window.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown'}));})()`);
  await sleep(200);
  const afterArrows = await js(`(document.querySelector('#template-list .palette-row.selected .palette-label')||{}).textContent`);
  const items = (picker && picker.items) || [];
  // The four seeded templates must be there. The assertion is a superset, not an
  // exact list: this reads the user's real templates folder, which may hold
  // their own files (and files from older versions of the app).
  const seeded = ['claude-md', 'note', 'skill', 'subagent'].every((n) => items.includes(n));
  check(
    'template: the palette action opens the picker with the four seeded templates and the arrows navigate',
    action === 'new from template' && !!picker && picker.open && seeded && items.length >= 4 && afterArrows === items[2] && items[2] !== items[0],
    JSON.stringify({ action, items, afterArrows })
  );

  const noteTpl = path.join(rootDir, 'note-tpl-e2e.md');
  await js(
    `(function(){var rows=[...document.querySelectorAll('#template-list .palette-row')];var i=rows.findIndex(function(r){return r.querySelector('.palette-label').textContent==='note';});templateSel=i;window.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter'}));})()`
  );
  await sleep(500);
  const askedName = await js(
    `(function(){return {open:!document.getElementById('input-overlay').classList.contains('hidden'),title:document.getElementById('input-title').textContent};})()`
  );
  await js(`(function(){var i=document.getElementById('input-field');i.value='note-tpl-e2e.md';document.getElementById('input-ok').click();})()`);
  await sleep(1800);
  const written = fs.existsSync(noteTpl) ? fs.readFileSync(noteTpl, 'utf8') : '';
  const now = new Date();
  const two = (n) => String(n).padStart(2, '0');
  const today = now.getFullYear() + '-' + two(now.getMonth() + 1) + '-' + two(now.getDate());
  const openedPath = await js('currentPath');
  const caret = await js(
    `(function(){var ed=document.querySelector('#panes .pane.active .vditor-ir');var s=window.getSelection();return {inside:!!ed&&!!s.anchorNode&&ed.contains(s.anchorNode),collapsed:s.isCollapsed};})()`
  );
  check(
    'template: note.md resolves {{date}}, {{title}} and {{folder}}, drops the {{cursor}} marker and opens in the active pane',
    written.indexOf('# note-tpl-e2e') === 0 &&
      written.includes(today) &&
      written.includes('in ' + path.basename(rootDir) + '.') &&
      !/\{\{/.test(written) &&
      written.indexOf(String.fromCharCode(0xe000)) === -1 &&
      openedPath === noteTpl &&
      !!askedName && askedName.open && /new from note/.test(askedName.title) &&
      !!caret && caret.inside,
    JSON.stringify({ written: written.slice(0, 120), openedPath, caret, askedName })
  );

  const tempTpl = path.join(templatesDir, 'e2e-template.md');
  fs.writeFileSync(
    tempTpl,
    '# {{title}}\n\nauthor: {{ask:who writes}}\nreviewer: {{ask:who writes}}\nmarker: {{something-the-app-does-not-know}}\n\n{{cursor}}\n',
    'utf8'
  );
  const askTpl = path.join(rootDir, 'ask-tpl-e2e.md');
  await js(`void newFromTemplate()`);
  await sleep(700);
  const reread = await js(`[...document.querySelectorAll('#template-list .palette-row .palette-label')].map(function(l){return l.textContent;})`);
  await js(
    `(function(){var rows=[...document.querySelectorAll('#template-list .palette-row')];var i=rows.findIndex(function(r){return r.querySelector('.palette-label').textContent==='e2e-template';});templateSel=i;window.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter'}));})()`
  );
  await sleep(500);
  await js(`(function(){var i=document.getElementById('input-field');i.value='ask-tpl-e2e.md';document.getElementById('input-ok').click();})()`);
  await sleep(600);
  const asked = await js(
    `(function(){return {open:!document.getElementById('input-overlay').classList.contains('hidden'),title:document.getElementById('input-title').textContent};})()`
  );
  await js(`(function(){var i=document.getElementById('input-field');i.value='someone from the e2e';document.getElementById('input-ok').click();})()`);
  await sleep(1800);
  const askWritten = fs.existsSync(askTpl) ? fs.readFileSync(askTpl, 'utf8') : '';
  check(
    'template: the folder is re-read live, {{ask:...}} is asked once and substituted everywhere, an unknown marker stays intact',
    Array.isArray(reread) && reread.indexOf('e2e-template') !== -1 &&
      !!asked && asked.open && asked.title === 'who writes' &&
      /author: someone from the e2e/.test(askWritten) && /reviewer: someone from the e2e/.test(askWritten) &&
      askWritten.includes('{{something-the-app-does-not-know}}') && !/\{\{cursor\}\}/.test(askWritten),
    JSON.stringify({ reread, asked, askWritten: askWritten.slice(0, 160) })
  );

  const abortedTpl = path.join(rootDir, 'aborted-tpl-e2e.md');
  await js(`void newFromTemplate()`);
  await sleep(700);
  await js(
    `(function(){var rows=[...document.querySelectorAll('#template-list .palette-row')];var i=rows.findIndex(function(r){return r.querySelector('.palette-label').textContent==='e2e-template';});templateSel=i;window.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter'}));})()`
  );
  await sleep(500);
  await js(`(function(){var i=document.getElementById('input-field');i.value='aborted-tpl-e2e.md';document.getElementById('input-ok').click();})()`);
  await sleep(600);
  await js(`document.getElementById('input-field').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);
  await sleep(900);
  const aborted = !fs.existsSync(abortedTpl);
  const dialogClosed = await js(`document.getElementById('input-overlay').classList.contains('hidden')`);
  await js(`void newFromTemplate()`);
  await sleep(700);
  await js(`window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}))`);
  await sleep(500);
  const pickerClosed = await js(
    `(function(){return {tpl:document.getElementById('template-overlay').classList.contains('hidden'),name:document.getElementById('input-overlay').classList.contains('hidden')};})()`
  );
  check(
    'template: Esc at the question creates no file at all, and Esc in the picker cancels the flow',
    aborted && dialogClosed === true && !!pickerClosed && pickerClosed.tpl && pickerClosed.name,
    JSON.stringify({ aborted, dialogClosed, pickerClosed })
  );

  const subTpl = path.join(rootDir, 'sub-tpl-e2e');
  fs.mkdirSync(subTpl, { recursive: true });
  fs.writeFileSync(path.join(subTpl, 'note.md'), '# sub tpl\n', 'utf8');
  await sleep(1400);
  await js(
    `(function(){var rows=[...document.querySelectorAll('#file-tree .tree-row.folder')];var r=rows.find(function(x){return x.querySelector('.tree-name').textContent==='sub-tpl-e2e';});if(r)r.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,clientX:200,clientY:200}));})()`
  );
  await sleep(300);
  const folderMenu = await js(
    `(function(){var m=document.getElementById('ctx-menu');if(m.classList.contains('hidden'))return null;return [...m.querySelectorAll('.ctx-item')].map(function(i){return i.textContent;});})()`
  );
  await js(`hideCtxMenu()`);
  const toolbarBtn = await js(
    `(function(){var b=document.getElementById('btn-tree-template');return !!b&&!!b.querySelector('svg')&&(b.title||'').length>0&&!!document.getElementById('tree-toolbar')&&document.getElementById('tree-toolbar').contains(b);})()`
  );
  check(
    'template: button in the sidebar toolbar and "new from template here" in the folder context menu',
    toolbarBtn === true && Array.isArray(folderMenu) && folderMenu.indexOf('new from template here') === folderMenu.indexOf('new .md file here') + 1,
    JSON.stringify({ toolbarBtn, folderMenu })
  );

  await openPath(demoPath);
  await forget(['note-tpl-e2e', 'ask-tpl-e2e']);
  fs.rmSync(noteTpl, { force: true });
  fs.rmSync(askTpl, { force: true });
  fs.rmSync(tempTpl, { force: true });
  fs.rmSync(subTpl, { recursive: true, force: true });
  await sleep(900);
}

module.exports = { run };

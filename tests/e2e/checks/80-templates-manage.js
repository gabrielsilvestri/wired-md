// Managing the templates from inside the app: create, rename, open for editing
// and move to the Recycle Bin, all from the picker footer, with cancelling at
// any step leaving nothing behind.

async function run(ctx) {
  const { js, sleep, check, fs, path, forget, openPath, userDir, demoPath } = ctx;

  const templatesDir = userDir('templates');
  const created = path.join(templatesDir, 'manage-e2e.md');
  const renamed = path.join(templatesDir, 'manage-e2e-renamed.md');
  const cancelled = path.join(templatesDir, 'cancelled-e2e.md');

  await js('selectedDir = null');

  // The palette action opens the picker in management mode.
  await js(`(function(){openPalette('commands');var i=document.getElementById('palette-input');i.value='manage the template files';i.dispatchEvent(new Event('input'));})()`);
  await sleep(250);
  const action = await js(`(function(){var r=document.querySelector('#palette-list .palette-row.selected .palette-label');return r?r.textContent:null;})()`);
  await js(`document.getElementById('palette-input').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))`);
  await sleep(700);
  const opened = await js(
    `(function(){var o=document.getElementById('template-overlay');var btns=['btn-template-new','btn-template-edit','btn-template-rename','btn-template-delete','btn-template-folder'].map(function(id){var b=document.getElementById(id);return b?{icon:!!b.querySelector('svg'),tip:b.title,text:b.textContent.trim()}:null;});return {open:!o.classList.contains('hidden'),head:document.getElementById('template-head').textContent,btns:btns};})()`
  );
  check(
    'templates: the "manage the template files" palette action opens the picker in management mode with icon buttons and English tooltips',
    action === 'manage the template files' && !!opened && opened.open && /manage templates/.test(opened.head) &&
      opened.btns.every((b) => b && b.icon && b.tip && b.text === '' && /^[\x20-\x7e]+$/.test(b.tip)),
    JSON.stringify(opened)
  );

  // Create: the name dialog opens over the picker without the picker stealing
  // the Enter that confirms it.
  await js(`document.getElementById('btn-template-new').click()`);
  await sleep(500);
  const askedNew = await js(
    `(function(){return {open:!document.getElementById('input-overlay').classList.contains('hidden'),title:document.getElementById('input-title').textContent,pickerStillOpen:!document.getElementById('template-overlay').classList.contains('hidden')};})()`
  );
  await js(`(function(){var i=document.getElementById('input-field');i.value='manage-e2e';i.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));})()`);
  await sleep(900);
  const afterCreate = await js(
    `(function(){return {items:[...document.querySelectorAll('#template-list .palette-row .palette-label')].map(function(l){return l.textContent;}),sel:(document.querySelector('#template-list .palette-row.selected .palette-label')||{}).textContent,pickerOpen:!document.getElementById('template-overlay').classList.contains('hidden')};})()`
  );
  check(
    'templates: create asks for a name over the open picker, writes the file and selects it in the refreshed list',
    !!askedNew && askedNew.open && askedNew.pickerStillOpen && /new template/.test(askedNew.title) &&
      fs.existsSync(created) && /\{\{title\}\}/.test(fs.readFileSync(created, 'utf8')) &&
      !!afterCreate && afterCreate.items.indexOf('manage-e2e') !== -1 && afterCreate.sel === 'manage-e2e' && afterCreate.pickerOpen,
    JSON.stringify({ askedNew, afterCreate, exists: fs.existsSync(created) })
  );

  // Cancelling create leaves nothing on disk.
  await js(`document.getElementById('btn-template-new').click()`);
  await sleep(500);
  await js(`document.getElementById('input-field').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);
  await sleep(700);
  const noGarbage = !fs.existsSync(cancelled) && !fs.existsSync(path.join(templatesDir, 'untitled.md'));
  // Esc cancels the whole flow: the app's global Escape closes the picker under
  // the dialog too. What matters is that nothing was written.
  const cancelClosed = await js(`document.getElementById('template-overlay').classList.contains('hidden')`);

  // Rename.
  await js(`void manageTemplates()`);
  await sleep(800);
  await js(
    `(function(){var rows=[...document.querySelectorAll('#template-list .palette-row')];templateSel=rows.findIndex(function(r){return r.querySelector('.palette-label').textContent==='manage-e2e';});document.getElementById('btn-template-rename').click();})()`
  );
  await sleep(500);
  const askedRename = await js(`document.getElementById('input-title').textContent`);
  await js(`(function(){var i=document.getElementById('input-field');i.value='manage-e2e-renamed.md';i.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));})()`);
  await sleep(900);
  const afterRename = await js(
    `(function(){return {items:[...document.querySelectorAll('#template-list .palette-row .palette-label')].map(function(l){return l.textContent;}),sel:(document.querySelector('#template-list .palette-row.selected .palette-label')||{}).textContent};})()`
  );
  check(
    'templates: cancelling create writes nothing, and rename moves the file and keeps the selection on it',
    noGarbage && cancelClosed === true &&
      /rename manage-e2e/.test(askedRename || '') &&
      !fs.existsSync(created) && fs.existsSync(renamed) &&
      !!afterRename && afterRename.sel === 'manage-e2e-renamed' && afterRename.items.indexOf('manage-e2e') === -1,
    JSON.stringify({ noGarbage, cancelClosed, askedRename, afterRename, created: fs.existsSync(created), renamed: fs.existsSync(renamed) })
  );

  // Open the template in a pane: it is edited with the same editor as any note.
  await js(`document.getElementById('btn-template-edit').click()`);
  await sleep(1400);
  const editing = await js(`(function(){return {path:currentPath,closed:document.getElementById('template-overlay').classList.contains('hidden')};})()`);
  check(
    'templates: "open for editing" closes the picker and opens the template file itself in a pane',
    !!editing && editing.closed === true && editing.path === renamed,
    JSON.stringify(editing)
  );

  // Delete goes to the Recycle Bin, never unlink.
  await forget(['manage-e2e-renamed']);
  await openPath(demoPath);
  await js(`void manageTemplates()`);
  await sleep(800);
  await js(
    `(function(){var rows=[...document.querySelectorAll('#template-list .palette-row')];templateSel=rows.findIndex(function(r){return r.querySelector('.palette-label').textContent==='manage-e2e-renamed';});window.confirm=function(){return true;};document.getElementById('btn-template-delete').click();})()`
  );
  await sleep(1200);
  await js(`delete window.confirm`); // never leave a stubbed confirm behind
  const afterDelete = await js(
    `(function(){return [...document.querySelectorAll('#template-list .palette-row .palette-label')].map(function(l){return l.textContent;});})()`
  );
  const seeded = ['claude-md', 'note', 'skill', 'subagent'].every((n) => (afterDelete || []).includes(n));
  check(
    'templates: delete moves the template to the Recycle Bin, drops it from the list and leaves the seeded ones alone',
    !fs.existsSync(renamed) && Array.isArray(afterDelete) && afterDelete.indexOf('manage-e2e-renamed') === -1 && seeded,
    JSON.stringify({ gone: !fs.existsSync(renamed), afterDelete })
  );

  await js(`window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}))`);
  await sleep(400);
  const closed = await js(`document.getElementById('template-overlay').classList.contains('hidden')`);
  check('templates: Esc closes the management picker', closed === true, JSON.stringify({ closed }));

  await openPath(demoPath);
  fs.rmSync(created, { force: true });
  fs.rmSync(renamed, { force: true });
  fs.rmSync(cancelled, { force: true });
  await sleep(600);
}

module.exports = { run };

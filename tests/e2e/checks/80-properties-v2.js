// Properties panel v2: renaming a key in place and adding one of each kind,
// with order, comments, unknown keys and nested maps coming back untouched, and
// the schema keys offered first in the add row.

async function run(ctx) {
  const { js, sleep, check, fs, path, forget, openPath, demoPath, rootDir } = ctx;

  // The panel toggles and persists, so a run has to start from a known state.
  await js('toggleFrontmatterPanel(true)');
  await sleep(300);

  const source = fs.readFileSync(path.join(rootDir, 'tables-v1.md'), 'utf8');
  const work = path.join(rootDir, 'props-v2-e2e.md');
  fs.writeFileSync(work, source, 'utf8');
  await sleep(1200);
  await openPath(work);
  await sleep(800);

  // --- renaming a key ---
  const renameUi = await js(
    `(function(){var p=document.querySelector('#panes .pane.active .fm-panel');var l=[...p.querySelectorAll('.fm-row .fm-key')].find(function(x){return x.textContent==='published';});if(!l)return null;var tip=l.title;l.click();var i=p.querySelector('.fm-row input.fm-key-input');return {tip:tip,opened:!!i,value:i?i.value:null};})()`
  );
  await sleep(200);
  await js(
    `(function(){var i=document.querySelector('#panes .pane.active .fm-panel input.fm-key-input');i.value='is-published';i.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));})()`
  );
  await sleep(800);
  const renamed = await js(
    `(function(){var p=document.querySelector('#panes .pane.active .fm-panel');return {keys:[...p.querySelectorAll('.fm-row .fm-key')].map(function(l){return l.textContent;}),value:activePane().vditor.getValue(),dirty:dirty};})()`
  );
  const raw = (renamed && renamed.value) || '';
  check(
    'properties: clicking a key renames it in place, keeping order, the comment, the unknown key and the nested map',
    !!renameUi && renameUi.opened && renameUi.value === 'published' && /click to rename/.test(renameUi.tip) &&
      !!renamed && renamed.keys.join(',') === 'name,description,tools,is-published,meta' && renamed.dirty === true &&
      /# comment that must survive a rename/.test(raw) &&
      /is-published: false/.test(raw) && !/\npublished:/.test(raw) &&
      /meta:\n {2}author: biel\n {2}version: 1/.test(raw) &&
      /- Read\n {2}- Write/.test(raw) &&
      /## second section/.test(raw),
    JSON.stringify({ renameUi, keys: renamed && renamed.keys, dirty: renamed && renamed.dirty, head: raw.slice(0, 220) })
  );

  // A name that is already in the block is refused, inline and without a popup.
  await js(
    `(function(){var p=document.querySelector('#panes .pane.active .fm-panel');var l=[...p.querySelectorAll('.fm-row .fm-key')].find(function(x){return x.textContent==='is-published';});l.click();var i=p.querySelector('input.fm-key-input');i.value='name';i.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));})()`
  );
  await sleep(700);
  const clash = await js(
    `(function(){var p=document.querySelector('#panes .pane.active .fm-panel');return {warns:[...p.querySelectorAll('.fm-warn')].map(function(w){return w.textContent;}),keys:[...p.querySelectorAll('.fm-row .fm-key')].map(function(l){return l.textContent;})};})()`
  );
  check(
    'properties: renaming onto a key that is already there is refused in an inline row, and nothing in the block moves',
    !!clash && clash.keys.join(',') === 'name,description,tools,is-published,meta' &&
      clash.warns.some((w) => /already there/.test(w)),
    JSON.stringify(clash)
  );

  // --- adding a key of each kind ---
  const addRow = await js(
    `(function(){var p=document.querySelector('#panes .pane.active .fm-panel');var r=p.querySelector('.fm-add-row');if(!r)return null;var dl=r.querySelector('datalist');return {kinds:[...r.querySelectorAll('.fm-add-kind option')].map(function(o){return o.value+':'+o.textContent;}),suggest:[...dl.querySelectorAll('option')].map(function(o){return o.value;}),btn:!!r.querySelector('.fm-add-btn svg'),tip:r.querySelector('.fm-add-btn').title,schema:(p.querySelector('.fm-schema')||{}).textContent};})()`
  );
  const addOne = (name, kind) =>
    js(
      `(function(){var r=document.querySelector('#panes .pane.active .fm-panel .fm-add-row');r.querySelector('.fm-add-key').value=${JSON.stringify(name)};r.querySelector('.fm-add-kind').value=${JSON.stringify(kind)};r.querySelector('.fm-add-btn').click();})()`
    );
  await addOne('color', 'string');
  await sleep(700);
  await addOne('priority', 'number');
  await sleep(700);
  await addOne('labels', 'list');
  await sleep(700);
  await addOne('draft', 'bool');
  await sleep(700);
  const added = await js(
    `(function(){var p=document.querySelector('#panes .pane.active .fm-panel');return {keys:[...p.querySelectorAll('.fm-row .fm-key')].map(function(l){return l.textContent;}),controls:[...p.querySelectorAll('.fm-row')].map(function(r){var i=r.querySelector('.fm-val');return r.querySelector('.fm-key').textContent+':'+(i?(i.type||'div'):'none');}),value:activePane().vditor.getValue()};})()`
  );
  const addedRaw = (added && added.value) || '';
  check(
    'properties: the add row offers the schema keys first and creates a key of each kind with the empty value of that kind',
    !!addRow && addRow.schema === 'subagent' && addRow.btn === true && addRow.tip === 'Add the key' &&
      addRow.kinds.join(',') === 'string:text,number:number,list:list,bool:boolean' &&
      addRow.suggest[0] === 'model' && addRow.suggest[1] === 'color' &&
      !!added && added.keys.join(',') === 'name,description,tools,is-published,meta,color,priority,labels,draft' &&
      /\ncolor: ""/.test(addedRaw) && /\npriority: 0/.test(addedRaw) && /\nlabels: \[\]/.test(addedRaw) && /\ndraft: false/.test(addedRaw) &&
      /# comment that must survive a rename/.test(addedRaw) &&
      added.controls.indexOf('draft:checkbox') !== -1 && added.controls.indexOf('priority:text') !== -1,
    JSON.stringify({ addRow, keys: added && added.keys, controls: added && added.controls, tail: addedRaw.slice(0, 320) })
  );

  // Saving writes exactly what the panel built, and the body below is untouched.
  await js('void save()');
  await sleep(900);
  const onDisk = fs.readFileSync(work, 'utf8');
  check(
    'properties: the whole v2 round trip survives a save to disk',
    onDisk === addedRaw && /Text above the table, with a price of R\$ 297/.test(onDisk) && /\|\s*Feature\s*\|\s*State\s*\|\s*Note\s*\|/.test(onDisk),
    JSON.stringify({ same: onDisk === addedRaw, len: [onDisk.length, addedRaw.length] })
  );

  await openPath(demoPath);
  await forget(['props-v2-e2e']);
  fs.rmSync(work, { force: true });
  await sleep(800);
}

module.exports = { run };

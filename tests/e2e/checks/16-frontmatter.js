// Frontmatter as a properties panel: it shows up for a file with a YAML block
// and stays away otherwise, edits mark the pane dirty and save to disk, the
// round trip preserves everything, the schema flags real problems, invalid YAML
// degrades to a read only view, and the palette toggle persists.

async function run(ctx) {
  const { js, key, sleep, check, fs, path, win, forget, openPath, readConfigFile, demoPath, rootDir, fixtures } = ctx;

  const fmPath = fixtures.skill;
  const fmOriginal = fs.readFileSync(fmPath, 'utf8');

  // The panel is toggleable and the value persists: start from a known state.
  await js('toggleFrontmatterPanel(true)');
  await sleep(300);

  await openPath(fmPath);
  await sleep(600);
  const seen = await js(
    `(function(){var p=document.querySelector('#panes .pane.active .fm-panel');if(!p)return null;var rows=[...p.querySelectorAll('.fm-row')].map(function(r){var i=r.querySelector('.fm-val');return {k:r.querySelector('.fm-key').textContent,kind:i?i.className:null,v:i&&i.type==='checkbox'?i.checked:(i&&i.value!==undefined?i.value:(i?i.textContent:null))};});return {hidden:p.classList.contains('hidden'),schema:(p.querySelector('.fm-schema')||{}).textContent,rows:rows,warnings:p.querySelectorAll('.fm-warn').length};})()`
  );
  await openPath(demoPath);
  const noFm = await js(`(function(){var p=document.querySelector('#panes .pane.active .fm-panel');return {hidden:!p||p.classList.contains('hidden')};})()`);
  const keys = ((seen && seen.rows) || []).map((l) => l.k).join(',');
  const tools = ((seen && seen.rows) || []).find((l) => l.k === 'tools');
  const bool = ((seen && seen.rows) || []).find((l) => l.k === 'published');
  const meta = ((seen && seen.rows) || []).find((l) => l.k === 'meta');
  check(
    'properties: the panel opens for a file with frontmatter (list, boolean, preserved map) and stays away for one without',
    !!seen && !seen.hidden && keys === 'name,description,tools,model,published,meta' && seen.schema === 'subagent' &&
      !!tools && tools.v === 'Read, Write, Bash' && !!bool && bool.v === false && !!meta && /fm-other/.test(meta.kind) &&
      seen.warnings === 0 && noFm.hidden,
    JSON.stringify({ keys, schema: seen && seen.schema, noFm })
  );

  await openPath(fmPath);
  await sleep(500);
  await js(
    `(function(){var i=[...document.querySelectorAll('#panes .pane.active .fm-row input.fm-val')].find(function(x){return x.dataset.key==='description';});i.value='description changed by the e2e';i.dispatchEvent(new Event('change'));})()`
  );
  await sleep(700);
  const dirty = await js('dirty');
  win.focus();
  key('S', ['control']);
  await sleep(1000);
  const onDisk = fs.readFileSync(fmPath, 'utf8');
  const clean = await js('dirty');
  check(
    'properties: editing a value marks the pane dirty and Ctrl+S writes the frontmatter to disk',
    dirty === true && clean === false && /description: description changed by the e2e/.test(onDisk),
    'dirty=' + dirty + ' clean=' + clean
  );

  check(
    'properties: the round trip preserves the nested map, the comment, key order and the body',
    /meta:\r?\n {2}author: biel\r?\n {2}version: 2/.test(onDisk) &&
      /# comment preserved on round trip/.test(onDisk) &&
      /name: example-skill[\s\S]*description:[\s\S]*tools:[\s\S]*model: sonnet/.test(onDisk) &&
      /## when to use/.test(onDisk) && /- Read\r?\n {2}- Write\r?\n {2}- Bash/.test(onDisk),
    JSON.stringify(onDisk.slice(0, 260))
  );

  fs.writeFileSync(fmPath, fmOriginal, 'utf8');
  await js(`(function(){vditor.setValue(${JSON.stringify(fmOriginal)});setDirty(false);refreshFmPanel(activePane());})()`);
  await sleep(600);

  const skillDir = path.join(rootDir, 'skill-e2e');
  const skillPath = path.join(skillDir, 'SKILL.md');
  fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(skillPath, '---\nname: skill-e2e\ndescribe: this was meant to be description\n---\n# skill e2e\n', 'utf8');
  await sleep(1200);
  await openPath(skillPath);
  await sleep(600);
  const skill = await js(
    `(function(){var p=document.querySelector('#panes .pane.active .fm-panel');if(!p)return null;return {schema:(p.querySelector('.fm-schema')||{}).textContent,warnings:[...p.querySelectorAll('.fm-warn')].map(function(w){return w.textContent;})};})()`
  );
  const skillWarnings = (skill && skill.warnings) || [];
  check(
    'properties: the skill schema flags the missing description and the lookalike key (describe)',
    !!skill && skill.schema === 'skill' && skillWarnings.some((a) => /the description key is missing/.test(a)) && skillWarnings.some((a) => /describe.*typo.*description/.test(a)),
    JSON.stringify(skill)
  );

  const brokenPath = path.join(skillDir, 'broken-e2e.md');
  fs.writeFileSync(brokenPath, '---\nname: [this never closes\ndescription: hi\n---\n# broken\n', 'utf8');
  await sleep(1200);
  await openPath(brokenPath);
  await sleep(600);
  const broken = await js(
    `(function(){var p=document.querySelector('#panes .pane.active .fm-panel');if(!p)return null;return {hidden:p.classList.contains('hidden'),raw:!!p.querySelector('.fm-raw'),fields:p.querySelectorAll('.fm-row input').length,warnings:[...p.querySelectorAll('.fm-warn')].map(function(w){return w.textContent;})};})()`
  );
  check(
    'properties: invalid YAML degrades to a raw read only view with the parser error, no editable fields',
    !!broken && !broken.hidden && broken.raw && broken.fields === 0 && (broken.warnings || []).some((a) => /invalid YAML/.test(a)),
    JSON.stringify(broken)
  );

  await openPath(fmPath);
  await sleep(500);
  await js(`(function(){openPalette('commands');var i=document.getElementById('palette-input');i.value='properties';i.dispatchEvent(new Event('input'));})()`);
  await sleep(250);
  const paletteLabel = await js(`(function(){var r=document.querySelector('#palette-list .palette-row.selected .palette-label');return r?r.textContent:null;})()`);
  await js(`document.getElementById('palette-input').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))`);
  await sleep(700);
  const afterToggle = await js(`(function(){var p=document.querySelector('#panes .pane.active .fm-panel');return {hidden:!p||p.classList.contains('hidden'),cfg:config.frontmatterPanel};})()`);
  const cfgOnDisk = readConfigFile();
  await js('toggleFrontmatterPanel(true)');
  await sleep(600);
  const backAgain = await js(`(function(){var p=document.querySelector('#panes .pane.active .fm-panel');return !!p && !p.classList.contains('hidden');})()`);
  check(
    'properties: the palette action hides the panel, persists to config.json and brings it back',
    paletteLabel === 'properties: show or hide' && !!afterToggle && afterToggle.hidden && afterToggle.cfg === false &&
      !!cfgOnDisk && cfgOnDisk.frontmatterPanel === false && backAgain === true,
    JSON.stringify({ paletteLabel, afterToggle, disk: cfgOnDisk && cfgOnDisk.frontmatterPanel, backAgain })
  );

  await openPath(demoPath);
  await forget(['skill-e2e', 'broken-e2e', 'example-skill']);
  fs.rmSync(skillDir, { recursive: true, force: true });
  fs.writeFileSync(fmPath, fmOriginal, 'utf8');
  await sleep(800);
}

module.exports = { run };

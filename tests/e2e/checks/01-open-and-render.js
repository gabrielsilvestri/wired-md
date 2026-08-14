// The file from argv opens, renders inline, and the sidebar tree marks it active.

async function run(ctx) {
  const { js, check, demoPath } = ctx;

  const opened = await js('currentPath');
  check('opens demo.md from argv', !!opened && opened === demoPath, String(opened));

  const dom = await js(
    `(function(){var r=document.querySelector('.vditor-ir .vditor-reset');if(!r)return null;return {h1:!!r.querySelector('h1'),table:!!r.querySelector('table'),code:!!r.querySelector('pre'),quote:!!r.querySelector('blockquote'),task:!!r.querySelector('input[type=checkbox]')};})()`
  );
  check(
    'inline rendering (heading, table, code, quote, task)',
    !!dom && dom.h1 && dom.table && dom.code && dom.quote && dom.task,
    JSON.stringify(dom)
  );

  const side = await js(
    `(function(){var a=document.querySelector('#file-tree .tree-row.file.active .tree-name');return {rows:document.querySelectorAll('#file-tree .tree-row').length,active:a?a.textContent:null};})()`
  );
  check('sidebar tree with the active item', !!side && side.rows >= 1 && side.active === 'demo.md', JSON.stringify(side));
}

module.exports = { run };

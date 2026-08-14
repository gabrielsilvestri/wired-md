// Spreadsheet style table editing: the fixture is pre-normalized, Tab walks the
// cells and grows the table at the end, and every transform leaves the document
// outside the table block byte for byte identical, on screen and on disk.

// The lines of the first pipe table in a markdown text, plus the character range
// it occupies. The check computes this itself instead of asking the renderer, so
// the assertion does not depend on the code it is testing.
function tableRegion(text) {
  const lines = text.split('\n');
  for (let i = 0; i + 1 < lines.length; i++) {
    if (lines[i].indexOf('|') === -1) continue;
    const delim = lines[i + 1];
    if (!/^[\s:|-]+$/.test(delim) || delim.indexOf('-') === -1 || delim.indexOf('|') === -1) continue;
    let end = i + 2;
    while (end < lines.length && lines[end].trim() !== '' && lines[end].indexOf('|') !== -1) end += 1;
    let start = 0;
    for (let k = 0; k < i; k++) start += lines[k].length + 1;
    let stop = start;
    for (let k = i; k < end; k++) stop += lines[k].length + 1;
    return { start, end: stop - 1, lines: lines.slice(i, end) };
  }
  return null;
}

function outsideMatches(before, after) {
  const r = tableRegion(before);
  if (!r) return false;
  const prefix = before.slice(0, r.start);
  const suffix = before.slice(r.end);
  return after.length >= prefix.length + suffix.length && after.startsWith(prefix) && after.endsWith(suffix);
}

const cellsOf = (line) => line.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map((c) => c.trim());

async function run(ctx) {
  const { js, key, sleep, check, fs, path, win, forget, openPath, demoPath, rootDir } = ctx;

  const fixture = path.join(rootDir, 'tables-v1.md');
  // The repo runs with core.autocrlf, so a fresh checkout hands this file over
  // with CRLF while the editor writes LF. Normalizing the working copy first is
  // what keeps the byte comparisons below about the table and not about git.
  //
  // The ORIGINAL BYTES are kept aside and written back at the end: normalizing
  // and leaving it that way changed only the line endings, which is invisible in
  // a diff view and still left `npm test` with a dirty working tree.
  const originalBytes = fs.readFileSync(fixture);
  let original = originalBytes.toString('utf8');
  const asLf = original.split('\r\n').join('\n');
  if (asLf !== original) {
    fs.writeFileSync(fixture, asLf, 'utf8');
    original = asLf;
  }
  const restoreFixtureBytes = () => fs.writeFileSync(fixture, originalBytes);

  // The panel toggles and persists, so a run has to start from a known state.
  await js('toggleFrontmatterPanel(true)');
  await sleep(300);

  // Puts the caret in one cell of the first table of the active pane.
  const caretIn = (row, col) =>
    js(
      `(function(){var root=document.querySelector('#panes .pane.active .vditor-ir .vditor-reset');var t=root.querySelector('table');if(!t)return null;var rows=t.querySelectorAll('tr');var cell=rows[${row}].children[${col}];root.focus();var r=document.createRange();r.selectNodeContents(cell);r.collapse(false);var s=window.getSelection();s.removeAllRanges();s.addRange(r);return cell.textContent;})()`
    );

  const restore = () =>
    js(
      `(function(){var p=activePane();p.vditor.setValue(${JSON.stringify(original)});setPaneDirty(p,false);refreshFmPanel(p);})()`
    );

  await openPath(fixture);
  await sleep(800);

  // A fixture that is not already in the form the parser emits would make every
  // byte comparison below meaningless: the first save would rewrite it.
  win.focus();
  key('S', ['control']);
  await sleep(1000);
  const afterOpenSave = fs.readFileSync(fixture, 'utf8');
  check(
    'tables: the fixture is pre-normalized, open plus save does not change a byte',
    afterOpenSave === original,
    JSON.stringify({ same: afterOpenSave === original, len: [original.length, afterOpenSave.length] })
  );

  // --- Tab through the cells, and off the last one ---
  const first = await caretIn(0, 0);
  await sleep(200);
  win.focus();
  key('Tab');
  await sleep(400);
  const afterTab = await js(`(function(){var c=caretCell();return c?{row:c.row,col:c.col,text:c.cell.textContent}:null;})()`);
  win.focus();
  key('Tab', ['shift']);
  await sleep(400);
  const afterShiftTab = await js(`(function(){var c=caretCell();return c?{row:c.row,col:c.col,text:c.cell.textContent}:null;})()`);
  win.focus();
  key('Return');
  await sleep(400);
  const afterEnter = await js(`(function(){var c=caretCell();return c?{row:c.row,col:c.col,text:c.cell.textContent}:null;})()`);
  check(
    'tables: Tab moves to the next cell, Shift+Tab back, Enter to the row below in the same column',
    first === 'Feature' &&
      !!afterTab && afterTab.row === 0 && afterTab.col === 1 && afterTab.text === 'State' &&
      !!afterShiftTab && afterShiftTab.row === 0 && afterShiftTab.col === 0 &&
      !!afterEnter && afterEnter.row === 1 && afterEnter.col === 0 && afterEnter.text === 'Inline rendering',
    JSON.stringify({ first, afterTab, afterShiftTab, afterEnter })
  );

  const beforeGrow = await js('activePane().vditor.getValue()');
  await caretIn(2, 2); // last cell of the last row
  await sleep(200);
  win.focus();
  key('Tab');
  await sleep(600);
  const afterGrow = await js('activePane().vditor.getValue()');
  const landed = await js(`(function(){var c=caretCell();return c?{row:c.row,col:c.col,nRows:c.nRows}:null;})()`);
  win.focus();
  key('S', ['control']);
  await sleep(1000);
  const grownOnDisk = fs.readFileSync(fixture, 'utf8');
  const grownRegion = tableRegion(grownOnDisk);
  check(
    'tables: Tab off the last cell adds a row, and the document outside the table block is unchanged in memory and on disk',
    !!landed && landed.row === 3 && landed.col === 0 && landed.nRows === 4 &&
      outsideMatches(beforeGrow, afterGrow) &&
      outsideMatches(original, grownOnDisk) &&
      !!grownRegion && grownRegion.lines.length === 5,
    JSON.stringify({ landed, inMemory: outsideMatches(beforeGrow, afterGrow), onDisk: outsideMatches(original, grownOnDisk), rows: grownRegion && grownRegion.lines.length })
  );

  fs.writeFileSync(fixture, original, 'utf8');
  await restore();
  await sleep(600);

  // --- column commands ---
  const beforeCols = await js('activePane().vditor.getValue()');
  await caretIn(0, 1); // the "State" column
  await sleep(200);
  const addedRight = await js('runTableCommand("colRight")');
  await sleep(400);
  const aligned = await js('runTableCommand("alignCenter")');
  await sleep(400);
  const afterCols = await js('activePane().vditor.getValue()');
  const colRegion = tableRegion(afterCols);
  const header = colRegion ? cellsOf(colRegion.lines[0]) : [];
  const delim = colRegion ? cellsOf(colRegion.lines[1]) : [];
  check(
    'tables: add column right plus align column center, with the rest of the document untouched',
    addedRight === true && aligned === true &&
      header.length === 4 && header[0] === 'Feature' && header[1] === 'State' && header[3] === 'Note' &&
      /^:-+:$/.test(delim[2]) && /^-+$/.test(delim[0]) &&
      outsideMatches(beforeCols, afterCols),
    JSON.stringify({ addedRight, aligned, header, delim, outside: outsideMatches(beforeCols, afterCols) })
  );

  const movedLeft = await js('runTableCommand("colMoveLeft")');
  await sleep(400);
  const afterMove = await js('activePane().vditor.getValue()');
  const moveRegion = tableRegion(afterMove);
  const moveDelim = moveRegion ? cellsOf(moveRegion.lines[1]) : [];
  const moveHeader = moveRegion ? cellsOf(moveRegion.lines[0]) : [];
  const deleted = await js('runTableCommand("colDelete")');
  await sleep(400);
  const afterDelete = await js('activePane().vditor.getValue()');
  const delRegion = tableRegion(afterDelete);
  const guard = await js('getLastGuardTrip()');
  check(
    'tables: move column left carries its alignment, delete column removes it, and the round trip guard never tripped',
    movedLeft === true && deleted === true &&
      /^:-+:$/.test(moveDelim[1]) && moveHeader[2] === 'State' &&
      !!delRegion && cellsOf(delRegion.lines[0]).length === 3 &&
      outsideMatches(beforeCols, afterDelete) && guard === null,
    JSON.stringify({ movedLeft, deleted, moveHeader, moveDelim, afterDeleteHeader: delRegion && delRegion.lines[0], guard })
  );

  // --- row commands and the floating toolbar ---
  await restore();
  await sleep(600);
  await caretIn(1, 0);
  await sleep(300);
  const toolbar = await js(
    `(function(){var t=document.getElementById('table-toolbar');if(!t)return null;var btns=[...t.querySelectorAll('.tt-btn')];return {open:isTableToolbarOpen(),n:btns.length,tips:btns.map(function(b){return b.title;}),icons:btns.every(function(b){return !!b.querySelector('svg')&&!b.textContent.trim();})};})()`
  );
  const rowDown = await js('runTableCommand("rowDown")');
  await sleep(400);
  const afterRowDown = await js('activePane().vditor.getValue()');
  const rowRegion = tableRegion(afterRowDown);
  await caretIn(1, 0);
  await sleep(200);
  const rowDeleted = await js('runTableCommand("rowDelete")');
  await sleep(400);
  const afterRowDelete = await js('activePane().vditor.getValue()');
  const delRowRegion = tableRegion(afterRowDelete);
  const headerSafe = await js(
    `(function(){var root=document.querySelector('#panes .pane.active .vditor-ir .vditor-reset');var t=root.querySelector('table');var c=t.querySelectorAll('tr')[0].children[0];var r=document.createRange();r.selectNodeContents(c);r.collapse(false);var s=window.getSelection();s.removeAllRanges();s.addRange(r);return runTableCommand('rowDelete');})()`
  );
  await sleep(300);
  const paletteActions = await js(`PALETTE_ACTIONS.map(function(a){return typeof a.label==='function'?a.label():a.label;}).filter(function(l){return l.indexOf('table: ')===0;})`);
  check(
    'tables: the toolbar is icons with English tooltips, rows move and delete, the header row is never deleted, and every command is in the palette',
    !!toolbar && toolbar.open && toolbar.n === 13 && toolbar.icons && toolbar.tips.every((t) => !!t && /^[\x20-\x7e]+$/.test(t)) &&
      rowDown === true && !!rowRegion && cellsOf(rowRegion.lines[2])[0] === 'Tables' &&
      rowDeleted === true && !!delRowRegion && delRowRegion.lines.length === 3 &&
      headerSafe === false &&
      Array.isArray(paletteActions) && paletteActions.length === 13,
    JSON.stringify({ toolbar: toolbar && toolbar.n, rowDown, rowDeleted, headerSafe, palette: paletteActions && paletteActions.length, rows: rowRegion && rowRegion.lines, afterDelete: delRowRegion && delRowRegion.lines })
  );

  const toolbarGone = await js(
    `(function(){var root=document.querySelector('#panes .pane.active .vditor-ir .vditor-reset');var h=root.querySelector('h1')||root.firstElementChild;var r=document.createRange();r.selectNodeContents(h);r.collapse(false);var s=window.getSelection();s.removeAllRanges();s.addRange(r);document.dispatchEvent(new Event('selectionchange'));return isTableToolbarOpen();})()`
  );
  check('tables: the toolbar disappears the moment the caret leaves the table', toolbarGone === false, JSON.stringify({ toolbarGone }));

  await restore();
  await sleep(400);
  await openPath(demoPath);
  await forget(['tables-v1']);
  restoreFixtureBytes();
  await sleep(800);
}

module.exports = { run };

// AI bridge per note: the sparkles button lives in every pane header (never in
// the title bar) and the palette carries the matching actions.

async function run(ctx) {
  const { js, check } = ctx;

  const bridge = await js(
    `(function(){var all=[...document.querySelectorAll('#panes .pane')];var okBtn=all.length>0&&all.every(function(p){var b=p.querySelector('.pane-header .pane-claude');return !!b&&!!b.querySelector('svg')&&(b.title||'').length>0;});var labels=PALETTE_ACTIONS.map(function(a){return typeof a.label==='function'?a.label():a.label;});return {okBtn:okBtn,notInTitlebar:!document.getElementById('btn-claude-file')&&!document.getElementById('btn-claude-sel'),actionFile:labels.indexOf('send file to claude')!==-1,actionSelection:labels.indexOf('send selection to claude')!==-1,actionBeside:labels.indexOf('open file beside')!==-1};})()`
  );
  check(
    'AI bridge: sparkles in the pane header (and out of the title bar), actions in the palette',
    !!bridge && bridge.okBtn && bridge.notInTitlebar && bridge.actionFile && bridge.actionSelection && bridge.actionBeside,
    JSON.stringify(bridge)
  );
}

module.exports = { run };

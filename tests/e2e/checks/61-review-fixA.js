// Review shots for this work package: the YAML frontmatter block, a fenced code
// block at rest, and the same code block with the caret inside it.
//
// OPT IN, like the other two shot writing checks: nothing is written without
// WIRED_SHOTS=1, because a PNG re-encoded on every run is a diff on every run
// and `npm test` has to leave the working tree clean.
//
// WIRED_SHOTS_PREFIX names the set ("after" by default). The "before" set was
// taken by stashing the fix and running this same check against the previous
// code, which is the only honest way to photograph a bug that no longer exists.
//
// Each shot is cropped to the block itself rather than the whole window: the
// question here is what one block looks like, and a full window shrinks it to a
// stripe.

const path = require('path');

const OUT = path.join(__dirname, '..', '..', '..', 'docs', 'review-fixA');
const SHOTS = process.env.WIRED_SHOTS === '1';
const PREFIX = process.env.WIRED_SHOTS_PREFIX || 'after';

// The pane holding a file, made active and scrolled to the block of interest.
function focusBlock(paneKey, type) {
  return `(function(){
    var p = panes.find(function(x){ return x.path && x.path.indexOf(${JSON.stringify(paneKey)}) !== -1; });
    if (!p) return null;
    p.el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    var ed = p.el.querySelector('.vditor-ir pre.vditor-reset');
    var n = ed.querySelector('[data-type=' + JSON.stringify(${JSON.stringify(type)}) + ']');
    if (!n) return null;
    n.scrollIntoView({ block: 'center' });
    return null;
  })()`;
}

function rectOf(paneKey, type) {
  return `(function(){
    var p = panes.find(function(x){ return x.path && x.path.indexOf(${JSON.stringify(paneKey)}) !== -1; });
    if (!p) return null;
    var ed = p.el.querySelector('.vditor-ir pre.vditor-reset');
    var n = ed ? ed.querySelector('[data-type=' + JSON.stringify(${JSON.stringify(type)}) + ']') : null;
    if (!n) return null;
    var r = n.getBoundingClientRect();
    var pad = 16;
    return {
      x: Math.max(0, Math.round(r.left - pad)),
      y: Math.max(0, Math.round(r.top - pad)),
      width: Math.round(r.width + pad * 2),
      height: Math.round(r.height + pad * 2)
    };
  })()`;
}

async function run(ctx) {
  const { js, sleep, check, fs, win } = ctx;

  if (!SHOTS) {
    check('review shots for fixA skipped (set WIRED_SHOTS=1 to write docs/review-fixA)', true);
    return;
  }
  fs.mkdirSync(OUT, { recursive: true });

  // One pane, wide window: a block photographed inside a 480px column is a
  // picture of the column, not of the block.
  win.setSize(1180, 900);
  win.center();
  await js(`(function(){config.focusMode=false;config.typewriterMode=false;applyFocusMode();applyTypewriterMode();
    if(document.activeElement&&document.activeElement.blur)document.activeElement.blur();
    var s=window.getSelection();if(s)s.removeAllRanges();return null;})()`);
  await sleep(500);

  // In the tabs world nothing before this file keeps example-skill.md open, so
  // the shot opens it itself and closes it again afterwards.
  let openedFm = false;
  const hasFm = await js(`!!panes.find(function(x){return x.path&&x.path.indexOf('example-skill.md')!==-1;})`);
  if (!hasFm) {
    const fmPath = await js(
      `(function(){var p=panes.find(function(x){return x.path&&x.path.indexOf('demo.md')!==-1;});return p?p.path.replace(/demo\\.md$/,'example-skill.md'):null;})()`
    );
    if (fmPath) {
      await js(`void openPath(${JSON.stringify(fmPath)})`);
      await sleep(900);
      openedFm = true;
    }
  }

  const written = [];
  const shoot = async (name, paneKey, type) => {
    await js(focusBlock(paneKey, type));
    await sleep(500);
    const rect = await js(rectOf(paneKey, type));
    if (!rect || rect.width < 2 || rect.height < 2) return;
    const img = await win.webContents.capturePage(rect);
    const file = PREFIX + '-' + name + '.png';
    fs.writeFileSync(path.join(OUT, file), img.toPNG());
    written.push(file);
  };

  await shoot('frontmatter', 'example-skill.md', 'yaml-front-matter');
  await shoot('code-block', 'demo.md', 'code-block');

  // The same code block with the caret inside it: before the fix this is where
  // the source appeared ABOVE the rendered preview and the block showed twice.
  await js(
    `(function(){var p=panes.find(function(x){return x.path&&x.path.indexOf('demo.md')!==-1;});if(!p)return null;var ed=p.el.querySelector('.vditor-ir pre.vditor-reset');if(!ed)return null;ed.focus();var prev=ed.querySelector('[data-type="code-block"] .vditor-ir__preview');if(prev)prev.click();return null;})()`
  );
  await sleep(700);
  await shoot('code-block-editing', 'demo.md', 'code-block');

  // Caret out again, and nothing left dirty for the checks that follow.
  await js(
    `(function(){var p=panes.find(function(x){return x.path&&x.path.indexOf('demo.md')!==-1;});if(!p)return null;var ed=p.el.querySelector('.vditor-ir pre.vditor-reset');if(!ed)return null;var kids=[].slice.call(ed.children);var t=kids.find(function(k){return k.tagName==='P';})||kids[0];if(!t)return null;var r=document.createRange();r.selectNodeContents(t);r.collapse(true);var s=getSelection();s.removeAllRanges();s.addRange(r);t.click();document.dispatchEvent(new Event('selectionchange'));return null;})()`
  );
  await sleep(400);

  if (openedFm) {
    await js(
      `(function(){var p=panes.find(function(x){return x.path&&x.path.indexOf('example-skill.md')!==-1;});if(p)void closePane(p);})()`
    );
    await sleep(400);
  }

  check(
    'review shots for fixA written to docs/review-fixA',
    written.length === 3,
    JSON.stringify(written)
  );
}

module.exports = { run };

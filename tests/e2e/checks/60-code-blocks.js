// Code blocks and YAML frontmatter: the surface they sit on, the syntax colors
// over that surface, and the single copy rule while editing.
//
// The three things this locks down, all of them regressions the owner hit:
//
//   1. The surface. Vditor's vendored content theme painted
//      `code:not(.hljs):not(.highlight-chroma)` with rgba(66, 133, 244, .36),
//      a saturated blue, and it loaded after styles.css so it won. Every YAML
//      frontmatter block in the document was a blue slab with nothing clicked,
//      and so was any code block being edited. The surface is a theme variable
//      now, and this check reads it from the theme rather than from a literal.
//   2. The syntax colors. Vditor falls back to the LIGHT "github" highlight.js
//      theme whenever the configured name is not on its list, which put #24292e
//      body text on a dark surface at 1.1:1. Every token is measured here.
//   3. One copy. IR reveals the editable source ABOVE the rendered preview and
//      keeps both on screen. The preview has to be gone exactly while the caret
//      is inside the block, and back when it is not.

const CODE_PANE = 'demo.md';
const FM_PANE = 'example-skill.md';

// The node of the first code block in a pane, plus everything worth measuring
// on both of its faces.
function probe(paneKey, type) {
  return `(function(){
    var p = panes.find(function(x){ return x.path && x.path.indexOf(${JSON.stringify(paneKey)}) !== -1; });
    if (!p) return null;
    var ed = p.el.querySelector('.vditor-ir pre.vditor-reset');
    var n = ed.querySelector('[data-type=' + JSON.stringify(${JSON.stringify(type || 'code-block')}) + ']');
    if (!n) return null;
    var src = n.querySelector('.vditor-ir__marker--pre > code');
    var prev = n.querySelector('.vditor-ir__preview');
    var pcode = prev ? prev.querySelector('code') : null;
    var read = function(el){
      if (!el) return null;
      var cs = getComputedStyle(el);
      return { bg: cs.backgroundColor, color: cs.color, font: cs.fontFamily, size: cs.fontSize, pad: cs.padding, radius: cs.borderRadius };
    };
    var tokens = [];
    if (pcode) pcode.querySelectorAll('[class*="hljs-"]').forEach(function(s){
      tokens.push({ cls: s.className, color: getComputedStyle(s).color });
    });
    return {
      expanded: n.classList.contains('vditor-ir__node--expand'),
      src: read(src),
      preview: read(pcode),
      previewDisplay: prev ? getComputedStyle(prev).display : null,
      tokens: tokens,
      themeBg2: getComputedStyle(document.documentElement).getPropertyValue('--bg-2').trim(),
      themeInk: getComputedStyle(document.documentElement).getPropertyValue('--ink').trim()
    };
  })()`;
}

function rgb(value) {
  const m = String(value || '').match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

function hexRgb(value) {
  const m = String(value || '').trim().match(/^#([0-9a-f]{6})$/i);
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function same(a, b) {
  return !!a && !!b && a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
}

async function run(ctx) {
  const { js, sleep, check } = ctx;

  // The pane holding the code block becomes the active one (a collapsed pane
  // measures nothing useful), and the pane that was active is put back at the
  // end, because the checks after this one inherit the layout.
  const previous = await js(`(function(){var p=activePane();return p&&p.path?p.path:null;})()`);
  await js(
    `(function(){var p=panes.find(function(x){return x.path&&x.path.indexOf(${JSON.stringify(CODE_PANE)})!==-1;});if(p)p.el.dispatchEvent(new MouseEvent('mousedown',{bubbles:true}));})()`
  );
  await sleep(500);

  const idle = await js(probe(CODE_PANE));

  // 1. The surface, read from the theme rather than written down here.
  const bg2 = hexRgb(idle && idle.themeBg2);
  const srcBg = rgb(idle && idle.src && idle.src.bg);
  const prevBg = rgb(idle && idle.preview && idle.preview.bg);
  // The old vendor blue, composited over --bg-2, is what this must never be.
  const oldBlue = [66, 133, 244].map((v, i) => Math.round(v * 0.36 + (bg2 ? bg2[i] : 0) * 0.64));
  check(
    'code block: both faces sit on the themed --bg-2 surface, not the vendor blue',
    same(srcBg, bg2) && same(prevBg, bg2) && !same(srcBg, oldBlue) && !same(prevBg, oldBlue),
    JSON.stringify({ themeBg2: idle && idle.themeBg2, srcBg: idle && idle.src && idle.src.bg, prevBg: idle && idle.preview && idle.preview.bg, oldBlue: oldBlue })
  );

  // 2. Editing in place means the two faces are the same object to the eye.
  const s = idle && idle.src;
  const p = idle && idle.preview;
  check(
    'code block: the editable source and the rendered preview share font, size, padding and radius',
    !!s && !!p && s.font === p.font && s.size === p.size && s.pad === p.pad && s.radius === p.radius,
    JSON.stringify({ src: s, preview: p })
  );

  // 3. Syntax colors over that surface, inside the owner's band. The tokens are
  //    whatever the fixture happens to produce, which is the point: a token this
  //    check does not know about still has to be readable.
  const band = [];
  for (const t of (idle && idle.tokens) || []) {
    const c = rgb(t.color);
    if (!c || !bg2) continue;
    const value = await js(`contrastRatio(${JSON.stringify(c)}, ${JSON.stringify(bg2)})`);
    band.push({ cls: t.cls, ratio: Math.round(value * 100) / 100 });
  }
  const inkRatio = await js(
    `contrastRatio(${JSON.stringify(rgb(idle && idle.preview && idle.preview.color) || [0, 0, 0])}, ${JSON.stringify(bg2 || [0, 0, 0])})`
  );
  check(
    'code block: every syntax token and the code text itself measure 4.5:1 to 11:1 over the code surface',
    band.length > 0 && band.every((x) => x.ratio >= 4.5 && x.ratio <= 11) && inkRatio >= 4.5 && inkRatio <= 11,
    JSON.stringify({ tokens: band, codeText: Math.round(inkRatio * 100) / 100 })
  );

  // 4. One copy. Idle: the preview is what you see. Caret inside: the source is,
  //    and the preview is gone rather than sitting under it.
  const previewIdle = idle && idle.previewDisplay;
  await js(
    `(function(){var p=activePane();var ed=p.el.querySelector('.vditor-ir pre.vditor-reset');var n=ed.querySelector('[data-type="code-block"]');ed.focus();n.querySelector('.vditor-ir__preview').click();return null;})()`
  );
  await sleep(600);
  const inside = await js(probe(CODE_PANE));
  check(
    'code block: entering it shows ONE copy (the preview is hidden while the caret is inside, visible when it is not)',
    previewIdle === 'block' && !!idle && idle.expanded === false &&
      !!inside && inside.expanded === true && inside.previewDisplay === 'none',
    JSON.stringify({ idle: { expanded: idle && idle.expanded, preview: previewIdle }, inside: { expanded: inside && inside.expanded, preview: inside && inside.previewDisplay } })
  );

  // Caret out of the block again, so the pane is left the way it was found.
  await js(
    `(function(){var p=activePane();var ed=p.el.querySelector('.vditor-ir pre.vditor-reset');var kids=[].slice.call(ed.children);var target=kids.find(function(k){return k.tagName==='P';})||kids[0];var r=document.createRange();r.selectNodeContents(target);r.collapse(true);var sel=getSelection();sel.removeAllRanges();sel.addRange(r);target.click();document.dispatchEvent(new Event('selectionchange'));return null;})()`
  );
  await sleep(600);
  const outside = await js(probe(CODE_PANE));
  check(
    'code block: leaving it brings the rendered preview back',
    !!outside && outside.expanded === false && outside.previewDisplay === 'block',
    JSON.stringify({ expanded: outside && outside.expanded, preview: outside && outside.previewDisplay })
  );

  // 5. The frontmatter block: the same quiet surface. In IR it has no preview at
  //    all, only the editable source, which is why it was blue in the document
  //    with nothing clicked.
  //    In the tabs world nothing before this check keeps example-skill.md open,
  //    so the check opens it itself (and closes it again, leaving the layout as
  //    it found it).
  let openedFm = false;
  let fm = await js(probe(FM_PANE, 'yaml-front-matter'));
  if (!fm) {
    const fmPath = await js(
      `(function(){var p=panes.find(function(x){return x.path&&x.path.indexOf(${JSON.stringify(CODE_PANE)})!==-1;});return p?p.path.replace(/demo\\.md$/, ${JSON.stringify(FM_PANE)}):null;})()`
    );
    if (fmPath) {
      await js(`void openPath(${JSON.stringify(fmPath)})`);
      await sleep(900);
      openedFm = true;
      fm = await js(probe(FM_PANE, 'yaml-front-matter'));
    }
  }
  const fmBg = rgb(fm && fm.src && fm.src.bg);
  check(
    'frontmatter: the YAML block reads as the same quiet code surface, with no preview to duplicate it',
    same(fmBg, bg2) && !same(fmBg, oldBlue) && !!fm && fm.preview === null,
    JSON.stringify({ bg: fm && fm.src && fm.src.bg, themeBg2: fm && fm.themeBg2, preview: fm && fm.preview })
  );

  // Nothing here edits anything, so no pane may come out of it dirty.
  const dirty = await js(`panes.filter(function(x){return x.dirty;}).map(function(x){return x.path;})`);
  check('code blocks: reading and entering a block leaves every pane clean', dirty.length === 0, JSON.stringify(dirty));

  if (openedFm) {
    await js(
      `(function(){var p=panes.find(function(x){return x.path&&x.path.indexOf(${JSON.stringify(FM_PANE)})!==-1;});if(p)void closePane(p);})()`
    );
    await sleep(400);
  }

  if (previous) {
    await js(
      `(function(){var p=panes.find(function(x){return x.path===${JSON.stringify(previous)};});if(p)p.el.dispatchEvent(new MouseEvent('mousedown',{bubbles:true}));})()`
    );
    await sleep(400);
  }
}

module.exports = { run };

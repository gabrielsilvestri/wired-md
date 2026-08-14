// Theme switch, custom accent with its derived variants, and a CSS snippet
// injected on top. The theme is put back to wired at the end.

const SNIPPET = 'example-underlined-headings.css';

async function run(ctx) {
  const { js, sleep, check } = ctx;

  await js(`(async()=>{config.theme='light';await applyTheme('light');})()`);
  await sleep(300);
  const lightBg = await js(`getComputedStyle(document.documentElement).getPropertyValue('--bg').trim()`);
  check('light theme applied', lightBg === '#f2f0ea', lightBg);

  await js(`(function(){config.accent='#7a4fc7';applyCustom();})()`);
  const acc = await js(
    `(function(){var s=getComputedStyle(document.documentElement);return {a:s.getPropertyValue('--accent').trim(),soft:s.getPropertyValue('--accent-soft').trim()};})()`
  );
  check('custom accent and its soft variant', !!acc && acc.a === '#7a4fc7' && /^#/.test(acc.soft) && acc.soft !== acc.a, JSON.stringify(acc));

  await js(`(async()=>{config.snippets=[${JSON.stringify(SNIPPET)}];await applySnippets();})()`);
  await sleep(200);
  const styles = await js(`document.querySelectorAll('style[data-snippet]').length`);
  check('CSS snippet injected', styles === 1, 'styles=' + styles);

  // Back to the wired theme before anything that measures colors.
  await js(`(async()=>{config.theme='wired';config.accent=null;config.snippets=[];await applyTheme('wired');await applySnippets();})()`);
  await sleep(300);
}

module.exports = { run };

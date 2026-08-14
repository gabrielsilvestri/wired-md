// A dollar sign is money, not a formula: inline math is off in the lute, and
// the text survives the round trip untouched.

const EDITOR = '#panes .pane.active .vditor-ir .vditor-reset';

async function run(ctx) {
  const { js, sleep, check, fs, path, forget, openPath, demoPath, rootDir } = ctx;

  const moneyPath = path.join(rootDir, 'money-e2e.md');
  const moneyText = 'Price from R$297 to R$ 397, and plan B costs R$ 2.997.\n\nOne charges R$ 62 and the other R$ 1.200 a month.\n';
  fs.writeFileSync(moneyPath, moneyText, 'utf8');
  await openPath(moneyPath);
  await sleep(700);

  const money = await js(
    `(function(){var root=document.querySelector('${EDITOR}');if(!root)return null;return {math:root.querySelectorAll('[data-type="math-inline"], code.language-math, .katex, .vditor-math').length,text:root.textContent.replace(/\\s+/g,' ').trim(),value:vditor.getValue()};})()`
  );
  check(
    'R$ does not become a formula (inline math off) and the text survives the round trip',
    !!money && money.math === 0 &&
      money.text.indexOf('R$297 to R$ 397') !== -1 && money.text.indexOf('R$ 2.997') !== -1 &&
      money.value.replace(/\s+/g, ' ').trim() === moneyText.replace(/\s+/g, ' ').trim(),
    JSON.stringify(money)
  );

  await forget(['money-e2e']);
  await openPath(demoPath);
  fs.rmSync(moneyPath, { force: true });
  await sleep(700);
}

module.exports = { run };

// Export the note as a standalone HTML page in the active theme, and as a PDF
// printed from that page; the frontmatter stays out of both, and the palette
// offers both.

async function run(ctx) {
  const { js, check, fs, userDir, openPath, until, forget, demoPath } = ctx;

  const note = userDir('export-check.md');
  fs.writeFileSync(note, '---\nname: secret-key-e2e\n---\n# Export title\n\nA paragraph with **bold** text.\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n', 'utf8');
  // WIRED_EXPORT_KEEP=<folder> keeps the exported demo.md files there to look
  // at; never set by the suite.
  const keep = process.env.WIRED_EXPORT_KEEP;
  const htmlOut = userDir('export-check.html');
  const pdfOut = userDir('export-check.pdf');

  try {
    await openPath(note);
    await until(`activePane()&&activePane().path===${JSON.stringify(note)}&&activePane().ready`);
    const labels = await js(`PALETTE_ACTIONS.map(function(a){return typeof a.label==='function'?a.label():a.label;})`);
    check('export: the palette offers HTML and PDF', labels.includes('export note as HTML') && labels.includes('export note as PDF'));

    const h = await js(`window.wiredExport.exportNote('html', ${JSON.stringify(htmlOut)})`);
    const html = fs.existsSync(htmlOut) ? fs.readFileSync(htmlOut, 'utf8') : '';
    const bg = await js(`getComputedStyle(document.documentElement).getPropertyValue('--bg').trim()`);
    check(
      'export: HTML is a standalone page with the content, the title, the theme colors and no frontmatter or script',
      !!h && h.ok && /<title>Export title<\/title>/.test(html) && /<strong>bold<\/strong>/.test(html) && /<table>/.test(html) &&
        html.indexOf('secret-key-e2e') === -1 && html.indexOf('<script') === -1 && html.indexOf(bg) !== -1,
      JSON.stringify({ res: h, size: html.length, bg })
    );

    const p = await js(`window.wiredExport.exportNote('pdf', ${JSON.stringify(pdfOut)})`);
    const head = fs.existsSync(pdfOut) ? fs.readFileSync(pdfOut).subarray(0, 5).toString('latin1') : '';
    check('export: PDF is written and is a PDF', !!p && p.ok && head === '%PDF-' && fs.statSync(pdfOut).size > 2000, JSON.stringify({ res: p, head }));
    if (keep) {
      await openPath(demoPath);
      await js(`window.wiredExport.exportNote('html', ${JSON.stringify(keep + '/demo.html')})`);
      await js(`window.wiredExport.exportNote('pdf', ${JSON.stringify(keep + '/demo.pdf')})`);
    }
  } finally {
    await forget(['export-check.md']);
    for (const f of [note, htmlOut, pdfOut]) fs.rmSync(f, { force: true, maxRetries: 10, retryDelay: 200 });
    await openPath(demoPath);
  }
}

module.exports = { run };

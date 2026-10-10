/* 诊断：走完整链路并打印中间产物，定位 PDF 表结构还原的问题 */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js');

const root = path.join(__dirname, '..');
const dom = new JSDOM('<html><body></body></html>', {
  runScripts: 'outside-only', url: 'http://localhost/', pretendToBeVisual: true
});
const w = dom.window;
['store.js', 'parser.js', 'import-file.js'].forEach(f => {
  w.eval(fs.readFileSync(path.join(root, 'www/js', f), 'utf8'));
});

(async () => {
  const data = new Uint8Array(fs.readFileSync(path.join(root, '.tmp-test.pdf')));
  const doc = await pdfjsLib.getDocument({ data, useSystemFonts: false }).promise;
  const page = await doc.getPage(1);
  const vp = page.getViewport({ scale: 1 });
  const tc = await page.getTextContent();

  const words = w.FileImport.itemsToWords(tc.items, vp.height);
  console.log('=== itemsToWords 输出 ' + words.length + ' 个词块 ===');
  words.slice(0, 26).forEach((x, i) => {
    console.log(String(i).padStart(3),
      JSON.stringify(x.text).padEnd(16),
      'x0=' + x.bbox.x0.toFixed(1).padEnd(7),
      'y0=' + x.bbox.y0.toFixed(1));
  });

  console.log('\n=== wordsToTable 矩阵 ===');
  const m = w.Parser.wordsToTable(words, 0, 4);
  m.forEach((r, i) => {
    console.log('r' + String(i).padStart(2) + ' | ' + r.map(c => (c || '·')).join(' | '));
  });

  console.log('\n=== 非空格的原始 str（前 20）===');
  tc.items.filter(x => String(x.str).trim()).slice(0, 20)
    .forEach(x => console.log('  ' + JSON.stringify(x.str) + '  y=' + x.transform[5]));
})().catch(e => { console.error('失败:', e && e.stack || e); process.exit(1); });

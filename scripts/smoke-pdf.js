/* PDF 导入链路测试
   1) 单元：手工构造 pdf.js 文字项 → itemsToWords → wordsToTableByAnchor
   2) 集成：真实 pdf.js 解析课表 PDF，跑完整链路并校验每个字段
   3) 诊断：非 PDF / 损坏文件应给出可读的错误
*/
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const root = path.join(__dirname, '..');
let pass = 0, fail = 0;
function t(name, ok, extra) {
  if (ok) { pass++; console.log('  ✔ ' + name); }
  else { fail++; console.log('  ✘ ' + name + (extra !== undefined ? '  → ' + JSON.stringify(extra) : '')); }
}

const dom = new JSDOM('<html><body></body></html>', {
  runScripts: 'outside-only', url: 'http://localhost/', pretendToBeVisual: true
});
const w = dom.window;
['store.js', 'parser.js', 'import-file.js'].forEach(f => {
  w.eval(fs.readFileSync(path.join(root, 'www/js', f), 'utf8'));
});
const FI = w.FileImport, P = w.Parser;

/* ---------- 1. 单元 ---------- */
console.log('\n[1] itemsToWords：pdf.js 文字项 → 词块');
function item(str, x, y, size = 10) {
  return { str: str, transform: [size, 0, 0, size, x, y], width: str.length * size * 0.5, height: size };
}
const PAGE_H = 792;
const fakeItems = [
  item('Mon', 110, 730), item('Tue', 205, 730), item('Wed', 300, 730),
  item('No.1', 45, 700),
  item('Math', 110, 690), item('Zhang', 110, 677), item('A101', 110, 664),
  item('English', 205, 690), item('Li', 205, 677), item('B203', 205, 664),
];
const words1 = FI.itemsToWords(fakeItems, PAGE_H);
t('产出词块', words1.length >= 8, words1.length);
t('词块带 bbox 四边', words1.every(x => x.bbox && typeof x.bbox.x0 === 'number' && typeof x.bbox.y1 === 'number'));
t('y0 <= y1', words1.every(x => x.bbox.y0 <= x.bbox.y1));
t('文字完整未被拆散', words1.some(x => x.text === 'Math') && words1.some(x => x.text === 'English'),
  words1.map(x => x.text));

const m1 = P.wordsToTableByAnchor(words1, 0);
t('矩阵列数合理（4-6）', m1[0].length >= 4 && m1[0].length <= 6, m1[0].length);
t('表头单独成行', /Mon/.test(m1[0].join(' ')) && !/Math/.test(m1[0].join(' ')), m1[0]);
t('No.1 与它的课程合成一行',
  /No\.1/.test(m1[1][0]) && /Math/.test(m1[1].join(' ')) && /Zhang/.test(m1[1].join(' ')),
  m1[1]);

/* ---------- 2 & 3. 真实 PDF ---------- */
const pdfPath = path.join(root, '.tmp-test.pdf');
if (!fs.existsSync(pdfPath)) {
  console.log('\n! 缺少 .tmp-test.pdf，跳过集成测试（可运行 scripts/make-test-pdf.py 生成）');
  console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败');
  process.exit(fail ? 1 : 0);
}

const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js');

(async () => {
  console.log('\n[2] 真实 PDF 完整链路');
  const data = new Uint8Array(fs.readFileSync(pdfPath));
  const doc = await pdfjsLib.getDocument({ data, useSystemFonts: false }).promise;
  t('PDF 能打开', doc.numPages >= 1, doc.numPages);

  const page = await doc.getPage(1);
  const tc = await page.getTextContent();
  const vp = page.getViewport({ scale: 1 });
  t('读出文字项', tc.items.length >= 20, tc.items.length);

  const words2 = FI.itemsToWords(tc.items, vp.height);
  const m2 = P.wordsToTableByAnchor(words2, 0);
  t('表头行独立（含 Mon 但不含 Math）',
    /Mon/.test(m2[0].join(' ')) && !/Math/.test(m2[0].join(' ')), m2[0]);
  t('节次行把课程名/教师/地点并回一格',
    /No\.1/.test(m2[1][0]) && /Math/.test(m2[1].join(' ')) && /A101/.test(m2[1].join(' ')), m2[1]);

  const cs = P.parseTable(m2, 20);
  t('解析出课程（>=8）', cs.length >= 8, cs.length);

  const by = n => cs.filter(c => c.name === n);
  const math = by('Math')[0];
  t('课程名未粘连（Math）', !!math, cs.map(c => c.name));
  if (math) {
    t('教师正确（Zhang）', math.teacher === 'Zhang', math.teacher);
    t('地点正确（A101）', math.place === 'A101', math.place);
    t('星期正确（周一=1）', math.day === 1, math.day);
    t('节次正确（第 1 节）', math.start === 1 && math.end === 1, [math.start, math.end]);
    t('周次正确（1-16 共 16 周）', math.weeks.length === 16, math.weeks.length);
  }
  const chem = by('Chemistry')[0];
  t('Chemistry 周次为 3-15（13 周）', chem && chem.weeks.length === 13, chem && chem.weeks.length);
  t('Chemistry 星期为周三', chem && chem.day === 3, chem && chem.day);
  t('Physics 周次为 1-8（8 周）', (by('Physics')[0] || {}).weeks &&
    by('Physics')[0].weeks.length === 8, (by('Physics')[0] || {}).weeks);
  // 英文人名/地点不在中文词典里，PE 那格会带上 Sun/Gym，这里只要求课程名以 PE 开头
  t('PE 课程也被识别', cs.some(c => /^PE\b/.test(c.name)), cs.map(c => c.name));
  t('没有把表头 Mon/Tue 当成课程',
    !cs.some(c => /^(Mon|Tue|Wed|Thu|Fri)$/.test(c.name)), cs.map(c => c.name));

  console.log('\n[3] 非 PDF 文件应给出可读诊断');
  const bad = path.join(root, '.tmp-notpdf.pdf');
  fs.writeFileSync(bad, '<!DOCTYPE html><html><body>hi</body></html>');
  try {
    await pdfjsLib.getDocument({ data: new Uint8Array(fs.readFileSync(bad)), useSystemFonts: false }).promise;
    t('非 PDF 内容应当报错', false, '竟然没报错');
  } catch (e) {
    t('非 PDF 内容会抛异常（由诊断分支转成中文提示）', !!(e && (e.name || e.message)), e && e.name);
  }
  fs.unlinkSync(bad);

  console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败');
  process.exit(fail ? 1 : 0);
})().catch(e => {
  console.log('  ✘ 集成测试异常：' + (e && e.stack || e));
  process.exit(1);
});

/* 用**真实**教务接口返回的 JSON（scripts/fixtures/hntou-kb.json）跑一遍 App 的解析器，
 * 看它把课表解析成什么样。数据来源：2025000001 账号在 zfjw.hntou.edu.cn 实抓。
 *
 * 用法：node scripts/check-real-kb.js
 */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const root = path.join(__dirname, '..');
const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  runScripts: 'outside-only', url: 'http://localhost/', pretendToBeVisual: true
});
const w = dom.window;
['store.js', 'bridge.js', 'parser.js', 'import-jw.js'].forEach(f => {
  w.eval(fs.readFileSync(path.join(root, 'www/js', f), 'utf8'));
});

const raw = JSON.parse(fs.readFileSync(path.join(root, 'scripts/fixtures/hntou-kb.json'), 'utf8'));
const kb = raw.kbList;
const TOTAL = 20;

console.log('原始记录 %d 条，学期总周数按 %d 算\n', kb.length, TOTAL);

const parsed = w.Parser.parseJwList(kb, TOTAL);
console.log('解析出 %d 条\n', parsed.length);

console.log('课程名'.padEnd(24) + '星期  节次    解析出的周次'.padEnd(46) + ' UI 会显示');
console.log('-'.repeat(105));
let bugCount = 0;
kb.forEach((it, i) => {
  const p = parsed[i];
  if (!p) { console.log('  ✘ 第 %d 条没解析出来: %s', i, it.kcmc); bugCount++; return; }
  const zcd = it.zcd || '';
  const wantParity = /\(单\)/.test(zcd) ? '单' : (/\(双\)/.test(zcd) ? '双' : '');
  const shown = w.Store.formatWeeks(p.weeks, TOTAL, p.parity);
  let flag = '';
  if (wantParity === '单' && shown !== '单周') { flag = '  ✘ 应显示「单周」'; bugCount++; }
  if (wantParity === '双' && shown !== '双周') { flag = '  ✘ 应显示「双周」'; bugCount++; }
  if (zcd === '5-8周,10-13周' && p.weeks.join(',') !== '5,6,7,8,10,11,12,13') {
    flag = '  ✘ 丢了第二段 10-13 周'; bugCount++;
  }
  console.log(
    String(p.name).slice(0, 22).padEnd(24) +
    String(p.day).padEnd(5) +
    (p.start + '-' + p.end).padEnd(8) +
    ('[' + p.weeks.length + '周] ' + p.weeks.join(',')).padEnd(46) +
    shown + flag);
});

console.log('\n' + '='.repeat(105));
console.log(bugCount ? '发现 ' + bugCount + ' 处解析错误' : '全部正确');

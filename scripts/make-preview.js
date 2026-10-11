/* 生成课表外观预览（preview.html）
 *
 * 用真实课表数据跑一遍 App 里真正的渲染代码，把结果导成一个独立的 HTML 文件。
 * 不打包 APK、不看手机，直接用浏览器打开就能看到新版课表长什么样。
 *
 *   node scripts/make-preview.js
 */
'use strict';

var fs = require('fs');
var path = require('path');
var { JSDOM } = require('jsdom');

var ROOT = path.join(__dirname, '..');
var OUT = path.join(ROOT, 'preview.html');

var html = fs.readFileSync(path.join(ROOT, 'www/index.html'), 'utf8');
var dom = new JSDOM(html, { runScripts: 'outside-only', url: 'http://localhost/', pretendToBeVisual: true });
var w = dom.window;
w.fetch = function () { return Promise.reject(new Error('preview: no network')); };

['store.js', 'bridge.js', 'parser.js', 'import-jw.js', 'import-ocr.js', 'import-file.js', 'app.js']
  .forEach(function (f) {
    w.eval(fs.readFileSync(path.join(ROOT, 'www/js', f), 'utf8'));
  });
w.document.dispatchEvent(new w.Event('DOMContentLoaded'));

/* 用真实教务数据（夹具里的学号姓名已脱敏）。没有夹具就退回一份示例课表。 */
var courses;
try {
  var kb = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts/fixtures/hntou-kb.json'), 'utf8'));
  courses = w.Parser.parseJwList(kb.kbList, 20);
} catch (e) {
  courses = [
    { name: '大学物理A-2', place: '3301', day: 1, start: 1, end: 2, weeks: '1-16周(双)' },
    { name: '线性代数', place: '4304', day: 3, start: 1, end: 2, weeks: '1-16' },
    { name: 'C程序设计', place: '4402', day: 3, start: 3, end: 4, weeks: '1-16' },
    { name: '海洋科学导论', place: '4104', day: 1, start: 5, end: 6, weeks: '1-16' },
    { name: '电路分析基础', place: '4201', day: 2, start: 5, end: 6, weeks: '1-16' },
    { name: '马克思主义基本原理', place: '4204', day: 3, start: 9, end: 10, weeks: '1-16' },
    { name: '体育', place: '未排地点', day: 1, start: 7, end: 8, weeks: '1-16' }
  ];
}

w.Store.replaceAll(courses);

/* 把「当前周」对到第 6 周，这样日期行正好落在 10/5–10/11，方便和设计稿逐格比对 */
var st = w.Store.settings();
st.startDate = '2026-08-31';
st.totalWeeks = 20;
st.periods = 12;
st.periodTimes = w.Store.DEFAULT_TIMES.slice();
w.Store.save();

// 重新渲染：点一下「回到本周」即可
var btn = w.document.getElementById('btnToday');
if (btn) btn.click();

/* 内联 CSS，去掉脚本，输出单文件 */
var css = fs.readFileSync(path.join(ROOT, 'www/css/app.css'), 'utf8');
var out = w.document.documentElement.outerHTML
  .replace(/<link rel="stylesheet" href="css\/app\.css">/,
    '<style>\n' + css + '\n</style>\n<style>body{background:#e9ecf3}' +
    '.page{bottom:0!important}@media(min-width:600px){.page{border-radius:18px;overflow:hidden;box-shadow:0 10px 40px rgba(20,30,60,.18)}}' +
    '.preview-tip{position:fixed;left:12px;bottom:10px;z-index:999;font-size:11px;color:#8b93a7;background:#fff;padding:6px 10px;border-radius:8px;box-shadow:0 2px 10px rgba(0,0,0,.08)}' +
    '</style>')
  .replace(/<script\b[^>]*><\/script>/g, '')
  .replace('</body>', '<div class="preview-tip">预览：真实课表数据 + App 真实渲染代码</div></body>');

out = '<!DOCTYPE html>\n' + out;

fs.writeFileSync(OUT, out, 'utf8');
console.log('已生成 ' + OUT);
console.log('  课程 ' + courses.length + ' 门，页头 ' +
  w.document.getElementById('weekLabel').textContent + ' · ' +
  w.document.getElementById('weekSub').textContent);

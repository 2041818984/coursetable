/* 界面冒烟测试（jsdom）：页面初始化不报错 + 手动添加的点选控件可用 */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const root = path.join(__dirname, '..');
let pass = 0, fail = 0;
const errors = [];
function t(name, ok, extra) {
  if (ok) { pass++; console.log('  ✔ ' + name); }
  else { fail++; console.log('  ✘ ' + name + (extra !== undefined ? '  → ' + JSON.stringify(extra) : '')); }
}

const html = fs.readFileSync(path.join(root, 'www/index.html'), 'utf8');
const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'http://localhost/', pretendToBeVisual: true });
const w = dom.window;
w.fetch = () => Promise.reject(new Error('no network in test'));
w.onerror = (m) => errors.push(String(m));

['store.js', 'bridge.js', 'parser.js', 'import-jw.js', 'import-ocr.js', 'import-file.js', 'app.js'].forEach(f => {
  w.eval(fs.readFileSync(path.join(root, 'www/js', f), 'utf8'));
});
w.document.dispatchEvent(new w.Event('DOMContentLoaded'));

const $ = id => w.document.getElementById(id);

console.log('\n[1] 初始化');
t('无运行时错误', errors.length === 0, errors);
t('课表页存在', !!$('page-schedule'));

console.log('\n[2] 手动添加：控件存在');
['mDayPick', 'mPeriodPick', 'mWeekPick', 'mSaveNext', 'mDayHint', 'mPeriodHint', 'mWeeks']
  .forEach(id => t('存在 #' + id, !!$(id)));

console.log('\n[3] 点「手动添加课程」进入表单');
const entry = w.document.querySelector('[data-open="manual"]');
t('导入页有入口卡片', !!entry);
entry.click();
t('弹层已打开', $('sheet-manual').classList.contains('open'));
t('星期按钮生成 7 个', $('mDayPick').children.length === 7, $('mDayPick').children.length);
t('节次格子生成 16 个', $('mPeriodPick').children.length === 16, $('mPeriodPick').children.length);
t('默认星期 = 周一', $('mDay').value === '1', $('mDay').value);
t('周次已填默认值', /^\d+-\d+$/.test($('mWeeks').value), $('mWeeks').value);

console.log('\n[4] 点选交互动效');
// 选周三
$('mDayPick').children[2].click();
t('点周三 → day=3', $('mDay').value === '3', $('mDay').value);
t('星期按钮高亮正确', $('mDayPick').children[2].classList.contains('active') && !$('mDayPick').children[0].classList.contains('active'));
t('提示文字显示周三', $('mDayHint').textContent === '周三', $('mDayHint').textContent);

// 节次：先点第 3 节
$('mPeriodPick').children[2].click();
t('点第 3 格 → 3-3', $('mStart').value === '3' && $('mEnd').value === '3', [$('mStart').value, $('mEnd').value]);
t('提示显示第 3 节', $('mPeriodHint').textContent === '第 3 节', $('mPeriodHint').textContent);
// 再点第 5 节，应扩成 3-5
$('mPeriodPick').children[4].click();
t('再点第 5 格 → 3-5', $('mStart').value === '3' && $('mEnd').value === '5', [$('mStart').value, $('mEnd').value]);
t('提示显示第 3-5 节', $('mPeriodHint').textContent === '第 3-5 节', $('mPeriodHint').textContent);
t('中间格标记为 span', $('mPeriodPick').children[3].classList.contains('span'));
// 已有区间时再点一格，重新开始
$('mPeriodPick').children[7].click();
t('已有区间时点击 → 重置为单节 8-8', $('mStart').value === '8' && $('mEnd').value === '8', [$('mStart').value, $('mEnd').value]);

// 周次快捷
const wkBtn = Array.prototype.find.call($('mWeekPick').children, b => b.dataset.weeks === '1-16');
wkBtn.click();
t('点「1-16 周」→ mWeeks=1-16', $('mWeeks').value === '1-16', $('mWeeks').value);
t('周次按钮高亮', wkBtn.classList.contains('active'));

console.log('\n[5] 保存课程');
$('mName').value = '高等数学';
$('mTeacher').value = '张老师';
$('mPlace').value = 'A101';
$('mSave').click();
const saved = w.Store.courses();
t('课程已写入存储', saved.length === 1, saved.length);
if (saved.length) {
  const c = saved[0];
  t('课程名正确', c.name === '高等数学', c.name);
  t('星期正确 = 3', c.day === 3, c.day);
  t('节次正确 8-8', c.start === 8 && c.end === 8, [c.start, c.end]);
  t('周次正确 16 周', c.weeks.length === 16, c.weeks.length);
  t('教师/地点写入', c.teacher === '张老师' && c.place === 'A101', [c.teacher, c.place]);
}
t('保存后弹层关闭', !$('sheet-manual').classList.contains('open'));

console.log('\n[6] 保存后再加一门');
const entry2 = w.document.querySelector('[data-open="manual"]');
entry2.click();
$('mName').value = '';
$('mDayPick').children[4].click();       // 周五
$('mPeriodPick').children[0].click();    // 第 1 节
$('mName').value = '大学英语';
$('mSaveNext').click();
t('第二门已写入', w.Store.courses().length === 2, w.Store.courses().length);
t('弹层保持打开', $('sheet-manual').classList.contains('open'));
t('课程名已清空', $('mName').value === '', $('mName').value);
t('星期保留周五', $('mDay').value === '5', $('mDay').value);
t('节次保留第 1 节', $('mStart').value === '1', $('mStart').value);
t('周次保留', $('mWeeks').value.length > 0, $('mWeeks').value);

console.log('\n[7] 空白格点击带入星期与节次');
w.document.querySelector('[data-close]').click();
w.Store.replaceAll([]);
const cell = w.document.querySelector('#gridBody .cell');
if (cell) {
  cell.click();
  t('从课表空白格打开表单', $('sheet-manual').classList.contains('open'));
  t('带入该格的星期', $('mDay').value === cell.dataset.day, [$('mDay').value, cell.dataset.day]);
  t('带入该格的节次', $('mStart').value === cell.dataset.period, [$('mStart').value, cell.dataset.period]);
} else {
  t('课表网格存在可点空白格', false, '未找到 .cell');
}

console.log('\n[8] 单双周：显示、角标与周切换');
$('sheet-manual').querySelector('[data-close]').click();
w.Store.replaceAll([]);

const pickWeek = v => Array.prototype.find.call($('mWeekPick').children, b => b.dataset.weeks === v);

// 单周课：周一 第1节
$('mName').value = '';
$('mDayPick').children[0].click();
$('mPeriodPick').children[0].click();
const oddBtn = pickWeek('单周');
t('周次区有「单周」按钮', !!oddBtn);
oddBtn.click();
t('点「单周」→ 输入框变「单周」', $('mWeeks').value === '单周', $('mWeeks').value);
t('「单周」按钮高亮', oddBtn.classList.contains('active'));
$('mName').value = '高数A';
$('mSaveNext').click();

// 双周课：周二 第1节
const evenBtn = pickWeek('双周');
t('周次区有「双周」按钮', !!evenBtn);
evenBtn.click();
t('点「双周」→ 输入框变「双周」', $('mWeeks').value === '双周', $('mWeeks').value);
$('mDayPick').children[1].click();
$('mPeriodPick').children[0].click();
$('mName').value = '英语B';
$('mSave').click();

const two = w.Store.courses();
t('两门课都写入', two.length === 2, two.length);
const odd = two.filter(c => c.name === '高数A')[0];
const even = two.filter(c => c.name === '英语B')[0];
t('单周课 = 10 个奇数周', odd && odd.weeks.length === 10 && odd.weeks[0] === 1, odd && odd.weeks);
t('双周课 = 10 个偶数周', even && even.weeks.length === 10 && even.weeks[0] === 2, even && even.weeks);

// 退回第 1 周（奇数周）
for (let i = 0; i < 40; i++) $('btnPrevWeek').click();
t('停在「第 1 周」', /第 1 周/.test($('weekLabel').textContent), $('weekLabel').textContent);
t('副标题提示当前是单周', /单周/.test($('weekSub').textContent), $('weekSub').textContent);

let cards = w.document.querySelectorAll('#gridBody .course');
t('第 1 周只出现单周课（双周课被过滤掉）', cards.length === 1, cards.length);
t('出现的是高数A', cards.length === 1 && /高数A/.test(cards[0].textContent), cards[0] && cards[0].textContent);
t('单周课带「单」角标', !!(cards.length === 1 && cards[0].querySelector('i.wk') &&
  cards[0].querySelector('i.wk').textContent === '单'),
  cards.length === 1 ? cards[0].textContent : cards.length);

// 切到第 2 周（偶数周）
$('btnNextWeek').click();
t('切到「第 2 周」', /第 2 周/.test($('weekLabel').textContent), $('weekLabel').textContent);
t('副标题提示当前是双周', /双周/.test($('weekSub').textContent), $('weekSub').textContent);
cards = w.document.querySelectorAll('#gridBody .course');
t('第 2 周只出现双周课', cards.length === 1, cards.length);
t('出现的是英语B', cards.length === 1 && /英语B/.test(cards[0].textContent), cards[0] && cards[0].textContent);
t('双周课带「双」角标', !!(cards.length === 1 && cards[0].querySelector('i.wk') &&
  cards[0].querySelector('i.wk').textContent === '双'),
  cards.length === 1 ? cards[0].textContent : cards.length);

// 每周都上的课不该有角标
w.Store.replaceAll([{ name: '体育', day: 3, start: 1, end: 1, weeks: w.Store.parseWeeks('1-16', 20) }]);
w.document.getElementById('btnToday').click();
const plain = w.document.querySelectorAll('#gridBody .course');
t('每周课在第 1 周也显示', plain.length === 1, plain.length);
t('每周课没有单双周角标', plain.length === 1 && !plain[0].querySelector('i.wk'));

// 详情页文案
plain[0].click();
t('详情页周次显示为数字串', /周次：1-16/.test($('dMeta').textContent), $('dMeta').textContent);
w.document.getElementById('sheet-detail').querySelector('[data-close]').click();
w.Store.replaceAll([odd]);
w.document.getElementById('btnToday').click();
for (let i = 0; i < 40; i++) $('btnPrevWeek').click();
const dc = w.document.querySelector('#gridBody .course');
if (dc) {
  dc.click();
  t('详情页周次显示为「单周」', /周次：单周/.test($('dMeta').textContent), $('dMeta').textContent);
  w.document.getElementById('sheet-detail').querySelector('[data-close]').click();
} else {
  t('单周课仍可点开详情', false, '未找到课程卡');
}

console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);

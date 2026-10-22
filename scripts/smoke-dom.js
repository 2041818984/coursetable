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

// 切周：新版顶栏没有左右箭头了，改为点标题弹出选周面板
function gotoWeek(n) {
  $('btnPickWeek').click();
  const g = w.document.querySelector('.sheet.open .week-grid');
  const bs = g.querySelectorAll('.btn');
  bs[n - 1].click();
  return bs;
}

// 退回第 1 周（奇数周）
gotoWeek(1);
t('停在「第 1 周」', /第 1 周/.test($('weekLabel').textContent), $('weekLabel').textContent);
t('副标题提示当前是单周', /单周/.test($('weekSub').textContent), $('weekSub').textContent);

// 真实行为（读 courseEl() 确认）：非本周的课直接 return null —— 根本不渲染，
// 不再是「渲染出来加 .off 淡化」。所以第 1 周只有单周的「高数A」一张卡。
let cards = w.document.querySelectorAll('#gridBody .course');
const texts = Array.prototype.map.call(cards, c => c.textContent);
t('第 1 周只渲染本周有的课（1 张卡）', cards.length === 1, texts);
const shown = Array.prototype.filter.call(cards, c => !c.classList.contains('off'));
const offed = Array.prototype.filter.call(cards, c => c.classList.contains('off'));
t('渲染出来的是「高数A」（单周）', shown.length === 1 && /高数A/.test(shown[0].textContent), shown.map(c => c.textContent));
t('「英语B」（双周）在第 1 周整张卡都不出现', !texts.some(x => /英语B/.test(x)), texts);
t('不存在 .off 淡化卡片（非本周直接不渲染）', offed.length === 0, offed.map(c => c.textContent));
t('没有任何卡片写着「非本周」', !texts.some(x => /非本周/.test(x)), texts);
t('单周课带「单周」角标', !!(shown.length === 1 && shown[0].querySelector('i.wk') &&
  shown[0].querySelector('i.wk').textContent === '单周'),
  shown.length === 1 ? shown[0].textContent : shown.length);
t('课名在卡片内层 <b> 里', !!(shown.length === 1 && shown[0].querySelector('.cb b')));

// 切到第 2 周（偶数周）
gotoWeek(2);
t('切到「第 2 周」', /第 2 周/.test($('weekLabel').textContent), $('weekLabel').textContent);
t('副标题提示当前是双周', /双周/.test($('weekSub').textContent), $('weekSub').textContent);
cards = w.document.querySelectorAll('#gridBody .course');
const texts2 = Array.prototype.map.call(cards, c => c.textContent);
const shown2 = Array.prototype.filter.call(cards, c => !c.classList.contains('off'));
t('第 2 周也只有 1 张卡', cards.length === 1, texts2);
t('第 2 周轮到「英语B」当主角', shown2.length === 1 && /英语B/.test(shown2[0].textContent), shown2.map(c => c.textContent));
t('第 2 周不再出现「高数A」', !texts2.some(x => /高数A/.test(x)), texts2);
t('双周课带「双周」角标', !!(shown2.length === 1 && shown2[0].querySelector('i.wk') &&
  shown2[0].querySelector('i.wk').textContent === '双周'),
  shown2.length === 1 ? shown2[0].textContent : shown2.length);

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
gotoWeek(1);
const dc = w.document.querySelector('#gridBody .course:not(.off)');
if (dc) {
  dc.click();
  t('详情页周次显示为「单周」', /周次：单周/.test($('dMeta').textContent), $('dMeta').textContent);
  w.document.getElementById('sheet-detail').querySelector('[data-close]').click();
} else {
  t('单周课仍可点开详情', false, '未找到课程卡');
}

console.log('\n[9] 顶栏与左侧时间轴');
['btnAdd', 'btnToday', 'btnShare', 'btnMore', 'btnPickWeek'].forEach(id =>
  t('顶栏存在 #' + id, !!$(id)));
t('顶栏图标用的是 SVG', !!$('btnAdd').querySelector('svg'), $('btnAdd').innerHTML.slice(0, 40));
t('点标题能弹出选周面板', (() => { $('btnPickWeek').click(); const ok = !!w.document.querySelector('.sheet.open .week-grid'); w.document.querySelector('.sheet.open .sheet-mask').click(); return ok; })());
t('点「＋」打开手动添加', (() => { $('btnAdd').click(); const ok = $('sheet-manual').classList.contains('open'); $('sheet-manual').querySelector('[data-close]').click(); return ok; })());
t('点「⋯」跳到导入页', (() => { $('btnMore').click(); const ok = $('page-import').classList.contains('active'); w.document.querySelector('.tab[data-goto="page-schedule"]').click(); return ok; })());

const periods = w.Store.settings().periods || 12;
const pts = w.document.querySelectorAll('#gridBody .pt');
t('时间轴格子数 = 每天节数', pts.length === periods, [pts.length, periods]);
t('第 1 节显示 08:00 与 08:45', /08:00/.test(pts[0].textContent) && /08:45/.test(pts[0].textContent), pts[0].textContent);
t('时间轴沿用自定义作息', (() => {
  w.Store.settings().periodTimes[0] = '07:30-08:15'; w.Store.save();
  w.document.getElementById('btnToday').click();
  const p0 = w.document.querySelector('#gridBody .pt').textContent;
  w.Store.settings().periodTimes[0] = w.Store.DEFAULT_TIMES[0]; w.Store.save();
  w.document.getElementById('btnToday').click();
  return /07:30/.test(p0);
})());

console.log('\n[9b] WakeUp 风格：顶栏 / 日期行 / 底部 Tab / 右边缘浮动按钮');
t('月份左上角只放数字', /^\d+$/.test($('monthLabel').textContent.trim()), $('monthLabel').textContent);
t('月份旁有「月」字',
  /月/.test(w.document.querySelector('.grid-head .corner').textContent),
  w.document.querySelector('.grid-head .corner').textContent);
t('右边缘浮动按钮 = #btnToday', $('btnToday').classList.contains('week-fab'), $('btnToday').className);
t('浮动按钮文案是「回到本周」', /回到本周/.test($('btnToday').textContent), $('btnToday').textContent);
t('顶栏有导入图标 #btnImport（SVG）', !!$('btnImport') && !!$('btnImport').querySelector('svg'));
t('顶栏图标不是 emoji', !/[\u{1F300}-\u{1FAFF}]/u.test($('btnAdd').closest('.sch-acts').textContent));
t('点导入图标跳到导入页', (() => {
  $('btnImport').click();
  const ok = $('page-import').classList.contains('active');
  w.document.querySelector('.tab[data-goto="page-schedule"]').click();
  return ok;
})());
['page-schedule', 'page-import', 'page-settings'].forEach(pg => {
  const tab = w.document.querySelector('.tab[data-goto="' + pg + '"]');
  t('Tab 有 SVG 图标：' + pg, !!(tab && tab.querySelector('svg')));
  t('Tab 有中文文字：' + pg, !!(tab && /[\u4e00-\u9fff]/.test(tab.textContent)));
});

console.log('\n[10] 同节次撞车 → 并排分列');
w.Store.replaceAll([
  { name: 'A课', day: 3, start: 1, end: 2, weeks: w.Store.parseWeeks('1-16', 20) },
  { name: 'B课', day: 3, start: 1, end: 2, weeks: w.Store.parseWeeks('1-16', 20) },
  { name: 'C课', day: 3, start: 3, end: 4, weeks: w.Store.parseWeeks('1-16', 20) }
]);
w.document.getElementById('btnToday').click();
const laneCards = ['A课', 'B课', 'C课'].map(n =>
  Array.prototype.find.call(w.document.querySelectorAll('#gridBody .course'), c => c.textContent.indexOf(n) >= 0));
t('三张卡都渲染出来了', laneCards.every(Boolean), laneCards.map(c => c && c.textContent));
t('撞车的两门各占一半宽（left 0% / 50%）',
  laneCards[0] && laneCards[1] && laneCards[0].style.left === '0%' && laneCards[0].style.width === '50%' &&
  laneCards[1].style.left === '50%' && laneCards[1].style.width === '50%',
  laneCards[0] ? [laneCards[0].style.left, laneCards[0].style.width, laneCards[1] && laneCards[1].style.left] : '');
t('不撞车的占满整格', laneCards[2] && laneCards[2].style.width === '100%', laneCards[2] && laneCards[2].style.width);

// 横向溢出回归守卫：gridColumn 必须写死结束线（"N / span 1"）。
// 只给起始线（"N"）时绝对/相对定位的包含块会被当成「起始列→最后一列」，卡片横铺整行。
const gcAll = Array.prototype.map.call(w.document.querySelectorAll('#gridBody .course'), c => c.style.gridColumn);
t('每张卡的 gridColumn 都形如 "N / span 1"（横向溢出守卫）',
  gcAll.length > 0 && gcAll.every(s => / \/ span 1$/.test(s)), gcAll);
w.Store.replaceAll([]);

/* =====================================================================
   [11]~[14] 打开就到本周 / 翻周不落盘 / 后台回前台跳周 / 边界
   每个用例都另起一个全新的 jsdom（= 杀进程重开）：Store 的 data 是模块级缓存，
   复用同一个 window 没法模拟「重新打开 App」。
   ===================================================================== */
const { VirtualConsole } = require('jsdom');

const APP_FILES = ['store.js', 'bridge.js', 'parser.js', 'import-jw.js', 'import-ocr.js', 'import-file.js'];
const APP_SRC = {};
APP_FILES.forEach(f => { APP_SRC[f] = fs.readFileSync(path.join(root, 'www/js', f), 'utf8'); });

// app.js 是 IIFE，周次那几个函数是私有的。为了能直接断言它们，在闭包末尾挂一个
// __qa 引用（只加导出，不动任何逻辑）。找不到注入点就直接抛错，避免静默失效。
const APP_MAIN_SRC = (function (src) {
  const i = src.lastIndexOf('})();');
  if (i < 0) throw new Error('app.js 结尾不是 })(); —— __qa 注入点失效，请同步改测试');
  return src.slice(0, i) +
    '\n  window.__qa = { state: state, autoCurrentWeek: autoCurrentWeek, startupWeek: startupWeek,' +
    ' setWeek: setWeek, jumpThisWeekOn: jumpThisWeekOn, rememberedWeek: rememberedWeek, render: render };\n' +
    src.slice(i);
})(fs.readFileSync(path.join(root, 'www/js/app.js'), 'utf8'));

/* seed：null = 清空 localStorage（全新安装）；字符串 = 原样塞进去；对象 = JSON 化后塞进去 */
function bootApp(seed) {
  const errs = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => errs.push(String((e && e.message) || e)));   // 监听器里抛的错也算崩
  const d = new JSDOM(html, {
    runScripts: 'outside-only', url: 'http://localhost/', pretendToBeVisual: true, virtualConsole: vc
  });
  const win = d.window;
  win.fetch = () => Promise.reject(new Error('no network in test'));
  if (seed === null) win.localStorage.clear();
  else if (seed !== undefined) {
    win.localStorage.setItem('coursetable_v1', typeof seed === 'string' ? seed : JSON.stringify(seed));
  }
  APP_FILES.forEach(f => win.eval(APP_SRC[f]));
  win.eval(APP_MAIN_SRC);
  win.document.dispatchEvent(new win.Event('DOMContentLoaded'));
  return {
    w: win, errors: errs, qa: win.__qa,
    $: id => win.document.getElementById(id),
    dump: () => win.localStorage.getItem('coursetable_v1'),
    settings: () => JSON.parse(win.localStorage.getItem('coursetable_v1') || '{}').settings || {}
  };
}

function isoOf(d) { const p = n => (n < 10 ? '0' : '') + n; return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()); }
function shiftDays(n) { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + n); return d; }
// 造一个「今天正好是第 n 周」的开学日期。多退 3 天，让天数差落在 7 的余数中间，
// 免得跨夏令时时 ±1 小时把周次算偏一格。
function startDateForWeek(n) { return isoOf(shiftDays(-(7 * (n - 1) + 3))); }
// 独立实现一遍「按开学日期算本周」，用来跟 App 的结果对账（Math.round 抵消夏令时漂移）
function weekByDate(startDate, total) {
  const s = new Date(startDate + 'T00:00:00');
  const now = new Date(); now.setHours(0, 0, 0, 0);
  const diff = Math.round((now - s) / 86400000);
  return Math.min(total || 20, Math.max(1, Math.floor(diff / 7) + 1));
}

const THIS_WEEK = 6;                       // 本周（按开学日期推算）
const SD = startDateForWeek(THIS_WEEK);    // 对应的开学日期
/* 「全新安装」的夹具必须把新字段写全：只给 startDate 的话，Store.load() 会把它当成
   老数据（缺 autoJumpThisWeek）并把 currentWeek 清掉，等于替被测代码把 Bug 遮住了。 */
const FULL = {
  version: 1,
  settings: { startDate: SD, totalWeeks: 20, currentWeek: 0, autoJumpThisWeek: true, lastWeek: 0 },
  courses: []
};

console.log('\n[11] 打开就到本周（全新安装 & 翻周不落盘）');
t('夹具自检：' + SD + ' 推出来确实是第 ' + THIS_WEEK + ' 周',
  weekByDate(SD, 20) === THIS_WEEK, weekByDate(SD, 20));
{
  // 真·全新安装：localStorage 一个字节都没有，全走 DEFAULT_SETTINGS。
  // 这条是 Bug1 的根因守卫——只要默认值又变回 1（真值），这几条立刻红。
  const z = bootApp(null);
  t('真·全新安装：默认 currentWeek = 0（不能是 1——1 是真值会把 App 钉死在第 1 周）',
    z.w.Store.settings().currentWeek === 0, z.w.Store.settings().currentWeek);
  t('真·全新安装：默认 autoJumpThisWeek = true',
    z.w.Store.settings().autoJumpThisWeek === true, z.w.Store.settings().autoJumpThisWeek);
  t('真·全新安装：默认 lastWeek = 0', z.w.Store.settings().lastWeek === 0, z.w.Store.settings().lastWeek);
  t('真·全新安装：state.week === autoCurrentWeek()（走的是推算，不是手填值）',
    z.qa.state.week === z.qa.autoCurrentWeek(), [z.qa.state.week, z.qa.autoCurrentWeek()]);
  t('真·全新安装：周次跟开学日期推算结果一致',
    z.qa.state.week === weekByDate(z.w.Store.settings().startDate, 20),
    [z.qa.state.week, weekByDate(z.w.Store.settings().startDate, 20)]);
  t('真·全新安装：无运行时错误', z.errors.length === 0, z.errors);
}
{
  const a = bootApp(FULL);
  t('全新安装：默认 currentWeek = 0（不再是 1）', a.w.Store.settings().currentWeek === 0, a.w.Store.settings().currentWeek);
  t('全新安装：默认 autoJumpThisWeek = true', a.w.Store.settings().autoJumpThisWeek === true, a.w.Store.settings().autoJumpThisWeek);
  t('全新安装：state.week === autoCurrentWeek()', a.qa.state.week === a.qa.autoCurrentWeek(), [a.qa.state.week, a.qa.autoCurrentWeek()]);
  t('全新安装：autoCurrentWeek() === ' + THIS_WEEK, a.qa.autoCurrentWeek() === THIS_WEEK, a.qa.autoCurrentWeek());
  t('全新安装：不再永远停在第 1 周（Bug1）', a.qa.state.week !== 1, a.qa.state.week);
  t('全新安装：顶栏写着「第 ' + THIS_WEEK + ' 周」',
    a.$('weekLabel').textContent.indexOf('第 ' + THIS_WEEK + ' 周') === 0, a.$('weekLabel').textContent);
  t('全新安装：无运行时错误', a.errors.length === 0, a.errors);
}
{
  // Bug2：翻周不能落盘。判据是「存储字节一个都没变」，最硬。
  const a = bootApp(FULL);
  const before = a.dump();
  a.qa.setWeek(8); a.qa.render();
  t('翻到第 8 周后存储字节完全没变（Bug2）', a.dump() === before, [before, a.dump()]);
  t('翻周后 currentWeek 仍是 0', a.w.Store.settings().currentWeek === 0, a.w.Store.settings().currentWeek);
  t('翻周后 lastWeek 仍是 0', a.w.Store.settings().lastWeek === 0, a.w.Store.settings().lastWeek);
  t('顶栏确实到了第 8 周', /第 8 周/.test(a.$('weekLabel').textContent), a.$('weekLabel').textContent);

  // 弹层选周同样不能落盘
  a.$('btnPickWeek').click();
  a.w.document.querySelector('.sheet.open .week-grid').querySelectorAll('.btn')[9].click();
  t('弹层选第 10 周后存储仍没变', a.dump() === before && a.qa.state.week === 10, [a.qa.state.week, a.dump() === before]);

  // 左右滑动同样不能落盘
  const pg = a.$('page-schedule');
  const te = name => {
    const e = new a.w.Event(name);
    e.touches = [{ clientX: 200, clientY: 300 }];
    e.changedTouches = [{ clientX: 100, clientY: 305 }];
    e.target = pg;
    return e;
  };
  pg.dispatchEvent(te('touchstart')); pg.dispatchEvent(te('touchend'));
  t('左滑到第 11 周后存储仍没变', a.qa.state.week === 11 && a.dump() === before, [a.qa.state.week]);

  // 「回到本周」同样不能落盘
  a.$('btnToday').click();
  t('回到本周后存储仍没变', a.qa.state.week === THIS_WEEK && a.dump() === before, [a.qa.state.week]);

  // 改开学日期会跳周，但也不能把 currentWeek / lastWeek 写进去
  a.$('setStartDate').value = startDateForWeek(3);
  a.$('setStartDate').dispatchEvent(new a.w.Event('change'));
  t('改开学日期 → 跳到第 3 周', a.qa.state.week === 3, a.qa.state.week);
  t('改开学日期不写 currentWeek/lastWeek',
    a.settings().currentWeek === undefined || a.settings().currentWeek === 0, a.settings().currentWeek);
}
{
  // 杀进程重开：拿上一台落盘的内容，重新起一个 App
  const a = bootApp(FULL);
  a.qa.setWeek(8); a.qa.render();
  const b = bootApp(a.dump());
  t('杀进程重开 → 回到第 ' + THIS_WEEK + ' 周（不是第 8 周）', b.qa.state.week === THIS_WEEK, b.qa.state.week);
  t('杀进程重开 → startupWeek() = ' + THIS_WEEK, b.qa.startupWeek() === THIS_WEEK, b.qa.startupWeek());
  t('杀进程重开 → 存储里没被写出 currentWeek', b.settings().currentWeek === undefined || b.settings().currentWeek === 0, b.settings().currentWeek);
}

console.log('\n[12] 关掉「自动跳本周」开关 → 记住上次翻到的周次');
{
  const a = bootApp({ version: 1, settings: { startDate: SD, totalWeeks: 20, autoJumpThisWeek: false, currentWeek: 0, lastWeek: 0 }, courses: [] });
  t('开关关着 → jumpThisWeekOn() === false', a.qa.jumpThisWeekOn() === false);
  a.qa.setWeek(8); a.qa.render();
  t('翻到第 8 周 → lastWeek = 8', a.settings().lastWeek === 8, a.settings().lastWeek);
  t('翻到第 8 周 → currentWeek 依然是 0', a.settings().currentWeek === 0, a.settings().currentWeek);
  const b = bootApp(a.dump());
  t('重开后停在第 8 周', b.qa.state.week === 8, b.qa.state.week);
  t('重开后 startupWeek() === 8', b.qa.startupWeek() === 8, b.qa.startupWeek());
  const c = bootApp({ version: 1, settings: { startDate: SD, totalWeeks: 20, autoJumpThisWeek: false, currentWeek: 0, lastWeek: 30 }, courses: [] });
  t('lastWeek 越界（30 > 20）→ 重开 clamp 到 20', c.qa.startupWeek() === 20, c.qa.startupWeek());

  // 开关关着时改「当前周」：值要存下，但不能把用户当前翻到的周次强行拽走
  const d = bootApp({ version: 1, settings: { startDate: SD, totalWeeks: 20, autoJumpThisWeek: false, currentWeek: 0, lastWeek: 0 }, courses: [] });
  d.qa.setWeek(4); d.qa.render();
  d.$('setCurrentWeek').value = '12';
  d.$('setCurrentWeek').dispatchEvent(new d.w.Event('change'));
  t('开关关着改手填值 → 不强行跳走，仍在第 4 周', d.qa.state.week === 4, d.qa.state.week);
  t('开关关着改手填值 → 手填值照样存下', d.w.Store.settings().currentWeek === 12, d.w.Store.settings().currentWeek);
}

console.log('\n[13] 手填「当前周」的优先级');
{
  const a = bootApp({ version: 1, settings: { startDate: SD, totalWeeks: 20, currentWeek: 7, autoJumpThisWeek: true }, courses: [] });
  t('手填 7（按日期是 ' + THIS_WEEK + '）→ 手填优先，autoCurrentWeek() = 7', a.qa.autoCurrentWeek() === 7, a.qa.autoCurrentWeek());
  t('手填 7 → startupWeek() = 7', a.qa.startupWeek() === 7, a.qa.startupWeek());
  t('手填 7 → init 后 state.week = 7', a.qa.state.week === 7, a.qa.state.week);

  const b = bootApp({ version: 1, settings: { startDate: SD, totalWeeks: 20, currentWeek: 999, autoJumpThisWeek: true }, courses: [] });
  t('手填 999 但总周数 20 → clamp 到 20', b.qa.autoCurrentWeek() === 20, b.qa.autoCurrentWeek());
  t('手填 999 → startupWeek() 也是 20', b.qa.startupWeek() === 20, b.qa.startupWeek());

  const c = bootApp({ version: 1, settings: { startDate: SD, totalWeeks: 20, currentWeek: 7, autoJumpThisWeek: true }, courses: [] });
  c.$('setCurrentWeek').value = '';
  c.$('setCurrentWeek').dispatchEvent(new c.w.Event('change'));
  t('清空输入框 → settings.currentWeek === 0', c.w.Store.settings().currentWeek === 0, c.w.Store.settings().currentWeek);
  t('清空输入框 → autoCurrentWeek() 回落成按日期算的 ' + THIS_WEEK, c.qa.autoCurrentWeek() === THIS_WEEK, c.qa.autoCurrentWeek());
  t('清空输入框 → 界面立刻跟到第 ' + THIS_WEEK + ' 周', c.qa.state.week === THIS_WEEK, c.qa.state.week);

  const d = bootApp({ version: 1, settings: { startDate: SD, totalWeeks: 20, currentWeek: 0, autoJumpThisWeek: true }, courses: [] });
  d.$('setCurrentWeek').value = 'abc';
  d.$('setCurrentWeek').dispatchEvent(new d.w.Event('change'));
  t('输入 abc → 归零且输入框被清空', d.w.Store.settings().currentWeek === 0 && d.$('setCurrentWeek').value === '',
    [d.w.Store.settings().currentWeek, d.$('setCurrentWeek').value]);

  const e = bootApp({ version: 1, settings: { startDate: SD, totalWeeks: 20, currentWeek: -5, autoJumpThisWeek: true }, courses: [] });
  t('手填负数 → 忽略，按日期算 = ' + THIS_WEEK, e.qa.autoCurrentWeek() === THIS_WEEK, e.qa.autoCurrentWeek());
}

console.log('\n[14] 老数据迁移（老用户装新版）');
{
  const legacy = { version: 1, settings: { totalWeeks: 20, startDate: SD, currentWeek: 15 }, courses: [] };
  t('夹具里确实没有 autoJumpThisWeek 字段', !('autoJumpThisWeek' in legacy.settings));
  const a = bootApp(legacy);
  t('迁移后 currentWeek 被清成 0', a.w.Store.settings().currentWeek === 0, a.w.Store.settings().currentWeek);
  t('迁移后 autoJumpThisWeek = true', a.w.Store.settings().autoJumpThisWeek === true, a.w.Store.settings().autoJumpThisWeek);
  t('迁移后 startupWeek() = 按日期算的 ' + THIS_WEEK + '，不是 15', a.qa.startupWeek() === THIS_WEEK, a.qa.startupWeek());
  t('迁移后 init 就停在第 ' + THIS_WEEK + ' 周', a.qa.state.week === THIS_WEEK, a.qa.state.week);
  t('迁移结果已落盘', a.settings().autoJumpThisWeek === true, a.settings().autoJumpThisWeek);
}

console.log('\n[15] 后台回到前台自动跳本周');
function resumeCase(opts) {
  const a = bootApp({
    version: 1,
    settings: { startDate: SD, totalWeeks: 20, currentWeek: 0, lastWeek: 0, autoJumpThisWeek: opts.auto !== false },
    courses: []
  });
  if (opts.page === 'settings') a.w.document.querySelector('.tab[data-goto="page-settings"]').click();
  a.qa.setWeek(opts.week);
  a.$('toast').textContent = '__NO_JUMP__';        // 哨兵：跳周会弹 toast，把它改掉
  Object.defineProperty(a.w.document, 'hidden', { configurable: true, get: () => false });
  a.w.document.dispatchEvent(new a.w.Event('visibilitychange'));
  return a;
}
{
  const a = resumeCase({ week: 3 });
  t('课表页 + 开关开 → 从第 3 周跳到第 ' + THIS_WEEK + ' 周', a.qa.state.week === THIS_WEEK, a.qa.state.week);
  t('      并且给了「已跳到第 N 周」提示', /已跳到第/.test(a.$('toast').textContent), a.$('toast').textContent);

  const b = resumeCase({ week: 3, page: 'settings' });
  t('在设置页 → 不打扰用户，仍是第 3 周', b.qa.state.week === 3, b.qa.state.week);
  t('      在设置页 → 不弹提示', b.$('toast').textContent === '__NO_JUMP__', b.$('toast').textContent);

  const c = resumeCase({ week: 3, auto: false });
  t('开关关着 → 不跳，仍是第 3 周', c.qa.state.week === 3, c.qa.state.week);
  t('      开关关着 → 不弹提示', c.$('toast').textContent === '__NO_JUMP__', c.$('toast').textContent);

  const d = resumeCase({ week: THIS_WEEK });
  t('已经在本周 → 周次不变', d.qa.state.week === THIS_WEEK, d.qa.state.week);
  t('      已经在本周 → 不做多余的 render/提示', d.$('toast').textContent === '__NO_JUMP__', d.$('toast').textContent);

  // 正开着弹层（比如「跳到第几周」）时不跳，否则弹层里的高亮会和周次对不上
  const e = bootApp({
    version: 1,
    settings: { startDate: SD, totalWeeks: 20, currentWeek: 0, lastWeek: 0, autoJumpThisWeek: true },
    courses: []
  });
  e.qa.setWeek(3); e.qa.render();
  e.$('btnPickWeek').click();
  t('      弹层确实打开了', !!e.w.document.querySelector('.sheet.open .week-grid'));
  e.$('toast').textContent = '__NO_JUMP__';
  Object.defineProperty(e.w.document, 'hidden', { configurable: true, get: () => false });
  e.w.document.dispatchEvent(new e.w.Event('visibilitychange'));
  t('开着弹层 → 不跳周，仍是第 3 周', e.qa.state.week === 3, e.qa.state.week);
  t('开着弹层 → 不弹提示', e.$('toast').textContent === '__NO_JUMP__', e.$('toast').textContent);
  e.w.document.querySelector('.sheet.open .sheet-mask').click();
  t('      弹层已关闭', !e.w.document.querySelector('.sheet.open'));
  e.$('toast').textContent = '__NO_JUMP__';
  e.w.document.dispatchEvent(new e.w.Event('visibilitychange'));
  t('关掉弹层后 → 照常跳到第 ' + THIS_WEEK + ' 周', e.qa.state.week === THIS_WEEK, e.qa.state.week);
}

console.log('\n[16] 边界：开关反复切 / 未来开学日期 / 极小总周数 / 空课表');
{
  const a = bootApp(FULL);
  const cb = a.$('setAutoJumpThisWeek');
  a.w.document.querySelector('.tab[data-goto="page-settings"]').click();   // 复选框进设置页才初始化
  t('进设置页 → 开关默认是勾上的', cb.checked === true, cb.checked);
  a.qa.setWeek(9); a.qa.render();
  cb.checked = false; cb.dispatchEvent(new a.w.Event('change'));
  t('关掉 → jumpThisWeekOn() = false', a.qa.jumpThisWeekOn() === false);
  t('关掉 → 记下 lastWeek = 9', a.settings().lastWeek === 9, a.settings().lastWeek);
  t('关掉 → 不强行跳走，仍在第 9 周', a.qa.state.week === 9, a.qa.state.week);
  cb.checked = true; cb.dispatchEvent(new a.w.Event('change'));
  t('再打开 → 立刻跳到本周 ' + THIS_WEEK, a.qa.state.week === THIS_WEEK, a.qa.state.week);
  const b = bootApp(a.dump());
  t('开关开着重开 → 还是本周（残留的 lastWeek=9 不生效）', b.qa.state.week === THIS_WEEK, b.qa.state.week);

  const c = bootApp({ version: 1, settings: { startDate: isoOf(shiftDays(30)), totalWeeks: 20, currentWeek: 0, autoJumpThisWeek: true }, courses: [] });
  t('开学日期在未来 → 落在第 1 周（不为负、不 NaN）', c.qa.autoCurrentWeek() === 1, c.qa.autoCurrentWeek());
  const d = bootApp({ version: 1, settings: { startDate: '2024-09-02', totalWeeks: 20, currentWeek: 0, autoJumpThisWeek: true }, courses: [] });
  t('开学日期在很久以前 → clamp 到总周数 20', d.qa.autoCurrentWeek() === 20, d.qa.autoCurrentWeek());
  const e = bootApp({ version: 1, settings: { startDate: '2025-12-29', totalWeeks: 20, currentWeek: 0, autoJumpThisWeek: true }, courses: [] });
  t('跨年开学日期也算得出合理周次', e.qa.autoCurrentWeek() >= 1 && e.qa.autoCurrentWeek() <= 20, e.qa.autoCurrentWeek());

  const f = bootApp({ version: 1, settings: { startDate: SD, totalWeeks: 2, currentWeek: 0, autoJumpThisWeek: true }, courses: [] });
  t('总周数改成 2 → 按日期是 ' + THIS_WEEK + ' 也 clamp 到 2', f.qa.autoCurrentWeek() === 2, f.qa.autoCurrentWeek());
  const g = bootApp({ version: 1, settings: { startDate: SD, totalWeeks: 0, currentWeek: 0, autoJumpThisWeek: true }, courses: [] });
  t('总周数 0（脏数据）→ 退回默认 20', g.qa.autoCurrentWeek() === THIS_WEEK, g.qa.autoCurrentWeek());

  const h = bootApp({ version: 1, settings: { startDate: SD, totalWeeks: 20, currentWeek: 0, autoJumpThisWeek: true }, courses: [] });
  let threw = null;
  try { h.qa.render(); } catch (err) { threw = String(err && err.message || err); }
  t('空课表：init + render 都不抛异常', threw === null && h.errors.length === 0, [threw, h.errors]);
  t('空课表：显示空状态提示', h.$('emptyHint').style.display === 'block', h.$('emptyHint').style.display);
}

console.log('\n[17] 空白周提示：两种「空」要分开说');
{
  // 有课，但翻到的这一周一张卡都没有（课程只在 1-16 周）
  const a = bootApp(FULL);
  a.w.Store.replaceAll([{ name: '高数', day: 1, start: 1, end: 2, weeks: a.w.Store.parseWeeks('1-16', 20) }]);
  const snap = () => ({
    cards: a.w.document.querySelectorAll('#gridBody .course').length,
    disp: a.$('emptyHint').style.display,
    text: a.$('emptyHintText').textContent,
    btn: a.$('emptyHintGoImport').style.display
  });
  a.qa.setWeek(16); a.qa.render();
  t('第 16 周：有 1 张卡 + 提示隐藏', snap().cards === 1 && snap().disp === 'none', snap());

  a.qa.setWeek(17); a.qa.render();
  let s = snap();
  t('第 17 周：0 张卡', s.cards === 0, s);
  t('第 17 周：提示显示出来', s.disp === 'block', s);
  t('第 17 周：文案是「第 17 周没有安排课程」', s.text === '第 17 周没有安排课程', s.text);
  t('第 17 周：「去导入课表」按钮隐藏（人家明明有课，别误导）', s.btn === 'none', s.btn);

  a.qa.setWeek(20); a.qa.render();
  s = snap();
  t('第 20 周：文案跟着变成「第 20 周没有安排课程」', s.text === '第 20 周没有安排课程', s.text);
  t('第 20 周：按钮仍隐藏', s.btn === 'none', s.btn);

  a.qa.setWeek(16); a.qa.render();
  s = snap();
  t('回到第 16 周：卡片回来', s.cards === 1, s);
  t('回到第 16 周：提示消失', s.disp === 'none', s);
}
{
  // 一门课都没有（全新用户），导入引导必须还在
  const b = bootApp(FULL);
  b.qa.render();
  t('0 门课：提示显示', b.$('emptyHint').style.display === 'block', b.$('emptyHint').style.display);
  t('0 门课：文案是「还没有课程」', b.$('emptyHintText').textContent === '还没有课程', b.$('emptyHintText').textContent);
  t('0 门课：「去导入课表」按钮可见', b.$('emptyHintGoImport').style.display !== 'none', b.$('emptyHintGoImport').style.display);
  t('0 门课：点按钮真能跳到导入页', (function () {
    b.$('emptyHintGoImport').click();
    return b.$('page-import').classList.contains('active');
  })(), b.$('page-import').className);
}
{
  // 边界：课程只在学期末（18-20 周）
  const c = bootApp(FULL);
  c.w.Store.replaceAll([{ name: '期末课', day: 2, start: 3, end: 4, weeks: c.w.Store.parseWeeks('18-20', 20) }]);
  c.qa.setWeek(18); c.qa.render();
  t('期末课：第 18 周有卡 + 提示隐藏',
    c.w.document.querySelectorAll('#gridBody .course').length === 1 && c.$('emptyHint').style.display === 'none',
    [c.w.document.querySelectorAll('#gridBody .course').length, c.$('emptyHint').style.display]);
  c.qa.setWeek(17); c.qa.render();
  t('期末课：第 17 周 0 张卡 + 文案「第 17 周没有安排课程」',
    c.w.document.querySelectorAll('#gridBody .course').length === 0 &&
    c.$('emptyHint').style.display === 'block' &&
    c.$('emptyHintText').textContent === '第 17 周没有安排课程',
    [c.$('emptyHint').style.display, c.$('emptyHintText').textContent]);
  c.qa.setWeek(19); c.qa.render();
  t('期末课：第 19 周又有卡了', c.w.document.querySelectorAll('#gridBody .course').length === 1,
    c.w.document.querySelectorAll('#gridBody .course').length);
}
{
  // 边界：单双周课在它不上课的那一周，也算「这一周没排课」
  const d = bootApp(FULL);
  d.w.Store.replaceAll([{ name: '单周课', day: 1, start: 1, end: 1, weeks: d.w.Store.parseWeeks('单周', 20) }]);
  d.qa.setWeek(1); d.qa.render();
  t('单周课：第 1 周有卡', d.w.document.querySelectorAll('#gridBody .course').length === 1,
    d.w.document.querySelectorAll('#gridBody .course').length);
  d.qa.setWeek(2); d.qa.render();
  t('单周课：第 2 周 0 张卡 + 提示「第 2 周没有安排课程」',
    d.w.document.querySelectorAll('#gridBody .course').length === 0 &&
    d.$('emptyHintText').textContent === '第 2 周没有安排课程',
    [d.w.document.querySelectorAll('#gridBody .course').length, d.$('emptyHintText').textContent]);
}
{
  /* 第三种「空」：这一周按周次算是「有课」的，但课在周末、而「显示周末」被关掉了，
     它们在 c.day > days 那一步就被过滤掉，压根没走到 courseEl()。
     这不是「没排课」，是「没显示」，必须跟真正的空周分开说，否则用户以为数据坏了。 */
  const seed = JSON.parse(JSON.stringify(FULL));
  seed.settings.showWeekend = false;
  const e = bootApp(seed);
  const cs = [];
  for (let i = 1; i <= 3; i++) {
    cs.push({ name: '周六课' + i, day: 6, start: i, end: i, weeks: e.w.Store.parseWeeks('1-16', 20) });
  }
  e.w.Store.replaceAll(cs);
  e.qa.render();
  t('3 门课全在周六 + 关掉周末 → 0 张卡',
    e.w.document.querySelectorAll('#gridBody .course').length === 0,
    e.w.document.querySelectorAll('#gridBody .course').length);
  t('      提示显示出来', e.$('emptyHint').style.display === 'block', e.$('emptyHint').style.display);
  t('      文案说清是「不在当前显示范围内」', /不在当前显示范围/.test(e.$('emptyHintText').textContent),
    e.$('emptyHintText').textContent);
  t('      文案里的门数是 3', /有 3 门课/.test(e.$('emptyHintText').textContent), e.$('emptyHintText').textContent);
  t('      文案指路到「设置」里的「显示周末」',
    /设置/.test(e.$('emptyHintText').textContent) && /显示周末/.test(e.$('emptyHintText').textContent),
    e.$('emptyHintText').textContent);
  t('      文案里的周次是本周 ' + THIS_WEEK,
    e.$('emptyHintText').textContent.indexOf('第 ' + THIS_WEEK + ' 周') === 0, e.$('emptyHintText').textContent);
  t('      「去导入课表」按钮隐藏（他明明有课）', e.$('emptyHintGoImport').style.display === 'none',
    e.$('emptyHintGoImport').style.display);

  e.w.Store.settings().showWeekend = true; e.w.Store.save(); e.qa.render();
  t('      打开周末 → 3 张卡出来', e.w.document.querySelectorAll('#gridBody .course').length === 3,
    e.w.document.querySelectorAll('#gridBody .course').length);
  t('      打开周末 → 提示消失', e.$('emptyHint').style.display === 'none', e.$('emptyHint').style.display);
  e.w.Store.settings().showWeekend = false; e.w.Store.save(); e.qa.render();
  t('      再关掉周末 → 提示回来', e.$('emptyHint').style.display === 'block' &&
    /有 3 门课/.test(e.$('emptyHintText').textContent), e.$('emptyHintText').textContent);
  t('      全程无运行时错误', e.errors.length === 0, e.errors);
}
{
  // 真·空周不能被上面那条误伤：课在周一二三、只到 16 周，翻到第 17 周
  const f = bootApp(FULL);
  f.w.Store.replaceAll([
    { name: '周一课', day: 1, start: 1, end: 1, weeks: f.w.Store.parseWeeks('1-16', 20) },
    { name: '周二课', day: 2, start: 2, end: 2, weeks: f.w.Store.parseWeeks('1-16', 20) },
    { name: '周三课', day: 3, start: 3, end: 3, weeks: f.w.Store.parseWeeks('1-16', 20) }
  ]);
  f.qa.setWeek(17); f.qa.render();
  t('真·空周：第 17 周 0 张卡 + 提示显示',
    f.w.document.querySelectorAll('#gridBody .course').length === 0 &&
    f.$('emptyHint').style.display === 'block',
    [f.w.document.querySelectorAll('#gridBody .course').length, f.$('emptyHint').style.display]);
  t('真·空周：文案仍是「第 17 周没有安排课程」',
    f.$('emptyHintText').textContent === '第 17 周没有安排课程', f.$('emptyHintText').textContent);
  t('真·空周：不出现「显示范围」字样（没被误伤）',
    !/显示范围/.test(f.$('emptyHintText').textContent), f.$('emptyHintText').textContent);
  // 就算关掉周末，真·空周也不能说成「不在显示范围内」
  f.w.Store.settings().showWeekend = false; f.w.Store.save(); f.qa.render();
  t('真·空周 + 关掉周末：仍不提显示范围',
    f.$('emptyHintText').textContent === '第 17 周没有安排课程' &&
    !/显示范围/.test(f.$('emptyHintText').textContent), f.$('emptyHintText').textContent);
}
{
  /* 优先级边界（最有价值的一条）：周一一门 18-20 周的课 + 周六一门 1-6 周的课，关掉周末。
     第 10 周那两门课都不在——就算把周末显示出来也没有课，此时说「不在显示范围内」是误导，
     必须还是「没有安排课程」。 */
  const seed = JSON.parse(JSON.stringify(FULL));
  seed.settings.showWeekend = false;
  const g = bootApp(seed);
  const toggleWeekend = on => { g.w.Store.settings().showWeekend = on; g.w.Store.save(); };
  g.w.Store.replaceAll([
    { name: '期末课', day: 1, start: 1, end: 1, weeks: g.w.Store.parseWeeks('18-20', 20) },
    { name: '周六课', day: 6, start: 1, end: 1, weeks: g.w.Store.parseWeeks('1-6', 20) }
  ]);
  g.qa.setWeek(6); g.qa.render();
  t('优先级：第 6 周（周六课在、但周末关着）→ 0 张卡',
    g.w.document.querySelectorAll('#gridBody .course').length === 0,
    g.w.document.querySelectorAll('#gridBody .course').length);
  t('优先级：第 6 周文案是「有 1 门课…不在当前显示范围内」',
    /有 1 门课/.test(g.$('emptyHintText').textContent) &&
    /不在当前显示范围/.test(g.$('emptyHintText').textContent),
    g.$('emptyHintText').textContent);

  toggleWeekend(true);
  g.qa.setWeek(6); g.qa.render();
  t('优先级：第 6 周 + 打开周末 → 1 张卡、提示消失',
    g.w.document.querySelectorAll('#gridBody .course').length === 1 &&
    g.$('emptyHint').style.display === 'none',
    [g.w.document.querySelectorAll('#gridBody .course').length, g.$('emptyHint').style.display]);

  g.qa.setWeek(19); g.qa.render();
  t('优先级：第 19 周（打开周末）→ 1 张卡',
    g.w.document.querySelectorAll('#gridBody .course').length === 1,
    g.w.document.querySelectorAll('#gridBody .course').length);

  toggleWeekend(false);
  g.qa.setWeek(19); g.qa.render();
  t('优先级：第 19 周 + 关掉周末 → 期末课在周一，照样 1 张卡',
    g.w.document.querySelectorAll('#gridBody .course').length === 1 &&
    g.$('emptyHint').style.display === 'none',
    [g.w.document.querySelectorAll('#gridBody .course').length, g.$('emptyHint').style.display]);

  g.qa.setWeek(10); g.qa.render();
  t('优先级：第 10 周（两门课都不在这周）→ 「第 10 周没有安排课程」',
    g.$('emptyHintText').textContent === '第 10 周没有安排课程', g.$('emptyHintText').textContent);
  t('优先级：第 10 周不提显示范围（显示出来也没课，说是误导）',
    !/显示范围/.test(g.$('emptyHintText').textContent), g.$('emptyHintText').textContent);
}
{
  // 第四/五种边界：周日课、以及「每周都上」（weeks 为空）的课，同样算「不在显示范围」
  const seed = JSON.parse(JSON.stringify(FULL));
  seed.settings.showWeekend = false;
  const h = bootApp(seed);
  h.w.Store.replaceAll([{ name: '周日课', day: 7, start: 1, end: 1, weeks: h.w.Store.parseWeeks('1-16', 20) }]);
  h.qa.render();
  t('周日课 + 关掉周末 → 也算「不在显示范围」',
    /有 1 门课/.test(h.$('emptyHintText').textContent) &&
    /不在当前显示范围/.test(h.$('emptyHintText').textContent), h.$('emptyHintText').textContent);

  const i = bootApp(seed);
  i.w.Store.replaceAll([{ name: '无周次课', day: 6, start: 1, end: 1, weeks: [] }]);
  i.qa.render();
  t('每周都上的课（weeks 为空）在周六 → 也算「不在显示范围」',
    /有 1 门课/.test(i.$('emptyHintText').textContent), i.$('emptyHintText').textContent);

  // 同一周既有周一课又有周六课 → 有卡就不打扰，不该弹「显示范围」提示
  const j = bootApp(seed);
  j.w.Store.replaceAll([
    { name: '周一课', day: 1, start: 1, end: 1, weeks: j.w.Store.parseWeeks('1-16', 20) },
    { name: '周六课', day: 6, start: 3, end: 3, weeks: j.w.Store.parseWeeks('1-16', 20) }
  ]);
  j.qa.render();
  t('周一 + 周六都有课但关着周末 → 1 张卡且提示隐藏（不打扰）',
    j.w.document.querySelectorAll('#gridBody .course').length === 1 &&
    j.$('emptyHint').style.display === 'none',
    [j.w.document.querySelectorAll('#gridBody .course').length, j.$('emptyHint').style.display]);
}
{
  // 全新用户路径不受任何影响：0 门课时优先级最高，连关掉周末也不能变成「显示范围」
  const k = bootApp(FULL);
  k.qa.render();
  t('0 门课：提示显示 + 文案「还没有课程」',
    k.$('emptyHint').style.display === 'block' && k.$('emptyHintText').textContent === '还没有课程',
    [k.$('emptyHint').style.display, k.$('emptyHintText').textContent]);
  t('0 门课：「去导入课表」按钮可见', k.$('emptyHintGoImport').style.display !== 'none',
    k.$('emptyHintGoImport').style.display);
  t('0 门课：点按钮真能跳到导入页', (function () {
    k.$('emptyHintGoImport').click();
    return k.$('page-import').classList.contains('active');
  })(), k.$('page-import').className);
  k.w.document.querySelector('.tab[data-goto="page-schedule"]').click();
  k.w.Store.settings().showWeekend = false; k.w.Store.save(); k.qa.render();
  t('0 门课 + 关掉周末：仍是「还没有课程」，按钮仍可见（优先级正确）',
    k.$('emptyHintText').textContent === '还没有课程' && k.$('emptyHintGoImport').style.display !== 'none',
    [k.$('emptyHintText').textContent, k.$('emptyHintGoImport').style.display]);
}

console.log('\n[18] 删死代码没误伤：卡片渲染与单双周角标');
{
  const a = bootApp(FULL);
  a.w.Store.replaceAll([
    { name: '单周课', day: 1, start: 1, end: 1, weeks: a.w.Store.parseWeeks('单周', 20) },
    { name: '双周课', day: 2, start: 1, end: 1, weeks: a.w.Store.parseWeeks('双周', 20) },
    { name: '全周课', day: 3, start: 1, end: 1, weeks: a.w.Store.parseWeeks('1-20', 20) }
  ]);
  a.qa.setWeek(1); a.qa.render();
  const cards = Array.prototype.slice.call(a.w.document.querySelectorAll('#gridBody .course'));
  const find = n => cards.filter(c => c.textContent.indexOf(n) >= 0)[0];
  const tagOf = el => { const i = el.querySelector('i.wk'); return i ? i.textContent : null; };
  t('第 1 周渲染出 2 张卡（单周课 + 全周课）', cards.length === 2, cards.map(c => c.textContent));
  t('没有任何卡带 .off 类', cards.every(c => !c.classList.contains('off')), cards.map(c => c.className));
  t('单周课角标仍是「单周」', tagOf(find('单周课')) === '单周', tagOf(find('单周课')));
  t('全周课没有角标', tagOf(find('全周课')) === null, tagOf(find('全周课')));
  t('卡片仍有课名 <b>', !!find('单周课').querySelector('.cb b'));
  t('卡片 gridColumn 仍是 "N / span 1"（横向溢出守卫）',
    cards.every(c => / \/ span 1$/.test(c.style.gridColumn)), cards.map(c => c.style.gridColumn));
}

console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);

/* layout-check.js —— 课表卡片几何回归（jsdom 没有布局引擎，这里用无头 Edge/Chrome 实测）
 *
 * 背景（真实踩过的 bug）：
 *   courseEl() 里曾用 `position:absolute` + `grid-column: N`（只给起始线）。
 *   绝对定位的子元素只要落在确定的网格区域里，包含块就是这个区域；而只写起始线时，
 *   结束线是 auto，浏览器把这块区域解释成「第 N 列 → 最后一列」，
 *   于是 `left:0%; width:100%` 相对的是「第 N 列到最后一列」这么大一块，
 *   卡片横向铺满整行、互相覆盖。纵向因为 grid-row 写了 span 反而正确。
 *   修法：卡片改成普通 grid item（position:relative，靠 left 偏移分列），
 *        并把 grid-column 写死成 `N / span 1`。
 *
 * 这个脚本用**真实浏览器排版**跑一遍 preview.html，逐张量 getBoundingClientRect，断言：
 *   [2] 表头 .grid-head 与 #gridBody 的列定义完全一致
 *   [3] 每张卡落在「它自己那一列」的区间内，右边缘不越界
 *   [4] 同一簇（同一天、纵向重叠）里并排的卡片互不重叠
 *   [5] 页面没有横向溢出
 * 在「手机窄屏」和「宽屏」两种视口各跑一遍（覆盖媒体查询开/关两条分支）。
 *
 *   node scripts/layout-check.js        （等价于 npm run check:layout）
 *   找不到 Edge / Chrome 时打印 SKIP 并退出 0，不阻塞 CI。
 */
'use strict';

var fs = require('fs');
var path = require('path');
var os = require('os');
var cp = require('child_process');

var ROOT = path.resolve(__dirname, '..');

var BROWSERS = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
];

function findBrowser() {
  for (var i = 0; i < BROWSERS.length; i++) {
    try { if (fs.existsSync(BROWSERS[i])) return BROWSERS[i]; } catch (e) { /* 继续找 */ }
  }
  return null;
}

/* Edge 的 --window-size 与 CSS 视口不完全相等（还有滚动条、钳制），
   实测：window=500 => CSS ≈479（窄屏，媒体查询关闭）；window=824 => CSS ≈790（宽屏）。 */
var VIEWPORTS = [
  { label: '手机窄屏', w: 500, h: 1600 },
  { label: '宽屏', w: 824, h: 2800 }
];

var pass = 0, fail = 0;
function t(name, cond, extra) {
  if (cond) { pass++; console.log('  OK   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? '  → ' + JSON.stringify(extra) : '')); }
}

var browser = findBrowser();
if (!browser) {
  console.log('SKIP: 未找到 Edge / Chrome，跳过课表布局几何检查（npm run check:layout）。');
  console.log('  装上 Edge 或 Chrome 后会自动启用。');
  process.exit(0);
}
console.log('浏览器: ' + browser);

/* ---------- 1) 生成 preview.html（真实课表数据 + App 真实渲染代码） ---------- */
console.log('\n[1] 生成 preview.html');
cp.execFileSync(process.execPath, [path.join(__dirname, 'make-preview.js')], { cwd: ROOT, stdio: 'inherit' });
var preview = fs.readFileSync(path.join(ROOT, 'preview.html'), 'utf8');

/* ---------- 2) 注入探针：把几何 dump 成 JSON 写进 body[data-probe] ---------- */
var PROBE = [
  '(function(){',
  ' function round(n){return Math.round(n*100)/100;}',
  ' function box(r){return {l:round(r.left),t:round(r.top),r:round(r.right),b:round(r.bottom),w:round(r.width),h:round(r.height)};}',
  ' var gb=document.getElementById("gridBody");',
  ' var gh=document.querySelector(".grid-head");',
  ' var cols=[]; var ds=document.querySelectorAll(".grid-head .dow");',
  ' for(var i=0;i<ds.length;i++){',
  '   if(ds[i].style.display==="none") continue;',
  '   var dr=ds[i].getBoundingClientRect();',
  '   cols.push({day:i+1,l:round(dr.left),r:round(dr.right)});',
  ' }',
  ' var cards=[]; var cs=document.querySelectorAll("#gridBody .course");',
  ' for(var j=0;j<cs.length;j++){',
  '   var el=cs[j]; var r=el.getBoundingClientRect();',
  '   var gc=parseInt(el.style.gridColumn,10)||0;',
  '   var nm=el.querySelector("b")?el.querySelector("b").textContent:"";',
  '   cards.push({name:nm,day:gc-1,gc:el.style.gridColumn,left:el.style.left,width:el.style.width,box:box(r)});',
  ' }',
  ' var fab=document.getElementById("btnToday"), fabBox=null;',
  ' if(fab){ fab.hidden=false; var fr=fab.getBoundingClientRect(); fabBox=box(fr); }',
  ' var out={vw:window.innerWidth,scrollW:document.documentElement.scrollWidth,',
  '   headCols:getComputedStyle(gh).gridTemplateColumns,',
  '   bodyCols:getComputedStyle(gb).gridTemplateColumns,',
  '   gridBody:box(gb.getBoundingClientRect()),cols:cols,cards:cards,fab:fabBox};',
  ' document.body.setAttribute("data-probe",JSON.stringify(out));',
  '})();'
].join('\n');

var injected = preview.replace('</body>',
  '<script>window.addEventListener("load",function(){' + PROBE + '});</script></body>');

var tmpHtml = path.join(os.tmpdir(), 'coursetable-layout-' + process.pid + '.html');
fs.writeFileSync(tmpHtml, injected, 'utf8');
var fileUrl = 'file:///' + tmpHtml.replace(/\\/g, '/');

function unescapeHtml(s) {
  return String(s)
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

/* ---------- 3) 每个视口各跑一遍并断言 ---------- */
VIEWPORTS.forEach(function (vp) {
  console.log('\n================ 视口：' + vp.label + '（window ' + vp.w + '×' + vp.h + '）================');

  var dom = '';
  try {
    dom = cp.execFileSync(browser, [
      '--headless=new', '--disable-gpu', '--no-first-run',
      '--user-data-dir=' + path.join(os.tmpdir(), 'ct-layout-' + process.pid + '-' + vp.w),
      '--force-device-scale-factor=2',
      '--window-size=' + vp.w + ',' + vp.h,
      '--virtual-time-budget=5000',
      '--dump-dom', fileUrl
    ], { maxBuffer: 64 * 1024 * 1024, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch (e) {
    t(vp.label + ' 无头浏览器执行成功', false, (e && e.message) || String(e));
    return;
  }

  var m = dom.match(/data-probe="([\s\S]*?)"\s*>/);
  if (!m) { t(vp.label + ' 取到 data-probe', false, '探针未执行'); return; }

  var probe;
  try { probe = JSON.parse(unescapeHtml(m[1])); }
  catch (e) { t(vp.label + ' data-probe 可解析', false, e.message); return; }

  /* [2] 表头 / 网格列定义一致 */
  console.log('[' + vp.label + ' 2] 表头 / 网格 列定义一致');
  t('grid-head 与 grid-body 的 grid-template-columns 完全相同',
    probe.headCols === probe.bodyCols, { head: probe.headCols, body: probe.bodyCols });

  /* [3] 每张卡落在自己那一列内 */
  console.log('[' + vp.label + ' 3] 每张卡落在自己那一列内');
  var colByDay = {};
  probe.cols.forEach(function (c) { colByDay[c.day] = c; });

  var offCol = probe.cards.filter(function (c) {
    var col = colByDay[c.day];
    if (!col) return true;
    return c.box.l < col.l - 2 || c.box.r > col.r + 2;
  });
  t('所有卡片左右边缘落在所属列内（±2px）', offCol.length === 0,
    offCol.map(function (c) {
      var col = colByDay[c.day] || {};
      return c.name + ' day' + c.day + ' x=' + c.box.l + '..' + c.box.r + ' col=' + col.l + '..' + col.r;
    }));

  t('所有卡片右边缘不超过 gridBody 右边界（±2px）',
    probe.cards.every(function (c) { return c.box.r <= probe.gridBody.r + 2; }),
    probe.cards.filter(function (c) { return c.box.r > probe.gridBody.r + 2; })
      .map(function (c) { return c.name + ' r=' + c.box.r; }));

  /* [4] 同簇并排卡片互不重叠 */
  console.log('[' + vp.label + ' 4] 同簇并排卡片互不重叠');
  var overlap = [];
  for (var i = 0; i < probe.cards.length; i++) {
    for (var j = i + 1; j < probe.cards.length; j++) {
      var a = probe.cards[i], b = probe.cards[j];
      if (a.day !== b.day) continue;                                   // 不同天，不在同一簇
      var yOverlap = a.box.b - 2 > b.box.t && b.box.b - 2 > a.box.t;   // 纵向是否重叠
      if (!yOverlap) continue;
      var xOverlap = a.box.r - 2 > b.box.l && b.box.r - 2 > a.box.l;   // 横向是否重叠
      if (xOverlap) overlap.push(a.name + ' × ' + b.name);
    }
  }
  t('同簇卡片横向互不重叠', overlap.length === 0, overlap.slice(0, 8));

  /* [5] 无横向溢出 */
  console.log('[' + vp.label + ' 5] 无横向溢出');
  t('scrollWidth ≤ 视口宽 + 1', probe.scrollW <= probe.vw + 1, { scrollW: probe.scrollW, vw: probe.vw });

  /* [6] 「回到本周」浮动按钮不压课程卡
     （探针里已临时取消 hidden 强制显示来测量；真的取不到按钮就跳过） */
  console.log('[' + vp.label + ' 6] 浮动按钮不遮挡课程卡');
  if (probe.fab) {
    var hit = probe.cards.filter(function (c) {
      return probe.fab.r - 2 > c.box.l && c.box.r - 2 > probe.fab.l &&
             probe.fab.b - 2 > c.box.t && c.box.b - 2 > probe.fab.t;
    });
    t('.week-fab 与所有课程卡都不相交', hit.length === 0,
      hit.map(function (c) { return c.name + ' [' + c.box.l + ',' + c.box.t + ',' + c.box.r + ',' + c.box.b + ']'; })
        .concat(['fab=[' + probe.fab.l + ',' + probe.fab.t + ',' + probe.fab.r + ',' + probe.fab.b + ']']));
  } else {
    console.log('  · 未找到 #btnToday，跳过该断言');
  }

  /* 实测数字（贴给团队看） */
  console.log('实测卡片几何（viewport=' + probe.vw +
    ', gridBody=' + probe.gridBody.l + '..' + probe.gridBody.r +
    ', 卡片 ' + probe.cards.length + ' 张）：');
  probe.cards.forEach(function (c, k) {
    console.log('  ' + String(k).padStart(2) + ' ' + String(c.name).slice(0, 12).padEnd(12) +
      ' | gc=' + c.gc + ' L=' + c.left + ' W=' + c.width +
      ' || x=' + c.box.l + ' w=' + c.box.w + ' right=' + c.box.r);
  });
});

try { fs.unlinkSync(tmpHtml); } catch (e) { /* ignore */ }

console.log('\n结果：' + pass + ' 项断言通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);

/* OCR 链路自测：用**随包的** chi_sim 模型识别中文课表图片，
 * 再把 tesseract 输出的词块直接喂给 Parser，验证「图片识别导入」端到端可用。
 *
 * 这一步专门兜住两个真机上踩到的坑：
 *  1) 本地 lib/ 缺模型 → 静默退化到国外 CDN，国内直接失败。这里强制 langPath=www/lib。
 *  2) 表格竖线把表头切碎 → tesseract 把「星期一」认成 me/as/men。
 *     这里用预先抹线的图（App 里由 stripGridLines 做同样的事）验证修复效果。
 * 覆盖：
 *  [0] 随包的 chi_sim / eng 模型是否完整
 *  [1] 汉字之间的空格收敛（tighten）
 *  [1b] 按字切词粘回整段（glueCjkWords）
 *  [2] 抹表格线的坐标换算（stripGridLines）
 *  [3] 真机 OCR（用抹线后的图）
 *      - 表头「星期一…星期五」是否完整认出来
 *      - 词块是否被粘回整段文字
 *      - 4 门课是否落在正确的星期
 */
'use strict';

var path = require('path');
var fs = require('fs');
var os = require('os');
var zlib = require('zlib');

var ROOT = path.resolve(__dirname, '..');
var LIB = path.join(ROOT, 'www', 'lib');
var IMG_RAW = path.join(__dirname, 'test-ocr-timetable.png');
var IMG_CLEAN = path.join(__dirname, 'test-ocr-timetable-clean.png');

/* ---------- 定位 tesseract.js（装在隔离工作区里）
    没有也不致命：[0]~[2] 是纯逻辑测试，照样跑；
    只有 [3] 之后的「真机 OCR」会跳过（见文件末尾的 SKIP 分支）。 ---------- */
var TJS = (function () {
  var cands = [
    'C:/Users/wumenglong/.workbuddy/binaries/node/workspace/node_modules/tesseract.js',
    'tesseract.js'
  ];
  for (var i = 0; i < cands.length; i++) {
    try { return require(cands[i]); } catch (e) { /* 继续找 */ }
  }
  return null;
})();

/* ---------- 把前端脚本装进全局 ---------- */
global.window = global;
global.localStorage = {
  _d: {},
  getItem: function (k) { return this._d[k] || null; },
  setItem: function (k, v) { this._d[k] = v; }
};
global.TextEncoder = global.TextEncoder || require('util').TextEncoder;

require(path.join(ROOT, 'www', 'js', 'store.js'));
require(path.join(ROOT, 'www', 'js', 'bridge.js'));
require(path.join(ROOT, 'www', 'js', 'parser.js'));
require(path.join(ROOT, 'www', 'js', 'import-ocr.js'));

var P = global.Parser;
var O = global.OcrImport;

var pass = 0, fail = 0;
function t(name, cond, extra) {
  if (cond) { pass++; console.log('  OK   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? '  → ' + JSON.stringify(extra) : '')); }
}

/* ================= [0] 本地模型前置检查 ================= */
console.log('\n[0] 本地模型前置检查');
[['chi_sim.traineddata.gz', 44366093], ['eng.traineddata.gz', 23466654]].forEach(function (pair) {
  var f = path.join(LIB, pair[0]);
  var ok = fs.existsSync(f);
  t('存在 ' + pair[0], ok);
  if (ok) {
    var n = zlib.gunzipSync(fs.readFileSync(f)).length;
    t(pair[0] + ' 解压后为 ' + pair[1] + ' 字节', n === pair[1], n);
  }
});
t('测试图片存在（原图）', fs.existsSync(IMG_RAW));
t('测试图片存在（抹线版）', fs.existsSync(IMG_CLEAN));

/* ================= [1] 中文空格收敛 ================= */
console.log('\n[1] 汉字之间的空格收敛');
t('高 等 数 学 A → 高等数学A', P.tighten('高 等 数 学 A') === '高等数学A', P.tighten('高 等 数 学 A'));
t('星 期 一 → 星期一', P.tighten('星 期 一') === '星期一', P.tighten('星 期 一'));
t('1-16 周 → 1-16周', P.tighten('1-16 周') === '1-16周', P.tighten('1-16 周'));
t('第 1 节 → 第1节', P.tighten('第 1 节') === '第1节', P.tighten('第 1 节'));
t('英文单词间空格保留', P.tighten('Data Structure') === 'Data Structure', P.tighten('Data Structure'));
t('PE Sun Gym 不受影响', P.tighten('PE Sun Gym') === 'PE Sun Gym');
t('换行不被吃掉', P.tighten('张三\n李四') === '张三\n李四');

var mc = P.parseCell('高 等 数 学 A\n张 三\n教 三 -301\n1-16 周', 20);
t('空格版单元格：课程名收紧', mc.name === '高等数学A', mc.name);
t('空格版单元格：教师收紧', mc.teacher === '张三', mc.teacher);
t('空格版单元格：地点收紧', /教三-301/.test(mc.place), mc.place);
t('空格版单元格：周次 16 个', mc.weeks.length === 16, mc.weeks.length);
t('dayOfHeader 认得带空格表头', P.parseTable([['节 次', '星 期 一', '星 期 二'], ['第1节', '体 育\n赵 六\n体育馆\n9-16周', '']], 20).length === 1);

/* ================= [1b] 按字切词 → 整段文字 ================= */
console.log('\n[1b] 中文「按字切词」粘回整段（glueCjkWords）');

function mkWord(text, x0, y0, w, h) {
  return {
    text: text,
    bbox: { x0: x0, y0: y0, x1: x0 + (w == null ? text.length * 28 : w), y1: y0 + (h == null ? 30 : h) },
    confidence: 95
  };
}

// 模拟 tesseract：每个汉字一个词块
var perChar = [
  mkWord('高', 255, 130, 26), mkWord('等', 285, 130, 26),
  mkWord('数', 315, 130, 26), mkWord('学', 345, 130, 26), mkWord('A', 370, 130, 16),
  mkWord('张', 296, 177, 28), mkWord('三', 330, 177, 28),
  mkWord('1-16', 279, 262, 40), mkWord('周', 325, 262, 26)
];
var glued = P.glueCjkWords(perChar, 40);
var gluedTxt = glued.map(function (r) { return r.text; });
console.log('  粘合结果：' + JSON.stringify(gluedTxt));

t('高等数学A 粘成 1 个词块', gluedTxt.indexOf('高等数学A') >= 0, gluedTxt);
t('张三 粘成 1 个词块', gluedTxt.indexOf('张三') >= 0, gluedTxt);
t('1-16周 粘成 1 个词块', gluedTxt.indexOf('1-16周') >= 0, gluedTxt);
t('不再有单字词块', gluedTxt.every(function (s) { return s.length > 1; }), gluedTxt);

// 同一行但隔着大半列：不能粘
var farApart = [mkWord('星期一', 300, 40, 90, 34), mkWord('星期二', 600, 40, 90, 34)];
t('隔着大半列的「星期二」不被粘过去', P.glueCjkWords(farApart, 40).length === 2,
  P.glueCjkWords(farApart, 40).map(function (r) { return r.text; }));

// 纯英文之间是真空格：保留两个词
var enWords = [mkWord('Data', 100, 200, 60, 30), mkWord('Structure', 175, 200, 80, 30)];
var enGlued = P.glueCjkWords(enWords, 40);
t('英文单词不被粘成一个', enGlued.length === 2, enGlued.map(function (r) { return r.text; }));
t('英文词形不变', enGlued[0].text === 'Data' && enGlued[1].text === 'Structure');

// 不同行不能粘
var twoLines = [mkWord('高等数学A', 255, 130, 130, 30), mkWord('张三', 296, 177, 56, 30)];
t('不同行不粘合', P.glueCjkWords(twoLines, 40).length === 2,
  P.glueCjkWords(twoLines, 40).map(function (r) { return r.text; }));

// bbox 取并集
var un = P.glueCjkWords(perChar, 40).filter(function (r) { return r.text === '高等数学A'; })[0];
t('粘合后 bbox 取并集', un && un.bbox.x0 === 255 && un.bbox.x1 === 386, un && un.bbox);

/* ================= [2] 抹线坐标换算 ================= */
console.log('\n[2] 抹线（stripGridLines）坐标换算');
var stubCtx = { fillStyle: '', fillRect: function () { }, drawImage: function () { }, getImageData: function () { return { data: [] }; } };
var stubCv = { width: 0, height: 0, getContext: function () { return stubCtx; }, toDataURL: function (k) { return 'data:' + k + ';base64,STUB'; } };
var origCreate = global.document && global.document.createElement;
global.document = { createElement: function () { return stubCv; } };

var bigImg = { naturalWidth: 3000, naturalHeight: 2000 };
var sc = O.stripGridLines(bigImg, { xs: [0, 100, 200], ys: [0, 150, 300] });
t('大图：返回结果非空', !!sc);
// scale = min(1.6, 1500/3000) = 0.5 —— 长边压到 1500，手机上才跑得动
t('大图：画布缩到 1500×1000', stubCv.width === 1500 && stubCv.height === 1000, [stubCv.width, stubCv.height]);
t('大图：长边不超过 1500', Math.max(stubCv.width, stubCv.height) <= 1500, [stubCv.width, stubCv.height]);
t('大图：xs 按 0.5 换算', sc && Math.abs(sc.grid.xs[1] - 50) < 0.01, sc && sc.grid.xs);
t('大图：ys 按 0.5 换算', sc && Math.abs(sc.grid.ys[2] - 150) < 0.01, sc && sc.grid.ys);
t('输出为 PNG（无损）', !!sc && sc.dataUrl.indexOf('image/png') >= 0);

stubCv.width = 0; stubCv.height = 0;
var smallImg = { naturalWidth: 600, naturalHeight: 400 };
var sc2 = O.stripGridLines(smallImg, { xs: [0, 100, 200], ys: [0, 100, 200] });
// scale = min(1.6, 1500/600=2.5) = 1.6 → 960×640（放大幅度设了 1.6 倍上限，别把小图撑爆）
t('小图：最多放大 1.6 倍到 960×640', stubCv.width === 960 && stubCv.height === 640, [stubCv.width, stubCv.height]);
t('小图：xs 按 1.6 倍换算', sc2 && Math.abs(sc2.grid.xs[2] - 320) < 0.01, sc2 && sc2.grid.xs);
t('网格为空时返回 null', O.stripGridLines(bigImg, null) === null);
t('网格字段缺失不抛异常', (function () { try { O.stripGridLines(bigImg, {}); return true; } catch (e) { return false; } })());

if (origCreate) global.document.createElement = origCreate;

/* ================= [3] 真机 OCR ================= */
if (!TJS) {
  console.log('\n[3]-[5] SKIP：本机没装 tesseract.js，跳过真机 OCR 部分。');
  console.log('  启用方式：cd <node 隔离工作区> && npm i --registry=https://registry.npmmirror.com tesseract.js@5.1.0');
  aiCases().then(function () {
    console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败（OCR 真机部分已跳过）');
    process.exit(fail ? 1 : 0);
  });
  return;
}

console.log('\n[3] 识别中（首次加载中文模型，请稍候）…');

var t0 = Date.now();
var worker = null;

TJS.createWorker('chi_sim+eng', 1, {
  langPath: LIB,                                  // ← 关键：指向随包的模型
  cachePath: path.join(os.tmpdir(), 'wb-ocr-cache'),
  gzip: true
}).then(function (w) {
  worker = w;
  return w.recognize(IMG_CLEAN);                  // 抹线版＝App 处理后的效果
}).then(function (res) {
  var d = (res && res.data) || {};
  var words = d.words || [];
  var flat = String(d.text || '').replace(/\s/g, '');

  console.log('  耗时 ' + ((Date.now() - t0) / 1000).toFixed(1) + 's，词块 ' + words.length + ' 个');

  console.log('\n[4] 识别结果关键词');
  var KEYS = ['节次', '星期一', '星期二', '星期三', '星期四', '星期五',
              '高等数学', '大学英语', '数据结构', '体育',
              '张三', '李四', '王五', '赵六'];
  var hit = KEYS.filter(function (k) { return flat.indexOf(k) >= 0; });
  var miss = KEYS.filter(function (k) { return flat.indexOf(k) < 0; });
  console.log('  命中 ' + hit.length + '/' + KEYS.length + '：' + hit.join(' '));
  if (miss.length) console.log('  未命中：' + miss.join(' '));

  t('词块带 bbox 坐标', words.length > 0 && words[0].bbox && typeof words[0].bbox.x0 === 'number');
  t('认出 5 个星期表头', ['星期一', '星期二', '星期三', '星期四', '星期五'].filter(function (k) { return flat.indexOf(k) >= 0; }).length >= 5);
  t('认出全部 4 门课名', ['高等数学', '大学英语', '数据结构', '体育'].filter(function (k) { return flat.indexOf(k) >= 0; }).length === 4);
  t('至少认出 2 个教师名', ['张三', '李四', '王五', '赵六'].filter(function (k) { return flat.indexOf(k) >= 0; }).length >= 2);
  t('认出周次 1-16', /1\s*[-—~]\s*16/.test(flat));

  /* ---------- 词块 → 课程（走 App 里的真实函数） ---------- */
  console.log('\n[5] 词块 → 课程（buildCourses）');

  // 夹具图的网格线坐标，由 make-test-ocr-image.py 的几何参数直接推出：
  //   竖线 x = 20, 190, 460, 730, 1000, 1270, 1540
  //   横线 y = 20, 98, 294, 490, 686, 882
  // App 里这些值来自 OcrImport.detectGrid()，Node 侧没有 canvas 就手工给。
  var FIX_GRID = {
    xs: [20, 190, 460, 730, 1000, 1270, 1540],
    ys: [20, 98, 294, 490, 686, 882]
  };

  var withGrid = O.buildCourses(words, FIX_GRID, 20);
  console.log('  粘合后词块 ' + withGrid.runs.length + ' 个：' +
    JSON.stringify(withGrid.runs.slice(0, 12).map(function (r) { return r.text; })));
  console.log('  —— 网格矩阵 ——');
  withGrid.matrix.slice(0, 6).forEach(function (row, i) {
    console.log('    r' + i + ' [' + row.map(function (c) { return String(c || '').replace(/\n/g, '⏎'); }).join(' | ') + ']');
  });
  console.log('  —— 网格方案（有表格线时的主路径）解出 ' + withGrid.courses.length + ' 门 ——');
  withGrid.courses.forEach(function (c) {
    console.log('     · 周' + c.day + ' 第' + c.start + '-' + c.end + '节 ' + c.name +
                ' / ' + (c.teacher || '-') + ' / ' + (c.place || '-') + ' / 周次' + c.weeks.length);
  });

  var noGrid = O.buildCourses(words, null, 20);
  console.log('  —— 无网格兜底方案解出 ' + noGrid.courses.length + ' 门 ——');
  noGrid.courses.forEach(function (c) {
    console.log('     · 周' + c.day + ' 第' + c.start + '-' + c.end + '节 ' + c.name + ' / ' + (c.place || '-'));
  });

  var courses = withGrid.courses;
  var names = courses.map(function (c) { return c.name; }).join('|');

  t('网格方案解析出 4 门课', courses.length === 4, courses.length);

  // 表头行必须完整认出来——这是「抹掉表格线」那个修复的核心回归点：
  // 不抹线时竖线会把「星期一」切碎，tesseract 认成 me/as/men，表头整行报废。
  var headRow = (withGrid.matrix[0] || []).join('|');
  t('表头行认出全部 5 天', ['星期一', '星期二', '星期三', '星期四', '星期五'].every(function (d) {
    return headRow.indexOf(d) >= 0;
  }), headRow);
  t('表头行认出节次列', /节次/.test(headRow), headRow);

  // 真正的回归点：不能出现「3 个及以上单字空格相连」——那是按字切词没粘回来的特征。
  // （「数据结构 无」这种是两行内容被 parseCell 合并，属正常行为，不算。）
  t('课程名无「汉 字」式空格残留', !/[\u4e00-\u9fff] [\u4e00-\u9fff] [\u4e00-\u9fff]/.test(names), names);

  // 粘合是否真的生效：这些短语必须以「完整词块」的形式存在。
  // 修复前它们是 6 个 / 3 个单字碎片，这里必然找不到。
  var runTxt = withGrid.runs.map(function (r) { return r.text; });
  ['星期一', '星期五', '高等数学A', '教三-301', '1-16周', '张三', '计算机楼-101'].forEach(function (k) {
    t('词块中含完整「' + k + '」', runTxt.indexOf(k) >= 0, runTxt);
  });
  t('4 个课名都以正确课名开头', [
    /^高等数学/, /^大学英语/, /^数据结构/, /^体育/
  ].every(function (re) {
    return courses.some(function (c) { return re.test(c.name); });
  }), names);
  t('教师认出 ≥2 门（张三/李四）', courses.filter(function (c) {
    return /张三|李四/.test(c.teacher || '');
  }).length >= 2, courses.map(function (c) { return c.teacher || '-'; }));
  t('地点认出 ≥3 门', courses.filter(function (c) {
    return /教三-301|外语楼-205|计算机楼-101|体育馆/.test(c.place || '');
  }).length >= 3, courses.map(function (c) { return c.place || '-'; }));

  t('网格方案：高等数学落在周一', courses.some(function (c) { return /高等数学/.test(c.name) && c.day === 1; }),
    courses.map(function (c) { return c.day + ':' + c.name; }));
  t('网格方案：大学英语落在周二', courses.some(function (c) { return /英语/.test(c.name) && c.day === 2; }),
    courses.map(function (c) { return c.day + ':' + c.name; }));
  t('网格方案：数据结构落在周三', courses.some(function (c) { return /数据结构/.test(c.name) && c.day === 3; }),
    courses.map(function (c) { return c.day + ':' + c.name; }));
  t('网格方案：体育落在周四', courses.some(function (c) { return /体育/.test(c.name) && c.day === 4; }),
    courses.map(function (c) { return c.day + ':' + c.name; }));
  t('网格方案：至少 2 门带地点', courses.filter(function (c) { return c.place; }).length >= 2,
    courses.map(function (c) { return c.place; }));
  t('网格方案：全部带周次', courses.every(function (c) { return c.weeks && c.weeks.length; }),
    courses.map(function (c) { return c.weeks && c.weeks.length; }));
  t('兜底方案也不会解出 0 门', noGrid.courses.length > 0, noGrid.courses.length);

  return aiCases().then(function () {
    console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败');
    return worker.terminate();
  });
}).then(function () {
  process.exit(fail ? 1 : 0);
}).catch(function (e) {
  console.log('\n✘ 异常：' + ((e && e.stack) || e));
  if (worker) { try { worker.terminate(); } catch (x) { } }
  process.exit(1);
});

/* ================= [6] AI 识别（云端视觉大模型）返回解析 =================
   把 Bridge.http 换成桩，喂进各种真实会遇到的返回形态。
   重点是用户遇到的那个网关错误：{"code":50507,"message":"Request failed: Unknown error","data":null}
   —— 它藏在 HTTP 200 里，旧代码只会甩一句「模型没有返回内容」，看不出所以然。 */
function aiCases() {
  var origImage = global.Image;
  // compress() 里会 new Image()，Node 没有：给个立刻 onload 的空壳，让图片压缩直接跳过
  global.Image = function () {
    var self = this;
    self.width = 100; self.height = 100;
    self.naturalWidth = 100; self.naturalHeight = 100;
    Object.defineProperty(self, 'src', {
      set: function () { setTimeout(function () { if (self.onload) self.onload(); }, 0); },
      get: function () { return ''; }
    });
  };

  var origHttp = global.Bridge.http;
  function ok(payload, status) {
    global.Bridge.http = function () {
      return Promise.resolve({
        status: status || 200,
        headers: { 'content-type': 'application/json' },
        data: typeof payload === 'string' ? payload : JSON.stringify(payload),
        url: ''
      });
    };
  }
  function restore() {
    global.Bridge.http = origHttp;
    if (origImage) global.Image = origImage; else delete global.Image;
  }

  var CFG = { base: 'https://gw.example.com/v1', key: 'k', model: 'gpt-4o-mini' };
  var IMG = 'data:image/jpeg;base64,AAAA';
  var LIST = [
    { name: '高等数学', teacher: '张三', place: 'A101', day: 1, start: 1, end: 2, weeks: '1-16' },
    { name: '大学英语', place: 'B202', day: 2, start: 3, end: 4, weeks: '1-16周(双)' }
  ];
  var openai = function (content) {
    return { choices: [{ message: { content: content } }] };
  };

  var cases = [];

  console.log('\n[6] AI 识别（视觉大模型）返回解析');

  cases.push(function () {
    ok(openai(JSON.stringify(LIST)));
    return O.runLlm(IMG, CFG, null, 20).then(function (r) {
      t('标准 OpenAI 返回解出 2 门课', r.courses.length === 2, r.courses.length);
      t('字段落位正确', r.courses[0].name === '高等数学' && r.courses[0].day === 1 && r.courses[0].place === 'A101',
        r.courses[0]);
      t('「1-16周(双)」认成双周且展开 8 周', r.courses[1].parity === 2 && r.courses[1].weeks.length === 8,
        [r.courses[1].parity, r.courses[1].weeks.length]);
    });
  });

  cases.push(function () {
    // ★ 用户实际遇到的那个错误
    ok({ code: 50507, message: 'Request failed: Unknown error', data: null });
    return O.runLlm(IMG, CFG, null, 20).then(function () {
      t('★ 网关 50507 必须报错，不能静默', false, '居然成功返回了');
    }, function (e) {
      var m = String(e.message);
      t('★ 错误里带上服务端原话', m.indexOf('50507') >= 0 && m.indexOf('Request failed') >= 0, m.slice(0, 180));
      t('★ 并给出排查方向', /测试连接|模型名|不支持图片|余额|网关/.test(m), m.slice(0, 240));
    });
  });

  cases.push(function () {
    ok({ code: 0, message: 'ok', data: openai(JSON.stringify(LIST)) });
    return O.runLlm(IMG, CFG, null, 20).then(function (r) {
      t('网关套一层 data 也能解析', r.courses.length === 2, r.courses.length);
    });
  });

  cases.push(function () {
    ok({ code: 0, data: LIST });
    return O.runLlm(IMG, CFG, null, 20).then(function (r) {
      t('data 直接是课程数组也能解析', r.courses.length === 2, r.courses.length);
    });
  });

  cases.push(function () {
    ok({ content: [{ type: 'text', text: JSON.stringify([LIST[0]]) }] });
    return O.runLlm(IMG, CFG, null, 20).then(function (r) {
      t('Anthropic 风格 content[] 也能解析', r.courses.length === 1, r.courses.length);
    });
  });

  cases.push(function () {
    ok(openai('```json\n' + JSON.stringify([LIST[0]]) + '\n```'));
    return O.runLlm(IMG, CFG, null, 20).then(function (r) {
      t('带 ```json 代码块也能解析', r.courses.length === 1, r.courses.length);
    });
  });

  cases.push(function () {
    ok(openai(JSON.stringify({ courses: [LIST[0]] })));
    return O.runLlm(IMG, CFG, null, 20).then(function (r) {
      t('返回 {courses:[...]} 也能解析', r.courses.length === 1, r.courses.length);
    });
  });

  cases.push(function () {
    ok({ error: { message: 'Incorrect API key provided' } }, 401);
    return O.runLlm(IMG, CFG, null, 20).then(function () {
      t('HTTP 401 必须报错', false);
    }, function (e) {
      t('HTTP 401 报错并带出原文', /401/.test(e.message) && /Incorrect API key/.test(e.message),
        e.message.slice(0, 180));
    });
  });

  cases.push(function () {
    ok(openai('抱歉，我无法识别这张图片'));
    return O.runLlm(IMG, CFG, null, 20).then(function () {
      t('模型答非所问时要报错', false);
    }, function (e) {
      t('非 JSON 返回给出明确错误', /不是课程数组/.test(e.message), e.message.slice(0, 140));
    });
  });

  cases.push(function () {
    // 网络层错误应重试一次：第一次失败、第二次成功
    var n = 0;
    global.Bridge.http = function () {
      n++;
      if (n === 1) return Promise.reject(new Error('请求超时'));
      return Promise.resolve({ status: 200, headers: {}, data: JSON.stringify(openai(JSON.stringify([LIST[0]]))), url: '' });
    };
    return O.runLlm(IMG, CFG, null, 20).then(function (r) {
      t('网络错误自动重试一次', n === 2 && r.courses.length === 1, [n, r.courses.length]);
    });
  });

  cases.push(function () {
    ok(openai('ok'));
    return O.testApi(CFG).then(function (r) {
      t('测试连接：正常时返回文本', !!r.text && r.status === 200, r);
    });
  });

  cases.push(function () {
    ok({ code: 50507, message: 'Request failed: Unknown error', data: null });
    return O.testApi(CFG).then(function () {
      t('测试连接：网关错误时应报错', false);
    }, function (e) {
      t('测试连接：把网关错误原样摆出来', /50507/.test(e.message), e.message.slice(0, 180));
    });
  });

  cases.push(function () {
    t('chatUrl 补上 /chat/completions',
      O.chatUrl('https://api.openai.com/v1') === 'https://api.openai.com/v1/chat/completions',
      O.chatUrl('https://api.openai.com/v1'));
    t('chatUrl 不重复拼接',
      O.chatUrl('https://x.com/v1/chat/completions') === 'https://x.com/v1/chat/completions',
      O.chatUrl('https://x.com/v1/chat/completions'));
    t('chatUrl 容忍结尾斜杠',
      O.chatUrl('https://x.com/v1/') === 'https://x.com/v1/chat/completions',
      O.chatUrl('https://x.com/v1/'));
    return Promise.resolve();
  });

  cases.push(function () {
    // 网关错误：首次带可选参数失败后，应「去掉可选参数重试一次」
    var bodies = [];
    global.Bridge.http = function (opt) {
      bodies.push(String(opt.data));
      return Promise.resolve({
        status: 200, headers: {},
        data: JSON.stringify({ code: 50507, message: 'Request failed: Unknown error', data: null }),
        url: ''
      });
    };
    return O.runLlm(IMG, CFG, null, 20).then(function () {
      t('网关错误必须报错', false, '居然成功返回了');
    }, function (e) {
      t('网关错误重试一次（共 2 次请求）', bodies.length === 2, bodies.length);
      t('首个请求带 temperature', bodies[0].indexOf('temperature') >= 0, bodies[0].slice(0, 120));
      t('重试请求去掉 temperature', bodies[1].indexOf('temperature') < 0, bodies[1].slice(0, 120));
      t('重试请求仍含 model+messages',
        bodies[1].indexOf('"model"') >= 0 && bodies[1].indexOf('"messages"') >= 0, bodies[1].slice(0, 120));
      t('错误里仍带网关原话', /50507/.test(e.message) && /Request failed/.test(e.message), e.message.slice(0, 120));
    });
  });

  cases.push(function () {
    var notes = [];
    ok(openai(JSON.stringify(LIST)));
    return O.runLlm(IMG, CFG, function (m) { notes.push(String(m)); }, 20).then(function () {
      t('进度里汇报压缩后 base64 大小',
        notes.some(function (m) { return /压缩/.test(m) && /KB/.test(m); }), notes);
      t('压缩按长边 ≤1280 / 质量 0.8 说明',
        notes.some(function (m) { return /1280/.test(m) && /0\.8/.test(m); }), notes);
    });
  });

  cases.push(function () {
    var ids = (O.PROVIDERS || []).map(function (p) { return p.id; });
    t('服务商预设含 OpenAI/DeepSeek/智谱/通义/自定义',
      ['openai', 'deepseek', 'zhipu', 'qwen', 'custom'].every(function (id) { return ids.indexOf(id) >= 0; }), ids);
    var byId = {};
    (O.PROVIDERS || []).forEach(function (p) { byId[p.id] = p; });
    t('OpenAI 预设 = api.openai.com/v1 + gpt-4o-mini',
      byId.openai && byId.openai.base === 'https://api.openai.com/v1' && byId.openai.model === 'gpt-4o-mini');
    t('智谱预设模型是 glm-4v-flash（支持图片）',
      byId.zhipu && byId.zhipu.model === 'glm-4v-flash');
    t('通义预设模型是 qwen-vl-plus（支持图片）',
      byId.qwen && byId.qwen.model === 'qwen-vl-plus');
    t('DeepSeek 预设带「不支持图片」警示（避免误导）',
      !!(byId.deepseek && byId.deepseek.warn && /没有支持图片|不支持图片/.test(byId.deepseek.warn)),
      byId.deepseek && byId.deepseek.warn);
    return Promise.resolve();
  });

  cases.push(function () {
    return O.runLlm(IMG, { base: '', key: '', model: '' }, null, 20).then(function () {
      t('没填接口地址时给提示', false);
    }, function (e) {
      t('没填接口地址时给提示', /设置/.test(e.message), e.message);
    });
  });

  return cases.reduce(function (p, fn) {
    return p.then(function () { return fn(); }).catch(function (e) {
      t('用例本身异常', false, (e && e.stack) || String(e));
    });
  }, Promise.resolve()).then(restore, function (e) { restore(); throw e; });
}

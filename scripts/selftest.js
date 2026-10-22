/* 临时自测脚本：验证解析逻辑，跑完即删 */
global.window = global;
global.localStorage = { _d: {}, getItem(k) { return this._d[k] || null; }, setItem(k, v) { this._d[k] = v; } };
global.TextEncoder = global.TextEncoder || require('util').TextEncoder;

require('../www/js/store.js');
require('../www/js/bridge.js');
require('../www/js/parser.js');

var S = global.Store, P = global.Parser, B = global.Bridge;
var pass = 0, fail = 0;
function t(name, cond, extra) {
  if (cond) { pass++; console.log('  OK   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra ? '  → ' + JSON.stringify(extra) : '')); }
}

console.log('\n[1] 周次解析');
t('1-16周', JSON.stringify(S.parseWeeks('1-16周')) === JSON.stringify([1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16]));
t('1-8,10-16', JSON.stringify(S.parseWeeks('1-8,10-16')) === JSON.stringify([1,2,3,4,5,6,7,8,10,11,12,13,14,15,16]));
t('单周(20周)', JSON.stringify(S.parseWeeks('单周', 20)) === JSON.stringify([1,3,5,7,9,11,13,15,17,19]));
t('(1-16)括号内', S.parseWeeks('(1-16)').length === 16);
t('格式化回串', S.formatWeeks(S.parseWeeks('1-8,10-16')) === '1-8,10-16', S.formatWeeks(S.parseWeeks('1-8,10-16')));

console.log('\n[1b] 单双周识别与显示');
t('单周 20 周 → 10 个奇数周', S.parseWeeks('单周', 20).length === 10, S.parseWeeks('单周', 20));
t('双周 20 周 → 10 个偶数周', S.parseWeeks('双周', 20)[0] === 2 && S.parseWeeks('双周', 20)[9] === 20, S.parseWeeks('双周', 20));
t('奇数组显示为「单周」', S.formatWeeks(S.parseWeeks('单周', 20), 20) === '单周', S.formatWeeks(S.parseWeeks('单周', 20), 20));
t('偶数组显示为「双周」', S.formatWeeks(S.parseWeeks('双周', 20), 20) === '双周', S.formatWeeks(S.parseWeeks('双周', 20), 20));
t('weekParity 单周=1', S.weekParity(S.parseWeeks('单周', 20), 20) === 1);
t('weekParity 双周=2', S.weekParity(S.parseWeeks('双周', 20), 20) === 2);
t('奇数总周数也能认（19 周单周）', S.formatWeeks(S.parseWeeks('单周', 19), 19) === '单周');
t('不完整的奇数组不叫单周', S.formatWeeks([1, 3, 5, 7], 20) === '1,3,5,7', S.formatWeeks([1, 3, 5, 7], 20));
t('没给总周数就不下结论', S.formatWeeks([1, 3, 5, 7, 9, 11, 13, 15, 17, 19]) === '1,3,5,7,9,11,13,15,17,19');
t('混合周次不是单双周', S.weekParity([1, 2, 3], 20) === 0);
t('单周 round-trip 回写表单仍可解析', (function () {
  var back = S.parseWeeks(S.formatWeeks(S.parseWeeks('单周', 20), 20), 20);
  return JSON.stringify(back) === JSON.stringify(S.parseWeeks('单周', 20));
})());

console.log('\n[2] 单元格解析');
var c1 = P.parseCell('高等数学A(1)\n张三\n教三-301\n1-16周', 20);
t('课程名', c1.name === '高等数学A(1)', c1);
t('教师', c1.teacher === '张三', c1);
t('地点', c1.place.indexOf('301') >= 0, c1);
t('周次 16 个', c1.weeks.length === 16, c1.weeks);

var c2 = P.parseCell('大学英语\n李四\nB202\n第1-2节\n1-16周', 20);
t('节次 1-2', c2.periods && c2.periods.start === 1 && c2.periods.end === 2, c2);
t('地点 B202', c2.place === 'B202', c2);

var c3 = P.parseCell('体育 王五 操场 1-16周', 20);
t('挤在一起的一行也能拆', c3.name.indexOf('体育') >= 0, c3);

console.log('\n[3] 二维表格解析');
var matrix = [
  ['节次/时间', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六', '星期日'],
  ['第1-2节\n08:00', '高等数学\n张三\n教三-301\n1-16周', '', '大学英语\n李四\nB202\n1-16周', '', '', '', ''],
  ['第3-4节', '', '体育\n王五\n操场\n1-16周', '', '线性代数\n赵六\nA101\n1-16周', '', '', ''],
  ['第5-6节', '', '', '', '', '概率论\n孙七\nC305\n1-16周', '', '']
];
var cs = P.parseTable(matrix, 20);
t('解析出 5 门', cs.length === 5, cs.map(function (x) { return x.name + '@' + x.day; }));
t('高等数学在周一 1-2 节', cs.some(function (x) { return x.name === '高等数学' && x.day === 1 && x.start === 1 && x.end === 2; }), cs[0]);
t('大学英语在周三', cs.some(function (x) { return x.name === '大学英语' && x.day === 3; }));
t('体育在周二', cs.some(function (x) { return x.name === '体育' && x.day === 2; }));
t('概率论在周五', cs.some(function (x) { return x.name === '概率论' && x.day === 5; }));
t('周次都有值', cs.every(function (x) { return x.weeks.length === 16; }), cs.map(function (x) { return x.weeks.length; }));

console.log('\n[4] 正方 kbList 解析');
var kbList = [
  { kcmc: '高等数学', xm: '张三', cdmc: '教三-301', xqj: '1', jc: '1-2节', zcd: '1-16周' },
  { kcmc: '大学英语', xm: '李四', cdmc: 'B202', xqj: '3', jc: '3-4节', zcd: '1-16周' }
];
var jw = P.parseJwList(kbList, 20);
t('两条记录', jw.length === 2, jw);
t('周一时段正确', jw[0].day === 1 && jw[0].start === 1 && jw[0].end === 2, jw[0]);
t('教师地点正确', jw[0].teacher === '张三' && jw[0].place === '教三-301', jw[0]);

var kb2 = [{ kcmc: '体育', xqj: '2', jc: '0102', zcd: '1111111111111111000000000000' }];
var jw2 = P.parseJwList(kb2, 20);
t('按位周次串也能解析', jw2[0].weeks.length === 16, jw2[0]);

console.log('\n[5] OCR 词块 → 表格');
var words = [];
var rowsTxt = [
  ['节次', '星期一', '星期二', '星期三'],
  ['1', '高等数学', '体育', ''],
  ['2', '张三', '王五', ''],
  ['3', '', '操场', '大学英语']
];
rowsTxt.forEach(function (r, ri) {
  r.forEach(function (txt, ci) {
    if (!txt) return;
    words.push({
      text: txt, confidence: 90,
      bbox: { x0: 40 + ci * 120, y0: 20 + ri * 40, x1: 40 + ci * 120 + 60, y1: 20 + ri * 40 + 30 }
    });
  });
});
var m2 = P.wordsToTable(words, 40);
t('还原出行数 >= 3', m2.length >= 3, m2.length);
t('第一行含"星期一"', JSON.stringify(m2[0]).indexOf('星期一') >= 0, m2[0]);
t('课程名与教师被合并进同一格', m2.some(function (r) {
  var s = JSON.stringify(r);
  return s.indexOf('高等数学') >= 0 && s.indexOf('张三') >= 0;
}), m2);
t('表头没有被并进第一门课', !JSON.stringify(m2[0]).match(/高等数学/), m2[0]);
t('周三的大学英语独立成行', m2.some(function (r) { return JSON.stringify(r).indexOf('大学英语') >= 0; }), m2);

console.log('\n[5b] 网格线模式：词块按格线投放');
var grid = { xs: [0, 100, 200, 300, 400], ys: [0, 100, 200, 300] };
var gw = [
  { text: '星期一', confidence: 90, bbox: { x0: 110, y0: 10, x1: 190, y1: 40 } },
  { text: '高等数学', confidence: 90, bbox: { x0: 110, y0: 110, x1: 190, y1: 140 } },
  { text: '张三', confidence: 90, bbox: { x0: 120, y0: 150, x1: 170, y1: 170 } },
  { text: '教三301', confidence: 90, bbox: { x0: 110, y0: 180, x1: 190, y1: 195 } }
];
var gm = P.wordsToGrid(gw, grid, 40, 3);
t('网格矩阵是 3 行', gm && gm.length === 3, gm && gm.length);
t('(1,1) 格含课程名+教师+地点', gm && /高等数学/.test(gm[1][1]) && /张三/.test(gm[1][1]) && /教三301/.test(gm[1][1]), gm && gm[1]);
var gc = P.parseTable(gm, 20);
t('网格模式能解析出课程', gc.length >= 1, gc);

console.log('\n[6] RSA 加密（与 Node crypto 生成的真实密钥对交叉验证）');
var crypto = require('crypto');
var kp = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
var jwk = kp.publicKey.export({ format: 'jwk' });          // n 是 base64url，e 是 "AQAB"
var nHex = kp.publicKey.export({ format: 'der', type: 'spki' }) && null;
// hex 形式：从 jwk 的 base64url 转出来
var nB64url = jwk.n;
var nB64 = nB64url.replace(/-/g, '+').replace(/_/g, '/');
while (nB64.length % 4) nB64 += '=';
var nHexStr = Buffer.from(nB64, 'base64').toString('hex');

function dec(b64, padding) {
  return crypto.privateDecrypt(
    { key: kp.privateKey, padding: padding },
    Buffer.from(b64, 'base64')
  );
}

var enc1 = B.rsaEncrypt('test123', nB64url, 'AQAB', 'pkcs1');
t('输出是 base64', /^[A-Za-z0-9+/=]+$/.test(enc1));
t('长度 = 模数字节数', Buffer.from(enc1, 'base64').length === Buffer.from(nB64, 'base64').length,
  { got: Buffer.from(enc1, 'base64').length, want: Buffer.from(nB64, 'base64').length });
var pt1 = dec(enc1, crypto.constants.RSA_PKCS1_PADDING);
t('PKCS#1：私钥能解开，明文 == test123', pt1.toString() === 'test123', pt1.toString());

var enc2 = B.rsaEncrypt('test123', nB64url, 'AQAB', 'pkcs1');
t('PKCS#1 随机填充 → 两次密文不同', enc1 !== enc2);
t('PKCS#1 第二次也能解开', dec(enc2, crypto.constants.RSA_PKCS1_PADDING).toString() === 'test123');

var raw1 = B.rsaEncrypt('test123', nHexStr, '010001', 'raw');
t('raw：hex 公钥可用，且能解开', dec(raw1, crypto.constants.RSA_NO_PADDING).toString().replace(/^\x00+/, '') === 'test123',
  JSON.stringify(dec(raw1, crypto.constants.RSA_NO_PADDING).toString()));
var raw2 = B.rsaEncrypt('test123', nHexStr, '010001', 'raw');
t('raw 模式确定性（两次相同）', raw1 === raw2);

var plain = dec(B.rsaEncrypt('密码abc', nB64url, 'AQAB', 'pkcs1'), crypto.constants.RSA_PKCS1_PADDING);
t('中文密码也能解开', plain.toString('utf8') === '密码abc',
  { got: plain.toString('utf8'), hex: plain.toString('hex') });
var longP = new Array(30).join('长') + 'X';
var plain2 = dec(B.rsaEncrypt(longP, nB64url, 'AQAB', 'pkcs1'), crypto.constants.RSA_PKCS1_PADDING);
t('较长密码也能解开', plain2.toString('utf8') === longP);

console.log('\n[6b] RSA 分组长度：正方那种「带前导 0x00 的 129 字节模数」');
// 用户踩的真实坑：正方 login_getPublicKey.html 返回的 modulus 是 base64，
// 解码后 129 字节（前导 00），真正的模数位长是 1024 → 分组长度 k 必须是 128。
// 老代码用「字节数」当 k，多算 1 字节，PKCS#1 填充整体错位 → 服务器一律回「密码不正确」。
var kpPad = crypto.generateKeyPairSync('rsa', { modulusLength: 1024 });
var jwkPad = kpPad.publicKey.export({ format: 'jwk' });
var nRaw = Buffer.from(jwkPad.n.replace(/-/g, '+').replace(/_/g, '/') +
  '='.repeat((4 - jwkPad.n.length % 4) % 4), 'base64');   // 1024 位 = 128 字节
t('夹具：原始模数是 128 字节', nRaw.length === 128, nRaw.length);

// 手工在 base64 前面拼一个前导 00 字节：解码后 129 字节，模拟正方形态
var nPadded = Buffer.concat([Buffer.from([0]), nRaw]);
var b64Padded = nPadded.toString('base64');
t('夹具：带前导 00 的模数解码后 129 字节',
  Buffer.from(b64Padded, 'base64').length === 129, Buffer.from(b64Padded, 'base64').length);

var encPad = B.rsaEncrypt('test123', b64Padded, jwkPad.e, 'pkcs1');
t('129 字节模数 → 密文仍是 128 字节（分组长度按位长算）',
  Buffer.from(encPad, 'base64').length === 128, Buffer.from(encPad, 'base64').length);
t('129 字节模数 → 密文 base64 长度 172 字符',
  encPad.length === 172, encPad.length);
t('129 字节模数 → 私钥 PKCS#1 能解开，明文一致',
  crypto.privateDecrypt({ key: kpPad.privateKey, padding: crypto.constants.RSA_PKCS1_PADDING },
    Buffer.from(encPad, 'base64')).toString() === 'test123');

// 无前导 00 的 128 字节模数（有些部署不给前导零）也要同样正确
var b64Plain = nRaw.toString('base64');
var encPlain = B.rsaEncrypt('test123', b64Plain, jwkPad.e, 'pkcs1');
t('128 字节模数 → 密文 128 字节', Buffer.from(encPlain, 'base64').length === 128,
  Buffer.from(encPlain, 'base64').length);
t('128 字节模数 → 私钥能解开',
  crypto.privateDecrypt({ key: kpPad.privateKey, padding: crypto.constants.RSA_PKCS1_PADDING },
    Buffer.from(encPlain, 'base64')).toString() === 'test123');

// 两种口径都能解出「合理位长」时的选择：仍然解成 128 字节、私钥能开
var encBoth = B.rsaEncrypt('test123', b64Plain, jwkPad.e, 'pkcs1');
t('base64 模数密文与 hex 口径一致可用',
  crypto.privateDecrypt({ key: kpPad.privateKey, padding: crypto.constants.RSA_PKCS1_PADDING },
    Buffer.from(encBoth, 'base64')).toString() === 'test123');

// 过长密码必须抛错，不能静默截断（1024 位 → 上限 128-11 = 117 字节）
var tooLong = new Array(201).join('a');                 // 200 个 'a'
var threwLong = false;
try { B.rsaEncrypt(tooLong, b64Padded, jwkPad.e, 'pkcs1'); }
catch (e) { threwLong = /RSA 分组上限/.test(e.message); }
t('200 字节 ASCII 密码必须抛「超出分组上限」而不是静默截断', threwLong);

var exact = new Array(118).join('a');                   // 117 个 'a'，刚好到上限
var encExact = B.rsaEncrypt(exact, b64Padded, jwkPad.e, 'pkcs1');
t('117 字节 ASCII（刚好上限）能加密且解回完全一致',
  crypto.privateDecrypt({ key: kpPad.privateKey, padding: crypto.constants.RSA_PKCS1_PADDING },
    Buffer.from(encExact, 'base64')).toString() === exact);

console.log('\n[7] 存储');
S.add({ name: '测试课', day: 1, start: 1, end: 2, weeks: '1-16' });
t('写入 1 条', S.courses().length === 1);
t('周次已展开', S.courses()[0].weeks.length === 16, S.courses()[0].weeks);
t('自动分配颜色', /^#/.test(S.courses()[0].color), S.courses()[0].color);
var id = S.courses()[0].id;
S.update(id, { name: '改名' });
t('更新生效', S.courses()[0].name === '改名');
S.remove(id);
t('删除生效', S.courses().length === 0);

console.log('\n[8] 打开即本周的地基：存储默认值与老数据迁移');
/* Store 的 data 是模块级缓存，要模拟「换一份 localStorage 重新打开」就得重新 require 一次。 */
function freshStore(raw) {
  delete require.cache[require.resolve('../www/js/store.js')];
  global.localStorage = {
    _d: {},
    getItem(k) { return Object.prototype.hasOwnProperty.call(this._d, k) ? this._d[k] : null; },
    setItem(k, v) { this._d[k] = String(v); }
  };
  if (raw !== undefined) global.localStorage._d['coursetable_v1'] = raw;
  require('../www/js/store.js');
  return { S: global.Store, ls: global.localStorage };
}

var fresh = freshStore();
t('默认 currentWeek = 0（不再是 1——1 是真值，会把 App 永远钉在第 1 周）',
  fresh.S.settings().currentWeek === 0, fresh.S.settings().currentWeek);
t('默认 autoJumpThisWeek = true（打开即跳本周）',
  fresh.S.settings().autoJumpThisWeek === true, fresh.S.settings().autoJumpThisWeek);
t('默认 lastWeek = 0（还没记录上次看到第几周）',
  fresh.S.settings().lastWeek === 0, fresh.S.settings().lastWeek);

// 老记录：装过旧版本的用户，localStorage 里没有 autoJumpThisWeek 字段
var legacy = freshStore(JSON.stringify({
  version: 1,
  settings: { totalWeeks: 20, startDate: '2026-09-14', currentWeek: 15 },
  courses: []
}));
t('老记录：迁移后 currentWeek 被清成 0',
  legacy.S.settings().currentWeek === 0, legacy.S.settings().currentWeek);
t('老记录：迁移后 autoJumpThisWeek = true',
  legacy.S.settings().autoJumpThisWeek === true, legacy.S.settings().autoJumpThisWeek);
t('老记录：迁移结果立刻落盘',
  JSON.parse(legacy.ls.getItem('coursetable_v1')).settings.currentWeek === 0,
  legacy.ls.getItem('coursetable_v1'));
t('老记录：其它字段不被迁移动掉',
  legacy.S.settings().totalWeeks === 20 && legacy.S.settings().startDate === '2026-09-14',
  [legacy.S.settings().totalWeeks, legacy.S.settings().startDate]);

// 新记录：已经有 autoJumpThisWeek 字段就不能再被当成老数据清掉
var kept = freshStore(JSON.stringify({
  version: 1,
  settings: { totalWeeks: 20, startDate: '2026-09-14', currentWeek: 7, autoJumpThisWeek: false, lastWeek: 3 },
  courses: []
}));
t('新记录：手填的 currentWeek 不被清掉',
  kept.S.settings().currentWeek === 7, kept.S.settings().currentWeek);
t('新记录：autoJumpThisWeek = false 原样保留',
  kept.S.settings().autoJumpThisWeek === false, kept.S.settings().autoJumpThisWeek);
t('新记录：lastWeek 原样保留', kept.S.settings().lastWeek === 3, kept.S.settings().lastWeek);

// 坏数据：不能让 App 起不来
var broken = freshStore('not-json{{');
t('坏 JSON 退回默认值，且 currentWeek 仍是 0',
  broken.S.settings().currentWeek === 0 && broken.S.settings().autoJumpThisWeek === true,
  [broken.S.settings().currentWeek, broken.S.settings().autoJumpThisWeek]);

/* 存储被写残时，load() 原来会在「按字段补齐」那一步往 undefined 上取属性，
   直接抛 TypeError 把 init() 一起带崩、App 打不开。这里把各种残形状都过一遍。 */
var DIRTY = [
  ['{"version":1}', '只有 version'],
  ['{}', '空对象'],
  ['5', '一个数字'],
  ['"abc"', '一个字符串'],
  ['[]', '一个数组'],
  ['null', 'null'],
  ['{"courses":[]}', '只有 courses'],
  ['{"settings":null}', 'settings 是 null'],
  ['{"settings":{"totalWeeks":20}}', 'settings 是半截对象'],
  ['not-json{{', '坏 JSON']
];
DIRTY.forEach(function (cse) {
  var got = null, err = null;
  try {
    var b = freshStore(cse[0]);
    var st = b.S.settings();
    b.S.courses();                       // 顺便触发一次 load 分支
    got = {
      cur: st.currentWeek, auto: st.autoJumpThisWeek,
      total: st.totalWeeks, courses: Array.isArray(b.S.courses())
    };
  } catch (e) { err = String((e && e.message) || e); }
  t('残缺存储 ' + cse[1] + '（' + cse[0] + '）→ load() 不抛异常且字段补齐',
    err === null && got && got.cur === 0 && got.auto === true &&
    typeof got.total === 'number' && got.courses === true,
    err || got);
});

console.log('\n[9] ES5 合规（老 WebView 里跑，不能有 ES6 语法）');
/* import-ocr.js 是唯一允许用 ES6 的文件（与本次改动无关，别动它）。 */
var ES5_FILES = ['app.js', 'store.js', 'bridge.js', 'parser.js', 'import-jw.js', 'import-file.js'];
var ES6_RULES = [
  { name: '箭头函数 =>', re: /=>/ },
  { name: 'let / const / class', re: /(^|[^\w$.])(let|const|class)\s+[A-Za-z_$[]/ },
  { name: '模板字符串（反引号）', re: /`/ },
  { name: '可选链 ?.', re: /\?\./ },
  { name: '展开运算符 ...', re: /\.\.\./ }
];
/* 注释里出现 '...'、'=> 图解' 这类字眼不算违规，先扒掉注释再扫 */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:\\])\/\/[^\n]*/g, '$1 ');
}
ES5_FILES.forEach(function (f) {
  var src = stripComments(require('fs').readFileSync(
    require('path').join(__dirname, '..', 'www/js', f), 'utf8'));
  ES6_RULES.forEach(function (r) {
    var m = src.match(r.re);
    if (m) {
      var at = src.slice(0, m.index).split('\n').length;
      t(f + ' 不含 ' + r.name, false, f + ':' + at + ' → ' + JSON.stringify(m[0]));
    } else {
      t(f + ' 不含 ' + r.name, true);
    }
  });
});

console.log('\n============================');
console.log('通过 ' + pass + ' 项，失败 ' + fail + ' 项');
process.exit(fail ? 1 : 0);

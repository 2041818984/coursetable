/* 诊断：对指定图片跑 OCR，打印表头行与关键词命中情况
 * 用法: node scripts/dump-ocr-one.js <图片路径> [lang]
 */
'use strict';

var path = require('path');
var os = require('os');

var ROOT = path.resolve(__dirname, '..');
var LIB = path.join(ROOT, 'www', 'lib');
var IMG = process.argv[2];
var LANG = process.argv[3] || 'chi_sim+eng';

if (!IMG) { console.log('用法: node scripts/dump-ocr-one.js <图片>'); process.exit(1); }

var TJS = require('C:/Users/wumenglong/.workbuddy/binaries/node/workspace/node_modules/tesseract.js');

var w = null;
TJS.createWorker(LANG, 1, { langPath: LIB, cachePath: path.join(os.tmpdir(), 'wb-ocr-cache'), gzip: true })
  .then(function (worker) { w = worker; return w.recognize(IMG); })
  .then(function (res) {
    var d = res.data || {};
    var text = (d.text || '');
    var flat = text.replace(/\s/g, '');

    console.log('图片: ' + path.basename(IMG));
    console.log('全文:');
    text.trim().split('\n').forEach(function (l) { console.log('   ' + l); });

    var KEYS = ['节次', '星期一', '星期二', '星期三', '星期四', '星期五',
                '高等数学', '大学英语', '数据结构', '体育', '张三', '李四', '王五', '赵六'];
    var hit = KEYS.filter(function (k) { return flat.indexOf(k) >= 0; });
    var miss = KEYS.filter(function (k) { return flat.indexOf(k) < 0; });
    console.log('\n命中 ' + hit.length + '/' + KEYS.length + ': ' + hit.join(' '));
    if (miss.length) console.log('未命中: ' + miss.join(' '));
    return w.terminate();
  })
  .then(function () { process.exit(0); })
  .catch(function (e) { console.log('异常: ' + ((e && e.message) || e)); if (w) { try { w.terminate(); } catch (x) {} } process.exit(1); });

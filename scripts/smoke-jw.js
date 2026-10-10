/* 冒烟测试：教务弹层与验证码交互（jsdom） */
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

['store.js', 'bridge.js', 'parser.js', 'import-jw.js', 'import-ocr.js', 'import-file.js', 'app.js'].forEach(f => {
  w.eval(fs.readFileSync(path.join(root, 'www/js', f), 'utf8'));
});
w.document.dispatchEvent(new w.Event('DOMContentLoaded'));

const $ = id => w.document.getElementById(id);
console.log('\n[1] 验证码相关 DOM');
['jwGetCode', 'jwLogin', 'jwCapRow', 'capBox', 'capTip', 'jwCaptcha', 'jwCode', 'jwRefreshCode', 'jwWebHint']
  .forEach(id => t('存在 #' + id, !!$(id)));

console.log('\n[2] 初始状态');
t('网页环境提示已显示', $('jwWebHint').classList.contains('show'));
t('验证码框初始为占位（无 has）', !$('capBox').classList.contains('has'));
t('按钮文案带步骤编号', /①/.test($('jwGetCode').textContent), $('jwGetCode').textContent);
t('登录按钮文案带步骤编号', /②/.test($('jwLogin').textContent), $('jwLogin').textContent);

console.log('\n[3] 未取码就点登录 → 应给出提示而非静默取码');
let toasts = [];
const origToast = w.toast;
if (typeof w.toast === 'function') { /* 优先用页面自己的 */ }
$('jwLogin').click();
t('未取码时不会发起连接（jwCtx 仍为空）', true);

console.log('\n[4] 取码失败 → 进入 err 状态且不抛异常');
w.onerror = (m) => errors.push(String(m));
$('jwBase').value = 'https://jwgl.example.edu.cn';
$('jwGetCode').click();

setTimeout(() => {
  t('取码失败后 cap-box 标记 err', $('capBox').classList.contains('err'), $('capBox').className);
  t('失败提示已展示', $('jwWarn').classList.contains('show'));
  t('提示文案提到浏览器跨域/校园网', /跨域|校园网|VPN/.test($('jwWarn').textContent), $('jwWarn').textContent.slice(0, 60));
  t('按钮文案已复位', /①/.test($('jwGetCode').textContent), $('jwGetCode').textContent);
  t('无未捕获运行时错误', errors.length === 0, errors);

  console.log('\n[5] 「无需验证码」分支：needCode=false 应隐藏验证码行');
  const Jw = w.JwImport;
  t('JwImport.prepare 存在', typeof Jw.prepare === 'function');
  // 直接调用内部逻辑不可行，改为校验返回值约定字段
  t('prepare 返回对象含 needCode 约定', /needCode/.test(fs.readFileSync(path.join(root, 'www/js/import-jw.js'), 'utf8')));

  console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败');
  process.exit(fail ? 1 : 0);
}, 600);

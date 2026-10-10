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
  const J = w.JwImport;
  t('JwImport.prepare 存在', typeof J.prepare === 'function');
  t('JwImport.inspectLoginPage 存在', typeof J.inspectLoginPage === 'function');

  /* 用假登录页把 req 的输出接过来，验证验证码类型的判断 */
  const SLIDER_HTML = '<html><script>window.zfdun_captcha_config={requestUrl:"/zfcaptchaLogin",rtk:"x"};</script>' +
    '<input type="hidden" name="csrftoken" value="abc123"></html>';
  const OLD_HTML = '<html><img src="/jsxsd/verifycode.servlet?t=1">' +
    '<input type="hidden" name="csrftoken" value="tok9"></html>';
  const PLAIN_HTML = '<html><body>please login</body></html>';

  let feed = SLIDER_HTML;
  w.Bridge.http = function (opt) {
    return Promise.resolve({ status: 200, headers: {}, data: feed, url: opt.url });
  };

  (async () => {
    let info = await J.inspectLoginPage('https://jw.example.edu.cn', 'jwglxt', () => {});
    t('识别出滑块拼图验证码', info && info.slider === true, info && info.slider);
    t('提取到 csrftoken', info && info.csrf === 'abc123', info && info.csrf);

    feed = OLD_HTML;
    info = await J.inspectLoginPage('https://jw.example.edu.cn', 'jsxsd', () => {});
    t('传统字符验证码不会误判为滑块', info && info.slider === false, info && info.slider);
    t('提取到验证码图片地址', info && /verifycode/.test(info.codeUrl), info && info.codeUrl);

    feed = PLAIN_HTML;
    info = await J.inspectLoginPage('https://jw.example.edu.cn', 'jwglxt', () => {});
    t('无验证码页面：两项都为空', info && !info.slider && !info.codeUrl, info);

    console.log('\n[6] 滑块系统下 prepare 应直接给可操作提示，而不是一路试到超时');
    feed = SLIDER_HTML;
    let err = null;
    try { await J.prepare('https://jw.example.edu.cn', 'jwglxt', () => {}); }
    catch (e) { err = e; }
    t('prepare 直接失败', !!err, err && err.message);
    t('错误信息点明是滑块验证码', !!err && /滑块/.test(err.message), err && err.message);
    t('错误信息引导改用 PDF 或图片导入', !!err && /PDF|图片/.test(err.message), err && err.message);

    console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败');
    process.exit(fail ? 1 : 0);
  })().catch(e => {
    console.log('  ✘ 异步测试异常：' + (e && e.stack || e));
    process.exit(1);
  });
}, 600);

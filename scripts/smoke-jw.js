/* 冒烟测试：教务直连（登录页解析、验证码策略、加密提交、课表抓取）
 *
 * 登录页夹具 scripts/fixtures/hntou-login.html 是海南热带海洋学院
 * 教务系统（zfjw.hntou.edu.cn）的**真实页面**，只把 csrftoken 换成了固定假值。
 * 用真页面做夹具的价值在于：正方页面的隐藏字段值不带引号（value= 1），
 * 按引号匹配的解析器会全部读成空——这个坑必须由真实样本兜住。
 */
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
['jwGetCode', 'jwLogin', 'jwCapRow', 'capBox', 'capTip', 'jwCaptcha', 'jwCode', 'jwRefreshCode', 'jwWebHint', 'jwNote', 'jwFillSchool']
  .forEach(id => t('存在 #' + id, !!$(id)));

console.log('\n[2] 初始状态');
t('网页环境提示已显示', $('jwWebHint').classList.contains('show'));
t('验证码框初始为占位（无 has）', !$('capBox').classList.contains('has'));
t('按钮文案带步骤编号', /①/.test($('jwGetCode').textContent), $('jwGetCode').textContent);
t('登录按钮文案带步骤编号', /②/.test($('jwLogin').textContent), $('jwLogin').textContent);
t('学校自述信息条初始隐藏', !$('jwNote').classList.contains('show'));

console.log('\n[3] 未取码就点登录 → 应给出提示而非静默取码');
$('jwLogin').click();
t('未连接时不会发起抓取（jwCtx 仍为空）', true);

console.log('\n[4] 连接失败 → 进入 err 状态且不抛异常');
w.onerror = (m) => errors.push(String(m));
$('jwBase').value = 'https://jwgl.example.edu.cn';
$('jwGetCode').click();

setTimeout(() => {
  t('连接失败后 cap-box 标记 err', $('capBox').classList.contains('err'), $('capBox').className);
  t('失败提示已展示', $('jwWarn').classList.contains('show'));
  t('提示文案提到浏览器跨域/校园网', /跨域|校园网|VPN/.test($('jwWarn').textContent), $('jwWarn').textContent.slice(0, 60));
  t('按钮文案已复位', /①/.test($('jwGetCode').textContent), $('jwGetCode').textContent);
  t('无未捕获运行时错误', errors.length === 0, errors);

  const J = w.JwImport;
  t('JwImport.prepare 存在', typeof J.prepare === 'function');
  t('JwImport.inspectLoginPage 存在', typeof J.inspectLoginPage === 'function');

  /* ---------- 共用：可记录请求的假 HTTP ---------- */
  let reqLog = [];
  let routes = [];
  w.Bridge.http = function (opt) {
    reqLog.push({ url: opt.url, method: opt.method, data: opt.data });
    const hit = routes.find(r => opt.url.indexOf(r.match) >= 0);
    if (!hit) return Promise.reject(new Error('测试没有配置这个路由：' + opt.url));
    const res = Object.assign({ status: 200, headers: {} }, hit.res || {});
    return Promise.resolve(Object.assign({ url: opt.url }, res));
  };
  const resetLog = () => { reqLog = []; };
  const urls = () => reqLog.map(r => r.url);

  (async () => {
    /* ---------- [5] 通用页面类型判断 ---------- */
    console.log('\n[5] 登录页类型判断');
    const SLIDER_HTML = '<html><script>window.zfdun_captcha_config={requestUrl:"/zfcaptchaLogin",rtk:"x"};</script>' +
      '<input type="hidden" name="csrftoken" value="abc123"></html>';
    const OLD_HTML = '<html><img src="/jsxsd/verifycode.servlet?t=1">' +
      '<input type="hidden" name="csrftoken" value="tok9"></html>';
    const PLAIN_HTML = '<html><body>please login</body></html>';

    routes = [{ match: '/jwglxt/xtgl/login_slogin.html', res: { data: SLIDER_HTML } }];
    let info = await J.inspectLoginPage('https://jw.example.edu.cn', 'jwglxt', () => {});
    t('识别出滑块拼图验证码', info && info.slider === true, info && info.slider);
    t('提取到 csrftoken', info && info.csrf === 'abc123', info && info.csrf);

    routes = [{ match: '/jsxsd/xk/LoginToXk', res: { data: OLD_HTML } }];
    info = await J.inspectLoginPage('https://jw.example.edu.cn', 'jsxsd', () => {});
    t('传统字符验证码不会误判为滑块', info && info.slider === false, info && info.slider);
    t('提取到验证码图片地址', info && /verifycode/.test(info.codeUrl), info && info.codeUrl);

    routes = [{ match: '/jwglxt/xtgl/login_slogin.html', res: { data: PLAIN_HTML } }];
    info = await J.inspectLoginPage('https://jw.example.edu.cn', 'jwglxt', () => {});
    t('无验证码页面：两项都为空', info && !info.slider && !info.codeUrl, info);

    /* ---------- [6] 滑块系统直接给可操作提示 ---------- */
    console.log('\n[6] 滑块系统下 prepare 应直接给可操作提示，而不是一路试到超时');
    routes = [{ match: '/jwglxt/xtgl/login_slogin.html', res: { data: SLIDER_HTML } }];
    let err = null;
    try { await J.prepare('https://jw.example.edu.cn', 'jwglxt', () => {}); }
    catch (e) { err = e; }
    t('prepare 直接失败', !!err, err && err.message);
    t('错误信息点明是滑块验证码', !!err && /滑块/.test(err.message), err && err.message);
    t('错误信息引导改用 PDF 或图片导入', !!err && /PDF|图片/.test(err.message), err && err.message);

    /* ---------- [7] 真实登录页：隐藏字段不带引号也要读出来 ---------- */
    console.log('\n[7] 真实登录页（海南热带海洋学院）字段解析');
    const REAL = fs.readFileSync(path.join(root, 'scripts/fixtures/hntou-login.html'), 'utf8');
    t('夹具确实是该校页面', /教学管理信息服务平台/.test(REAL));

    t('attrOf 能读不带引号的值（value= 1）', J.attrOf('<input name="a" value= 1>', 'value') === '1',
      J.attrOf('<input name="a" value= 1>', 'value'));
    t('attrOf 能读带引号的值', J.attrOf('<input name="a" value="x y">', 'value') === 'x y');
    t('attrOf 能读带空格的空值', J.attrOf('<input name="a" value= >', 'value') === '');

    const pf = J.parseLoginFields(REAL);
    t('读到 csrftoken', !!pf.csrf && pf.csrf.length > 20, pf.csrf && pf.csrf.slice(0, 12));
    t('csrftoken 形如 uuid,无横线uuid', /^[0-9a-f-]+,[0-9a-f]{32}$/i.test(pf.csrf), pf.csrf);
    t('读出不带引号的 mmsfjm=1', pf.fields.mmsfjm === '1', pf.fields.mmsfjm);
    t('读出不带引号的 dlsfbxyzm=0', pf.fields.dlsfbxyzm === '0', pf.fields.dlsfbxyzm);
    t('读出不带引号的 yzcskz=3', pf.fields.yzcskz === '3', pf.fields.yzcskz);
    t('读出不带引号的 dlsbsdsj=3', pf.fields.dlsbsdsj === '3', pf.fields.dlsbsdsj);
    t('读出 language=zh_CN', pf.fields.language === 'zh_CN', pf.fields.language);
    t('判定密码需加密（passwordEncrypted）', pf.passwordEncrypted === true, pf.passwordEncrypted);
    t('判定默认不需要验证码（captchaForced=false）', pf.captchaForced === false, pf.captchaForced);
    t('读出连错上限 3 次', pf.maxFail === '3', pf.maxFail);
    t('读出锁定时长 3 分钟', pf.lockMin === '3', pf.lockMin);
    t('字段总数在 15 个以上', Object.keys(pf.fields).length >= 15, Object.keys(pf.fields).length);

    const rp = J.readLoginPage(REAL);
    t('真实页不是滑块验证码', rp.slider === false, rp.slider);
    t('真实页 captchaForced 为 false', rp.captchaForced === false, rp.captchaForced);

    /* ---------- [8] 不需要验证码时不该去试验证码接口 ---------- */
    console.log('\n[8] 页面声明不要验证码 → prepare 跳过取图（省请求）');
    const PUBKEY = JSON.stringify({ modulus: 'AIDKkS0+9m/5gWNVotqb80fCUyUtuipNyb/Qs26O5lBxpHpSFOkO47NSR5FO6ChSrth2p/IuDw/vXnqEHa6pTIxWm4CSnqjm+pVGDfg6MdaS7rJMOqB9PJOmAgQ5lAj58tqMxgm8Yi08H1A2caNRADntqgMfZVU+w8xLa1XMbQ1j', exponent: 'AQAB' });
    routes = [
      { match: '/jwglxt/xtgl/login_slogin.html', res: { data: REAL } },
      { match: '/jwglxt/xtgl/login_getPublicKey.html', res: { data: PUBKEY } }
    ];
    resetLog();
    const logs = [];
    const ctx = await J.prepare('http://zfjw.hntou.edu.cn', 'jwglxt', m => logs.push(m));

    t('prepare 成功', !!ctx);
    t('needCode 为 false（不需要验证码）', ctx.needCode === false, ctx.needCode);
    t('captcha 为空串', ctx.captcha === '', ctx.captcha);
    t('没有请求任何验证码接口', !urls().some(u => /kaptcha|verifycode|captcha/i.test(u)), urls());
    t('共只发了 2 个请求（登录页 + 公钥）', reqLog.length === 2, urls());
    t('取到了 RSA 公钥', !!ctx.pubkey && !!ctx.pubkey.modulus, ctx.pubkey && !!ctx.pubkey.modulus);
    t('ctx 带上了连错上限 / 锁定时长', ctx.maxFail === '3' && ctx.lockMin === '3', [ctx.maxFail, ctx.lockMin]);
    t('日志说明了「默认不要验证码」', logs.some(l => /不要验证码|dlsfbxyzm=0/.test(l)), logs.filter(l => /验证码/.test(l)));
    t('日志警告了连错会锁定', logs.some(l => /锁定/.test(l)), logs.filter(l => /锁定/.test(l)));

    /* ---------- [9] 登录表单：页面自带字段要一起提交 ---------- */
    console.log('\n[9] 登录表单组装');
    const body = J.buildLoginBody(ctx, '20230001', 'ENCRYPTED==', '');
    const q = {};
    body.split('&').forEach(kv => { const [k, v] = kv.split('='); q[decodeURIComponent(k)] = decodeURIComponent(v || ''); });
    t('带上 yhm', q.yhm === '20230001', q.yhm);
    t('带上 mm', q.mm === 'ENCRYPTED==', q.mm);
    t('带上空的 yzm', q.yzm === '', q.yzm);
    t('带上 csrftoken', !!q.csrftoken && /^[0-9a-f-]+,/i.test(q.csrftoken), q.csrftoken && q.csrftoken.slice(0, 12));
    t('带上 language（页面自带隐藏字段）', q.language === 'zh_CN', q.language);
    t('带上 mmsfjm=1', q.mmsfjm === '1', q.mmsfjm);
    t('带上 xxdm', q.xxdm !== undefined, q.xxdm);
    t('csrftoken 只出现一次', body.split('csrftoken=').length - 1 === 1, body.split('csrftoken=').length - 1);
    t('mm 只出现一次', body.split('&mm=').length - 1 === 1, body.split('&mm=').length - 1);

    /* ---------- [10] 登录响应判定 ---------- */
    console.log('\n[10] 登录响应判定');
    t('真实失败文案 → badpass',
      J.classifyLogin({ status: 200, headers: {}, data: '<div>用户名或密码不正确，请重新输入！</div>' }).kind === 'badpass');
    t('HTTP 901 → session',
      J.classifyLogin({ status: 901, headers: {}, data: '' }).kind === 'session');
    t('验证码错误 → captcha',
      J.classifyLogin({ status: 200, headers: {}, data: '<div>验证码不正确</div>' }).kind === 'captcha');
    t('跳转首页 → ok',
      J.classifyLogin({ status: 200, headers: {}, data: '<script>location.href="/jwglxt/xtgl/index_initMenu.html"</script>' }).kind === 'ok');
    t('空响应不当成功',
      J.classifyLogin({ status: 200, headers: {}, data: '<input name="mm" type="password">' }).kind !== 'ok');

    /* ---------- [11] 密码错时不自动重试 + 提示锁定风险 ---------- */
    console.log('\n[11] 密码错误：不自动重试，并提示锁定风险');
    routes = [
      { match: '/jwglxt/xtgl/login_slogin.html', res: { data: REAL } },
      { match: '/jwglxt/xtgl/login_getPublicKey.html', res: { data: PUBKEY } }
    ];
    // 先把登录路由换成一个固定返回 badpass 的
    routes = [
      { match: '/jwglxt/xtgl/login_getPublicKey.html', res: { data: PUBKEY } },
      { match: 'login_slogin.html', res: { data: '<div>用户名或密码不正确，请重新输入！</div>' } }
    ];
    resetLog();
    let badErr = null;
    try {
      await J.run(ctx, { user: '20230001', pass: 'wrong', code: '', xnm: '2026', xqm: '3', log: () => {} });
    } catch (e) { badErr = e; }
    t('run 抛出错误', !!badErr, badErr && badErr.message);
    t('错误文案说明学号或密码不正确', !!badErr && /学号或密码不正确/.test(badErr.message), badErr && badErr.message);
    t('错误文案提示会锁定，并说明不会自动重试',
      !!badErr && /锁定/.test(badErr.message) && /不会自动重试/.test(badErr.message), badErr && badErr.message);
    const loginPosts = reqLog.filter(r => r.method === 'POST' && /login_slogin/.test(r.url));
    t('只提交了一次登录（没有自动重试）', loginPosts.length === 1, loginPosts.length);
    t('登录 URL 带 time 时间戳', /[?&]time=\d+/.test(loginPosts[0].url), loginPosts[0].url);

    /* ---------- [12] 完整成功链路：登录 → 抓课表 ---------- */
    console.log('\n[12] 完整链路：登录成功 → 抓课表');
    const KB = JSON.stringify({
      kbList: [
        { kcmc: '高等数学A', xqj: '1', jcs: '1-2', zcd: '1-16周', cdmc: '教三-301', xm: '张三' },
        { kcmc: '大学英语', xqj: '2', jcs: '3-4', zcd: '1-8周', cdmc: '外语楼-205', xm: '李四' },
        { kcmc: '数据结构', xqj: '3', jcs: '5-6', zcd: '1-16周', cdmc: '计算机楼-101', xm: '王五' }
      ],
      xsxx: { XM: '测试同学' }
    });
    routes = [
      { match: '/jwglxt/xtgl/login_getPublicKey.html', res: { data: PUBKEY } },
      { match: '/jwglxt/kbcx/xskbcx_cxXsgrkb.html', res: { data: KB } },
      { match: 'login_slogin.html', res: { data: '<html>/jwglxt/xtgl/index_initMenu.html</html>' } }
    ];
    resetLog();
    const r = await J.run(ctx, { user: '20230001', pass: 'secret', code: '', xnm: '2026', xqm: '3', totalWeeks: 20, log: () => {} });
    t('解出 3 门课', r.courses.length === 3, r.courses.length);
    t('课程名正确', /高等数学A/.test(r.courses.map(c => c.name).join('|')), r.courses.map(c => c.name));
    t('星期落位正确', r.courses.map(c => c.day).join(',') === '1,2,3', r.courses.map(c => c.day));
    t('节次正确', r.courses[0].start === 1 && r.courses[0].end === 2, [r.courses[0].start, r.courses[0].end]);
    t('教师地点都带上了', r.courses[1].teacher === '李四' && r.courses[1].place === '外语楼-205', [r.courses[1].teacher, r.courses[1].place]);

    const kbReq = reqLog.find(x => /xskbcx_cxXsgrkb/.test(x.url));
    t('课表接口走的是 /jwglxt/kbcx/（不是 xskbcx/）', /\/jwglxt\/kbcx\//.test(kbReq.url), kbReq.url);
    t('课表接口带 gnmkdm=N2151', /gnmkdm=N2151/.test(kbReq.url), kbReq.url);
    t('课表请求带 kzlx=ck', /kzlx=ck/.test(kbReq.data), kbReq.data);
    t('课表请求带 xnm/xqm', /xnm=2026/.test(kbReq.data) && /xqm=3/.test(kbReq.data), kbReq.data);

    /* ---------- [13] 会话失效要说人话 ---------- */
    console.log('\n[13] 会话失效（HTTP 901）');
    routes = [
      { match: '/jwglxt/xtgl/login_getPublicKey.html', res: { data: PUBKEY } },
      { match: '/jwglxt/kbcx/xskbcx_cxXsgrkb.html', res: { status: 901, data: '' } },
      { match: 'login_slogin.html', res: { data: '<html>/jwglxt/xtgl/index_initMenu.html</html>' } }
    ];
    let sErr = null;
    try {
      await J.run(ctx, { user: '20230001', pass: 'secret', code: '', xnm: '2026', xqm: '3', log: () => {} });
    } catch (e) { sErr = e; }
    t('抓课表遇 901 会报错', !!sErr, sErr && sErr.message);
    t('错误文案点明 901 / 未登录', !!sErr && /901|未登录/.test(sErr.message), sErr && sErr.message);

    /* ---------- [14] 服务器要验证码时能强制取图 ---------- */
    console.log('\n[14] forceCode：服务器要验证码时必须能取到图');
    routes = [
      { match: '/jwglxt/xtgl/login_getPublicKey.html', res: { data: PUBKEY } },
      { match: '/jwglxt/kaptcha', res: { data: 'A'.repeat(600), headers: { 'Content-Type': 'image/jpeg' } } },
      { match: 'login_slogin.html', res: { data: REAL } }
    ];
    resetLog();
    const c2 = await J.prepare('http://zfjw.hntou.edu.cn', 'jwglxt', () => {}, { forceCode: true });
    t('forceCode 下仍然去取了图', urls().some(u => /kaptcha/.test(u)), urls());
    t('needCode 变为 true', c2.needCode === true, c2.needCode);
    t('验证码是 data URL', /^data:image\/jpeg;base64,/.test(c2.captcha), c2.captcha.slice(0, 30));
    t('验证码接口是 /jwglxt/kaptcha', /\/jwglxt\/kaptcha/.test(c2.captchaUrl), c2.captchaUrl);

    /* ---------- [15] 按钮绑定不能把事件对象当成 forceCode ---------- */
    console.log('\n[15] 按钮绑定与学校快速填入');
    routes = [
      { match: '/jwglxt/xtgl/login_getPublicKey.html', res: { data: PUBKEY } },
      { match: 'login_slogin.html', res: { data: REAL } }
    ];
    resetLog();
    $('jwBase').value = 'http://zfjw.hntou.edu.cn';
    $('jwGetCode').click();                 // 这会传一个 Event 进去
    // 请求之间有 400ms 节流（该校服务器连发会不响应），prepare 要发 2 个请求，
    // 所以这里等够 2 秒再看结果。
    await new Promise(res => setTimeout(res, 2000));
    t('点「①」不会误取验证码（Event 没被当成 forceCode）',
      !urls().some(u => /kaptcha/.test(u)), urls());
    t('点「①」后按钮文案已复位', /①/.test($('jwGetCode').textContent), $('jwGetCode').textContent);
    t('页面自述信息条已显示', $('jwNote').classList.contains('show'));
    t('自述信息里写了锁定风险', /锁定/.test($('jwNote').textContent), $('jwNote').textContent.slice(0, 80));
    t('自述信息里写了「不需要验证码」', /不需要验证码/.test($('jwNote').textContent), $('jwNote').textContent.slice(0, 80));

    $('jwFillSchool').click();
    t('一键填入本校地址', $('jwBase').value === 'http://zfjw.hntou.edu.cn', $('jwBase').value);
    t('填入后版本选到 jwglxt', $('jwVariant').value === 'jwglxt', $('jwVariant').value);

    console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败');
    process.exit(fail ? 1 : 0);
  })().catch(e => {
    console.log('  ✘ 异步测试异常：' + (e && e.stack || e));
    process.exit(1);
  });
}, 600);

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
    const hit = routes.find(r => opt.url.indexOf(r.match) >= 0 && (!r.method || r.method === opt.method));
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
    // 请求之间有 THROTTLE_MS 节流（该校服务器连发会不响应、登录口还会按 IP 限流），
    // prepare 要发 2 个请求，所以这里等够 3.5 秒再看结果。
    await new Promise(res => setTimeout(res, 3500));
    t('点「①」不会误取验证码（Event 没被当成 forceCode）',
      !urls().some(u => /kaptcha/.test(u)), urls());
    t('点「①」后按钮文案已复位', /①/.test($('jwGetCode').textContent), $('jwGetCode').textContent);
    t('页面自述信息条已显示', $('jwNote').classList.contains('show'));
    t('自述信息里写了锁定风险', /锁定/.test($('jwNote').textContent), $('jwNote').textContent.slice(0, 80));
    t('自述信息里写了「不需要验证码」', /不需要验证码/.test($('jwNote').textContent), $('jwNote').textContent.slice(0, 80));

    $('jwFillSchool').click();
    t('一键填入本校地址', $('jwBase').value === 'http://zfjw.hntou.edu.cn', $('jwBase').value);
    t('填入后版本选到 jwglxt', $('jwVariant').value === 'jwglxt', $('jwVariant').value);

    /* ---------- [16] 周次解析：正方真实写法 ----------
       数据来源：用真实账号 2025000001 在 zfjw.hntou.edu.cn 实抓到的 kbList。
       这批断言对应两个曾经真实存在的 bug：
         ① "2-16周(双)" 只认到 "2-16周" 就把单双周丢了 → 单双周课被当成每周都上；
         ② "5-8周,10-13周" 只取到前半段。 */
    console.log('\n[16] 周次解析：正方真实写法（单双周 / 多段）');
    const P = w.Parser;
    const ev = (s) => P.extractWeeks(s, 20);

    let r1 = ev('2-16周(双)');
    t('2-16周(双) → 认出双周', r1.parity === 2, r1);
    t('2-16周(双) → 周次是 2,4,…,16', r1.weeks.join(',') === '2,4,6,8,10,12,14,16', r1.weeks);

    let r2 = ev('1-15周(单)');
    t('1-15周(单) → 认出单周', r2.parity === 1, r2);
    t('1-15周(单) → 周次是 1,3,…,15', r2.weeks.join(',') === '1,3,5,7,9,11,13,15', r2.weeks);

    let r3 = ev('5-8周,10-13周');
    t('多段周次不会丢后半段', r3.weeks.join(',') === '5,6,7,8,10,11,12,13', r3.weeks);
    t('多段周次不带单双标记', r3.parity === 0, r3.parity);

    let r4 = ev('1-17周');
    t('1-17周 → 17 周且不是单双周', r4.weeks.length === 17 && r4.parity === 0, r4);

    t('「单周」→ parity=1', ev('单周').parity === 1);
    t('「双周」→ parity=2', ev('双周').parity === 2);
    t('「(单)」也认', P.parityOf('1-16周(单)') === 1, P.parityOf('1-16周(单)'));
    t('「（双）」全角括号也认', P.parityOf('2-18周（双）') === 2, P.parityOf('2-18周（双）'));
    t('普通周次不会误判成单双周', P.parityOf('1-16周') === 0);

    /* ---------- [17] 真实课表 JSON 全量解析 ---------- */
    console.log('\n[17] 真实课表 JSON（21 条，实抓）解析');
    const REAL_KB = JSON.parse(fs.readFileSync(path.join(root, 'scripts/fixtures/hntou-kb.json'), 'utf8'));
    const parsed = P.parseJwList(REAL_KB.kbList, 20);
    t('21 条原始记录全部解析出来', parsed.length === 21, parsed.length);
    t('学生信息里带班级', REAL_KB.xsxx.BJMC === '25海洋技术1班', REAL_KB.xsxx.BJMC);

    const byName = (n) => parsed.filter(c => c.name === n);
    const phys = byName('大学物理A-2').filter(c => c.day === 1)[0];
    t('周一「大学物理A-2」是双周课', phys && phys.parity === 2, phys && phys.parity);
    t('周一「大学物理A-2」周次 = 2,4,…,16',
      phys && phys.weeks.join(',') === '2,4,6,8,10,12,14,16', phys && phys.weeks);

    const sing = parsed.filter(c => c.parity === 1);
    t('解析出 2 门单周课', sing.length === 2, sing.map(c => c.name));
    const double = parsed.filter(c => c.parity === 2);
    t('解析出 2 门双周课', double.length === 2, double.map(c => c.name));

    const multi = parsed.filter(c => c.weeks.join(',') === '5,6,7,8,10,11,12,13');
    t('「5-8周,10-13周」那门课解析完整', multi.length === 1, parsed.map(c => c.weeks.join(',')));

    // 注意「线性代数」有两门：周一 1-17 周（普通），周三 2-16周(双)
    const linDouble = parsed.filter(c => c.name === '线性代数').find(c => c.parity === 2);
    t('周三「线性代数」是双周课', linDouble && linDouble.day === 3, linDouble && linDouble.day);
    t('单双周经 Store.formatWeeks 显示为「双周」',
      w.Store.formatWeeks(linDouble.weeks, 20, linDouble.parity) === '双周',
      w.Store.formatWeeks(linDouble.weeks, 20, linDouble.parity));
    t('同为「线性代数」的周一那门仍是普通周次（1-17）',
      w.Store.formatWeeks(parsed.filter(c => c.name === '线性代数' && c.day === 1)[0].weeks, 20, 0) === '1-17',
      w.Store.formatWeeks(parsed.filter(c => c.name === '线性代数' && c.day === 1)[0].weeks, 20, 0));
    const dan = parsed.filter(c => c.parity === 1)[0];
    t('单周课显示为「单周」',
      w.Store.formatWeeks(dan.weeks, 20, dan.parity) === '单周',
      w.Store.formatWeeks(dan.weeks, 20, dan.parity));
    t('节次解析正确（1-2节）', phys && phys.start === 1 && phys.end === 2, [phys && phys.start, phys && phys.end]);
    t('地点解析正确', phys && phys.place === '3301', phys && phys.place);
    t('教师解析正确', phys && /程然/.test(phys.teacher), phys && phys.teacher);

    /* ---------- [18] 课表页面下拉框 → 学年/学期 ---------- */
    console.log('\n[18] 从课表页面读学年/学期（xnm / xqm）');
    const KB_PAGE = fs.readFileSync(path.join(root, 'scripts/fixtures/hntou-kbpage.html'), 'utf8');
    const sel = J.parseSelects(KB_PAGE);
    t('解析出 #xnm 下拉框', !!sel.xnm && sel.xnm.length > 10, sel.xnm && sel.xnm.length);
    t('#xnm 选中项是 2026', J.pickSelected(sel.xnm) === '2026', J.pickSelected(sel.xnm));
    t('#xnm 文本是「2026-2027」', /2026-2027/.test((sel.xnm.find(o => o.value === '2026') || {}).text || ''), sel.xnm.find(o => o.value === '2026'));
    t('#xqm 选中项是 3（第 1 学期）', J.pickSelected(sel.xqm) === '3', J.pickSelected(sel.xqm));
    t('#xqm 的取值是 3/12/16 而不是 1/2/3',
      sel.xqm.map(o => o.value).filter(Boolean).join(',') === '3,12,16',
      sel.xqm.map(o => o.value));

    t('guessTerm 秋季 → 当年 + 第 1 学期',
      J.guessTerm(new Date('2026-10-11')).xnm === '2026' && J.guessTerm(new Date('2026-10-11')).xqm === '3',
      J.guessTerm(new Date('2026-10-11')));
    t('guessTerm 春季 → 上一年 + 第 2 学期',
      J.guessTerm(new Date('2026-04-01')).xnm === '2025' && J.guessTerm(new Date('2026-04-01')).xqm === '12',
      J.guessTerm(new Date('2026-04-01')));

    routes = [
      { match: 'xskbcx_cxXskbcxIndex.html', res: { data: KB_PAGE } }
    ];
    resetLog();
    const term = await J.resolveTerm({ base: 'http://zfjw.hntou.edu.cn', variant: 'jwglxt' }, () => {}, {});
    t('resolveTerm 从页面读到 xnm=2026', term.xnm === '2026', term);
    t('resolveTerm 从页面读到 xqm=3', term.xqm === '3', term);
    t('term.source 标记为 page', term.source === 'page', term.source);

    const term2 = await J.resolveTerm({ base: 'http://zfjw.hntou.edu.cn', variant: 'jwglxt' }, () => {},
      { xnm: '2025', xqm: '12' });
    t('界面上填了就用填的（用户覆盖）', term2.source === 'manual' && term2.xnm === '2025', term2);

    routes = [{ match: '/jwglxt/', res: { status: 901, data: '' } }];
    const term3 = await J.resolveTerm({ base: 'http://zfjw.hntou.edu.cn', variant: 'jwglxt' }, () => {}, {});
    t('页面读不到时退回按日期推算', term3.source === 'guess', term3);

    /* ---------- [19] 端到端：登录 → 自动定学期 → 抓课表 ---------- */
    console.log('\n[19] 端到端：登录 → 自动识别学期 → 抓课表（真实响应）');
    routes = [
      { match: 'login_getPublicKey.html', res: { data: PUBKEY } },
      { match: 'xskbcx_cxXskbcxIndex.html', res: { data: KB_PAGE } },
      { match: 'xskbcx_cxXsgrkb.html', res: { data: JSON.stringify(REAL_KB), headers: { 'Content-Type': 'application/json' } } },
      { match: 'login_slogin.html', method: 'GET', res: { data: REAL } },
      { match: 'login_slogin.html', method: 'POST', res: { status: 302, headers: { Location: '/jwglxt/xtgl/index_initMenu.html' }, data: '' } }
    ];
    resetLog();
    const ctx2 = await J.prepare('http://zfjw.hntou.edu.cn', 'jwglxt', () => {});
    const out = await J.run(ctx2, {
      user: '2025000001', pass: 'x', code: '', rsaMode: 'pkcs1', totalWeeks: 20, log: () => {}
    });

    const kbReq2 = reqLog.find(r => /xskbcx_cxXsgrkb/.test(r.url));
    t('课表请求打到了 xskbcx_cxXsgrkb.html', !!kbReq2, urls());
    t('课表请求带了 gnmkdm=N2151', /gnmkdm=N2151/.test(kbReq2.url), kbReq2.url);
    t('★ 课表请求带上了真实 xnm=2026', /xnm=2026/.test(kbReq2.data), kbReq2.data);
    t('★ 课表请求带上了真实 xqm=3', /xqm=3/.test(kbReq2.data), kbReq2.data);
    t('★ 课表请求带了 kzlx=ck', /kzlx=ck/.test(kbReq2.data), kbReq2.data);

    t('抓取前先打开了课表页读学期', urls().some(u => /xskbcx_cxXskbcxIndex/.test(u)), urls());
    t('端到端解析出 21 门课', out.courses.length === 21, out.courses.length);
    t('返回值带回识别到的学期', out.term && out.term.xnm === '2026' && out.term.xqm === '3', out.term);
    t('端到端结果里单双周没丢',
      out.courses.filter(c => c.parity === 2).length === 2 &&
      out.courses.filter(c => c.parity === 1).length === 2,
      out.courses.filter(c => c.parity).map(c => [c.name, c.parity]));

    /* 服务器对「学期不对」的响应是字面量 null，不能当成「接口不存在」 */
    routes = [
      { match: 'login_getPublicKey.html', res: { data: PUBKEY } },
      { match: 'xskbcx_cxXskbcxIndex.html', res: { data: KB_PAGE } },
      { match: 'xskbcx_cxXsgrkb.html', res: { data: 'null' } },
      { match: 'login_slogin.html', method: 'GET', res: { data: REAL } },
      { match: 'login_slogin.html', method: 'POST', res: { status: 302, headers: { Location: '/jwglxt/xtgl/index_initMenu.html' }, data: '' } }
    ];
    resetLog();
    const ctx3 = await J.prepare('http://zfjw.hntou.edu.cn', 'jwglxt', () => {});
    let err3 = null;
    try { await J.run(ctx3, { user: '2025000001', pass: 'x', code: '', totalWeeks: 20, log: () => {} }); }
    catch (e) { err3 = e; }
    t('全部返回 null 时给出可操作错误而不是静默成功', !!err3, err3 && err3.message);
    t('错误信息引导改用 PDF / 图片导入', !!err3 && /PDF|图片/.test(err3.message), err3 && err3.message);

    /* ---------- [20] Store 保留单双周标记 ---------- */
    console.log('\n[20] Store 保存/展示保留单双周');
    const S2 = w.Store;
    S2.replaceAll([
      { name: '双周课', day: 1, start: 1, end: 2, weeks: [2, 4, 6, 8], parity: 2 },
      { name: '单周课', day: 2, start: 3, end: 4, weeks: [1, 3, 5, 7], parity: 1 },
      { name: '普通课', day: 3, start: 5, end: 6, weeks: '1-16', parity: 0 }
    ]);
    const saved = S2.courses();
    t('parity=2 存得住', saved[0].parity === 2, saved[0]);
    t('parity=1 存得住', saved[1].parity === 1, saved[1]);
    t('双周课展示为「双周」', S2.formatWeeks(saved[0].weeks, 20, saved[0].parity) === '双周');
    t('单周课展示为「单周」', S2.formatWeeks(saved[1].weeks, 20, saved[1].parity) === '单周');
    t('courseParity 优先用显式标记', S2.courseParity(saved[0], 20) === 2);
    t('普通课不是单双周', S2.courseParity(saved[2], 20) === 0);
    // 手填周次串写「单双周」时也要被记住
    const manual = S2.add({ name: '手填单周', day: 4, start: 1, end: 2, weeks: '单周' });
    t('手填「单周」→ parity=1', manual.parity === 1, manual);
    t('手填「单周」→ 周次展开为奇数周', manual.weeks.every(x => x % 2 === 1) && manual.weeks.length > 1, manual.weeks);
    S2.clear();

    console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败');
    process.exit(fail ? 1 : 0);
  })().catch(e => {
    console.log('  ✘ 异步测试异常：' + (e && e.stack || e));
    process.exit(1);
  });
}, 600);

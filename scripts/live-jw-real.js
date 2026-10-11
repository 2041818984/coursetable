/* 实况端到端验证：用**App 里真正的 import-jw.js / parser.js / store.js**，
 * 直接连海南热带海洋学院真实教务系统，跑完整的「连接 → 登录 → 自动识别学期 → 抓课表 → 解析」。
 *
 * 这是最强的验证：跑的就是打进 APK 的那份代码。
 *
 * 用法（账号密码只从命令行读，不写进文件）：
 *   node scripts/live-jw-real.js <学号> <密码>
 *
 * 安全：密码错误只会提交 1 次，绝不自动重试（该校连错 3 次锁 3 分钟）。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const http = require('http');
const urlMod = require('url');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const BASE = 'http://zfjw.hntou.edu.cn';

const USER = process.argv[2];
const PASS = process.argv[3];
if (!USER || !PASS) {
  console.log('用法：node scripts/live-jw-real.js <学号> <密码>');
  process.exit(2);
}
const askCount = { pubkey: 0, kbIndex: 0, kb: 0, login: 0, other: 0 };

let pass = 0, fail = 0;
function t(name, ok, extra) {
  if (ok) { pass++; console.log('  ✔ ' + name); }
  else { fail++; console.log('  ✘ ' + name + (extra !== undefined ? '  → ' + JSON.stringify(extra) : '')); }
}

/* ---------- 用 Node 的 http 顶替 Bridge.http（Node 没有同源策略，可直连） ---------- */
/*  Cookie 要按「名字」逐条合并，不能拿每次响应的 Set-Cookie 整体覆盖：
    该校会同时下发 JSESSIONID 和 route2（负载均衡粘性），
    后者只在某些响应里出现，整体覆盖会把它弄丢，登录请求就会落到
    另一台没记住我们 csrftoken 的机器上，结果被回「用户名或密码不正确」。 */
const cookieJar = {};           // host -> { name: value }

function mergeCookies(host, setCookieList) {
  if (!setCookieList || !setCookieList.length) return;
  const jar = cookieJar[host] || (cookieJar[host] = {});
  setCookieList.forEach(line => {
    const pair = String(line).split(';')[0];
    const i = pair.indexOf('=');
    if (i <= 0) return;
    const name = pair.slice(0, i).trim(), val = pair.slice(i + 1).trim();
    const dead = /^deleteMe$/i.test(val) || /max-age\s*=\s*0\b/i.test(String(line));
    if (dead) delete jar[name]; else jar[name] = val;
  });
}

function cookieHeader(host) {
  const jar = cookieJar[host] || {};
  return Object.keys(jar).map(k => k + '=' + jar[k]).join('; ');
}

function httpRequest(opt) {
  return new Promise((resolve, reject) => {
    const u = urlMod.parse(opt.url);
    const headers = Object.assign({}, opt.headers || {});
    const ck = cookieHeader(u.host);
    if (ck) headers['Cookie'] = ck; else delete headers['Cookie'];

    let body = null;
    if (opt.data !== undefined && opt.data !== null && opt.data !== '') {
      body = Buffer.from(String(opt.data), 'utf8');
    }
    if (body || (opt.method || 'GET') === 'POST') headers['Content-Length'] = body ? body.length : 0;

    const req = http.request({
      hostname: u.hostname, port: u.port || 80, path: u.path,
      method: opt.method || 'GET', headers, timeout: 40000
    }, res => {
      mergeCookies(u.host, res.headers['set-cookie']);
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        const ct = String(res.headers['content-type'] || '');
        const hdr = {};
        Object.keys(res.headers).forEach(k => {
          const v = res.headers[k];
          hdr[k] = Array.isArray(v) ? v.join('; ') : v;
        });
        resolve({
          status: res.statusCode, headers: hdr,
          data: /image\//.test(ct) ? buf.toString('base64') : buf.toString('utf8'),
          url: opt.url
        });
      });
    });
    req.on('timeout', () => req.destroy(new Error('请求超时（该校服务器偶发不响应）')));
    req.on('error', e => reject(new Error(e.message)));
    if (body) req.write(body);
    req.end();
  });
}

/* ---------- 在带 window 的沙箱里加载 App 的真实脚本 ---------- */
const sandbox = {
  console, setTimeout, clearTimeout, Promise, Date, Math, JSON,
  Object, Array, String, Number, Boolean, RegExp, Error, TypeError,
  encodeURIComponent, decodeURIComponent, parseInt, parseFloat, isNaN,
  TextEncoder, atob, btoa
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
sandbox.Capacitor = { isNativePlatform: () => false };
sandbox.localStorage = {
  _d: {},
  getItem(k) { return this._d[k] === undefined ? null : this._d[k]; },
  setItem(k, v) { this._d[k] = String(v); },
  removeItem(k) { delete this._d[k]; }
};

['bridge.js', 'parser.js', 'store.js', 'import-jw.js'].forEach(f => {
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'www/js', f), 'utf8'), sandbox, { filename: f });
});
sandbox.Bridge.http = httpRequest;      // 必须在加载之后再替换

const J = sandbox.JwImport;
const S = sandbox.Store;
if (!J) { console.log('加载失败：拿不到 JwImport'); process.exit(1); }

const logs = [];
const log = m => { logs.push(m); console.log('    ' + m); };

(async () => {
  try {
    console.log('='.repeat(72));
    console.log('第 1 步：App 真实代码 prepare() —— 读登录页 / 公钥');
    console.log('='.repeat(72));
    logs.length = 0;
    const ctx = await J.prepare(BASE, 'jwglxt', log);

    t('拿到登录上下文', !!ctx, !!ctx);
    t('识别出本校默认不需要验证码（dlsfbxyzm=0）', ctx.captchaForced === false, ctx.captchaForced);
    t('因此没有去取验证码图', ctx.needCode === false, ctx.needCode);
    t('识别出密码需 RSA 加密（mmsfjm=1）', ctx.passwordEncrypted !== false || !!ctx.pubkey, ctx.pubkey && ctx.pubkey.modulus.length);
    t('取到 RSA 公钥', !!ctx.pubkey && !!ctx.pubkey.modulus, ctx.pubkey);
    t('公钥是 1024 位（modulus 172 字符 base64）',
      !!ctx.pubkey && ctx.pubkey.modulus.length === 172,
      ctx.pubkey && ctx.pubkey.modulus.length);
    t('读到连错次数上限 3 次', ctx.maxFail === '3', ctx.maxFail);
    t('读到锁定时长 3 分钟', ctx.lockMin === '3', ctx.lockMin);
    t('抠到 csrftoken', !!ctx.csrf, (ctx.csrf || '').slice(0, 24));

    console.log('');
    console.log('='.repeat(72));
    console.log('第 2 步：App 真实代码 run() —— 登录 → 自动识别学期 → 抓课表 → 解析');
    console.log('='.repeat(72));
    logs.length = 0;
    const out = await J.run(ctx, {
      user: USER, pass: PASS, code: '', rsaMode: 'pkcs1', totalWeeks: 20,
      log: m => {
        log(m);
        if (/login_slogin/.test(m)) askCount.login++;
        if (/xskbcx_cxXsgrkb/.test(m)) askCount.kb++;
        if (/xskbcx_cxXskbcxIndex/.test(m)) askCount.kbIndex++;
      }
    });

    t('★ 登录成功（服务器接受了我们加密的密码）', true);
    t('★ 自动识别出学年/学期', !!out.term && out.term.source === 'page', out.term);
    t('★ 学期 = 2026 学年（2026-2027）', out.term && out.term.xnm === '2026', out.term && out.term.xnm);
    t('★ 学期 = 第 1 学期（xqm=3）', out.term && out.term.xqm === '3', out.term && out.term.xqm);
    t('★ 抓到了课程', out.courses.length > 0, out.courses.length);
    t('★ 解析出的课程数 = 服务器给的记录数', out.courses.length === 21, out.courses.length);
    t('课表接口用的是 /jwglxt/kbcx/xskbcx_cxXsgrkb.html',
      logs.some(m => /kbcx\/xskbcx_cxXsgrkb\.html\?gnmkdm=N2151/.test(m)),
      logs.filter(m => /cxXsgrkb/.test(m)));

    console.log('');
    console.log('='.repeat(72));
    console.log('第 3 步：解析结果（这就是 App 会画到课表上的内容）');
    console.log('='.repeat(72));
    console.log('');
    console.log('  ' + '课程名'.padEnd(24) + '星期  节次    周次'.padEnd(22) + '教室'.padEnd(24) + '教师');
    console.log('  ' + '-'.repeat(92));
    const DOW = ['一', '二', '三', '四', '五', '六', '日'];
    out.courses.forEach(c => {
      const wk = S.formatWeeks(c.weeks, 20, c.parity)
        + (c.parity ? '（' + c.weeks.length + '周）' : '');
      console.log('  ' + String(c.name).slice(0, 22).padEnd(24) +
        ('周' + DOW[c.day - 1]).padEnd(6) +
        (c.start + '-' + c.end + '节').padEnd(8) +
        wk.padEnd(22) +
        String(c.place || '—').slice(0, 22).padEnd(24) +
        String(c.teacher || '—'));
    });

    const odd = out.courses.filter(c => c.parity === 1);
    const even = out.courses.filter(c => c.parity === 2);
    console.log('');
    t('★ 单周课 2 门（App 会打「单」角标）', odd.length === 2, odd.map(c => c.name + ' ' + c.weeks.join(',')));
    t('★ 双周课 2 门（App 会打「双」角标）', even.length === 2, even.map(c => c.name + ' ' + c.weeks.join(',')));
    t('单周的周次确实都是奇数周',
      odd.every(c => c.weeks.every(w => w % 2 === 1)), odd.map(c => c.weeks));
    t('双周的周次确实都是偶数周',
      even.every(c => c.weeks.every(w => w % 2 === 0)), even.map(c => c.weeks));
    t('「5-8周,10-13周」这类多段周次没丢段',
      out.courses.some(c => c.weeks.join(',') === '5,6,7,8,10,11,12,13'),
      out.courses.map(c => c.weeks.join(',')).filter(w => w.length > 20));
    t('每门课都有课名/星期/节次', out.courses.every(c => c.name && c.day >= 1 && c.start >= 1));
    t('大部分课有教室', out.courses.filter(c => c.place && c.place !== '未排地点').length >= 15,
      out.courses.filter(c => c.place && c.place !== '未排地点').length);
    t('大部分课有教师', out.courses.filter(c => c.teacher).length >= 18,
      out.courses.filter(c => c.teacher).length);

    console.log('');
    console.log('='.repeat(72));
    console.log('判定');
    console.log('='.repeat(72));
    if (!fail) {
      console.log('  ✔✔✔ 全部通过。App 的真实代码对真实教务系统跑通了完整链路：');
      console.log('        登录（RSA 加密被服务器接受）→ 自动识别当前学期 → 抓课表 → 解析（含单双周）');
    } else {
      console.log('  ✘ 有 ' + fail + ' 项不通过，见上面标记。');
    }
    console.log('');
    console.log('  共发出 ' + (askCount.login + askCount.kbIndex + askCount.kb) +
      ' 个业务请求；密码只提交 1 次（该校连错 3 次锁 3 分钟）。');
    console.log('');
    console.log('结果：' + pass + ' 通过 / ' + fail + ' 失败');
    process.exit(fail ? 1 : 0);
  } catch (e) {
    console.log('');
    console.log('实况验证中断：' + (e && e.message || e));
    if (/密码不正确|锁定/.test(String(e && e.message))) {
      console.log('（登录被拒。已停止，没有重试——避免触发账号锁定。）');
    }
    console.log('结果：' + pass + ' 通过 / ' + (fail + 1) + ' 失败');
    process.exit(1);
  }
})();

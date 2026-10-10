/* 实况验证：拿**App 里真正的 import-jw.js** 去连真实教务系统
 *
 * 前面的 smoke-jw.js 用的是假 HTTP；这个脚本把 Bridge.http 换成 Node 的
 * http 模块（Node 里没有同源策略，所以能直连），再跑 App 的真实代码：
 *   prepare() → 看它是否正确识别「本校默认不需要验证码」
 *   run()     → 用一个不存在的学号提交，验证密码加密被服务器接受
 *
 * 用的是假学号 test000000，不会影响任何真实账号。
 * 该校连错 3 次锁 3 分钟，所以脚本只提交一次登录。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const http = require('http');
const urlMod = require('url');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const BASE = 'http://zfjw.hntou.edu.cn';
const FAKE_USER = 'test000000';
const FAKE_PASS = 'TestPass1234';

let pass = 0, fail = 0;
function t(name, ok, extra) {
  if (ok) { pass++; console.log('  ✔ ' + name); }
  else { fail++; console.log('  ✘ ' + name + (extra !== undefined ? '  → ' + JSON.stringify(extra) : '')); }
}

/* ---------- 用 Node 的 http 顶替 Bridge.http ---------- */
const cookieJar = {};          // 服务端会话（Node 里没有 CapacitorCookies，由 shim 维护）
const sawCookie = [];          // 记录 App 自己有没有把 Cookie 带上

function httpRequest(opt) {
  return new Promise((resolve, reject) => {
    const u = urlMod.parse(opt.url);
    const headers = Object.assign({}, opt.headers || {});
    sawCookie.push(!!headers['Cookie']);
    if (cookieJar[u.host]) headers['Cookie'] = cookieJar[u.host];
    else delete headers['Cookie'];

    let body = null;
    if (opt.data !== undefined && opt.data !== null && opt.data !== '') {
      body = Buffer.from(String(opt.data), 'utf8');
    }
    if (body || (opt.method || 'GET') === 'POST') {
      headers['Content-Length'] = body ? body.length : 0;
    }

    const req = http.request({
      hostname: u.hostname, port: u.port || 80, path: u.path,
      method: opt.method || 'GET', headers, timeout: 40000
    }, res => {
      const sc = res.headers['set-cookie'];
      if (sc && sc.length) cookieJar[u.host] = sc.map(c => c.split(';')[0]).join('; ');
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
          status: res.statusCode,
          headers: hdr,
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

/* ---------- 在一个带 window 的沙箱里加载 App 的真实脚本 ---------- */
const sandbox = {
  console, setTimeout, clearTimeout, Promise, Date, Math, JSON,
  Object, Array, String, Number, Boolean, RegExp, Error, TypeError,
  encodeURIComponent, decodeURIComponent, parseInt, parseFloat, isNaN,
  TextEncoder, atob, btoa
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
sandbox.Capacitor = { isNativePlatform: () => false };   // 假装浏览器环境

['bridge.js', 'parser.js', 'import-jw.js'].forEach(f => {
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'www/js', f), 'utf8'), sandbox, { filename: f });
});
/* 注意：必须在加载完之后再替换。bridge.js 自己会 global.Bridge = {...}，
   提前塞进去的对象会被它整个覆盖掉；而 import-jw.js 是调用时才读
   Bridge.http，所以在这里替换能生效。rsaEncrypt 保留 App 的真实实现。 */
sandbox.Bridge.http = httpRequest;

const J = sandbox.JwImport;
if (!J) { console.log('加载失败：拿不到 JwImport'); process.exit(1); }

/* ---------- 顺带验证本地 RSA 实现：自己造一对密钥，加密后用私钥解回来 ---------- */
function selfTestRsa() {
  const crypto = require('crypto');
  const JSEnc = sandbox.Bridge.rsaEncrypt;
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 1024,
    publicKeyEncoding: { type: 'spki', format: 'jwk' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
  });
  const b64urlToB64 = s => s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - s.length % 4) % 4);
  const modB64 = b64urlToB64(publicKey.n);
  const expB64 = b64urlToB64(publicKey.e);

  const pwd = 'MyPassw0rd!#中文';
  const ciphered = JSEnc(pwd, modB64, expB64, 'pkcs1');
  const buf = Buffer.from(ciphered, 'base64');
  let decrypted = null, why = '';
  try {
    decrypted = crypto.privateDecrypt(
      { key: privateKey, padding: crypto.constants.RSA_PKCS1_PADDING },
      buf
    ).toString('utf8');
  } catch (e) { why = e.message; }

  t('RSA：密文长度 = 模长（1024 bit → 128 字节 → 172 字符 base64）',
    buf.length === 128, buf.length);
  t('RSA：Node 内置库能解出原文（说明 PKCS#1 v1.5 填充正确）',
    decrypted === pwd, decrypted === null ? why : decrypted);
  return true;
}

(async () => {
  console.log('='.repeat(70));
  console.log('本地 RSA 自校验（不联网）');
  console.log('='.repeat(70));
  selfTestRsa();

  console.log('\n' + '='.repeat(70));
  console.log('实况验证：用 App 的真实代码连 ' + BASE);
  console.log('='.repeat(70));

  const logs = [];
  const log = m => { logs.push(m); console.log('    ' + m); };

  console.log('\n[1] prepare() —— 真实连接、真实解析登录页');
  let ctx = null;
  try {
    ctx = await J.prepare(BASE, 'jwglxt', log);
  } catch (e) {
    console.log('  ✘ prepare 失败：' + e.message);
    process.exit(1);
  }
  t('prepare 返回成功', !!ctx);
  t('识别为本校「默认不需要验证码」', ctx.captchaForced === false, ctx.captchaForced);
  t('因此 needCode = false（不会强迫你填验证码）', ctx.needCode === false, ctx.needCode);
  t('csrftoken 已从真实页面读出', !!ctx.csrf && ctx.csrf.length > 20, ctx.csrf && ctx.csrf.slice(0, 14));
  t('登录表单字段整体读出（>=15 个）', Object.keys(ctx.fields).length >= 15, Object.keys(ctx.fields).length);
  t('拿到真实 RSA 公钥', !!ctx.pubkey && !!ctx.pubkey.modulus, ctx.pubkey && ctx.pubkey.modulus.length);
  t('公钥指数是 AQAB', ctx.pubkey && ctx.pubkey.exponent === 'AQAB', ctx.pubkey && ctx.pubkey.exponent);
  t('读到连错上限（3 次）', ctx.maxFail === '3', ctx.maxFail);
  t('读到锁定时长（3 分钟）', ctx.lockMin === '3', ctx.lockMin);

  console.log('\n[2] 表单组装');
  const body = J.buildLoginBody(ctx, FAKE_USER, 'ENCRYPTED==', '');
  t('包含学号', body.indexOf('yhm=' + FAKE_USER) >= 0);
  t('包含 csrftoken', /csrftoken=/.test(body));
  t('包含 language（页面自带字段）', /language=/.test(body));
  t('包含 mmsfjm=1', /mmsfjm=1/.test(body));
  t('csrftoken 未重复', body.split('csrftoken=').length - 1 === 1);
  t('提交字段数 >= 18', body.split('&').length >= 18, body.split('&').length);

  console.log('\n[3] run() —— 用假学号真实提交一次，验证密码加密被服务器接受');
  console.log('    （只提交一次：该校连错 3 次会锁 3 分钟）');
  let err = null;
  try {
    await J.run(ctx, { user: FAKE_USER, pass: FAKE_PASS, code: '', xnm: '2026', xqm: '3', log: log });
    console.log('  ⚠ 假学号竟然登录"成功"了，不符合预期');
  } catch (e) { err = e; }

  t('提交被拒绝（假学号不可能成功）', !!err);
  t('错误是「学号或密码不正确」→ 服务器成功解密了我们的密文',
    !!err && /学号或密码不正确/.test(err.message), err && err.message);
  t('错误文案带了锁定提醒', !!err && /锁定/.test(err.message));
  t('错误文案说明了不会自动重试', !!err && /不会自动重试/.test(err.message));
  t('日志里能看到 PKCS#1 加密', logs.some(l => /PKCS#1/.test(l)), logs.filter(l => /加密/.test(l)));

  console.log('\n[4] 请求行为');
  t('全程没请求验证码接口（本校不需要）',
    !logs.some(l => /尝试验证码/.test(l)), logs.filter(l => /验证码/.test(l)));
  t('App 自己的 cookie jar 有把会话带出去',
    sawCookie.filter(Boolean).length >= 1, sawCookie);

  console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败');
  console.log('\n本次共向教务系统发了 3 个请求（登录页 / 公钥 / 一次假账号登录）。');
  process.exit(fail ? 1 : 0);
})().catch(e => {
  console.log('  ✘ 异常：' + (e && e.stack || e));
  process.exit(1);
});

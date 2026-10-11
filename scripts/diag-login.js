/* 对照诊断：同一账号，先发「已知能成功」的请求型态，再发「App 真实代码」的型态，
 * 把两次的请求头/请求体/响应全部打出来对比，定位 App 登录被拒的原因。
 *
 * 用法：node scripts/diag-login.js <学号> <密码>
 *
 * 只提交 2 次密码。第 1 次成功后服务器会清零「连错次数」，所以即使第 2 次失败也不会锁定。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const http = require('http');
const urlMod = require('url');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const BASE = 'http://zfjw.hntou.edu.cn';
const USER = process.argv[2], PASS = process.argv[3];
if (!USER || !PASS) { console.log('用法：node scripts/diag-login.js <学号> <密码>'); process.exit(2); }

/* 每个客户端独立 cookie 罐 */
function makeClient() {
  const jar = {};
  return {
    jar,
    request(opt) {
      return new Promise((resolve, reject) => {
        const u = urlMod.parse(opt.url);
        const headers = Object.assign({}, opt.headers || {});
        if (jar[u.host]) headers['Cookie'] = jar[u.host]; else delete headers['Cookie'];
        let body = null;
        if (opt.data !== undefined && opt.data !== null && opt.data !== '') body = Buffer.from(String(opt.data), 'utf8');
        if (body) headers['Content-Length'] = body.length;
        const req = http.request({
          hostname: u.hostname, port: u.port || 80, path: u.path,
          method: opt.method || 'GET', headers, timeout: 40000
        }, res => {
          const sc = res.headers['set-cookie'];
          if (sc && sc.length) jar[u.host] = sc.map(c => c.split(';')[0]).join('; ');
          const ch = [];
          res.on('data', c => ch.push(c));
          res.on('end', () => {
            const buf = Buffer.concat(ch);
            const ct = String(res.headers['content-type'] || '');
            const hdr = {};
            Object.keys(res.headers).forEach(k => {
              hdr[k] = Array.isArray(res.headers[k]) ? res.headers[k].join('; ') : res.headers[k];
            });
            resolve({ status: res.statusCode, headers: hdr, data: buf.toString('utf8'), raw: buf });
          });
        });
        req.on('timeout', () => req.destroy(new Error('超时')));
        req.on('error', e => reject(new Error(e.message)));
        if (body) req.write(body);
        req.end();
      });
    }
  };
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

function textOf(h) {
  return String(h).replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
}

function interesting(body) {
  const t = textOf(body);
  const hits = t.match(/[^ ]*(?:密码|用户名|学号|验证码|错误|不正确|不存在|锁定|失败|过期|失效)[^ ]*/g) || [];
  return hits.slice(0, 8);
}

/* ---------- 在沙箱里加载 App 真实代码 ---------- */
function loadApp(client) {
  const sandbox = {
    console, setTimeout, clearTimeout, Promise, Date, Math, JSON,
    Object, Array, String, Number, Boolean, RegExp, Error, TypeError,
    encodeURIComponent, decodeURIComponent, parseInt, parseFloat, isNaN, TextEncoder, atob, btoa
  };
  sandbox.window = sandbox; sandbox.globalThis = sandbox;
  sandbox.Capacitor = { isNativePlatform: () => false };
  ['bridge.js', 'parser.js', 'store.js', 'import-jw.js'].forEach(f => {
    vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'www/js', f), 'utf8'), sandbox, { filename: f });
  });
  const seen = [];
  sandbox.Bridge.http = opt => { seen.push(opt); return client.request(opt); };
  return { sandbox, seen };
}

function parseFields(html) {
  const out = {};
  const tags = html.match(/<input\b[^>]*>/gi) || [];
  tags.forEach(tag => {
    const nm = /\bname\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]*))/i.exec(tag);
    if (!nm) return;
    const name = nm[1] !== undefined ? nm[1] : (nm[2] !== undefined ? nm[2] : nm[3]);
    const v = /\bvalue\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]*))/i.exec(tag);
    const val = v ? (v[1] !== undefined ? v[1] : (v[2] !== undefined ? v[2] : v[3])) : '';
    out[name] = val;              // 同名取最后一个
  });
  return out;
}

(async () => {
  /* ============ 客户端 A：手工型态（上次已经跑通过的那种） ============ */
  console.log('='.repeat(74));
  console.log('A. 手工型态（Python 探测脚本用过、上次成功的型态）');
  console.log('='.repeat(74));
  const ca = makeClient();
  let r = await ca.request({ url: BASE + '/jwglxt/xtgl/login_slogin.html' });
  const htmlA = r.data;
  const fA = parseFields(htmlA);
  console.log('登录页 %d 字节，%d 个字段', htmlA.length, Object.keys(fA).length);
  await sleep(1200);

  r = await ca.request({ url: BASE + '/jwglxt/xtgl/login_getPublicKey.html?time=' + Date.now() });
  const keyA = JSON.parse(r.data);
  await sleep(1200);

  const { createHash } = require('crypto');
  // 用和 App 完全相同的 RSA 实现（从沙箱里拿）
  const appA = loadApp(ca);
  const encA = appA.sandbox.Bridge.rsaEncrypt(PASS, keyA.modulus, keyA.exponent, 'pkcs1');

  const bodyA = Object.keys(fA).filter(k => !['yhm', 'mm', 'yzm'].includes(k))
    .map(k => encodeURIComponent(k) + '=' + encodeURIComponent(fA[k])).join('&')
    + '&yhm=' + encodeURIComponent(USER) + '&mm=' + encodeURIComponent(encA) + '&yzm=';

  const uA = BASE + '/jwglxt/xtgl/login_slogin.html?time=' + Date.now();
  const encAEnc = encodeURIComponent(encA);
  console.log('请求体（密码已打码）: %s', bodyA.replace(encAEnc, '<ENC>').slice(0, 320));
  r = await ca.request({
    url: uA, method: 'POST', data: bodyA,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Linux; Android 12; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Mobile Safari/537.36',
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept-Language': 'zh-CN,zh;q=0.9',
      'Referer': BASE + '/jwglxt/xtgl/login_slogin.html',
      'X-Requested-With': 'XMLHttpRequest',
      'Origin': BASE
    }
  });
  console.log('→ HTTP %s  Location=%s  %d 字节', r.status, r.headers['location'] || '(无)', (r.raw || Buffer.from(r.data)).length);
  console.log('  提示: %s', JSON.stringify(interesting(r.data)));
  const aOk = r.status === 302 || r.status === 200 && !/name=["']?mm/i.test(r.data);
  console.log('  A 判定: %s', aOk ? '登录成功（或至少被接受）' : '失败');

  /* ============ 客户端 B：App 真实代码 ============ */
  console.log('');
  console.log('='.repeat(74));
  console.log('B. App 真实代码（JwImport.prepare + login）');
  console.log('='.repeat(74));
  await sleep(1500);
  const cb = makeClient();
  const appB = loadApp(cb);
  const J = appB.sandbox.JwImport;
  const ctx = await J.prepare(BASE, 'jwglxt', m => console.log('    ' + m));
  await sleep(800);

  const loginOpt = await new Promise(resolve => {
    const orig = appB.sandbox.Bridge.http;
    appB.sandbox.Bridge.http = opt => {
      if (/login_slogin/.test(opt.url) && (opt.method === 'POST')) { resolve(opt); return Promise.resolve({ status: 0, headers: {}, data: '' }); }
      return orig(opt);
    };
    J.run(ctx, { user: USER, pass: PASS, code: '', rsaMode: 'pkcs1', totalWeeks: 20, log: () => {} })
      .catch(() => { });
  });

  console.log('App 实际发出的登录请求：');
  console.log('  URL : %s', loginOpt.url);
  console.log('  头  : %s', JSON.stringify(loginOpt.headers, null, 0));
  console.log('  体  : %s', String(loginOpt.data).replace(/mm=[^&]*/, 'mm=<ENC>').slice(0, 400));

  const bodyB = String(loginOpt.data);
  const bodyBnoEnc = bodyB.replace(/mm=[^&]*/, 'mm=X');
  const bodyAnoEnc = bodyA.replace(encAEnc, 'X');
  console.log('');
  console.log('A/B 请求体差异（密码统一打码后逐字段对比）：');
  const pa = new URLSearchParams(bodyAnoEnc), pb = new URLSearchParams(bodyBnoEnc);
  const keys = new Set([...pa.keys(), ...pb.keys()]);
  let diff = 0;
  keys.forEach(k => {
    const va = pa.getAll(k), vb = pb.getAll(k);
    if (JSON.stringify(va) !== JSON.stringify(vb)) {
      diff++;
      console.log('   ✘ %-22s A=%s   B=%s', k, JSON.stringify(va), JSON.stringify(vb));
    }
  });
  if (!diff) console.log('   （没有差异）');

  console.log('');
  console.log('A 的头键 : %s', Object.keys({ 'User-Agent': 1, 'Content-Type': 1, 'Referer': 1, 'X-Requested-With': 1, 'Origin': 1, 'Accept-Language': 1 }).join(', '));
  console.log('B 的头键 : %s', Object.keys(loginOpt.headers).join(', '));
  process.exit(0);
})().catch(e => { console.log('诊断异常：' + (e && e.stack || e)); process.exit(1); });

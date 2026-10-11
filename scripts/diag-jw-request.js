/* 离线诊断 App 的教务登录请求：
   1) 用本地生成的 RSA 密钥对校验 Bridge.rsaEncrypt 是否真的正确
   2) 跑 prepare()，把登录请求逐字段 dump 出来
   3) 用「Python 探测脚本」同款方式再组一份请求，做结构 diff
   完全不提交登录，不消耗密码次数。 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');
const http = require('http');
const https = require('https');
const urlMod = require('url');

const ROOT = process.cwd();
const BASE = 'http://zfjw.hntou.edu.cn';

/* ---------- 沙箱 ---------- */
const sandbox = {
  console, setTimeout, clearTimeout, Promise, Date, Math, JSON, Object, Array,
  String, Number, Boolean, RegExp, Error, TypeError, parseInt, parseFloat, isNaN,
  encodeURIComponent, decodeURIComponent, TextEncoder,
  atob: (s) => Buffer.from(s, 'base64').toString('binary'),
  btoa: (s) => Buffer.from(s, 'binary').toString('base64')
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
sandbox.Capacitor = { isNativePlatform: () => false };
sandbox.crypto = crypto.webcrypto;

/* ---------- 带完整日志的 http 桩 ---------- */
const cookieJar = {};
const reqLog = [];
function httpRequest(opt) {
  return new Promise((resolve, reject) => {
    const u = urlMod.parse(opt.url);
    const headers = Object.assign({}, opt.headers || {});
    // 合并本地 cookie 罐（按 cookie 名逐条合并，别整体覆盖）
    if (cookieJar[u.host]) {
      const jar = {};
      String(cookieJar[u.host]).split(';').forEach(p => {
        const i = p.indexOf('=');
        if (i > 0) jar[p.slice(0, i).trim()] = p.slice(i + 1).trim();
      });
      if (headers['Cookie']) {
        String(headers['Cookie']).split(';').forEach(p => {
          const i = p.indexOf('=');
          if (i > 0) jar[p.slice(0, i).trim()] = p.slice(i + 1).trim();
        });
      }
      headers['Cookie'] = Object.keys(jar).map(k => k + '=' + jar[k]).join('; ');
    }
    let body = null;
    if (opt.data !== undefined && opt.data !== null && opt.data !== '') body = Buffer.from(String(opt.data), 'utf8');
    if (body || (opt.method || 'GET') === 'POST') headers['Content-Length'] = body ? body.length : 0;

    reqLog.push({
      method: opt.method || 'GET', url: opt.url, headers: Object.assign({}, headers),
      body: body ? body.toString('utf8') : null
    });

    const mod = u.protocol === 'https:' ? https : http;
    const req = mod.request({
      hostname: u.hostname, port: u.port || 80, path: u.path,
      method: opt.method || 'GET', headers, timeout: 40000
    }, res => {
      const sc = res.headers['set-cookie'];
      if (sc && sc.length) {
        const jar = {};
        String(cookieJar[u.host] || '').split(';').forEach(p => {
          const i = p.indexOf('=');
          if (i > 0) jar[p.slice(0, i).trim()] = p.slice(i + 1).trim();
        });
        sc.forEach(c => {
          const kv = c.split(';')[0];
          const i = kv.indexOf('=');
          if (i > 0) jar[kv.slice(0, i).trim()] = kv.slice(i + 1).trim();
        });
        cookieJar[u.host] = Object.keys(jar).map(k => k + '=' + jar[k]).join('; ');
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        const ct = String(res.headers['content-type'] || '');
        const hdr = {};
        Object.keys(res.headers).forEach(k => { hdr[k] = Array.isArray(res.headers[k]) ? res.headers[k].join('; ') : res.headers[k]; });
        resolve({
          status: res.statusCode, headers: hdr,
          data: /image\//.test(ct) ? buf.toString('base64') : buf.toString('utf8'),
          url: opt.url
        });
      });
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', e => reject(new Error(e.message)));
    if (body) req.write(body);
    req.end();
  });
}

/* 把 http 桩挂进沙箱，再加载 App 代码 */
['bridge.js', 'parser.js', 'import-jw.js'].forEach(f => {
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'www/js', f), 'utf8'), sandbox, { filename: f });
});
sandbox.Bridge.http = httpRequest;
const J = sandbox.JwImport;
const B = sandbox.Bridge;

/* ---------- 1) RSA 自校验 ---------- */
console.log('='.repeat(72));
console.log('【1】Bridge.rsaEncrypt 正确性自校验（本地生成密钥对）');
console.log('='.repeat(72));
const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 1024 });
const jwk = publicKey.export({ format: 'jwk' });
console.log('  公钥 n（base64url, %d 字符）  e=%s', jwk.n.length, jwk.e);
const pass = process.argv[2] || 'Wml25800000.';
console.log('  待加密密码: %s  （%d 字符）', pass, pass.length);

let encOk = 0, encFail = 0;
for (let i = 0; i < 5; i++) {
  try {
    const enc = B.rsaEncrypt(pass, jwk.n, jwk.e, 'pkcs1');
    const raw = Buffer.from(enc, 'base64');
    const dec = crypto.privateDecrypt(
      { key: privateKey, padding: crypto.constants.RSA_PKCS1_PADDING }, raw);
    const got = dec.toString('utf8');
    if (got === pass) encOk++;
    else { encFail++; console.log('  ✘ 第%d次 解密结果 = %j', i + 1, got); }
  } catch (e) {
    encFail++;
    console.log('  ✘ 第%d次 异常: %s', i + 1, e.message);
  }
}
console.log('  → 加密/解密一致 %d 次 / 失败 %d 次  %s', encOk, encFail, encFail ? '✘ 加密实现有 bug' : '✔ 加密实现正确');

/* ---------- 2) prepare + dump App 请求 ---------- */
console.log('\n' + '='.repeat(72));
console.log('【2】App 真实代码 prepare() + 登录请求 dump');
console.log('='.repeat(72));
const logs = [];
J.prepare(BASE, 'jwglxt', m => logs.push(m)).then(ctx => {
  console.log('  prepare 日志：');
  logs.forEach(l => console.log('    ' + l));
  console.log('\n  ctx 摘要：base=%s variant=%s pubkey=%s csrf=%s maxFail=%s lockMin=%s captchaForced=%s',
    ctx.base, ctx.variant, ctx.pubkey ? '有' : '无', (ctx.csrf || '').slice(0, 12) + '…',
    ctx.maxFail, ctx.lockMin, ctx.captchaForced);

  const enc = B.rsaEncrypt(pass, ctx.pubkey.modulus, ctx.pubkey.exponent, 'pkcs1');
  const appBody = J.buildLoginBody(ctx, '252500010', enc, '');

  /* 解析成 map，便于结构 diff */
  const toMap = (s) => {
    const m = {};
    String(s).split('&').forEach(p => {
      const i = p.indexOf('=');
      if (i > 0) m[p.slice(0, i)] = decodeURIComponent(p.slice(i + 1));
    });
    return m;
  };
  const A = toMap(appBody);

  console.log('\n  App 请求体字段（%d 个）：', Object.keys(A).length);
  Object.keys(A).forEach(k => {
    let v = A[k];
    let note = '';
    if (k === 'mm') note = '  ← RSA 密文, base64解码 ' + Buffer.from(v, 'base64').length + ' 字节';
    console.log('    ' + String(k).padEnd(20) + ' = ' + JSON.stringify(v.length > 46 ? v.slice(0, 46) + '…' : v) + note);
  });

  /* ---------- 3) Python 口径的字段与请求体 ---------- */
  console.log('\n' + '='.repeat(72));
  console.log('【3】对比：Python 探测脚本口径（已实测成功）');
  console.log('='.repeat(72));
  return httpRequest({ url: BASE + '/jwglxt/xtgl/login_slogin.html', method: 'GET' }).then(res => {
    const H = res.data;
    const fields = {};
    const tags = H.match(/<input\b[^>]*>/gi) || [];
    tags.forEach(tag => {
      const nm = /\bname\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]*))/i.exec(tag);
      if (!nm) return;
      const name = nm[1] !== undefined ? nm[1] : nm[2] !== undefined ? nm[2] : nm[3];
      const vm2 = /\bvalue\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]*))/i.exec(tag);
      const val = vm2 ? (vm2[1] !== undefined ? vm2[1] : vm2[2] !== undefined ? vm2[2] : vm2[3]) : '';
      fields[name] = val;
    });
    const P = Object.assign({}, fields);
    P.yhm = '252500010'; P.mm = enc; P.yzm = '';
    const keys = Object.keys(P);

    console.log('  Python 口径字段（%d 个）: %s', keys.length, keys.join(', '));
    console.log('  App  口径字段（%d 个）: %s', Object.keys(A).length, Object.keys(A).join(', '));

    const onlyPy = keys.filter(k => !(k in A));
    const onlyApp = Object.keys(A).filter(k => !(k in P));
    console.log('\n  ▶ 只有 Python 带的字段: %s', JSON.stringify(onlyPy));
    console.log('  ▶ 只有 App  带的字段: %s', JSON.stringify(onlyApp));
    console.log('  ▶ 字段顺序 Python: %s', keys.slice(-6).join(' → '));
    console.log('  ▶ 字段顺序 App   : %s', Object.keys(A).slice(-6).join(' → '));

    const diffs = Object.keys(A).filter(k => k !== 'mm' && String(A[k]) !== String(P[k] === undefined ? '' : P[k]));
    console.log('  ▶ 值不一致的字段（除 mm）: %s',
      diffs.length ? diffs.map(k => k + ': App=' + JSON.stringify(A[k]) + ' Py=' + JSON.stringify(P[k])).join(' | ') : '无');

    /* ---------- 4) 请求级差异 ---------- */
    console.log('\n' + '='.repeat(72));
    console.log('【4】请求级差异（App 实际发出的 login POST）');
    console.log('='.repeat(72));
    const post = reqLog.find(r => r.method === 'POST');
    console.log('  App 登录请求行: POST %s', post ? post.url : '(还没发)');
    console.log('  App 请求头:');
    if (post) Object.keys(post.headers).forEach(k => console.log('    %-18s %s', k, post.headers[k]));
    console.log('\n  Python 探测脚本的登录请求（已实测成功）:');
    console.log('    POST %s/jwglxt/xtgl/login_slogin.html        ← 无 ?time=', BASE);
    console.log('    Content-Type        application/x-www-form-urlencoded');
    console.log('    Origin              %s', BASE);
    console.log('    Referer             %s/jwglxt/xtgl/login_slogin.html', BASE);
    console.log('    （无 X-Requested-With）');
    console.log('    Cookie              JSESSIONID + route2');
    console.log('\n  ▶ App 独有的请求头: %s',
      post ? Object.keys(post.headers).filter(k => /x-requested-with/i.test(k)).join(',') || '(无)' : '-');
  });
}).catch(e => {
  console.log('  ✘ 异常: %s\n%s', e.message, e.stack);
});

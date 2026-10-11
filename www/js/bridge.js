/* bridge.js —— 原生能力桥接：HTTP（绕过 CORS）、RSA 加密、文件读取、提示 */
(function (global) {
  'use strict';

  var P = (global.Capacitor && global.Capacitor.Plugins) || {};

  function isNative() {
    return !!(global.Capacitor && global.Capacitor.isNativePlatform && global.Capacitor.isNativePlatform());
  }

  function hasHttp() { return !!P.CapacitorHttp; }

  /* 默认 60 秒。原生的 CapacitorHttp 在 Android 上默认没有超时，
     请求发出去没人回就永远挂着——用户会以为 App 卡死了。 */
  var DEFAULT_TIMEOUT = 60000;

  function timeoutPromise(p, ms, msg) {
    if (!ms) return p;
    return new Promise(function (res, rej) {
      var done = false;
      var t = setTimeout(function () {
        if (done) return;
        done = true;
        rej(new Error(msg));
      }, ms);
      p.then(function (v) { if (done) return; done = true; clearTimeout(t); res(v); },
        function (e) { if (done) return; done = true; clearTimeout(t); rej(e); });
    });
  }

  /**
   * 统一 HTTP 请求。
   * 原生（APK）走 CapacitorHttp，请求由 Java 层发出，不受浏览器同源策略限制；
   * 浏览器环境退化为 fetch，跨域会失败，调用方需提示用户。
   * opt.timeout 传 0 表示不设超时。
   * @returns Promise<{status,headers,data,url}>
   */
  function http(opt) {
    var rt = opt.responseType || 'text';
    var to = opt.timeout === 0 ? 0 : (opt.timeout || DEFAULT_TIMEOUT);

    if (isNative() && hasHttp()) {
      var p = P.CapacitorHttp.request({
        url: opt.url,
        method: opt.method || 'GET',
        headers: opt.headers || {},
        data: opt.data,
        params: opt.params,
        responseType: rt === 'blob' ? 'text' : rt,
        connectTimeout: to || 60000,
        readTimeout: to || 60000,
        disableRedirects: false,
        shouldEncodeUrlParams: false
      }).then(function (res) {
        return { status: res.status, headers: res.headers || {}, data: res.data, url: opt.url };
      });
      return timeoutPromise(p, to ? to + 8000 : 0,
        '请求超时：等了 ' + Math.round(to / 1000) + ' 秒没有响应。请检查网络后重试。');
    }

    // 浏览器回退
    var init = { method: opt.method || 'GET', headers: opt.headers || {}, credentials: 'include' };
    if (opt.data !== undefined && init.method !== 'GET') init.body = opt.data;
    var url = opt.url;
    if (opt.params) {
      var q = Object.keys(opt.params).map(function (k) {
        return encodeURIComponent(k) + '=' + encodeURIComponent(opt.params[k]);
      }).join('&');
      url += (url.indexOf('?') >= 0 ? '&' : '?') + q;
    }

    var ctl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    var timer = null;
    if (ctl && to) {
      init.signal = ctl.signal;
      timer = setTimeout(function () { ctl.abort(); }, to);
    }
    return fetch(url, init).then(function (r) {
      if (timer) clearTimeout(timer);
      var h = {};
      r.headers.forEach(function (v, k) { h[k] = v; });
      var bodyP = rt === 'base64' ? r.arrayBuffer().then(arrayBufferToBase64)
        : rt === 'blob' ? r.arrayBuffer().then(arrayBufferToBase64)
          : r.text();
      return bodyP.then(function (d) { return { status: r.status, headers: h, data: d, url: url }; });
    }).catch(function (e) {
      if (timer) clearTimeout(timer);
      if (e && e.name === 'AbortError') {
        throw new Error('请求超时：等了 ' + Math.round(to / 1000) + ' 秒没有响应。请检查网络后重试。');
      }
      throw new Error('浏览器环境下跨域请求被拦截（CORS）。请打包成 APK 后使用，或改用「截图识别 / 文件导入」。');
    });
  }

  function arrayBufferToBase64(buf) {
    return bytesToBase64(new Uint8Array(buf));
  }

  // 同时支持普通数组和 TypedArray
  function bytesToBase64(bytes) {
    var s = '';
    for (var i = 0; i < bytes.length; i += 4096) {
      s += String.fromCharCode.apply(null, bytes.slice(i, i + 4096));
    }
    return btoa(s);
  }

  function base64ToBytes(b64) {
    // 同时容忍标准 base64 与 base64url（JWK 里的 n/e 是 base64url）
    var s = String(b64).replace(/\s/g, '').replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4) s += '=';
    var bin = atob(s);
    var out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  /* ---------- RSA：正方教务登录密码加密 ---------- */
  /* 依据：正方新版登录页取回 modulus/exponent 公钥后，在前端用 RSA 公钥加密密码再提交。
     这里同时支持 base64 / hex 两种公钥编码，并提供「PKCS#1 填充」与「裸整数幂」两种模式，
     因为不同学校部署的版本不一致，用户可在高级选项里切换。 */

  function looksHex(s) {
    return /^[0-9a-fA-F]+$/.test(s) && s.length % 2 === 0;
  }

  function toHex(s) {
    if (!s) return '';
    if (looksHex(s)) return s.toLowerCase();
    try { return Array.from(base64ToBytes(s)).map(function (b) {
      return (b < 16 ? '0' : '') + b.toString(16);
    }).join(''); } catch (e) { return ''; }
  }

  function bytesToHex(bytes) {
    var out = '';
    for (var i = 0; i < bytes.length; i++) out += (bytes[i] < 16 ? '0' : '') + bytes[i].toString(16);
    return out;
  }

  /* 一个大整数的「位长」。PKCS#1 要求 RSA 分组长度 k = ceil(bitlen(n)/8)。 */
  function bitLength(x) { return x === 0n ? 0 : x.toString(2).length; }

  /* 合理的模数位长区间：512 ~ 8192 bit（覆盖最低强度的旧部署到 8192 位强密钥）。
     用来在两个候选解码里挑出真正是公钥模数的那个。 */
  var MIN_MOD_BITS = 512;
  var MAX_MOD_BITS = 8192;

  /**
   * 解析公钥模数，返回 { hex, n, bits }。
   *
   * 为什么不能只用 toHex()：
   *   正方 /jwglxt/xtgl/login_getPublicKey.html 返回的 modulus 是 **base64**，
   *   解码后通常是 128 字节（1024 位），但**常常带一个前导 0x00**，
   *   于是变成 129 字节。如果直接拿「字节数」当分组长度 k，就会多算 1 字节，
   *   PKCS#1 的 00 02 前导填充整体错位，服务器解填充失败，
   *   一律回「用户名或密码不正确」——这就是登录永远失败的真因。
   *
   * 另一个坑：极少数字符串既是合法 hex 又是合法 base64，looksHex() 会误判。
   *   所以这里把两种口径都解一遍，取「位长落在 512~8192 bit」的那个；
   *   都不在区间时退回 hex 口径（保持旧行为），都不合法时返回 null。
   */
  function resolveModulus(raw) {
    if (!raw) return null;
    var cands = [], seen = {};
    var push = function (hex) {
      if (!hex || seen[hex]) return;
      seen[hex] = 1;
      var n = BigInt('0x' + hex);
      cands.push({ hex: hex, n: n, bits: bitLength(n) });
    };
    if (looksHex(raw)) push(String(raw).toLowerCase());
    try { push(bytesToHex(base64ToBytes(raw))); } catch (e) { /* 不是合法 base64，忽略 */ }
    if (!cands.length) return null;
    for (var i = 0; i < cands.length; i++) {
      if (cands[i].bits >= MIN_MOD_BITS && cands[i].bits <= MAX_MOD_BITS) return cands[i];
    }
    return cands[0];
  }

  /* 把明文编码成 UTF-8 字节数组（完整、不截断）。顺带正确处理代理对（4 字节字符）。 */
  function utf8Bytes(text) {
    var out = [];
    for (var i = 0; i < text.length; i++) {
      var c = text.charCodeAt(i);
      if (c < 128) {
        out.push(c);
      } else if (c < 2048) {
        out.push((c >> 6) | 192, (c & 63) | 128);
      } else if (c >= 0xD800 && c <= 0xDBFF && i + 1 < text.length &&
                 text.charCodeAt(i + 1) >= 0xDC00 && text.charCodeAt(i + 1) <= 0xDFFF) {
        var cp = 0x10000 + ((c - 0xD800) << 10) + (text.charCodeAt(i + 1) - 0xDC00);
        out.push(0xF0 | (cp >> 18), 0x80 | ((cp >> 12) & 63), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
        i++;
      } else {
        out.push((c >> 12) | 224, ((c >> 6) & 63) | 128, (c & 63) | 128);
      }
    }
    return out;
  }

  function pkcs1pad(text, nBytes) {
    // 先把整段明文编码完（不截断），超长直接判失败。
    // 靠「累加到上限就停」来截断的话，超长密码会产出一段**能解开、但明文不符**的密文，
    // 服务器解填充后对不上，只会回「用户名或密码不正确」——错误被伪装成了密码错。
    var msg = utf8Bytes(text);
    if (msg.length > nBytes - 11) return null;
    var padLen = nBytes - 3 - msg.length;          // ≥ 8，符合 PKCS#1 v1.5
    var ps = [];
    for (var k = 0; k < padLen; k++) ps.push(Math.floor(Math.random() * 254) + 1);   // 1..254，非零
    return [0, 2].concat(ps, [0], msg);
  }

  function modPow(b, e, m) {
    var r = 1n;
    b = b % m;
    while (e > 0n) {
      if (e & 1n) r = (r * b) % m;
      e >>= 1n;
      b = (b * b) % m;
    }
    return r;
  }

  function bytesToBigInt(ba) {
    var hex = '';
    for (var i = 0; i < ba.length; i++) hex += (ba[i] < 16 ? '0' : '') + ba[i].toString(16);
    return hex ? BigInt('0x' + hex) : 0n;
  }

  /** 公钥模数的位长（用于日志展示；解析失败返回 0）。 */
  function modulusBits(modulus) {
    var m = resolveModulus(modulus);
    return m ? m.bits : 0;
  }

  /**
   * @param {string} password 明文密码
   * @param {string} modulus  公钥模数（hex 或 base64）
   * @param {string} exponent 公钥指数（hex 或 base64）
   * @param {string} mode     'pkcs1'（默认）| 'raw'
   * @returns {string} base64 密文
   */
  function rsaEncrypt(password, modulus, exponent, mode) {
    var mod = resolveModulus(modulus);
    var eHex = toHex(exponent);
    if (!mod || !eHex) throw new Error('公钥格式无法识别（既非 hex 也非 base64）');
    var n = mod.n, e = BigInt('0x' + eHex);
    // 分组长度由模数的「位长」算，不能用 base64 解码后的字节数：
    // 正方返回的 modulus 常带前导 0x00（1024 位解出 129 字节），用字节数会多算 1 字节。
    var nBytes = Math.ceil(mod.bits / 8);

    var m;
    if (mode === 'raw') {
      var raw = Array.from(new TextEncoder().encode(password));
      if (raw.length > nBytes - 1) throw new Error('密码过长');
      m = bytesToBigInt([0].concat(raw));
    } else {
      var padded = pkcs1pad(password, nBytes);
      if (!padded) throw new Error('密码长度超出 RSA 分组上限');
      m = bytesToBigInt(padded);
    }
    if (m >= n) throw new Error('明文大于模数');

    var c = modPow(m, e, n);
    var hex = c.toString(16);
    while (hex.length < nBytes * 2) hex = '0' + hex;
    var bytes = [];
    for (var i = 0; i < hex.length; i += 2) bytes.push(parseInt(hex.substr(i, 2), 16));
    return bytesToBase64(bytes);
  }

  /* ---------- 文件 ---------- */
  function readFileAsDataURL(file) {
    return new Promise(function (res, rej) {
      var fr = new FileReader();
      fr.onload = function () { res({ dataUrl: fr.result, name: file.name, type: file.type, size: file.size }); };
      fr.onerror = function () { rej(new Error('读取文件失败')); };
      fr.readAsDataURL(file);
    });
  }

  function readFileAsText(file) {
    return new Promise(function (res, rej) {
      var fr = new FileReader();
      fr.onload = function () { res(fr.result); };
      fr.onerror = function () { rej(new Error('读取文件失败')); };
      fr.readAsText(file, 'utf-8');
    });
  }

  function readFileAsArrayBuffer(file) {
    return new Promise(function (res, rej) {
      var fr = new FileReader();
      fr.onload = function () { res(fr.result); };
      fr.onerror = function () { rej(new Error('读取文件失败')); };
      fr.readAsArrayBuffer(file);
    });
  }

  global.Bridge = {
    isNative: isNative,
    hasHttp: hasHttp,
    http: http,
    rsaEncrypt: rsaEncrypt,
    modulusBits: modulusBits,
    bytesToBase64: bytesToBase64,
    base64ToBytes: base64ToBytes,
    readFileAsDataURL: readFileAsDataURL,
    readFileAsText: readFileAsText,
    readFileAsArrayBuffer: readFileAsArrayBuffer
  };
})(window);

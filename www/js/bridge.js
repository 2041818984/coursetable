/* bridge.js —— 原生能力桥接：HTTP（绕过 CORS）、RSA 加密、文件读取、提示 */
(function (global) {
  'use strict';

  var P = (global.Capacitor && global.Capacitor.Plugins) || {};

  function isNative() {
    return !!(global.Capacitor && global.Capacitor.isNativePlatform && global.Capacitor.isNativePlatform());
  }

  function hasHttp() { return !!P.CapacitorHttp; }

  /**
   * 统一 HTTP 请求。
   * 原生（APK）走 CapacitorHttp，请求由 Java 层发出，不受浏览器同源策略限制；
   * 浏览器环境退化为 fetch，跨域会失败，调用方需提示用户。
   * @returns Promise<{status,headers,data,url}>
   */
  function http(opt) {
    var rt = opt.responseType || 'text';
    if (isNative() && hasHttp()) {
      var p = P.CapacitorHttp.request({
        url: opt.url,
        method: opt.method || 'GET',
        headers: opt.headers || {},
        data: opt.data,
        params: opt.params,
        responseType: rt === 'blob' ? 'text' : rt,
        disableRedirects: false,
        shouldEncodeUrlParams: false
      });
      return p.then(function (res) {
        return { status: res.status, headers: res.headers || {}, data: res.data, url: opt.url };
      });
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
    return fetch(url, init).then(function (r) {
      var h = {};
      r.headers.forEach(function (v, k) { h[k] = v; });
      var bodyP = rt === 'base64' ? r.arrayBuffer().then(arrayBufferToBase64)
        : rt === 'blob' ? r.arrayBuffer().then(arrayBufferToBase64)
          : r.text();
      return bodyP.then(function (d) { return { status: r.status, headers: h, data: d, url: url }; });
    }).catch(function (e) {
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

  function pkcs1pad(text, nBytes) {
    var ba = [];
    var i = text.length - 1;
    while (i >= 0 && ba.length < nBytes - 11) {
      var c = text.charCodeAt(i--);
      // unshift 会保持参数原顺序插到数组头部，所以 UTF-8 的高位字节必须写在前面
      if (c < 128) ba.unshift(c);
      else if (c < 2048) ba.unshift((c >> 6) | 192, (c & 63) | 128);
      else ba.unshift((c >> 12) | 224, ((c >> 6) & 63) | 128, (c & 63) | 128);
    }
    if (ba.length > nBytes - 11) return null;
    var padLen = nBytes - 3 - ba.length;
    var ps = [];
    for (var k = 0; k < padLen; k++) ps.push(Math.floor(Math.random() * 254) + 1);
    return [0, 2].concat(ps, [0], ba);
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

  /**
   * @param {string} password 明文密码
   * @param {string} modulus  公钥模数（hex 或 base64）
   * @param {string} exponent 公钥指数（hex 或 base64）
   * @param {string} mode     'pkcs1'（默认）| 'raw'
   * @returns {string} base64 密文
   */
  function rsaEncrypt(password, modulus, exponent, mode) {
    var nHex = toHex(modulus), eHex = toHex(exponent);
    if (!nHex || !eHex) throw new Error('公钥格式无法识别（既非 hex 也非 base64）');
    var n = BigInt('0x' + nHex), e = BigInt('0x' + eHex);
    var nBytes = nHex.length / 2;

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
    bytesToBase64: bytesToBase64,
    base64ToBytes: base64ToBytes,
    readFileAsDataURL: readFileAsDataURL,
    readFileAsText: readFileAsText,
    readFileAsArrayBuffer: readFileAsArrayBuffer
  };
})(window);

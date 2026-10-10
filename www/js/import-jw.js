/* import-jw.js —— 正方教务系统直连抓取
 *
 * 说明：以下接口路径来自正方教务系统公开流传的通用约定（/jwglxt 新版、/jsxsd 旧版）。
 * 不同学校的部署版本、路径、字段名差异很大，因此所有路径都做成可探测 + 可手动覆盖，
 * 抓不到时应改用「图片识别 / 文件导入」，不要假设一定能通。
 */
(function (global) {
  'use strict';

  var P = (global.Capacitor && global.Capacitor.Plugins) || {};

  var PATHS = {
    jwglxt: {
      loginPage: '/jwglxt/xtgl/login_slogin.html',
      pubkey: ['/jwglxt/xtgl/login_getPublicKey.html'],
      code: [
        '/jwglxt/verifycode.servlet',
        '/jwglxt/xtgl/login_getVerifyCode.html',
        '/jwglxt/CheckCode.aspx',
        '/jwglxt/img/captcha.jpg',
        '/jwglxt/verifyCode.servlet'
      ],
      kb: [
        '/jwglxt/xskbcx/xskbcx_cxXsgrkb.html?gnmkdm=N2535',
        '/jwglxt/xskbcx/xskbcx_cxXsKb.html?gnmkdm=N2535',
        '/jwglxt/kbcx/xskbcx_cxXsgrkb.html?gnmkdm=N2535',
        '/jwglxt/xskbcx/xskbcx_cxXsgrkb.html'
      ]
    },
    jsxsd: {
      loginPage: '/jsxsd/xk/LoginToXk',
      pubkey: [],
      code: ['/jsxsd/verifycode.servlet', '/jsxsd/CheckCode.aspx', '/CheckCode.aspx', '/jsxsd/imgcode.jpg'],
      kb: ['/jsxsd/xskb/xskb_list.do', '/jsxsd/kbcx/xskb_list.do']
    },
    root: {
      loginPage: '/default.aspx',
      pubkey: [],
      code: ['/CheckCode.aspx', '/verifycode.servlet', '/sys/ValidateCode.aspx'],
      kb: ['/xskbcx.aspx', '/xs_main.aspx?xh={user}']
    }
  };

  function normalizeBase(s) {
    var b = String(s || '').trim().replace(/\/+$/, '');
    if (!b) return '';
    if (!/^https?:\/\//i.test(b)) b = 'https://' + b;
    return b;
  }

  /* ---------- Cookie ----------
     CapacitorCookies 随 @capacitor/core 一起提供（不需要单独装插件），
     它的 getCookies 返回 HttpCookieMap（cookie 名 → 值），这里统一拼成
     请求头需要的 "a=1; b=2" 形式。插件不可用时退回手工 jar。 */
  var jar = {};

  function hostOf(url) {
    var m = String(url).match(/^https?:\/\/([^/:]+)/i);
    return m ? m[1] : '';
  }

  function cookieApi() { return P.CapacitorCookies || null; }

  function cookieToString(res) {
    if (!res) return '';
    if (typeof res === 'string') return res;
    var keys = Object.keys(res);
    if (keys.length === 1 && keys[0] === 'value' && typeof res.value === 'string') return res.value;
    var parts = [];
    keys.forEach(function (k) {
      if (typeof res[k] === 'string' && k !== 'url') parts.push(k + '=' + res[k]);
    });
    return parts.join('; ');
  }

  function getCookies(url) {
    var CP = cookieApi();
    if (CP && CP.getCookies) {
      return CP.getCookies({ url: url })
        .then(function (r) { return cookieToString(r) || (jar[hostOf(url)] || ''); })
        .catch(function () { return jar[hostOf(url)] || ''; });
    }
    if (P.CapacitorHttp && P.CapacitorHttp.getCookies) {
      return P.CapacitorHttp.getCookies({ url: url })
        .then(function (r) { return (r && r.value) || (jar[hostOf(url)] || ''); })
        .catch(function () { return jar[hostOf(url)] || ''; });
    }
    return Promise.resolve(jar[hostOf(url)] || '');
  }

  function rememberSetCookie(url, headers) {
    var h = headers || {};
    var raw = h['Set-Cookie'] || h['set-cookie'] || h['SET-COOKIE'];
    if (!raw) return Promise.resolve();
    var value = String(raw).split(';')[0];
    var name = value.split('=')[0];
    if (!name) return Promise.resolve();
    jar[hostOf(url)] = (jar[hostOf(url)] ? jar[hostOf(url)] + '; ' : '') + value;

    var CP = cookieApi();
    if (CP && CP.setCookie) {
      return CP.setCookie({
        url: url,
        key: name,
        value: value.slice(name.length + 1)
      }).catch(function () { });
    }
    return Promise.resolve();
  }

  function clearCookies(url) {
    jar[hostOf(url)] = '';
    var CP = cookieApi();
    if (CP && CP.clearCookies) {
      return CP.clearCookies({ url: url }).catch(function () { });
    }
    return Promise.resolve();
  }

  function withCookie(url, headers) {
    return getCookies(url).then(function (ck) {
      var h = {};
      for (var k in (headers || {})) h[k] = headers[k];
      if (ck) h['Cookie'] = ck;
      return h;
    });
  }

  var UA = 'Mozilla/5.0 (Linux; Android 12; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Mobile Safari/537.36';

  function req(url, opt) {
    opt = opt || {};
    return withCookie(url, opt.headers).then(function (headers) {
      var h = {
        'User-Agent': UA,
        'Accept': opt.accept || 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9'
      };
      if (headers['Cookie']) h['Cookie'] = headers['Cookie'];
      for (var k in headers) if (k !== 'Cookie') h[k] = headers[k];
      if (opt.referer) h['Referer'] = opt.referer;

      return Bridge.http({
        url: url,
        method: opt.method || 'GET',
        headers: h,
        data: opt.body,
        responseType: opt.responseType || 'text'
      });
    }).then(function (res) {
      return rememberSetCookie(url, res.headers).then(function () { return res; });
    });
  }

  /* ---------- 探测验证码接口 ---------- */
  function detectCode(base, variant, log) {
    var list = (PATHS[variant] || PATHS.jwglxt).code;
    var i = 0;
    function next() {
      if (i >= list.length) return Promise.reject(new Error('没找到验证码接口，请在「高级」里手动填写'));
      var url = base + list[i++] + (list[i - 1].indexOf('?') < 0 ? '?t=' + Date.now() : '');
      log('尝试验证码：' + url);
      return req(url, { responseType: 'base64', accept: 'image/*' }).then(function (res) {
        var d = res.data;
        var ct = (res.headers && (res.headers['Content-Type'] || res.headers['content-type']) || '').toLowerCase();
        var ok = typeof d === 'string' && d.length > 200 && (ct.indexOf('image') >= 0 || !/^[{<]/.test(atob(d.slice(0, 64))));
        if (ok) {
          log('✔ 验证码接口可用：' + url);
          return { url: url, dataUrl: 'data:image/jpeg;base64,' + d };
        }
        return next();
      }).catch(function (e) { log('✘ ' + url + ' → ' + e.message); return next(); });
    }
    return next();
  }

  /* ---------- 取 RSA 公钥 ---------- */
  function getPublicKey(base, variant, log) {
    var list = (PATHS[variant] || PATHS.jwglxt).pubkey;
    if (!list.length) return Promise.resolve(null);
    return req(base + list[0] + '?t=' + Date.now(), {
      method: 'POST',
      body: '',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    }).then(function (res) {
      var d = res.data;
      if (typeof d === 'object') return d;
      try { return JSON.parse(d); } catch (e) { return null; }
    }).then(function (j) {
      if (j && (j.modulus || j.Modulus)) {
        log('✔ 已获取 RSA 公钥（模数 ' + String(j.modulus || j.Modulus).length + ' 字符）');
        return { modulus: j.modulus || j.Modulus, exponent: j.exponent || j.Exponent || 'AQAB' };
      }
      log('· 该站点未返回公钥，将按明文密码提交');
      return null;
    }).catch(function (e) { log('· 取公钥失败：' + e.message); return null; });
  }

  /* ---------- 站点连通性：区分「地址错」与「该校无验证码」 ---------- */
  function ping(base, log) {
    log('检查教务地址连通性…');
    return req(base + '/', { method: 'GET' }).then(function (res) {
      if (!res) throw new Error('无响应');
      if (res.status >= 400) throw new Error('HTTP ' + res.status);
      log('✔ 教务地址可达（HTTP ' + res.status + '）');
      return true;
    }).catch(function (e) {
      if (/无响应|HTTP/.test(e.message)) throw e;
      throw new Error(e.message);
    });
  }

  function prepare(baseRaw, variant, log) {
    var base = normalizeBase(baseRaw);
    if (!base) return Promise.reject(new Error('请先填写教务地址'));
    return ping(base, log)
      .then(function () {
        // 取不到验证码不代表失败：不少学校登录不需要验证码
        return detectCode(base, variant, log).catch(function (e) {
          log('· 未取到验证码（' + e.message + '），按「无需验证码」继续');
          return null;
        });
      })
      .then(function (c) {
        return getPublicKey(base, variant, log).then(function (k) {
          return { base: base, captcha: c ? c.dataUrl : '', needCode: !!c, pubkey: k };
        });
      });
  }

  /* ---------- 登录 ---------- */
  function login(ctx, user, pass, code, rsaMode, log) {
    var variant = ctx.variant, base = ctx.base;
    var pwd = pass;
    if (ctx.pubkey) {
      try {
        pwd = Bridge.rsaEncrypt(pass, ctx.pubkey.modulus, ctx.pubkey.exponent, rsaMode);
        log('✔ 密码已用 RSA 加密（' + (rsaMode === 'raw' ? '裸整数幂' : 'PKCS#1') + '）');
      } catch (e) {
        log('✘ 加密失败：' + e.message + '，改为明文提交');
        pwd = pass;
      }
    }
    var loginUrl = base + (PATHS[variant] || PATHS.jwglxt).loginPage;
    var body = 'yhm=' + encodeURIComponent(user) + '&mm=' + encodeURIComponent(pwd) + '&yzm=' + encodeURIComponent(code || '');
    log('登录 → ' + loginUrl);
    return req(loginUrl, {
      method: 'POST',
      body: body,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Requested-With': 'XMLHttpRequest' },
      referer: base
    }).then(function (res) {
      var t = typeof res.data === 'string' ? res.data : JSON.stringify(res.data);
      if (/验证码|yzm|不正确|错误/.test(t) && t.length < 800) {
        throw new Error('登录被拒：' + t.slice(0, 120));
      }
      if (/用户名或密码|密码错误|账号或密码/.test(t)) throw new Error('学号或密码不正确');
      log('✔ 登录请求已发送（' + res.status + '），响应长度 ' + t.length);
      return res;
    });
  }

  /* ---------- 抓课表 ---------- */
  function fetchKb(ctx, user, xnm, xqm, log) {
    var variant = ctx.variant, base = ctx.base;
    var list = (PATHS[variant] || PATHS.jwglxt).kb;
    var i = 0;
    function next() {
      if (i >= list.length) return Promise.reject(new Error('课表接口都试过了，未取到数据'));
      var path = list[i++].replace('{user}', encodeURIComponent(user));
      var url = base + path;
      var body = xnm ? ('xnm=' + encodeURIComponent(xnm) + '&xqm=' + encodeURIComponent(xqm)) : '';
      log('抓课表 → ' + url);
      return req(url, {
        method: 'POST',
        body: body,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Requested-With': 'XMLHttpRequest' },
        referer: base + path
      }).then(function (res) {
        var d = res.data;
        var j = null;
        if (typeof d === 'object' && d) j = d;
        else { try { j = JSON.parse(d); } catch (e) { j = null; } }

        if (j && j.kbList && j.kbList.length) { log('✔ 取到 ' + j.kbList.length + ' 条课程记录'); return j.kbList; }
        if (j && j.timetable && j.timetable.length) return j.timetable;
        if (j && Array.isArray(j)) { if (j.length) { log('✔ 取到数组 ' + j.length + ' 条'); return j; } }

        // 可能是 HTML 页面（旧版 jsxsd），交给表格解析
        if (typeof d === 'string' && /<t[dhr]/i.test(d)) {
          log('· 返回的是 HTML 页面，转为表格解析');
          return { __html: d };
        }
        log('✘ ' + url + ' 未返回课表数据');
        return next();
      }).catch(function (e) { log('✘ ' + e.message); return next(); });
    }
    return next();
  }

  /**
   * 完整流程。ctx 由 prepare() 得到。
   * @returns Promise<{courses:Array, raw:any}>
   */
  function run(ctx, opts) {
    var log = opts.log || function () { };
    return login(ctx, opts.user, opts.pass, opts.code, opts.rsaMode || 'pkcs1', log)
      .then(function () { return fetchKb(ctx, opts.user, opts.xnm, opts.xqm, log); })
      .then(function (raw) {
        if (raw && raw.__html) {
          return { courses: global.Parser.parseTable(htmlToMatrix(raw.__html), opts.totalWeeks), raw: raw.__html };
        }
        var courses = global.Parser.parseJwList(raw, opts.totalWeeks);
        if (!courses.length) throw new Error('接口有返回，但没能解析出课程。请展开「高级」核对接口路径，或改用图片 / 文件导入。');
        return { courses: courses, raw: raw };
      });
  }

  /* HTML <table> → 二维数组（含 rowspan/colspan 展开） */
  function htmlToMatrix(html) {
    var doc = new DOMParser().parseFromString(html, 'text/html');
    var tables = doc.querySelectorAll('table');
    if (!tables.length) return [];
    var best = tables[0], bestN = 0;
    tables.forEach(function (t) { var n = t.querySelectorAll('td').length; if (n > bestN) { bestN = n; best = t; } });

    var grid = [];
    function ensure(r, c) {
      while (grid.length <= r) grid.push([]);
      while (grid[r].length <= c) grid[r].push('');
    }
    var rows = best.querySelectorAll('tr');
    for (var ri = 0; ri < rows.length; ri++) {
      var tr = rows[ri];
      var ci = 0;
      var cells = tr.querySelectorAll('td,th');
      for (var k = 0; k < cells.length; k++) {
        var cell = cells[k];
        ensure(ri, ci);
        while (grid[ri][ci]) ci++;
        var cs = parseInt(cell.getAttribute('colspan') || '1', 10);
        var rs = parseInt(cell.getAttribute('rowspan') || '1', 10);
        var txt = (cell.innerText || cell.textContent || '').replace(/ /g, ' ').trim();
        for (var r2 = ri; r2 < ri + rs; r2++) {
          for (var c2 = ci; c2 < ci + cs; c2++) { ensure(r2, c2); if (r2 === ri && c2 === ci) grid[r2][c2] = txt; else if (!grid[r2][c2]) grid[r2][c2] = txt; }
        }
        ci += cs;
      }
    }
    var maxC = grid.reduce(function (m, r) { return Math.max(m, r.length); }, 0);
    return grid.map(function (r) {
      var out = r.slice();
      while (out.length < maxC) out.push('');
      return out;
    });
  }

  global.JwImport = {
    PATHS: PATHS,
    normalizeBase: normalizeBase,
    prepare: prepare,
    run: run,
    htmlToMatrix: htmlToMatrix,
    clearCookies: clearCookies
  };
})(window);

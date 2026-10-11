/* import-jw.js —— 正方教务系统直连抓取
 *
 * 路径来自正方教务系统的公开约定（/jwglxt 新版、/jsxsd 旧版），
 * 并用海南热带海洋学院（zfjw.hntou.edu.cn）实测校正过。
 *
 * 实测结论（2026-10，该校 /jwglxt 新版，用真实账号跑通）：
 *   1. 登录页 action = /jwglxt/xtgl/login_slogin.html?time=<毫秒>
 *   2. 密码必须 RSA 加密：PKCS#1 v1.5 填充，密文 base64。
 *      公钥 /jwglxt/xtgl/login_getPublicKey.html 返回的 modulus/exponent 是 base64，
 *      该校是 1024 位（modulus 172 字符）。登录成功后 302 回 login_slogin.html。
 *   3. 验证码图片在 /jwglxt/kaptcha（不是 verifycode.servlet）。
 *   4. dlsfbxyzm=0 → 该校**默认不要验证码**；验证码框 #yzmDiv 平时隐藏，
 *      连错 yzcskz(=3) 次才出现。所以「不弹验证码」是正常的，不是坏了。
 *   5. dlsbsdsj=3 → 连错 3 次锁定 3 分钟。因此 App 绝不自动重试密码。
 *   6. 未登录带 X-Requested-With 访问受保护路径返回自定义状态码 901（0 字节）；
 *      不带这个头则返回登录页 HTML。所以判定会话必须带该头看 901。
 *   7. 该校服务器会间歇性不响应（疑似限流），所以请求要节流 + 重试。
 *   8. ★ 课表真实入口（从主菜单扒出来的）：
 *       页面  /jwglxt/kbcx/xskbcx_cxXskbcxIndex.html?gnmkdm=N253508
 *       数据  /jwglxt/kbcx/xskbcx_cxXsgrkb.html?gnmkdm=N2151
 *       /jwglxt/xskbcx/... 那一支在本校**不存在**（404 系统维护页面）。
 *   9. ★★ 查课表必须带 xnm(学年) 和 xqm(学期)，两个都不能空也不猜错：
 *       传空值服务器直接回字面量 "null"（4 字节），什么都不给。
 *       xqm 的取值是 3/12/16（第一/二/三学期），不是 1/2/3。
 *       所以这里改成「先打开课表页面，读 #xnm / #xqm 下拉框的选中项，
 *       再拿这个值去查」——跟浏览器完全一致，不依赖用户手填。
 *
 * 不同学校部署差异很大，路径仍做成可探测 + 可手动覆盖，
 * 抓不到时应改用「图片识别 / 文件导入」。
 */
(function (global) {
  'use strict';

  var P = (global.Capacitor && global.Capacitor.Plugins) || {};

  /* 常见学校的教务地址，仅用于一键填入 */
  var SCHOOL_PRESETS = [
    { name: '海南热带海洋学院', base: 'http://zfjw.hntou.edu.cn' }
  ];

  var PATHS = {
    jwglxt: {
      loginPage: '/jwglxt/xtgl/login_slogin.html',
      pubkey: ['/jwglxt/xtgl/login_getPublicKey.html'],
      code: [
        '/jwglxt/kaptcha',                          // 新版正方标准位置（实测确认）
        '/jwglxt/verifycode.servlet',
        '/jwglxt/xtgl/login_getVerifyCode.html',
        '/jwglxt/xtgl/login_captcha.html',
        '/jwglxt/CheckCode.aspx',
        '/jwglxt/img/captcha.jpg',
        '/jwglxt/captcha'
      ],
      kb: [
        // 权威写法：kbcx 目录 + gnmkdm=N2151，且 body 要带 kzlx=ck
        '/jwglxt/kbcx/xskbcx_cxXsgrkb.html?gnmkdm=N2151',
        '/jwglxt/kbcx/xskbcx_cxXsgrkb.html?gnmkdm=N253508',
        '/jwglxt/xskbcx/xskbcx_cxXsgrkb.html?gnmkdm=N2535',
        '/jwglxt/xskbcx/xskbcx_cxXsKb.html?gnmkdm=N2535'
      ],
      // 「个人课表查询」页面本身。查课表前先打开它，是为了读 #xnm / #xqm
      // 两个下拉框的选中项——正方不传这两个参数就什么都不返回。
      kbIndex: [
        '/jwglxt/kbcx/xskbcx_cxXskbcxIndex.html?gnmkdm=N253508',
        '/jwglxt/kbcx/xskbcx_cxXskbcxIndex.html?gnmkdm=N2151'
      ]
    },
    jsxsd: {
      loginPage: '/jsxsd/xk/LoginToXk',
      pubkey: [],
      code: ['/jsxsd/verifycode.servlet', '/jsxsd/CheckCode.aspx', '/CheckCode.aspx', '/jsxsd/imgcode.jpg'],
      kb: ['/jsxsd/xskb/xskb_list.do', '/jsxsd/kbcx/xskb_list.do'],
      kbIndex: []
    },
    root: {
      loginPage: '/default.aspx',
      pubkey: [],
      code: ['/CheckCode.aspx', '/verifycode.servlet', '/sys/ValidateCode.aspx'],
      kb: ['/xskbcx.aspx', '/xs_main.aspx?xh={user}'],
      kbIndex: []
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

  /* ---------- 请求节流 ----------
     实测：该校服务器在短时间连发若干请求后会直接不响应（连登录页都超时），
     登录口更是会按 IP 限流——自动化脚本在十几分钟内连续登录几次之后，
     即使是完全正确的账号密码也会被回「用户名或密码不正确」。
     所以把所有请求串成一条链，两次之间至少隔 THROTTLE_MS，并把
     「不响应」视为可重试的临时故障。不要把 THROTTLE_MS 调太小。 */
  var THROTTLE_MS = 900;
  var queue = Promise.resolve();
  var lastAt = 0;

  function throttle() {
    queue = queue.then(function () {
      return new Promise(function (res) {
        var now = Date.now();
        var wait = Math.max(0, lastAt + THROTTLE_MS - now);
        lastAt = now + wait;
        setTimeout(res, wait);
      });
    });
    return queue;
  }

  function isTransportError(e) {
    var m = String((e && e.message) || e || '');
    if (/HTTP\s*\d{3}/.test(m)) return false;      // 服务器给了明确状态码，不是传输问题
    if (/CORS|跨域/.test(m)) return false;          // 浏览器环境，重试也没用
    return true;
  }

  function httpRetry(opt, tries, log) {
    return throttle().then(function () {
      return Bridge.http(opt).catch(function (e) {
        if (tries > 1 && isTransportError(e)) {
          if (log) log('· 服务器没响应（本校偶发），重试…');
          return httpRetry(opt, tries - 1, log);
        }
        throw e;
      });
    });
  }

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

      return httpRetry({
        url: url,
        method: opt.method || 'GET',
        headers: h,
        data: opt.data,
        responseType: opt.responseType || 'text'
      }, opt.tries || 3, opt.log);
    }).then(function (res) {
      return rememberSetCookie(url, res.headers).then(function () { return res; });
    });
  }

  /* ---------- HTML 属性读取 ----------
     正方页面里隐藏字段的值大多不带引号，形如 value= 1（等号后还有空格），
     只按引号匹配会全部读成空。 */
  function attrOf(tag, name) {
    var m = String(tag).match(new RegExp('\\b' + name + '\\s*=\\s*(?:"([^"]*)"|\'([^\']*)\'|([^\\s>]*))', 'i'));
    if (!m) return null;
    if (m[1] !== undefined) return m[1];
    if (m[2] !== undefined) return m[2];
    return m[3] === undefined ? null : m[3];
  }

  /**
   * 把登录页里的表单字段全都抠出来。真实浏览器提交表单时会把所有
   * hidden 字段一起带上（language / xxdm / mmsfjm 等），只发 yhm+mm
   * 有些部署会被拒。
   */
  function parseLoginFields(html) {
    var out = {
      fields: {}, csrf: '', passwordEncrypted: null,
      captchaForced: null, maxFail: null, lockMin: null
    };
    var re = /<input\b[^>]*>/gi, m;
    while ((m = re.exec(html))) {
      var tag = m[0];
      var name = attrOf(tag, 'name');
      if (!name) continue;
      var v = attrOf(tag, 'value');
      v = (v == null) ? '' : String(v).trim();
      out.fields[name] = v;
      if (name === 'csrftoken' && v) out.csrf = v;
    }
    // 兜底：有些模板把 csrftoken 写在 JS 里
    if (!out.csrf) {
      var c = html.match(/csrftoken['"]?\s*[:=]\s*['"]([^'"]+)['"]/i);
      if (c) out.csrf = c[1];
    }

    function fld(k) {
      var s = out.fields[k];
      return (s === undefined || s === '') ? null : s;
    }
    out.passwordEncrypted = fld('mmsfjm') === '1';
    // dlsfbxyzm: 1=必须验证码，0=默认不要（连错几次才出现），缺失=未知
    var d = fld('dlsfbxyzm');
    out.captchaForced = (d === '1') ? true : (d === '0' ? false : null);
    out.maxFail = fld('yzcskz');
    out.lockMin = fld('dlsbsdsj');
    return out;
  }

  /* ---------- 读登录页 ----------
     新版正方（V9 / 正方云）可能把字符验证码换成滑块拼图，登录页里会出现
     zfcaptchaLogin / zfdun 这类标记。滑块必须人工拖动，本 App 不做自动识别，
     检测到就明确告诉用户换导入方式，而不是一路试到超时。
     另外顺便读出「要不要验证码」「连错几次锁多久」，用于给用户提示。 */
  function readLoginPage(html) {
    var s = String(html == null ? '' : html);
    var info = {
      slider: false, codeUrl: '', csrf: '', len: s.length,
      fields: {}, captchaForced: null, maxFail: null, lockMin: null,
      passwordEncrypted: null
    };
    if (!s) return info;

    if (/zfcaptchaLogin|zfdun|slider[-_]?bar|slideVerify|captcha_config/i.test(s)) {
      info.slider = true;
    }
    var m = s.match(/['"]([^'"]*(?:kaptcha|verifycode|verifyCode|checkcode|CheckCode|validatecode|ValidateCode|imgcode)[^'"]*)['"]/);
    if (m) info.codeUrl = m[1];

    var parsed = parseLoginFields(s);
    info.fields = parsed.fields;
    info.csrf = parsed.csrf;
    info.captchaForced = parsed.captchaForced;
    info.maxFail = parsed.maxFail;
    info.lockMin = parsed.lockMin;
    info.passwordEncrypted = parsed.passwordEncrypted;
    return info;
  }

  function describeLoginPage(info, log) {
    if (!info) return;
    log('登录页长度 ' + info.len + '，表单字段 ' + Object.keys(info.fields || {}).length + ' 个');
    if (info.slider) log('⚠ 检测到滑块拼图验证码（新版正方常见）');
    if (info.codeUrl) log('✔ 页面里的验证码图片：' + info.codeUrl);
    if (info.csrf) log('✔ 找到 csrftoken');
    if (info.passwordEncrypted === true) log('✔ 页面声明密码需 RSA 加密（mmsfjm=1）');
    if (info.captchaForced === false) {
      log('✔ 页面声明默认不要验证码（dlsfbxyzm=0）——验证码只在连错后出现');
    } else if (info.captchaForced === true) {
      log('⚠ 页面声明登录必须输验证码（dlsfbxyzm=1）');
    }
    if (info.maxFail && info.lockMin) {
      log('⚠ 连错 ' + info.maxFail + ' 次将锁定 ' + info.lockMin + ' 分钟，App 不会自动重试密码');
    }
  }

  function inspectLoginPage(base, variant, log) {
    var rel = (PATHS[variant] || PATHS.jwglxt).loginPage;
    var url = base + rel;
    log('读取登录页：' + url);
    return req(url, { method: 'GET', accept: 'text/html', log: log })
      .then(function (res) {
        var info = readLoginPage(res.data);
        describeLoginPage(info, log);
        return info;
      })
      .catch(function (e) {
        log('· 登录页读取失败：' + e.message + '（继续按默认路径探测）');
        return null;
      });
  }

  /* ---------- 探测验证码接口 ---------- */
  function detectCode(base, variant, log, preferred) {
    var list = (PATHS[variant] || PATHS.jwglxt).code.slice();
    // 登录页里直接写明的地址最可信，排到最前面先试
    if (preferred) {
      var p = String(preferred);
      if (/^https?:\/\//i.test(p)) p = (p.indexOf(base) === 0) ? p.slice(base.length) : '';
      if (p && p.charAt(0) !== '/') p = '/' + p;
      if (p) list.unshift(p);
    }
    var i = 0;
    function next() {
      if (i >= list.length) return Promise.reject(new Error('没找到验证码接口，请在「高级」里手动填写'));
      var rel = list[i++];
      var url = base + rel + (rel.indexOf('?') < 0 ? '?t=' + Date.now() : '');
      log('尝试验证码：' + url);
      return req(url, { responseType: 'base64', accept: 'image/*', log: log }).then(function (res) {
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
    return req(base + list[0] + '?time=' + Date.now(), {
      method: 'POST',
      data: '',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      log: log
    }).then(function (res) {
      var d = res.data;
      if (typeof d === 'object') return d;
      try { return JSON.parse(d); } catch (e) { return null; }
    }).then(function (j) {
      if (j && (j.modulus || j.Modulus)) {
        var mod = String(j.modulus || j.Modulus);
        var bytes = Math.round(mod.length * 3 / 4);   // base64 → 字节
        log('✔ 已获取 RSA 公钥（' + mod.length + ' 字符 base64，约 ' + bytes + ' 字节 ≈ ' +
          (bytes * 8) + ' bit）');
        return { modulus: mod, exponent: j.exponent || j.Exponent || 'AQAB' };
      }
      log('· 该站点未返回公钥，将按明文密码提交');
      return null;
    }).catch(function (e) { log('· 取公钥失败：' + e.message); return null; });
  }

  /* ---------- 站点连通性 ----------
     只发这一个请求：登录页能打开，就说明地址对且网络通。
     （很多学校根路径返回 404 或跳转，所以不拿根路径做判断；
       该校服务器连发请求会不响应，所以也不额外 ping 一次。） */
  function fetchLoginPage(base, variant, log) {
    var rel = (PATHS[variant] || PATHS.jwglxt).loginPage;
    var url = base + rel;
    log('打开登录页：' + url);
    return req(url, { method: 'GET', accept: 'text/html', log: log, tries: 3 })
      .then(function (res) {
        if (res.status === 901) {
          throw new Error('教务系统返回「未登录」（HTTP 901），登录页读不到，请核对地址。');
        }
        log('✔ 登录页已打开（HTTP ' + res.status + '）');
        return res.data;
      })
      .catch(function (e) {
        throw new Error('打不开教务登录页：' + e.message +
          '。请确认地址拼写正确、手机已连上校园网或学校 VPN。');
      });
  }

  function prepare(baseRaw, variant, log, opts) {
    opts = opts || {};
    var base = normalizeBase(baseRaw);
    if (!base) return Promise.reject(new Error('请先填写教务地址'));
    var page = null;
    return fetchLoginPage(base, variant, log)
      .then(function (html) {
        page = readLoginPage(html);
        describeLoginPage(page, log);
        return page;
      })
      .then(function (info) {
        if (info && info.slider) {
          throw new Error('这套教务用的是「滑块拼图」验证码（新版正方 / 正方云常见）。' +
            '滑块必须人工拖动，App 不做自动识别，所以自动登录这条路走不通。' +
            '请改用「文件 / 网页导入」（教务导出的课表 PDF 可以直接读），' +
            '或者用「图片识别」把课表截图导进来。');
        }

        // 页面明确声明「默认不要验证码」时就不去试那些接口了：
        // 一来省掉好几个请求（该校服务器连发请求会不响应），
        // 二来这类站点直接带空 yzm 提交是被接受的。
        // forceCode：服务器已经明确要验证码了（比如连错后），此时必须去取图。
        if (info && info.captchaForced === false && !opts.forceCode) {
          log('· 跳过验证码探测（页面已声明不需要）');
          return null;
        }
        if (opts.forceCode) log('· 服务器要求验证码，开始取图');
        // 取不到验证码不代表失败：不少学校登录确实不需要验证码
        return detectCode(base, variant, log, info && info.codeUrl).catch(function (e) {
          log('· 未取到验证码（' + e.message + '），按「无需验证码」继续');
          return null;
        });
      })
      .then(function (c) {
        return getPublicKey(base, variant, log).then(function (k) {
          return {
            base: base,
            variant: variant,
            captcha: c ? c.dataUrl : '',
            captchaUrl: c ? c.url : '',
            needCode: !!c,
            pubkey: k,
            csrf: (page && page.csrf) || '',
            fields: (page && page.fields) || {},
            captchaForced: page ? page.captchaForced : null,
            maxFail: page ? page.maxFail : null,
            lockMin: page ? page.lockMin : null
          };
        });
      });
  }

  /* ---------- 组装登录表单 ----------
     照页面原样把 hidden 字段带上（language / xxdm / mmsfjm / csrftoken…），
     再把 yhm / mm / yzm 填成我们的值。 */
  function buildLoginBody(ctx, user, pwd, code) {
    var parts = [];
    var f = (ctx && ctx.fields) || {};
    Object.keys(f).forEach(function (k) {
      if (k === 'yhm' || k === 'mm' || k === 'yzm' || k === 'hidMm') return;
      parts.push(encodeURIComponent(k) + '=' + encodeURIComponent(f[k]));
    });
    parts.push('yhm=' + encodeURIComponent(user));
    parts.push('mm=' + encodeURIComponent(pwd));
    parts.push('yzm=' + encodeURIComponent(code || ''));
    // 页面自带的 csrftoken 已经带上去了，别重复提交
    if (ctx.csrf && !f.csrftoken) parts.push('csrftoken=' + encodeURIComponent(ctx.csrf));
    return parts.join('&');
  }

  /* ---------- 判定登录响应 ----------
     正方登录失败时是「重新渲染登录页 + 页面上一条提示」，
     所以不能只看状态码，得看正文里的措辞。 */
  function classifyLogin(res) {
    var status = res && res.status;
    var loc = (res && res.headers && (res.headers['Location'] || res.headers['location'])) || '';
    var text = (res && typeof res.data === 'string') ? res.data : JSON.stringify((res && res.data) || '');

    if (status === 901) return { kind: 'session', text: text };
    if (/用户名或密码不正确|用户名或密码错误|密码错误|账号或密码|用户名不存在/.test(text)) {
      return { kind: 'badpass', text: text };
    }
    if (/验证码/.test(text) && /不正确|错误|为空|请输入|失效/.test(text)) {
      return { kind: 'captcha', text: text };
    }
    // 成功：通常 302 到首页，或响应里出现首页/菜单
    if (/index_initMenu|index_initMenu\.html|initMenu/i.test(text) || /index_initMenu/i.test(loc)) {
      return { kind: 'ok', text: text };
    }
    if (status >= 200 && status < 400 && !/<input[^>]*name=["']?mm/i.test(text)) {
      return { kind: 'ok', text: text };
    }
    return { kind: 'unknown', text: text };
  }

  function lockHint(ctx) {
    var n = ctx && ctx.maxFail, m = ctx && ctx.lockMin;
    var base = '注意：本校连错 ' + (n || '几') + ' 次会锁定 ' + (m || '几') + ' 分钟，' +
      'App 不会自动重试，请核对后再试。';
    // 实测：该校登录口按 IP 限流，短时间连续登录多次后，
    // 即使账号密码完全正确也会被回「用户名或密码不正确」。
    return base + '如果密码确定没错，可能是刚才连试太多次被限流了，等 5~10 分钟再试；' +
      '或者直接用手机流量/校园网打开教务系统网页登一次确认账号可用。';
  }

  /* ---------- 登录 ---------- */
  function login(ctx, user, pass, code, rsaMode, log) {
    var base = ctx.base;
    var pwd = pass;
    if (ctx.pubkey) {
      try {
        pwd = Bridge.rsaEncrypt(pass, ctx.pubkey.modulus, ctx.pubkey.exponent, rsaMode);
        log('✔ 密码已用 RSA 加密（' + (rsaMode === 'raw' ? '裸整数幂' : 'PKCS#1 v1.5') +
          '，密文 ' + pwd.length + ' 字符）');
      } catch (e) {
        log('✘ 加密失败：' + e.message + '，改为明文提交');
        pwd = pass;
      }
    } else {
      log('· 未取到公钥，按明文提交（若提示密码错误，可到「高级」换加密方式）');
    }
    var loginUrl = base + (PATHS[ctx.variant] || PATHS.jwglxt).loginPage +
      '?time=' + Date.now();   // 页面自己也会加时间戳，防止代理缓存
    var body = buildLoginBody(ctx, user, pwd, code);
    log('登录 → ' + loginUrl);
    if (code) log('· 本次带验证码：' + code);
    return req(loginUrl, {
      method: 'POST',
      data: body,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
        'X-Requested-With': 'XMLHttpRequest'
      },
      referer: base + (PATHS[ctx.variant] || PATHS.jwglxt).loginPage,
      log: log
    }).then(function (res) {
      var r = classifyLogin(res);
      if (r.kind === 'ok') {
        log('✔ 登录成功（HTTP ' + res.status + '）');
        return res;
      }
      if (r.kind === 'badpass') {
        throw new Error('学号或密码不正确。' + (lockHint(ctx) || '请确认后再试一次。'));
      }
      if (r.kind === 'captcha') {
        var err = new Error('这套教务要求验证码，请先点「①」取一张图再填。');
        err.needCode = true;
        throw err;
      }
      if (r.kind === 'session') {
        throw new Error('教务系统返回「未登录 / 会话失效」（HTTP 901）。' +
          '说明这次没真正登录成功，请核对学号密码；若反复出现，改用图片或文件导入。');
      }
      throw new Error('登录结果无法判断（HTTP ' + res.status + '）。' +
        (lockHint(ctx) || '请改用图片或文件导入。'));
    });
  }

  /* ---------- 抓课表 ---------- */

  /* 把页面里的 <select> 全抠出来：{selectId: [{value,text,selected}]}。
     正方把学年/学期做成了 #xnm / #xqm 两个下拉框，
     选中项就是「当前学期」，这是最权威的来源。 */
  function parseSelects(html) {
    var out = {};
    var re = /<select\b([^>]*)>([\s\S]*?)<\/select>/gi, m;
    while ((m = re.exec(String(html == null ? '' : html)))) {
      var attrs = m[1];
      var key = attrOf(attrs, 'id') || attrOf(attrs, 'name');
      if (!key) continue;
      var opts = [], o;
      var ore = /<option\b([^>]*)>([\s\S]*?)<\/option>/gi;
      while ((o = ore.exec(m[2]))) {
        var v = attrOf(o[1], 'value');
        opts.push({
          value: (v == null ? '' : String(v).trim()),
          text: String(o[2]).replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim(),
          selected: /selected/i.test(o[1])
        });
      }
      out[key] = opts;
    }
    return out;
  }

  /* 取下拉框的选中项；没有 selected 标记时退回第一个非空项。 */
  function pickSelected(opts) {
    if (!opts || !opts.length) return null;
    var i;
    for (i = 0; i < opts.length; i++) if (opts[i].selected && opts[i].value) return opts[i].value;
    for (i = 0; i < opts.length; i++) if (opts[i].value) return opts[i].value;
    return null;
  }

  function labelOf(opts, value) {
    for (var i = 0; i < (opts || []).length; i++) {
      if (opts[i].value === value) return opts[i].text || value;
    }
    return value;
  }

  /* 打不开课表页时的兜底：按当前日期推。
     学年码 = 学年起始年份（9 月开学），xqm 3=第一学期 / 12=第二学期。 */
  function guessTerm(now) {
    var d = now || new Date();
    var y = d.getFullYear(), mo = d.getMonth() + 1;
    return {
      xnm: String(mo >= 8 ? y : y - 1),
      xqm: (mo >= 2 && mo <= 7) ? '12' : '3'
    };
  }

  /* 拿到「要查哪个学年学期」。优先顺序：
     ① 界面上明确填了 → 用填的（用户覆盖）
     ② 打开课表页面读 #xnm / #xqm 的选中项（跟浏览器一致，最可靠）
     ③ 按当前日期推算（并提示用户可以手填） */
  function resolveTerm(ctx, log, opts) {
    opts = opts || {};
    var gx = String(opts.xnm == null ? '' : opts.xnm).trim();
    var gq = String(opts.xqm == null ? '' : opts.xqm).trim();
    if (gx && gq) {
      log('· 使用界面上填的学年学期：xnm=' + gx + '，xqm=' + gq);
      return Promise.resolve({ xnm: gx, xqm: gq, source: 'manual' });
    }

    var base = ctx.base;
    var list = ((PATHS[ctx.variant] || PATHS.jwglxt).kbIndex || []).slice();
    var i = 0;
    function next() {
      if (i >= list.length) return Promise.resolve(null);
      var path = list[i++];
      var url = base + path;
      log('读取课表页（为了拿学年学期）：' + url);
      return req(url, { method: 'GET', accept: 'text/html', log: log, tries: 2 })
        .then(function (res) {
          if (res.status === 901) throw new Error('未登录（901）');
          var sel = parseSelects(res.data);
          var xnm = pickSelected(sel.xnm), xqm = pickSelected(sel.xqm);
          if (xnm && xqm) {
            log('✔ 读到当前学年学期：' + labelOf(sel.xnm, xnm) + ' 第' +
              (xqm === '3' ? '一' : xqm === '12' ? '二' : xqm === '16' ? '三' : '?') +
              '学期（xnm=' + xnm + '，xqm=' + xqm + '）');
            return { xnm: xnm, xqm: xqm, source: 'page' };
          }
          log('· 这个页面里没有学年/学期下拉框');
          return next();
        })
        .catch(function (e) { log('✘ ' + e.message); return next(); });
    }
    return next().then(function (r) {
      if (r) return r;
      var g = guessTerm();
      log('· 没读到页面下拉框，按当前日期推算：xnm=' + g.xnm + '，xqm=' + g.xqm);
      g.source = 'guess';
      return g;
    });
  }

  function fetchKb(ctx, user, xnm, xqm, log) {
    var base = ctx.base;
    var list = (PATHS[ctx.variant] || PATHS.jwglxt).kb;
    var i = 0;
    function next() {
      if (i >= list.length) {
        throw new Error('课表接口都试过了，未取到数据。' +
          '请改用「文件 / PDF 导入」，或把课表页面截图后用「图片识别」。');
      }
      var path = list[i++].replace('{user}', encodeURIComponent(user));
      var url = base + path;
      // 实测：kzlx=ck 是必须带的（kzlx 为空会被当成「监控」视图而不返回数据）
      var body = 'xnm=' + encodeURIComponent(xnm || '') +
        '&xqm=' + encodeURIComponent(xqm || '') +
        '&kzlx=ck';
      log('抓课表 → ' + url);
      return req(url, {
        method: 'POST',
        data: body,
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
          'X-Requested-With': 'XMLHttpRequest'
        },
        referer: base + path,
        log: log
      }).then(function (res) {
        if (res.status === 901) {
          throw new Error('抓课表时教务系统说「未登录」（HTTP 901）。' +
            '登录没有真正生效，请核对学号密码后重试。');
        }
        var d = res.data;
        var j = null;
        if (typeof d === 'object' && d) j = d;
        else { try { j = JSON.parse(d); } catch (e) { j = null; } }

        if (j && j.kbList && j.kbList.length) {
          log('✔ 取到 ' + j.kbList.length + ' 条课程记录' +
            (j.xsxx && j.xsxx.XNM ? '（' + j.xsxx.XNM + ' 学年）' : ''));
          return j.kbList;
        }
        if (j && j.timetable && j.timetable.length) return j.timetable;
        if (Array.isArray(j) && j.length) { log('✔ 取到数组 ' + j.length + ' 条'); return j; }

        // 正方在「学年/学期不对」时不报错，而是返回字面量 null。
        // 这是最容易被误判成「接口不存在」的一种响应，单独说清楚。
        if (typeof d === 'string' && d.trim() === 'null') {
          log('✘ ' + url + ' 返回 null → 学年/学期不对（xnm=' + (xnm || '空') +
            '，xqm=' + (xqm || '空') + '）');
          return next();
        }

        // 可能是 HTML 页面（旧版 jsxsd），交给表格解析
        if (typeof d === 'string' && /<t[dhr]/i.test(d)) {
          if (/name=["']?mm|login_slogin|请输入|用户登录/.test(d) && !/kbList/.test(d)) {
            throw new Error('抓课表返回的是登录页，说明会话已失效。请重新登录。');
          }
          log('· 返回的是 HTML 页面，转为表格解析');
          return { __html: d };
        }
        log('✘ ' + url + ' 未返回课表数据');
        return next();
      }).catch(function (e) {
        // 会话类错误不要盲目换下一个地址，直接抛给用户
        if (/901|未登录|会话/.test(e.message)) throw e;
        log('✘ ' + e.message);
        return next();
      });
    }
    return Promise.resolve().then(next);
  }

  /**
   * 完整流程。ctx 由 prepare() 得到。
   * @returns Promise<{courses:Array, raw:any, term:Object}>
   */
  function run(ctx, opts) {
    var log = opts.log || function () { };
    var term = null;
    return login(ctx, opts.user, opts.pass, opts.code, opts.rsaMode || 'pkcs1', log)
      .then(function () { return resolveTerm(ctx, log, opts); })
      .then(function (t) {
        term = t;
        ctx.term = t;                     // 供界面回填「学年 / 学期」
        return fetchKb(ctx, opts.user, t.xnm, t.xqm, log);
      })
      .then(function (raw) {
        var courses;
        if (raw && raw.__html) {
          courses = global.Parser.parseTable(htmlToMatrix(raw.__html), opts.totalWeeks);
        } else {
          courses = global.Parser.parseJwList(raw, opts.totalWeeks);
        }
        if (!courses.length) {
          throw new Error('接口有返回，但没能解析出课程。请展开「高级」核对接口路径，或改用图片 / 文件导入。');
        }
        return { courses: courses, raw: raw, term: term };
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
        var txt = (cell.innerText || cell.textContent || '').replace(/\u00a0/g, ' ').trim();
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
    SCHOOL_PRESETS: SCHOOL_PRESETS,
    THROTTLE_MS: THROTTLE_MS,
    normalizeBase: normalizeBase,
    attrOf: attrOf,
    parseLoginFields: parseLoginFields,
    readLoginPage: readLoginPage,
    inspectLoginPage: inspectLoginPage,
    detectCode: detectCode,
    buildLoginBody: buildLoginBody,
    classifyLogin: classifyLogin,
    parseSelects: parseSelects,
    pickSelected: pickSelected,
    guessTerm: guessTerm,
    resolveTerm: resolveTerm,
    prepare: prepare,
    run: run,
    htmlToMatrix: htmlToMatrix,
    clearCookies: clearCookies
  };
})(window);

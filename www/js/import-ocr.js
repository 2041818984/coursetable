/* import-ocr.js —— 图片课表识别：本地 Tesseract OCR / 云端视觉大模型
 *
 * 本地 OCR 为什么会「卡死」（真机实测 + 定位）：
 *   1. Android 的 WebView 里，Tesseract.recognize() 内部自己 createWorker，
 *      一旦 worker 卡在加载 20MB 中文模型或 wasm 编译上，这个 Promise
 *      既不 resolve 也不 reject —— 界面就永远停在「识别中」。
 *      现在改成自己 createWorker，拿得到句柄，就能 terminate，也就能取消。
 *   2. 图太大。原来会把图放大到长边 1800px 再喂进去，手机上要多算好几倍。
 *      现在封顶 1500px、且最多放大 1.6 倍。
 *   3. worker 用完就扔，第二次识别又要重新加载模型。现在复用。
 *   4. 没有任何超时。现在有看门狗：长时间没进展就停下来说清楚原因。
 */
(function (global) {
  'use strict';

  var CDN = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.0/dist/';
  var CORE_CDN = 'https://cdn.jsdelivr.net/npm/tesseract.js-core@5.1.0/';
  var LANG_CDN = 'https://tessdata.projectnaptha.com/4.0.0/';
  var LANG = 'chi_sim+eng';

  /* 转成绝对地址：worker 内部用 importScripts 取核心，相对路径会解析错 */
  function abs(p) {
    try { return new URL(p, location.href).href; } catch (e) { return p; }
  }

  /* 识别引擎的三段回退：本地 SIMD 核心 → 本地标准核心 → 在线 CDN。
     语言包与核心都已随包附带，因此正常情况下完全离线可用，
     只有本地资源缺失（例如把 www 单独拷到别处）才会走 CDN。 */
  function recognizeChain() {
    var lib = abs('lib/');
    return [
      { tag: '本地模型', worker: abs('lib/worker.min.js'), core: abs('lib/tesseract-core-simd.wasm.js'), lang: lib },
      { tag: '本地模型（兼容）', worker: abs('lib/worker.min.js'), core: abs('lib/tesseract-core.wasm.js'), lang: lib },
      { tag: '在线模型', worker: CDN + 'worker.min.js', core: CORE_CDN + 'tesseract-core-simd.wasm.js', lang: LANG_CDN }
    ];
  }

  var tessPromise = null;

  function loadTesseract(onProgress) {
    if (global.Tesseract) return Promise.resolve(global.Tesseract);
    if (tessPromise) return tessPromise;
    tessPromise = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = 'lib/tesseract.min.js';
      s.onload = function () { global.Tesseract ? resolve(global.Tesseract) : reject(new Error('本地库加载异常')); };
      s.onerror = function () {
        if (onProgress) onProgress('本地库缺失，改用 CDN 下载…');
        var s2 = document.createElement('script');
        s2.src = CDN + 'tesseract.min.js';
        s2.onload = function () { global.Tesseract ? resolve(global.Tesseract) : reject(new Error('CDN 库加载异常')); };
        s2.onerror = function () { reject(new Error('无法加载 OCR 引擎，请联网后重试，或改用 AI 识别')); };
        document.head.appendChild(s2);
      };
      document.head.appendChild(s);
    });
    return tessPromise;
  }

  /* ---------- 图片压缩 ---------- */
  function compress(dataUrl, maxSide) {
    maxSide = maxSide || 1600;
    return new Promise(function (resolve) {
      var img = new Image();
      img.onload = function () {
        var w = img.width, h = img.height;
        var scale = Math.min(1, maxSide / Math.max(w, h));
        if (scale >= 1 && dataUrl.length < 900000) return resolve(dataUrl);
        var cw = Math.round(w * scale), ch = Math.round(h * scale);
        var cv = document.createElement('canvas');
        cv.width = cw; cv.height = ch;
        var ctx = cv.getContext('2d');
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cw, ch);
        ctx.drawImage(img, 0, 0, cw, ch);
        resolve(cv.toDataURL('image/jpeg', 0.86));
      };
      img.onerror = function () { resolve(dataUrl); };
      img.src = dataUrl;
    });
  }

  /* ---------- 表格线检测 ----------
     课表截图里的横向/纵向网格线，可以用「某一行（列）上暗像素占比很高」找出来。
     拿到网格线后，OCR 出来的每个词块按中心点落进对应格子，比纯坐标聚类准得多。 */
  function loadImage(dataUrl) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.onload = function () { resolve(img); };
      img.onerror = function () { reject(new Error('图片无法读取')); };
      img.src = dataUrl;
    });
  }

  function detectGrid(img) {
    try {
      var W = img.naturalWidth || img.width;
      var H = img.naturalHeight || img.height;
      if (!W || !H) return null;
      var scale = Math.min(1, 1400 / Math.max(W, H));
      var w = Math.max(1, Math.round(W * scale));
      var h = Math.max(1, Math.round(H * scale));

      var cv = document.createElement('canvas');
      cv.width = w; cv.height = h;
      var ctx = cv.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(img, 0, 0, w, h);
      var d = ctx.getImageData(0, 0, w, h).data;

      var rowDark = new Int32Array(h), colDark = new Int32Array(w);
      for (var y = 0; y < h; y++) {
        var base = y * w * 4;
        for (var x = 0; x < w; x++) {
          var i = base + x * 4;
          var lum = (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000;
          if (lum < 170) { rowDark[y]++; colDark[x]++; }
        }
      }

      var rows = findLines(rowDark, h, w);
      var cols = findLines(colDark, w, h);
      if (rows.length < 3 || cols.length < 3) return null;

      return {
        ys: rows.map(function (v) { return v / scale; }),
        xs: cols.map(function (v) { return v / scale; })
      };
    } catch (e) {
      return null;
    }
  }

  function findLines(dark, len, span) {
    var thr = span * 0.72;
    var raw = [], run = null;
    for (var i = 0; i < len; i++) {
      if (dark[i] >= thr) { if (!run) run = { s: i, e: i }; else run.e = i; }
      else if (run) { raw.push((run.s + run.e) / 2); run = null; }
    }
    if (run) raw.push((run.s + run.e) / 2);

    var out = [];
    raw.forEach(function (v) {
      if (!out.length || v - out[out.length - 1] > 6) out.push(v);
      else out[out.length - 1] = (out[out.length - 1] + v) / 2;
    });
    return out;
  }

  /* ---------- 抹掉表格线 ----------
     这一步对识别率影响极大：课表的竖线会把表头「星期一」切成一个个孤立的小块，
     tesseract 在孤立小块上很容易把 3 个汉字认成 me/as/men 这种拉丁乱码，
     结果就是表头认不出来 → 所有课都堆到周一。把线涂白后表头能完整成行，识别率大幅提升。
     抹线只涂 3px 宽的细条，文字笔画不会被碰到（能被判定成"线"的行/列，暗像素占比要 >72%）。 */
  function stripGridLines(img, grid) {
    try {
      var W = img.naturalWidth || img.width;
      var H = img.naturalHeight || img.height;
      if (!W || !H || !grid) return null;

      /* 目标：长边落在 1000~1500 之间。
         手机上算力有限，放大到 1800 会明显变慢；缩得太小又会丢笔画。
         所以既给上限（1500）也给放大幅度上限（1.6 倍）。 */
      var scale = Math.min(1.6, 1500 / Math.max(W, H));
      var w = Math.max(1, Math.round(W * scale));
      var h = Math.max(1, Math.round(H * scale));

      var cv = document.createElement('canvas');
      cv.width = w; cv.height = h;
      var ctx = cv.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);

      var t = Math.max(1, Math.round(3 * scale));
      var off = Math.floor(t / 2);
      ctx.fillStyle = '#fff';
      (grid.ys || []).forEach(function (y) {
        var yy = Math.round(y * scale);
        if (yy >= -t && yy <= h + t) ctx.fillRect(0, yy - off, w, t);
      });
      (grid.xs || []).forEach(function (x) {
        var xx = Math.round(x * scale);
        if (xx >= -t && xx <= w + t) ctx.fillRect(xx - off, 0, t, h);
      });

      // 用无损 PNG：JPEG 的压缩噪点会拉低 OCR 准确率
      return {
        dataUrl: cv.toDataURL('image/png'),
        // 网格要换算到「抹线后画布」的坐标系，否则词块会落错格子
        grid: {
          xs: (grid.xs || []).map(function (x) { return x * scale; }),
          ys: (grid.ys || []).map(function (y) { return y * scale; })
        }
      };
    } catch (e) {
      return null;
    }
  }

  /* ---------- 词块 → 课程 ----------
     表格重建有多个方案，各自解一遍，取「真能解出课」的那个：
       网格方案：有表格线时最准，词块按中心点落格
       锚点方案：认节次列（第N节）当行分隔
       普通方案：只靠 y 坐标聚类，兜底
     grid 为空（没检测到表格线）时自动跳过网格方案。 */
  function buildCourses(words, grid, totalWeeks) {
    // 先把 tesseract 的「按字切词」粘回整段文字，否则中文课表会被拆散
    var runs = words;
    try { runs = global.Parser.glueCjkWords(words, 40) || words; } catch (e) { runs = words; }

    var cands = [];
    if (grid) { try { cands.push(global.Parser.wordsToGrid(runs, grid, 40, 3)); } catch (e) { } }
    try { cands.push(global.Parser.wordsToTableByAnchor(runs, 40)); } catch (e) { }
    try { cands.push(global.Parser.wordsToTable(runs, 40, 3)); } catch (e) { }

    var matrix = [], courses = [];
    for (var k = 0; k < cands.length; k++) {
      var m = cands[k];
      if (!m || !m.length) continue;
      var cs = [];
      try { cs = global.Parser.parseTable(m, totalWeeks) || []; } catch (e) { cs = []; }
      if (cs.length) { matrix = m; courses = cs; break; }
      if (!matrix.length) matrix = m;
    }
    return { matrix: matrix, courses: courses, runs: runs };
  }

  /* ---------- 识别任务状态 ----------
     worker 缓存：模型加载一次十几秒，复用后第二次识别几乎立刻开始。
     取消：保留当前任务的句柄，用户点「取消」时能立刻 terminate 并 reject。 */
  var workerCache = null;                       // { worker, tag }
  var ocrState = { job: null, onLog: null };

  function ensureWorker(T, chainIndex) {
    var cfg = recognizeChain()[chainIndex];
    if (workerCache && workerCache.tag === cfg.tag) return Promise.resolve(workerCache.worker);

    var opts = {
      workerPath: cfg.worker,
      corePath: cfg.core,
      langPath: cfg.lang,
      workerBlobURL: false,
      gzip: true,
      logger: function (m) {
        if (!m) return;
        if (m.status === 'recognizing text' && m.progress != null) {
          if (ocrState.onLog) ocrState.onLog('识别中 ' + Math.round(m.progress * 100) + '%', m.progress);
        } else if (m.status) {
          if (ocrState.onLog) ocrState.onLog(statusText(m.status), null);
        }
      }
    };
    return T.createWorker(LANG, 1, opts).then(function (w) {
      workerCache = { worker: w, tag: cfg.tag };
      return w;
    });
  }

  function dropWorker() {
    if (workerCache && workerCache.worker) {
      try { workerCache.worker.terminate(); } catch (e) { /* 已经死了就算了 */ }
    }
    workerCache = null;
  }

  /** 用户点「取消识别」时调用。会立刻终止 worker 并让 runOcr 的 Promise 失败。 */
  function cancelOcr() {
    var job = ocrState.job;
    if (!job) return false;
    job.cancelled = true;
    dropWorker();                        // 终止过就不能再复用
    if (job.abort) job.abort(new Error('已取消识别'));
    return true;
  }

  var STALL_MS = 150000;   // 两分半没有任何进展就认定卡死（模型加载在低端机上确实要很久）

  /* ---------- 本地 OCR ---------- */
  function runOcr(dataUrl, onProgress, totalWeeks) {
    var job = { cancelled: false, lastTick: Date.now() };
    ocrState.job = job;

    var say = function (m, p) {
      if (job.cancelled) return;
      job.lastTick = Date.now();
      if (onProgress) onProgress(m, p);
    };

    return new Promise(function (resolve, reject) {
      var done = false, wd = null;

      var cleanup = function () {
        if (wd) clearInterval(wd);
        ocrState.job = null;
        ocrState.onLog = null;
      };
      var ok = function (v) { if (done) return; done = true; cleanup(); resolve(v); };
      var bad = function (e) { if (done) return; done = true; cleanup(); reject(e); };
      job.abort = bad;

      // 看门狗：真机上「什么都不发生」是最难受的，这里主动兜住
      wd = setInterval(function () {
        if (done || job.cancelled) return;
        if (Date.now() - job.lastTick > STALL_MS) {
          job.cancelled = true;
          dropWorker();
          bad(new Error(
            '识别卡住了：两分半没有任何进展，已经停下来。\n' +
            '常见原因是图片太大或手机内存不足。可以换一张更小的截图重试，' +
            '或直接用「AI 识别」。'
          ));
        }
      }, 5000);
      if (wd && wd.unref) wd.unref();

      ocrState.onLog = say;

      var grid = null, input = dataUrl;

      loadImage(dataUrl).then(function (img) {
        if (job.cancelled) throw new Error('已取消识别');
        say('正在分析表格结构…');
        grid = detectGrid(img);
        if (grid) {
          say('已找到表格线：' + (grid.ys.length - 1) + ' 行 × ' + (grid.xs.length - 1) + ' 列，抹线后再识别…');
          var cleaned = stripGridLines(img, grid);
          if (cleaned) { input = cleaned.dataUrl; grid = cleaned.grid; }
        } else {
          say('没找到表格线，按坐标直接聚类…');
        }
        return loadTesseract(function (m) { say(m); });
      }).then(function (T) {
        if (job.cancelled) throw new Error('已取消识别');
        var chain = recognizeChain();
        var lastErr = null;

        function attempt(i) {
          if (job.cancelled) throw new Error('已取消识别');
          if (i >= chain.length) {
            var why = (lastErr && lastErr.message) ? lastErr.message : '未知原因';
            throw new Error('识别引擎加载失败（' + why + '）。可以改用「AI 识别」，或检查手机剩余内存。');
          }
          var cfg = chain[i];
          if (!workerCache || workerCache.tag !== cfg.tag) {
            say('加载「' + cfg.tag + '」…中文模型约 20MB，已随 App 打包（不耗流量），首次需要十几秒');
          }
          return ensureWorker(T, i).then(function (w) {
            if (job.cancelled) throw new Error('已取消识别');
            return w.recognize(input);
          }).catch(function (e) {
            if (job.cancelled) throw new Error('已取消识别');
            lastErr = e;
            dropWorker();
            say('· 「' + cfg.tag + '」不可用：' + ((e && e.message) || e) + '，换下一种…');
            return attempt(i + 1);
          });
        }
        return attempt(0);
      }).then(function (res) {
        if (job.cancelled) throw new Error('已取消识别');
        var d = (res && res.data) || {};
        var words = d.words || [];
        var lines = (d.lines || []).map(function (l) { return (l.text || '').trim(); }).filter(Boolean);

        // 表格重建有多个方案，各自解一遍，取「真能解出课」的那个。
        // 网格方案最准（有表格线时）；锚点方案认节次列；普通方案只靠坐标，兜底用。
        var built = buildCourses(words, grid, totalWeeks);
        var courses = built.courses;

        // 表格重建失败时，退化为逐行解析
        if (!courses.length) {
          courses = lines.map(function (t) {
            var info = global.Parser.parseCell(t, totalWeeks);
            return info.name ? {
              name: info.name, teacher: info.teacher, place: info.place,
              day: 1, start: info.periods ? info.periods.start : 1,
              end: info.periods ? info.periods.end : 1,
              weeks: info.weeks, _loose: true
            } : null;
          }).filter(Boolean);
        }
        return { courses: courses, raw: lines.join('\n'), matrix: built.matrix };
      }).then(ok, bad);
    });
  }

  function statusText(s) {
    var map = {
      'loading tesseract core': '加载核心…',
      'initializing tesseract': '初始化…',
      'initialized tesseract': '初始化完成',
      'loading language traineddata': '加载中文模型…',
      'loaded language traineddata': '模型就绪',
      'initializing api': '准备识别…',
      'recognizing text': '识别中'
    };
    return map[s] || s;
  }

  /* ================= 云端视觉大模型 ================= */

  var PROMPT = [
    '你是一个课表信息抽取器。请阅读这张课程表图片，输出严格的 JSON 数组，不要输出任何解释文字。',
    '每个元素格式：{"name":"课程名","teacher":"教师","place":"上课地点","day":1到7表示周一到周日,',
    '"start":开始节次,"end":结束节次,"weeks":"周次，如 1-16 或 1-8,10-16 或 1-16周(单)"}',
    '要求：',
    '1. 只抽取真实出现的课程，不要臆造；看不清的字段留空字符串。',
    '2. 同一门课一周多次、或不同周次段，拆成多个元素。',
    '3. 节次按图片里的行号或时间推断，第1节通常是早上第一节。',
    '4. 单周课写 "1-16周(单)"，双周课写 "1-16周(双)"；没有周次信息时填 "1-20"。',
    '5. 输出示例：[{"name":"高等数学","teacher":"张三","place":"A101","day":1,"start":1,"end":2,"weeks":"1-16"}]'
  ].join('\n');

  /** 把用户填的接口地址拼成 chat/completions 的完整 URL。 */
  function chatUrl(base) {
    var b = String(base || '').trim().replace(/\/+$/, '');
    if (!b) return '';
    if (/\/chat\/completions$/i.test(b)) return b;
    return b + '/chat/completions';
  }

  function clip(s, n) {
    var t = typeof s === 'string' ? s : (function () { try { return JSON.stringify(s); } catch (e) { return String(s); } })();
    t = String(t == null ? '' : t).replace(/\s+/g, ' ');
    return t.length > n ? t.slice(0, n) + '…' : t;
  }

  /** 从各种形态的返回里挖出模型说的那段文本。 */
  function digContent(body) {
    if (!body) return '';
    if (typeof body === 'string') return body;

    var pick = function (o) {
      if (!o || typeof o !== 'object') return '';
      if (o.choices && o.choices[0]) {                       // OpenAI 兼容
        var c = o.choices[0];
        var m = c.message || c.delta || {};
        var v = m.content;
        if (typeof v === 'string' && v) return v;
        if (Array.isArray(v)) {
          var s = v.map(function (x) { return (x && (x.text || x.content)) || ''; }).join('');
          if (s) return s;
        }
        if (typeof c.text === 'string' && c.text) return c.text;
      }
      if (Array.isArray(o.content) && o.content.length) {     // Anthropic 风格
        var t = o.content.map(function (x) { return (x && x.text) || ''; }).join('');
        if (t) return t;
      }
      if (typeof o.output_text === 'string' && o.output_text) return o.output_text;
      if (typeof o.result === 'string' && o.result) return o.result;
      if (typeof o.content === 'string' && o.content) return o.content;
      if (typeof o.text === 'string' && o.text) return o.text;
      return '';
    };

    var s = pick(body);
    if (s) return s;

    /* 国内很多中转网关会在外面套一层 {code, message, data}，
       真正的 OpenAI 结构藏在 data / result / response 里。 */
    var wrapKeys = ['data', 'result', 'response', 'output', 'body'];
    for (var i = 0; i < wrapKeys.length; i++) {
      var w = body[wrapKeys[i]];
      if (w && typeof w === 'object') {
        s = pick(w) || digContent(w);
        if (s) return s;
      } else if (typeof w === 'string' && w && /[[{]/.test(w)) {
        return w;
      }
    }
    return '';
  }

  /** 从返回里挖出错误说明（如果有）。 */
  function digError(body) {
    if (!body || typeof body !== 'object') return null;
    if (body.error) {
      var e = body.error;
      if (typeof e === 'string') return e;
      return e.message || e.msg || clip(e, 160);
    }
    if (body.Response && body.Response.Error) {
      var te = body.Response.Error;
      return te.Message || clip(te, 160);
    }
    // 网关风格：{code, message, data}，code 非 0/200 视为错误
    var code = body.code;
    if (code !== undefined && code !== null && String(code) !== '0' && String(code) !== '200') {
      return String(body.message || body.msg || '未知错误') + '（错误码 ' + code + '）';
    }
    if (body.msg && code !== 0) return String(body.msg);
    if (body.message && body.data === null && body.code !== undefined) return String(body.message);
    return null;
  }

  function extractJson(text) {
    var t = String(text).trim().replace(/^```(?:json)?/i, '').replace(/```\s*$/, '').trim();
    var tryParse = function (s) { try { return JSON.parse(s); } catch (e) { return undefined; } };

    var v = tryParse(t);
    if (v !== undefined) return v;
    var m = t.match(/\[[\s\S]*\]/);
    if (m) { v = tryParse(m[0]); if (v !== undefined) return v; }
    m = t.match(/\{[\s\S]*\}/);
    if (m) { v = tryParse(m[0]); if (v !== undefined) return v; }
    return null;
  }

  function clampDay(v) {
    if (typeof v === 'number') return Math.min(7, Math.max(1, Math.round(v) || 1));
    var s = String(v == null ? '' : v).trim();
    var n = parseInt(s.replace(/[^0-9]/g, ''), 10);
    if (n >= 1 && n <= 7) return n;
    var k = '一二三四五六日天'.indexOf(s.replace(/[周星期\s]/g, '').charAt(0));
    if (k >= 0) return k >= 6 ? 7 : k + 1;
    return 1;
  }

  /** 模型给的数组 → 课程对象。字段名做了兼容（中文键也认）。 */
  function toCourses(arr, totalWeeks) {
    var total = totalWeeks || 20;
    return (arr || []).map(function (it) {
      if (!it || typeof it !== 'object') return null;
      var name = String(it.name || it.kcmc || it.course || it.title || '').trim();
      if (!name) return null;

      var start = Math.max(1, parseInt(it.start != null ? it.start : it.jc, 10) || 1);
      var end = Math.max(start, parseInt(it.end != null ? it.end : it.jc, 10) || start);

      var wkText = String(it.weeks != null ? it.weeks : (it.zcd || ''));
      var parity = /单/.test(wkText) ? 1 : (/双/.test(wkText) ? 2 : 0);
      // 先把 (单)/(双) 括注摘掉拿到基础周次，再按奇偶过滤，
      // 把「1-16周(双)」真正落成 2,4,…,16 这 8 周。
      var base = global.Store.parseWeeks(wkText.replace(/[（(]\s*[单双]\s*[)）]/g, ' '), total);
      var weeks = base;
      if (parity) {
        weeks = base.filter(function (w) { return (w % 2) === (parity === 1 ? 1 : 0); });
        if (!weeks.length) {
          weeks = global.Store.parseWeeks(parity === 1 ? '单周' : '双周', total);
        }
      }

      return {
        name: name,
        teacher: String(it.teacher || it.xm || '').trim(),
        place: String(it.place || it.cdmc || it.location || it.room || '').trim(),
        day: clampDay(it.day != null ? it.day : it.xqj),
        start: start,
        end: end,
        weeks: weeks,
        parity: parity
      };
    }).filter(Boolean);
  }

  /* 网络层的错误（超时 / 断网）才重试；服务端明确回错误不重试，免得白等。 */
  function postChat(url, key, body, retries) {
    var attempt = function (n) {
      return Bridge.http({
        url: url,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + key
        },
        data: body,
        responseType: 'text',
        timeout: 90000
      }).catch(function (e) {
        if (n > 0) return attempt(n - 1);
        throw e;
      });
    };
    return attempt(retries || 0);
  }

  function parseBody(raw) {
    if (raw && typeof raw === 'object') return raw;
    try { return JSON.parse(raw); } catch (e) { return null; }
  }

  function runLlm(dataUrl, cfg, onProgress, totalWeeks) {
    var base = ((cfg && cfg.base) || '').trim();
    var key = ((cfg && cfg.key) || '').trim();
    var model = ((cfg && cfg.model) || '').trim() || 'gpt-4o-mini';
    if (!base) return Promise.reject(new Error('请先在「设置 → AI 识别」里填写接口地址'));
    var url = chatUrl(base);

    if (onProgress) onProgress('正在压缩图片…');
    return compress(dataUrl, 1024).then(function (small) {
      if (onProgress) onProgress('已发送给模型，等待返回…');
      var body = JSON.stringify({
        model: model,
        temperature: 0,
        messages: [{
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: small } },
            { type: 'text', text: PROMPT }
          ]
        }]
      });
      return postChat(url, key, body, 1);
    }).then(function (res) {
      var b = parseBody(res.data);
      var err = digError(b);
      var httpBad = res.status >= 400;
      var content = b ? digContent(b) : '';

      /* 一个很常见的情况：网关把错误包在 HTTP 200 里返回，
         形如 {"code":50507,"message":"Request failed: Unknown error","data":null}。
         这时既没有 content 也有明确的 message，把它原样告诉用户。 */
      if (httpBad || (!content && err)) {
        throw new Error(
          (httpBad ? ('接口返回 HTTP ' + res.status + '：') : '接口报错：') + (err || clip(res.data, 200)) +
          '\n\n服务端原话：' + clip(res.data, 300) +
          '\n\n怎么排查：\n' +
          '· 到「设置 → AI 识别」点「测试连接」，能立刻复现同样的错误\n' +
          '· 多半是模型名写错、该模型不支持图片输入、余额不足，或中转网关自身故障\n' +
          '· 也可以改用「本地 OCR（离线）」，完全不依赖网络和 API Key'
        );
      }

      // 有些网关把课程数组直接放在 data 里
      if (!content && b) {
        var maybe = (b.data !== undefined) ? b.data : b;
        if (Array.isArray(maybe)) {
          var direct = toCourses(maybe, totalWeeks);
          if (direct.length) return { courses: direct, raw: JSON.stringify(maybe) };
        }
      }

      if (!content) {
        throw new Error(
          '模型没有返回内容（HTTP ' + res.status + '）。\n原始返回：' + clip(res.data, 300) +
          '\n\n可以点「设置 → 测试连接」看服务端到底回了什么。'
        );
      }

      var arr = extractJson(content);
      if (arr && !Array.isArray(arr) && Array.isArray(arr.courses)) arr = arr.courses;
      if (!Array.isArray(arr)) {
        throw new Error('模型返回的不是课程数组：' + clip(content, 200));
      }

      var courses = toCourses(arr, totalWeeks);
      if (!courses.length) throw new Error('模型没识别出任何课程。换一张更清晰的截图再试。');
      return { courses: courses, raw: content };
    });
  }

  /** 设置页「测试连接」：发一条最小请求，把服务端的原话展示出来。 */
  function testApi(cfg) {
    var base = ((cfg && cfg.base) || '').trim();
    var key = ((cfg && cfg.key) || '').trim();
    var model = ((cfg && cfg.model) || '').trim() || 'gpt-4o-mini';
    if (!base) return Promise.reject(new Error('请先填写接口地址'));
    var url = chatUrl(base);

    var body = JSON.stringify({
      model: model,
      max_tokens: 8,
      messages: [{ role: 'user', content: '回复 ok' }]
    });

    return postChat(url, key, body, 0).then(function (res) {
      var b = parseBody(res.data);
      var err = digError(b);
      var content = b ? digContent(b) : '';
      if (res.status >= 400 || err) {
        throw new Error('服务端返回错误：' + (err || ('HTTP ' + res.status + ' ' + clip(res.data, 200))));
      }
      if (!content) throw new Error('能连上，但返回里没有文本内容：' + clip(res.data, 200));
      return { status: res.status, text: content, url: url };
    });
  }

  global.OcrImport = {
    runOcr: runOcr,
    cancel: cancelOcr,
    runLlm: runLlm,
    testApi: testApi,
    chatUrl: chatUrl,
    compress: compress,
    loadTesseract: loadTesseract,
    detectGrid: detectGrid,
    stripGridLines: stripGridLines,
    buildCourses: buildCourses
  };
})(window);

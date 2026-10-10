/* import-ocr.js —— 图片课表识别：本地 Tesseract OCR / 云端视觉大模型 */
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

  /* ---------- 本地 OCR ---------- */
  function runOcr(dataUrl, onProgress, totalWeeks) {
    var grid = null;
    return loadImage(dataUrl).then(function (img) {
      if (onProgress) onProgress('检测表格线…');
      grid = detectGrid(img);
      if (onProgress && grid) {
        onProgress('已识别表格线：' + (grid.ys.length - 1) + ' 行 × ' + (grid.xs.length - 1) + ' 列');
      }
      return loadTesseract(function (m) { if (onProgress) onProgress(m); });
    })
      .then(function (T) {
        var chain = recognizeChain();
        var lastErr = null;

        function attempt(i) {
          if (i >= chain.length) {
            var why = (lastErr && lastErr.message) ? lastErr.message : '未知原因';
            throw new Error('识别引擎初始化失败（' + why + '）。本地模型缺失时可尝试联网，或改用「AI 识别」。');
          }
          var cfg = chain[i];
          if (onProgress) onProgress('加载「' + cfg.tag + '」（中文模型约 19MB，首次稍慢）…');
          return T.recognize(dataUrl, LANG, {
            workerPath: cfg.worker,
            corePath: cfg.core,
            langPath: cfg.lang,
            workerBlobURL: false,
            logger: function (m) {
              if (!onProgress) return;
              if (m.status === 'recognizing text' && m.progress != null) {
                onProgress('识别中 ' + Math.round(m.progress * 100) + '%', m.progress);
              } else if (m.status) {
                onProgress(statusText(m.status), m.progress);
              }
            }
          }).catch(function (e) {
            lastErr = e;
            if (onProgress) onProgress('· ' + cfg.tag + ' 不可用：' + ((e && e.message) || e) + '，尝试下一种…');
            return attempt(i + 1);
          });
        }
        return attempt(0);
      })
      .then(function (res) {
        var d = res && res.data || {};
        var words = d.words || [];
        var lines = (d.lines || []).map(function (l) { return (l.text || '').trim(); }).filter(Boolean);

        var matrix = (grid && global.Parser.wordsToGrid(words, grid, 40, 3)) ||
          global.Parser.wordsToTable(words, 40, 3);
        var courses = global.Parser.parseTable(matrix, totalWeeks);

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
        return { courses: courses, raw: lines.join('\n'), matrix: matrix };
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

  /* ---------- 云端视觉大模型 ---------- */
  var PROMPT = [
    '你是一个课表信息抽取器。请阅读这张课程表图片，输出严格的 JSON 数组，不要输出任何解释文字。',
    '每个元素格式：{"name":"课程名","teacher":"教师","place":"上课地点","day":1到7表示周一到周日,',
    '"start":开始节次,"end":结束节次,"weeks":"周次，如 1-16 或 1-8,10-16"}',
    '要求：',
    '1. 只抽取真实出现的课程，不要臆造；看不清的字段留空字符串。',
    '2. 同一门课一周多次的，拆成多个元素。',
    '3. 节次按图片里的行号或时间推断，第1节通常是早上第一节。',
    '4. 若图片中没有周次信息，weeks 填 "1-20"。',
    '5. 输出示例：[{"name":"高等数学","teacher":"张三","place":"A101","day":1,"start":1,"end":2,"weeks":"1-16"}]'
  ].join('\n');

  function runLlm(dataUrl, cfg, onProgress, totalWeeks) {
    if (!cfg.base || !cfg.key) return Promise.reject(new Error('请先在「设置」里填写 AI 接口地址和 API Key'));
    var model = cfg.model || 'gpt-4o-mini';
    var url = String(cfg.base).replace(/\/+$/, '') + '/chat/completions';

    if (onProgress) onProgress('正在压缩图片…');
    return compress(dataUrl, 1280).then(function (small) {
      if (onProgress) onProgress('已发送给模型，等待返回…');
      return Bridge.http({
        url: url,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + cfg.key
        },
        data: JSON.stringify({
          model: model,
          temperature: 0,
          messages: [{
            role: 'user',
            content: [
              { type: 'image_url', image_url: { url: small } },
              { type: 'text', text: PROMPT }
            ]
          }]
        }),
        responseType: 'text'
      });
    }).then(function (res) {
      var body = typeof res.data === 'object' ? res.data : (function () { try { return JSON.parse(res.data); } catch (e) { return null; } })();
      if (!body) throw new Error('返回不是合法 JSON（HTTP ' + res.status + '）：' + String(res.data).slice(0, 200));
      if (body.error) throw new Error('接口报错：' + (body.error.message || JSON.stringify(body.error)));
      var content = '';
      if (body.choices && body.choices[0]) {
        var c = body.choices[0].message && body.choices[0].message.content;
        content = typeof c === 'string' ? c : (Array.isArray(c) ? c.map(function (x) { return x.text || ''; }).join('') : '');
      } else if (body.content) {
        content = typeof body.content === 'string' ? body.content : '';
      }
      if (!content) throw new Error('模型没有返回内容：' + JSON.stringify(body).slice(0, 200));

      var arr = extractJson(content);
      if (!Array.isArray(arr)) throw new Error('模型返回的不是数组：' + content.slice(0, 200));

      var courses = arr.map(function (it) {
        return {
          name: String(it.name || '').trim(),
          teacher: String(it.teacher || '').trim(),
          place: String(it.place || '').trim(),
          day: Math.min(7, Math.max(1, parseInt(it.day, 10) || 1)),
          start: parseInt(it.start, 10) || 1,
          end: parseInt(it.end, 10) || parseInt(it.start, 10) || 1,
          weeks: global.Store.parseWeeks(it.weeks || '1-' + (totalWeeks || 20), totalWeeks || 20)
        };
      }).filter(function (c) { return c.name; });

      if (!courses.length) throw new Error('模型没识别出任何课程');
      return { courses: courses, raw: content };
    });
  }

  function extractJson(text) {
    var t = String(text).trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
    try { return JSON.parse(t); } catch (e) { }
    var m = t.match(/\[[\s\S]*\]/);
    if (m) { try { return JSON.parse(m[0]); } catch (e2) { } }
    return null;
  }

  global.OcrImport = {
    runOcr: runOcr,
    runLlm: runLlm,
    compress: compress,
    loadTesseract: loadTesseract
  };
})(window);

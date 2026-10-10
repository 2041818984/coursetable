/* import-file.js —— 解析教务导出的 pdf / xls / xlsx / csv / html 与粘贴的网页源码 */
(function (global) {
  'use strict';

  var XLSX_CDN = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
  var PDF_CDN = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/';
  var xlsxPromise = null;

  function abs(p) {
    try { return new URL(p, location.href).href; } catch (e) { return p; }
  }

  function loadXlsx() {
    if (global.XLSX) return Promise.resolve(global.XLSX);
    if (xlsxPromise) return xlsxPromise;
    xlsxPromise = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = 'lib/xlsx.full.min.js';
      s.onload = function () { global.XLSX ? resolve(global.XLSX) : reject(new Error('本地表格库异常')); };
      s.onerror = function () {
        var s2 = document.createElement('script');
        s2.src = XLSX_CDN;
        s2.onload = function () { global.XLSX ? resolve(global.XLSX) : reject(new Error('表格库加载异常')); };
        s2.onerror = function () { reject(new Error('无法加载表格解析库，请联网后重试，或改用图片识别')); };
        document.head.appendChild(s2);
      };
      document.head.appendChild(s);
    });
    return xlsxPromise;
  }

  /* ---------- CSV / TSV ---------- */
  function parseCsv(text, delim) {
    if (delim == null) {
      var first = String(text).split(/\r?\n/).find(function (l) { return l.trim(); }) || '';
      var c1 = (first.match(/,/g) || []).length;
      var c2 = (first.match(/\t/g) || []).length;
      delim = c2 > c1 ? '\t' : ',';
    }
    var rows = [];
    var row = [], cur = '', inQ = false;
    var s = String(text);
    for (var i = 0; i < s.length; i++) {
      var ch = s[i];
      if (inQ) {
        if (ch === '"') {
          if (s[i + 1] === '"') { cur += '"'; i++; }
          else inQ = false;
        } else cur += ch;
      } else {
        if (ch === '"') inQ = true;
        else if (ch === delim) { row.push(cur); cur = ''; }
        else if (ch === '\n' || ch === '\r') {
          if (cur !== '' || row.length) { row.push(cur); rows.push(row); row = []; cur = ''; }
          if (ch === '\r' && s[i + 1] === '\n') i++;
        } else cur += ch;
      }
    }
    if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
    return rows.map(function (r) { return r.map(function (c) { return String(c).trim(); }); });
  }

  /* ---------- PDF ---------- */
  var pdfPromise = null;

  function loadPdf() {
    if (global.pdfjsLib) return Promise.resolve(global.pdfjsLib);
    if (pdfPromise) return pdfPromise;
    pdfPromise = new Promise(function (resolve, reject) {
      function done() {
        if (!global.pdfjsLib) return reject(new Error('PDF 库加载异常'));
        global.pdfjsLib.GlobalWorkerOptions.workerSrc = abs('lib/pdf.worker.min.js');
        resolve(global.pdfjsLib);
      }
      var s = document.createElement('script');
      s.src = 'lib/pdf.min.js';
      s.onload = done;
      s.onerror = function () {
        var s2 = document.createElement('script');
        s2.src = PDF_CDN + 'pdf.min.js';
        s2.onload = function () {
          if (!global.pdfjsLib) return reject(new Error('PDF 库加载异常'));
          global.pdfjsLib.GlobalWorkerOptions.workerSrc = PDF_CDN + 'pdf.worker.min.js';
          resolve(global.pdfjsLib);
        };
        s2.onerror = function () { reject(new Error('无法加载 PDF 解析库，请联网后重试')); };
        document.head.appendChild(s2);
      };
      document.head.appendChild(s);
    });
    return pdfPromise;
  }

  /* 把 pdf.js 的文字项整理成「词块」：同一行内水平紧邻的项先粘成一个词，
     再交给 Parser.wordsToTable 按坐标还原表格。 */
  function itemsToWords(items, pageHeight) {
    var raw = [];
    (items || []).forEach(function (it) {
      var str = String(it.str == null ? '' : it.str);
      if (!str.trim()) return;
      var tr = it.transform || [1, 0, 0, 1, 0, 0];
      var fh = Math.abs(tr[3]) || it.height || 10;
      var x0 = tr[4];
      var w = it.width || (str.length * fh * 0.5);
      var yTop = pageHeight - tr[5] - fh;
      raw.push({ text: str, x0: x0, x1: x0 + w, y0: yTop, y1: yTop + fh, h: fh });
    });
    if (!raw.length) return [];

    // 先按纵向位置分行
    raw.sort(function (a, b) { return (a.y0 - b.y0) || (a.x0 - b.x0); });
    var rows = [], cur = [raw[0]];
    for (var i = 1; i < raw.length; i++) {
      var ref = cur[cur.length - 1];
      var tol = Math.max(2, Math.min(ref.h, raw[i].h) * 0.6);
      if (Math.abs(raw[i].y0 - ref.y0) > tol) { rows.push(cur); cur = []; }
      cur.push(raw[i]);
    }
    rows.push(cur);

    // 行内按水平间隙粘词
    var words = [];
    rows.forEach(function (row) {
      row.sort(function (a, b) { return a.x0 - b.x0; });
      var acc = null;
      function flush() {
        if (!acc) return;
        var t = acc.text.replace(/\s+/g, ' ').trim();
        if (t) {
          words.push({
            text: t,
            bbox: { x0: acc.x0, y0: acc.y0, x1: acc.x1, y1: acc.y1 },
            confidence: 100
          });
        }
        acc = null;
      }
      row.forEach(function (it) {
        if (!acc) { acc = { text: it.text, x0: it.x0, x1: it.x1, y0: it.y0, y1: it.y1, h: it.h }; return; }
        var gap = it.x0 - acc.x1;
        if (gap <= acc.h * 0.6) {
          acc.text += (gap > acc.h * 0.12 ? ' ' : '') + it.text;
          acc.x1 = Math.max(acc.x1, it.x1);
          acc.y0 = Math.min(acc.y0, it.y0);
          acc.y1 = Math.max(acc.y1, it.y1);
        } else {
          flush();
          acc = { text: it.text, x0: it.x0, x1: it.x1, y0: it.y0, y1: it.y1, h: it.h };
        }
      });
      flush();
    });
    return words;
  }

  function parsePdf(file, totalWeeks, onProgress) {
    totalWeeks = totalWeeks || 20;
    return loadPdf()
      .then(function () { return Bridge.readFileAsArrayBuffer(file); })
      .then(function (buf) {
        var bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
        // 先看文件头，区分「不是 PDF」和「PDF 内容有问题」
        var head = String.fromCharCode.apply(null, bytes.subarray(0, 5));
        if (head.indexOf('%PDF') !== 0) {
          if (head.replace(/[\s\0]/g, '').indexOf('<') === 0 || head.indexOf('<!DO') === 0 || head.indexOf('<htm') === 0) {
            throw new Error('这个文件其实是网页（HTML），不是 PDF。请改用「文件 / 网页导入」里的粘贴方式。');
          }
          throw new Error('文件头不是 %PDF，可能下载不完整或不是 PDF 文件。建议重新从教务系统导出。');
        }
        return global.pdfjsLib.getDocument({ data: bytes }).promise;
      })
      .then(function (pdf) {
        var pages = Math.min(pdf.numPages, 12);
        if (onProgress) onProgress('PDF 共 ' + pdf.numPages + ' 页，逐页读取文字层…');
        var courses = [], usedPages = 0, textPages = 0;

        var seq = Promise.resolve();
        for (var p = 1; p <= pages; p++) {
          (function (pageNo) {
            seq = seq.then(function () {
              return pdf.getPage(pageNo).then(function (page) {
                return page.getTextContent().then(function (tc) {
                  var vp = page.getViewport({ scale: 1 });
                  var words = itemsToWords(tc.items, vp.height);
                  if (!words.length) return null;
                  textPages++;
                  if (onProgress) onProgress('第 ' + pageNo + ' 页：读出 ' + words.length + ' 个词块');
                  var matrix = global.Parser.wordsToTableByAnchor(words, 0);
                  var cs = global.Parser.parseTable(matrix, totalWeeks);
                  if (cs.length) { usedPages++; courses = courses.concat(cs); }
                  return null;
                });
              }).catch(function (e) {
                if (onProgress) onProgress('· 第 ' + pageNo + ' 页读取失败：' + ((e && e.message) || e));
                return null;
              });
            });
          })(p);
        }

        return seq.then(function () {
          if (!textPages) {
            throw new Error('这个 PDF 没有文字层（像是扫描件或图片导出）。请改用「图片识别导入」。');
          }
          if (!courses.length) {
            throw new Error('PDF 里读到了文字，但没能组成课表结构（需要「星期 + 节次」对得上）。可试试图片识别。');
          }
          return { courses: courses, pages: pages, usedPages: usedPages };
        });
      })
      .catch(function (e) {
        var msg = (e && e.name) || '';
        if (msg === 'PasswordException') {
          throw new Error('这个 PDF 设了打开密码（教务系统常见做法）。请先用 PDF 阅读器去掉密码另存，再导入。');
        }
        if (msg === 'InvalidPDFException' || /Invalid PDF|corrupt/i.test((e && e.message) || '')) {
          throw new Error('PDF 内容已损坏或格式不被支持。建议重新导出，或改用图片识别。');
        }
        throw e;
      });
  }

  /* ---------- 入口 ---------- */
  function parseText(text, totalWeeks) {
    totalWeeks = totalWeeks || 20;
    var t = String(text || '').trim();
    if (!t) return Promise.reject(new Error('内容为空'));

    var matrix;
    if (/<t[dhr][\s>]/i.test(t)) {
      matrix = global.JwImport.htmlToMatrix(t);
    } else {
      matrix = parseCsv(t);
    }
    var courses = global.Parser.parseTable(matrix, totalWeeks);

    // 退化：没有表格结构时，逐行当单元格解析
    if (!courses.length) {
      courses = t.split(/\r?\n/).map(function (line) {
        var info = global.Parser.parseCell(line, totalWeeks);
        return info.name ? {
          name: info.name, teacher: info.teacher, place: info.place,
          day: 1, start: info.periods ? info.periods.start : 1,
          end: info.periods ? info.periods.end : 1,
          weeks: info.weeks, _loose: true
        } : null;
      }).filter(Boolean);
    }
    if (!courses.length) return Promise.reject(new Error('没能解析出课程，请确认内容是课表（需要星期 + 节次信息）'));
    return Promise.resolve({ courses: courses, matrix: matrix });
  }

  function parseFile(file, totalWeeks, onProgress) {
    totalWeeks = totalWeeks || 20;
    var name = (file.name || '').toLowerCase();
    var isSheet = /\.xlsx?$/.test(name) || /sheet|excel/.test(file.type || '');
    var isPdf = /\.pdf$/.test(name) || /pdf/.test(file.type || '');

    if (isPdf) return parsePdf(file, totalWeeks, onProgress);

    if (isSheet) {
      return loadXlsx()
        .then(function () { return Bridge.readFileAsArrayBuffer(file); })
        .then(function (buf) {
          var wb = global.XLSX.read(buf, { type: 'array' });
          var sheet = pickSheet(wb);
          var matrix = global.XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: '' });
          var courses = global.Parser.parseTable(matrix, totalWeeks);
          if (!courses.length) throw new Error('表格里没能识别出课表结构（需要「星期 + 节次」）');
          return { courses: courses, matrix: matrix };
        });
    }
    return Bridge.readFileAsText(file).then(function (txt) { return parseText(txt, totalWeeks); });
  }

  function pickSheet(wb) {
    var names = wb.SheetNames || [];
    var best = null, bestN = 0;
    names.forEach(function (n) {
      var s = wb.Sheets[n];
      if (!s || !s['!ref']) return;
      var rows = global.XLSX.utils.sheet_to_json(s, { header: 1, raw: false, defval: '' });
      var cells = rows.reduce(function (a, r) { return a + r.filter(function (x) { return String(x).trim(); }).length; }, 0);
      if (cells > bestN) { bestN = cells; best = s; }
    });
    return best || wb.Sheets[names[0]];
  }

  global.FileImport = {
    parseFile: parseFile,
    parseText: parseText,
    parseCsv: parseCsv,
    parsePdf: parsePdf,
    itemsToWords: itemsToWords,
    loadXlsx: loadXlsx,
    loadPdf: loadPdf
  };
})(window);

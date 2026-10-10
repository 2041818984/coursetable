/* import-file.js —— 解析教务导出的 xls / xlsx / csv / html 与粘贴的网页源码 */
(function (global) {
  'use strict';

  var XLSX_CDN = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
  var xlsxPromise = null;

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

  function parseFile(file, totalWeeks) {
    totalWeeks = totalWeeks || 20;
    var name = (file.name || '').toLowerCase();
    var isSheet = /\.xlsx?$/.test(name) || /sheet|excel/.test(file.type || '');

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
    loadXlsx: loadXlsx
  };
})(window);

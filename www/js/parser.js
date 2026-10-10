/* parser.js —— 把「教务 JSON / 二维表格 / OCR 文本」统一解析成课程对象 */
(function (global) {
  'use strict';

  var DOW_WORDS = ['一', '二', '三', '四', '五', '六', '日', '天'];
  var DEFAULT_TIME = [
    ['08:00', '08:45'], ['08:55', '09:40'], ['10:00', '10:45'], ['10:55', '11:40'],
    ['14:00', '14:45'], ['14:55', '15:40'], ['16:00', '16:45'], ['16:55', '17:40'],
    ['19:00', '19:45'], ['19:55', '20:40'], ['20:50', '21:35'], ['21:45', '22:30']
  ];

  function trim(s) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); }

  /* 单元格专用规范化：保留换行（换行是「课程名 / 教师 / 地点 / 周次」的分隔依据），
     只把空格、制表符这类横向空白压成单个空格 */
  function normCell(s) {
    return String(s == null ? '' : s)
      .replace(/\r\n?/g, '\n')
      .replace(/[ \t\u00a0　]+/g, ' ')
      .replace(/ ?\n ?/g, '\n')
      .replace(/\n{2,}/g, '\n')
      .trim();
  }

  /* ============ 周次 / 节次 / 地点 / 教师的正则识别 ============ */

  // 周次：1-16周 / 第1-16周 / [1-16] / (1-16) / 1,3,5周 / 单周 / 双周
  function extractWeeks(text, totalWeeks) {
    totalWeeks = totalWeeks || 20;
    var t = trim(text);
    var res = { weeks: [], raw: '' };

    var m = t.match(/第?\s*(\d{1,2})\s*[-~—－]\s*(\d{1,2})\s*周/);
    if (m) { res.raw = m[0]; res.weeks = range(+m[1], +m[2]); return res; }

    m = t.match(/\[\s*(\d{1,2})\s*[-~—]\s*(\d{1,2})\s*\]/);
    if (m) { res.raw = m[0]; res.weeks = range(+m[1], +m[2]); return res; }

    m = t.match(/[（(]\s*(\d{1,2})\s*[-~—]\s*(\d{1,2})\s*[)）]\s*周?/);
    if (m) { res.raw = m[0]; res.weeks = range(+m[1], +m[2]); return res; }

    m = t.match(/(\d{1,2}(?:\s*[，,、]\s*\d{1,2}){0,20})\s*周(?![节次])/);
    if (m) {
      res.raw = m[0];
      res.weeks = m[1].split(/[，,、\s]+/).map(Number).filter(function (n) { return n > 0; });
      return res;
    }

    if (/单周/.test(t)) { res.raw = '单周'; res.weeks = oddEven(1, totalWeeks); return res; }
    if (/双周/.test(t)) { res.raw = '双周'; res.weeks = oddEven(0, totalWeeks); return res; }
    if (/全\s*周|每\s*周/.test(t)) { res.raw = '全周'; res.weeks = range(1, totalWeeks); return res; }
    return res;
  }

  function range(a, b) {
    var lo = Math.min(a, b), hi = Math.max(a, b), out = [];
    for (var i = lo; i <= hi; i++) out.push(i);
    return out;
  }
  function oddEven(parity, n) {
    var out = [];
    for (var i = 1; i <= n; i++) if (i % 2 === parity) out.push(i);
    return out;
  }

  // 节次：1-2节 / 第3节 / 1,2节
  function extractPeriods(text) {
    var t = trim(text);
    var m = t.match(/(\d{1,2})\s*[-~—]\s*(\d{1,2})\s*节/);
    if (m) return { start: Math.min(+m[1], +m[2]), end: Math.max(+m[1], +m[2]), raw: m[0] };
    m = t.match(/第\s*(\d{1,2})\s*节/);
    if (m) return { start: +m[1], end: +m[1], raw: m[0] };
    m = t.match(/(\d{1,2})\s*[，,、]\s*(\d{1,2})\s*节/);
    if (m) return { start: Math.min(+m[1], +m[2]), end: Math.max(+m[1], +m[2]), raw: m[0] };
    return null;
  }

  // 时间：08:00-09:40 → 节次
  function extractTimePeriods(text) {
    var t = trim(text);
    var m = t.match(/(\d{1,2})\s*[:：]\s*(\d{2})\s*[-~—]\s*(\d{1,2})\s*[:：]\s*(\d{2})/);
    if (!m) return null;
    var sMin = +m[1] * 60 + +m[2], eMin = +m[3] * 60 + +m[4];
    var s = nearestPeriod(sMin), e = nearestPeriod(eMin, true);
    if (!s) return null;
    return { start: s, end: Math.max(s, e || s), raw: m[0] };
  }

  function nearestPeriod(minutes, endMode) {
    var best = null, bestD = 1e9;
    for (var i = 0; i < DEFAULT_TIME.length; i++) {
      var a = DEFAULT_TIME[i][endMode ? 1 : 0].split(':');
      var v = +a[0] * 60 + +a[1];
      var d = Math.abs(v - minutes);
      if (d < bestD) { bestD = d; best = i + 1; }
    }
    return bestD <= 45 ? best : null;
  }

  // 地点特征词
  var PLACE_HINT = new RegExp('(楼|教室|教[一二三四五六七八九十\\d]|馆|场|厅|机房|实验室|中心|会议室|阶梯|多媒体|' +
    '腾讯会议|钉钉|雨课堂|学习通|线上|网络|操场|校区|区|' +
    '[A-Za-z]{1,3}\\d{2,4}|[-—]\\d{2,4}|\\d{3,4}室|' +
    '[\\u4e00-\\u9fa5][-—]?\\d{2,4}(?![节周月日]))');

  function isPlace(s) {
    var t = trim(s);
    if (!t) return false;
    if (/^\d{1,2}\s*[-~]\s*\d{1,2}\s*周?$/.test(t)) return false;
    if (PLACE_HINT.test(t)) return true;
    return false;
  }

  // 教师：2~6 个中文字符或带英文名，且不是课程名/地点/周次
  function isTeacherLike(s) {
    var t = trim(s);
    if (!t || t.length > 12) return false;
    if (/\d/.test(t)) return false;
    if (PLACE_HINT.test(t)) return false;
    if (/周|节/.test(t)) return false;
    if (/老师|教师|教授|讲师|副教授/.test(t)) return true;
    return /^[\u4e00-\u9fa5]{2,6}$/.test(t) || /^[A-Za-z\s.]{2,20}$/.test(t);
  }

  function cleanName(s) {
    return trim(s)
      .replace(/[（(]\s*\d{1,2}\s*[-~]\s*\d{1,2}\s*[)）]\s*周?/g, '')
      .replace(/第?\s*\d{1,2}\s*[-~]\s*\d{1,2}\s*周/g, '')
      .replace(/\d{1,2}\s*[-~]\s*\d{1,2}\s*节/g, '')
      .replace(/[（(]\s*[)）]/g, '')
      .trim();
  }

  /**
   * 解析一个课表单元格（可能是多行的文本，也可能是 OCR 挤在一起的一整串）
   * @returns {name,teacher,place,weeks,periods}
   */
  function parseCell(text, totalWeeks) {
    var out = { name: '', teacher: '', place: '', weeks: [], periods: null, _src: normCell(text) };
    if (!out._src) return out;

    var w = extractWeeks(out._src, totalWeeks);
    out.weeks = w.weeks;
    var rest = out._src.split(w.raw).join(' ');

    var p = extractPeriods(rest) || extractTimePeriods(rest);
    if (p) { out.periods = { start: p.start, end: p.end }; rest = rest.split(p.raw).join(' '); }

    // 按换行 / 多个空格 拆成片段；OCR 常常没有换行，这里再尝试按「课程名|人名|地点」硬切
    var parts = rest.split(/\n+|\s{2,}|[|｜]+/).map(trim).filter(Boolean);

    if (parts.length === 1) parts = splitGlued(parts[0]);

    var nameTaken = false;
    for (var i = 0; i < parts.length; i++) {
      var seg = parts[i];
      if (!seg) continue;
      if (!out.place && isPlace(seg)) { out.place = seg; continue; }
      if (!nameTaken) { out.name = cleanName(seg); nameTaken = true; continue; }
      if (!out.teacher && isTeacherLike(seg) && seg !== out.name) { out.teacher = seg; continue; }
      if (!out.place && PLACE_HINT.test(seg)) { out.place = seg; continue; }
      if (out.name && !out.name.includes(seg)) out.name = cleanName(out.name + ' ' + seg);
    }
    out.name = cleanName(out.name || cleanName(rest));
    return out;
  }

  // 把挤在一起的字符串切开：课程名在前，人名居中，地点/编号在尾部
  function splitGlued(s) {
    var t = trim(s);
    if (t.length < 5) return [t];
    var arr = t.match(/[\u4e00-\u9fa5]{2,}|[（(][^)）]*[)）]|[A-Za-z]+\d+|[A-Za-z]+|\d{2,}|\d/g);
    if (!arr || arr.length < 2) return [t];

    var out = [];
    arr.forEach(function (cur) {
      if (!out.length) { out.push(cur); return; }
      var last = out[out.length - 1];
      // 中文后紧跟数字/字母数字 → 合成一个地点或名称（教三 + 301 → 教三301）
      if (/^[\u4e00-\u9fa5]+$/.test(last) && /^([A-Za-z]+\d+|\d{2,})$/.test(cur)) { out[out.length - 1] = last + cur; return; }
      if (/^[A-Za-z]+\d+$/.test(last) && /^\d{2,}$/.test(cur)) { out[out.length - 1] = last + cur; return; }
      // 游离的单个字母或数字并回前一段（避免把 "A(1)" 拆碎）
      if (/^(\d|[A-Za-z])$/.test(cur)) { out[out.length - 1] = last + cur; return; }
      out.push(cur);
    });
    return out;
  }

  /* ============ 二维表格 → 课程 ============ */

  /**
   * @param {Array<Array<string>>} matrix 行优先的表格文本
   * @param {number} totalWeeks
   * @returns {Array} 课程对象（day/start/end 由行列推断）
   */
  function parseTable(matrix, totalWeeks) {
    totalWeeks = totalWeeks || 20;
    var rows = (matrix || []).map(function (r) { return (r || []).map(normCell); });
    if (!rows.length) return [];

    // 1) 定位表头行（含星期字样最多的那一行）
    var headIdx = -1, bestScore = 0;
    for (var i = 0; i < Math.min(rows.length, 5); i++) {
      var score = rows[i].filter(function (c) { return /星期|周[一二三四五六日天]|^[一二三四五六日天]$/.test(c); }).length;
      if (score > bestScore) { bestScore = score; headIdx = i; }
    }

    // 2) 表头 → 星期列映射
    var colToDay = {};
    if (headIdx >= 0 && bestScore >= 2) {
      rows[headIdx].forEach(function (c, j) {
        var m = c.match(/星期([一二三四五六日天])/) || c.match(/^周?([一二三四五六日天])$/);
        if (m) colToDay[j] = i2d(m[1]);
      });
    } else {
      // 没有表头：假设第 0 列是节次，其后依次周一→周日
      for (var j0 = 1; j0 < 8; j0++) colToDay[j0] = j0;
    }

    var courses = [];
    var lastPeriodByCol = {};

    for (var r = headIdx + 1; r < rows.length; r++) {
      var row = rows[r];
      if (!row || !row.join('').length) continue;

      // 3) 本行节次：优先从内容里读，其次从行号推断
      var per = null;
      for (var c = 0; c < Math.min(row.length, 2); c++) {
        per = extractPeriods(row[c]) || extractTimePeriods(row[c]) || per;
      }
      if (!per) {
        var seq = Object.keys(lastPeriodByCol).length ? r - headIdx : r - headIdx;
        per = { start: seq, end: seq };
      }

      for (var j2 = 0; j2 < row.length; j2++) {
        var day = colToDay[j2];
        if (!day) continue;
        var cell = row[j2];
        if (!cell || /^(　|\s)*$/.test(cell)) continue;

        var info = parseCell(cell, totalWeeks);
        if (!info.name) continue;
        var st = info.periods ? info.periods.start : per.start;
        var en = info.periods ? info.periods.end : per.end;
        courses.push({
          name: info.name,
          teacher: info.teacher,
          place: info.place,
          day: day,
          start: st,
          end: en,
          weeks: info.weeks.length ? info.weeks : range(1, totalWeeks)
        });
        lastPeriodByCol[j2] = en;
      }
    }
    return courses;
  }

  function i2d(ch) {
    var idx = DOW_WORDS.indexOf(ch);
    return idx < 0 ? 0 : idx + 1;
  }

  /* ============ 正方 kbList → 课程 ============ */

  /**
   * 兼容不同学校字段命名差异：对常见 key 逐一尝试。
   * 已知常见字段（不同版本命名不一）：kcmc/xqmc(星期) / jc(节次) / zcd(周次) / cdmc(地点) / xm(教师)
   */
  function pick(obj, keys) {
    for (var i = 0; i < keys.length; i++) {
      for (var k in obj) {
        if (k === keys[i] && obj[k] != null && obj[k] !== '') return obj[k];
      }
    }
    for (var i2 = 0; i2 < keys.length; i2++) {
      for (var k2 in obj) {
        if (k2.toLowerCase() === keys[i2].toLowerCase() && obj[k2] != null && obj[k2] !== '') return obj[k2];
      }
    }
    return '';
  }

  function parseJwList(list, totalWeeks) {
    totalWeeks = totalWeeks || 20;
    if (!Array.isArray(list)) return [];
    var out = [];
    list.forEach(function (it) {
      if (!it || typeof it !== 'object') return;
      var name = trim(pick(it, ['kcmc', 'kcxm', 'courseName', 'name', 'KCMC']));
      if (!name) return;
      var dayRaw = trim(pick(it, ['xqj', 'xq', 'day', 'dayOfWeek', 'XQJ']));
      var jcRaw = trim(pick(it, ['jc', 'jcs', 'ksjc', 'period', 'JC']));
      var zcd = trim(pick(it, ['zcd', 'zcs', 'weeks', 'ZCD']));
      var place = trim(pick(it, ['cdmc', 'jsmc', 'jxdd', 'place', 'location', 'CDMC']));
      var teacher = trim(pick(it, ['xm', 'jsxm', 'teacher', 'XM']));

      var day = (function () {
        var m = dayRaw.match(/([1-7])/);
        if (m) return +m[1];
        var m2 = dayRaw.match(/[一二三四五六日天]/);
        return m2 ? i2d(m2[0]) : 0;
      })();
      if (!day) return;

      var per = extractPeriods(jcRaw) ||
        (jcRaw.match(/(\d{1,2})/) ? { start: +RegExp.$1, end: (jcRaw.match(/(\d{1,2})\D+(\d{1,2})/) ? +RegExp.$2 : +RegExp.$1) } : null);

      var weeks = extractWeeks(zcd, totalWeeks).weeks;
      if (!weeks.length) {
        // "1111111111111111000000000000000000000000000" 这类按位表示
        if (/^[01]+$/.test(zcd) && zcd.length > 4) {
          weeks = [];
          for (var i = 0; i < zcd.length; i++) if (zcd[i] === '1') weeks.push(i + 1);
        }
      }
      if (!weeks.length) weeks = range(1, totalWeeks);

      out.push({
        name: name, teacher: teacher, place: place,
        day: day,
        start: per ? per.start : 1,
        end: per ? per.end : 1,
        weeks: weeks
      });
    });
    return out;
  }

  /* ============ OCR 词块（带坐标）→ 二维表格 ============ */

  /* 课表的一个课程块里通常有「课程名 / 教师 / 地点 / 周次」好几行文字，
     OCR 出来是多个文本行。这里把「上一格还没出现周次或节次」的续行并回去，
     一个块最多并 3 行，避免把下一节课的内容也吃进来。 */
  function mergeBlockRows(rows, maxDepth) {
    maxDepth = maxDepth || 3;
    var out = [], depths = [];
    rows.forEach(function (r) {
      var cols = [];
      r.forEach(function (v, c) { if (v && String(v).trim()) cols.push(c); });
      var li = out.length - 1;
      if (li >= 0 && cols.length && depths[li] < maxDepth &&
        !isHeaderRow(out[li]) && !isHeaderRow(r)) {
        var prev = out[li];
        var ok = cols.every(function (c) {
          var pv = String(prev[c] || '');
          return pv.trim() && !isClosed(pv);
        });
        if (ok) {
          cols.forEach(function (c) { prev[c] = String(prev[c]) + '\n' + String(r[c]); });
          depths[li]++;
          return;
        }
      }
      out.push(r.slice());
      depths.push(1);
    });
    return out;
  }

  function isClosed(txt) {
    return /周\s*$|节\s*$|\d\s*[-~]\s*\d\s*周/.test(txt);
  }

  // 表头行（星期 / 节次 / 时间）不参与上下合并，否则会把表头和第一门课粘在一起
  function isHeaderRow(row) {
    var n = (row || []).filter(function (v) {
      return /星期|周[一二三四五六日天]|节次|时间|上午|下午|早上|中午|晚上/.test(String(v));
    }).length;
    return n >= 1;
  }

  function wordsToTable(words, minConf, maxDepth) {
    minConf = minConf == null ? 40 : minConf;
    var ws = (words || []).filter(function (w) {
      return w && trim(w.text) && (!w.confidence || w.confidence >= minConf);
    });
    if (!ws.length) return [];

    // 行聚类：按 y0 排序后按间隙切分
    var sorted = ws.slice().sort(function (a, b) { return a.bbox.y0 - b.bbox.y0; });
    var heights = sorted.map(function (w) { return Math.max(4, w.bbox.y1 - w.bbox.y0); });
    heights.sort(function (a, b) { return a - b; });
    var medH = heights[Math.floor(heights.length / 2)] || 20;
    var rowsW = [], cur = [sorted[0]];
    for (var i = 1; i < sorted.length; i++) {
      if (sorted[i].bbox.y0 - cur[cur.length - 1].bbox.y0 > medH * 0.7) { rowsW.push(cur); cur = []; }
      cur.push(sorted[i]);
    }
    rowsW.push(cur);

    // 列边界：取所有词块左边界之间最大的几个空隙作为分隔
    var xs = ws.map(function (w) { return w.bbox.x0; }).sort(function (a, b) { return a - b; });
    var edges = [xs[0]];
    var gaps = [];
    for (var g = 1; g < xs.length; g++) gaps.push({ gap: xs[g] - xs[g - 1], at: (xs[g] + xs[g - 1]) / 2 });
    gaps.sort(function (a, b) { return b.gap - a.gap; });
    var wantCols = 8; // 节次列 + 7 天
    gaps.slice(0, Math.max(1, wantCols - 1)).forEach(function (o) { edges.push(o.at); });
    edges.sort(function (a, b) { return a - b; });

    function colOf(x) {
      var best = 0;
      for (var e = 0; e < edges.length; e++) if (x >= edges[e]) best = e;
      return best;
    }

    var matrix = rowsW.map(function (row) {
      var arr = new Array(edges.length).fill('');
      row.sort(function (a, b) { return a.bbox.x0 - b.bbox.x0; });
      row.forEach(function (w) {
        var c = colOf(w.bbox.x0);
        arr[c] = (arr[c] ? arr[c] + ' ' : '') + trim(w.text);
      });
      return arr;
    });
    return mergeBlockRows(matrix, maxDepth);
  }

  /* 已知网格线时（由图片线条检测得到），直接把词块投进对应单元格，准确率更高 */
  function wordsToGrid(words, grid, minConf, maxDepth) {
    minConf = minConf == null ? 40 : minConf;
    if (!grid || !grid.xs || !grid.ys) return null;
    var xs = grid.xs, ys = grid.ys;
    var nC = xs.length - 1, nR = ys.length - 1;
    if (nC < 2 || nR < 2) return null;

    var m = [];
    for (var r = 0; r < nR; r++) { var row = []; for (var c = 0; c < nC; c++) row.push(''); m.push(row); }

    var ws = (words || []).filter(function (w) {
      return w && trim(w.text) && (!w.confidence || w.confidence >= minConf);
    }).sort(function (a, b) { return a.bbox.y0 - b.bbox.y0; });

    ws.forEach(function (w) {
      var cx = (w.bbox.x0 + w.bbox.x1) / 2;
      var cy = (w.bbox.y0 + w.bbox.y1) / 2;
      var col = -1, row = -1;
      for (var c = 0; c < nC; c++) if (cx >= xs[c] && cx < xs[c + 1]) { col = c; break; }
      for (var r = 0; r < nR; r++) if (cy >= ys[r] && cy < ys[r + 1]) { row = r; break; }
      if (col < 0 || row < 0) return;
      m[row][col] = m[row][col] ? m[row][col] + '\n' + trim(w.text) : trim(w.text);
    });

    return mergeBlockRows(m, maxDepth || 3);
  }

  global.Parser = {
    parseCell: parseCell,
    parseTable: parseTable,
    parseJwList: parseJwList,
    wordsToTable: wordsToTable,
    wordsToGrid: wordsToGrid,
    mergeBlockRows: mergeBlockRows,
    normCell: normCell,
    extractWeeks: extractWeeks,
    extractPeriods: extractPeriods,
    extractTimePeriods: extractTimePeriods,
    DEFAULT_TIME: DEFAULT_TIME
  };
})(window);

/* store.js —— 课表数据模型与本地持久化 */
(function (global) {
  'use strict';

  var KEY = 'coursetable_v1';

  var DEFAULT_SETTINGS = {
    totalWeeks: 20,
    startDate: mondayOf(new Date()).toISOString().slice(0, 10),
    currentWeek: 1,
    showWeekend: true,
    periods: 12,
    api: { base: '', model: '', key: '' },
    jw: { base: '', variant: 'jwglxt', user: '', xnm: '', xqm: '3' }
  };

  var PALETTE = [
    '#4f6ef7', '#7c5cf0', '#e8654f', '#f0a63c',
    '#3fbf7f', '#2bb3c0', '#e05a8f', '#6b7a99',
    '#5c8ae0', '#9b6bd6'
  ];

  var data = null;

  function mondayOf(d) {
    var x = new Date(d.getTime());
    var w = x.getDay();          // 0=周日
    var diff = w === 0 ? -6 : 1 - w;
    x.setDate(x.getDate() + diff);
    return x;
  }

  function uid() {
    return 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  function defaults() {
    return { version: 1, settings: JSON.parse(JSON.stringify(DEFAULT_SETTINGS)), courses: [] };
  }

  function load() {
    if (data) return data;
    try {
      var raw = localStorage.getItem(KEY);
      data = raw ? JSON.parse(raw) : defaults();
    } catch (e) {
      data = defaults();
    }
    // 补齐升级过程中可能缺失的字段
    var s = DEFAULT_SETTINGS;
    for (var k in s) {
      if (data.settings[k] === undefined) data.settings[k] = JSON.parse(JSON.stringify(s[k]));
    }
    if (!Array.isArray(data.courses)) data.courses = [];
    return data;
  }

  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(data));
    } catch (e) {
      console.warn('保存失败', e);
    }
  }

  function settings() { return load().settings; }

  function courses() { return load().courses; }

  function colorFor(seed) {
    var h = 0, str = String(seed || '');
    for (var i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
    return PALETTE[h % PALETTE.length];
  }

  /* ---- 周次字符串 <-> 数组 ----
     支持：1-16 / 1-16周 / (1-16) / [1-16] / 第1-16周 / 1,3,5周 / 单周 / 双周 / 全周 */
  function parseWeeks(str, total) {
    total = total || 30;
    if (Array.isArray(str)) return str.slice().sort(function (a, b) { return a - b; });
    if (str === null || str === undefined || str === '') return [];

    var t = String(str);
    if (/单周/.test(t)) return oddEven(1, total);
    if (/双周/.test(t)) return oddEven(0, total);
    if (/全\s*周|每\s*周/.test(t)) return range(1, total);

    var out = {};
    t.replace(/[\[\]（）()]/g, ' ')
      .split(/[,，;；、\s]+/)
      .forEach(function (part) {
        if (!part) return;
        var m = part.match(/^第?(\d{1,2})\s*[-~—－]\s*(\d{1,2})\s*周?$/);
        if (m) {
          var a = +m[1], b = +m[2];
          for (var i = Math.min(a, b); i <= Math.max(a, b); i++) out[i] = 1;
          return;
        }
        m = part.match(/^第?(\d{1,2})\s*周?$/);
        if (m) out[+m[1]] = 1;
      });
    return Object.keys(out).map(Number).sort(function (a, b) { return a - b; });
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

  function formatWeeks(arr) {
    if (!arr || !arr.length) return '';
    var s = arr.slice().sort(function (a, b) { return a - b; });
    var res = [], i = 0;
    while (i < s.length) {
      var j = i;
      while (j + 1 < s.length && s[j + 1] === s[j] + 1) j++;
      res.push(j - i >= 1 ? s[i] + '-' + s[j] : String(s[i]));
      i = j + 1;
    }
    return res.join(',');
  }

  /* ---- 增删改 ---- */
  function add(c) {
    c = normalize(c);
    load().courses.push(c);
    save();
    return c;
  }

  function normalize(c) {
    return {
      id: c.id || uid(),
      name: (c.name || '未命名课程').trim(),
      teacher: (c.teacher || '').trim(),
      place: (c.place || '').trim(),
      day: Math.min(7, Math.max(1, +c.day || 1)),
      start: Math.max(1, +c.start || 1),
      end: Math.max(+c.start || 1, +c.end || +c.start || 1),
      weeks: parseWeeks(c.weeks, load().settings.totalWeeks),
      color: c.color || colorFor(c.name)
    };
  }

  function update(id, patch) {
    var cs = courses();
    for (var i = 0; i < cs.length; i++) {
      if (cs[i].id === id) {
        var merged = {};
        for (var k in cs[i]) merged[k] = cs[i][k];
        for (var p in patch) merged[p] = patch[p];
        cs[i] = normalize(merged);
        save();
        return cs[i];
      }
    }
    return null;
  }

  function remove(id) {
    var d = load();
    d.courses = d.courses.filter(function (c) { return c.id !== id; });
    save();
  }

  function clear() { load().courses = []; save(); }

  function replaceAll(list) {
    load().courses = (list || []).map(normalize);
    save();
  }

  function addMany(list) {
    (list || []).forEach(function (c) { load().courses.push(normalize(c)); });
    save();
  }

  function stat() {
    var cs = courses();
    var slots = cs.reduce(function (n, c) { return n + (c.end - c.start + 1); }, 0);
    return { count: cs.length, slots: slots };
  }

  global.Store = {
    KEY: KEY,
    PALETTE: PALETTE,
    load: load, save: save,
    settings: settings, courses: courses,
    colorFor: colorFor,
    parseWeeks: parseWeeks, formatWeeks: formatWeeks,
    add: add, addMany: addMany, update: update, remove: remove,
    clear: clear, replaceAll: replaceAll, stat: stat, uid: uid,
    mondayOf: mondayOf
  };
})(window);

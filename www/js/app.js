/* app.js —— 主控制：课表渲染、导入流程、设置 */
(function () {
  'use strict';

  var S = window.Store;
  var $ = function (id) { return document.getElementById(id); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };

  var state = { week: 1, engine: 'llm', pending: [], imgDataUrl: null, jwCtx: null, editingId: null };

  /* ---------------- 工具 ---------------- */
  var toastTimer;
  function toast(msg) {
    var t = $('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('show'); }, 2400);
  }

  function log(el, msg) {
    el.classList.add('show');
    el.textContent += (el.textContent ? '\n' : '') + msg;
    el.scrollTop = el.scrollHeight;
  }
  function clearLog(el) { el.textContent = ''; el.classList.remove('show'); }

  function openSheet(id) { $(id).classList.add('open'); }
  function closeSheet(id) {
    if (id) $(id).classList.remove('open');
    else $$('.sheet').forEach(function (s) { s.classList.remove('open'); });
  }

  function goto(pageId) {
    $$('.page').forEach(function (p) { p.classList.toggle('active', p.id === pageId); });
    $$('.tab').forEach(function (b) { b.classList.toggle('active', b.dataset.goto === pageId); });
    if (pageId === 'page-schedule') render();
    if (pageId === 'page-settings') loadSettingsUI();
  }

  /* ---------------- 周次计算 ---------------- */
  function weekStartDate(w) {
    var s = new Date(S.settings().startDate + 'T00:00:00');
    if (isNaN(s)) s = S.mondayOf(new Date());
    s.setDate(s.getDate() + (w - 1) * 7);
    return s;
  }

  function autoCurrentWeek() {
    var s = new Date(S.settings().startDate + 'T00:00:00');
    if (isNaN(s)) return 1;
    var now = new Date();
    now.setHours(0, 0, 0, 0);
    var diff = Math.floor((now - s) / 86400000);
    return Math.min(S.settings().totalWeeks, Math.max(1, Math.floor(diff / 7) + 1));
  }

  /* ---------------- 课表渲染 ---------------- */
  function render() {
    var st = S.settings();
    var total = st.totalWeeks || 20;
    if (state.week < 1) state.week = 1;
    if (state.week > total) state.week = total;

    var days = st.showWeekend ? 7 : 5;
    $('weekLabel').textContent = '第 ' + state.week + ' 周';
    $('weekSub').textContent = (state.week === autoCurrentWeek() ? '本周 · ' : '') + '共 ' + total + ' 周';

    var ws = weekStartDate(state.week);
    $('monthLabel').textContent = (ws.getMonth() + 1) + '月';
    var todayStr = new Date().toDateString();
    $$('.grid-head .dow').forEach(function (el) {
      var d = +el.dataset.dow;
      var dt = new Date(ws.getTime());
      dt.setDate(dt.getDate() + (d - 1));
      el.querySelector('i').textContent = dt.getDate();
      el.classList.toggle('today', dt.toDateString() === todayStr);
      el.style.display = d <= days ? '' : 'none';
    });

    var body = $('gridBody');
    body.style.setProperty('--cols', days);
    $$('.grid-head').forEach(function (h) { h.style.setProperty('--cols', days); });
    document.documentElement.style.setProperty('--cols', days);

    body.innerHTML = '';
    var frag = document.createDocumentFragment();

    var periods = st.periods || 12;
    for (var p = 1; p <= periods; p++) {
      var pt = document.createElement('div');
      pt.className = 'pt';
      pt.textContent = p;
      pt.style.gridColumn = '1';
      pt.style.gridRow = p;
      frag.appendChild(pt);

      for (var d2 = 1; d2 <= days; d2++) {
        var cell = document.createElement('div');
        cell.className = 'cell tap' + (d2 > 5 ? ' weekend' : '');
        cell.style.gridColumn = String(d2 + 1);
        cell.style.gridRow = String(p);
        cell.dataset.day = d2;
        cell.dataset.period = p;
        frag.appendChild(cell);
      }
    }

    var list = S.courses().filter(function (c) {
      return c.weeks.length === 0 || c.weeks.indexOf(state.week) >= 0;
    });

    list.forEach(function (c) {
      if (c.day > days) return;
      var el = document.createElement('div');
      el.className = 'course';
      el.style.background = c.color || S.colorFor(c.name);
      el.style.gridColumn = String(c.day + 1);
      el.style.gridRow = c.start + ' / span ' + Math.max(1, c.end - c.start + 1);
      el.innerHTML = '<b></b><span></span><span></span>';
      el.querySelector('b').textContent = c.name;
      var sp = el.querySelectorAll('span');
      sp[0].textContent = c.place || '';
      sp[1].textContent = c.teacher || '';
      el.dataset.id = c.id;
      frag.appendChild(el);
    });

    body.appendChild(frag);
    $('emptyHint').style.display = list.length ? 'none' : 'block';
  }

  /* ---------------- 课程详情 / 编辑 ---------------- */
  function showDetail(id) {
    var c = S.courses().filter(function (x) { return x.id === id; })[0];
    if (!c) return;
    state.editingId = id;
    $('dName').textContent = c.name;
    $('dMeta').innerHTML =
      '教师：' + (c.teacher || '—') + '<br>' +
      '地点：' + (c.place || '—') + '<br>' +
      '时间：周' + '一二三四五六日'.charAt(c.day - 1) + ' 第 ' + c.start + '-' + c.end + ' 节<br>' +
      '周次：' + (S.formatWeeks(c.weeks) || '全部');
    openSheet('sheet-detail');
  }

  function openManual(day, period, id) {
    var c = id ? S.courses().filter(function (x) { return x.id === id; })[0] : null;
    state.editingId = id || null;
    $('manualTitle').textContent = c ? '编辑课程' : '添加课程';
    $('mName').value = c ? c.name : '';
    $('mTeacher').value = c ? c.teacher : '';
    $('mPlace').value = c ? c.place : '';
    $('mDay').value = c ? c.day : (day || 1);
    $('mStart').value = c ? c.start : (period || 1);
    $('mEnd').value = c ? c.end : (period || 1);
    $('mWeeks').value = c ? S.formatWeeks(c.weeks) : ('1-' + (S.settings().totalWeeks || 20));
    $('mDelete').hidden = !c;
    closeSheet('sheet-detail');
    openSheet('sheet-manual');
  }

  /* ---------------- 待确认列表 ---------------- */
  function showConfirm(courses, title) {
    state.pending = courses.map(function (c) {
      return {
        checked: true,
        name: c.name, teacher: c.teacher || '', place: c.place || '',
        day: c.day, start: c.start, end: c.end,
        weeks: c.weeks && c.weeks.length ? c.weeks : [1]
      };
    });
    $('cfTitle').textContent = (title || '确认课程') + '（' + state.pending.length + ' 门）';
    renderConfirm();
    openSheet('sheet-confirm');
  }

  function renderConfirm() {
    var box = $('cfList');
    box.innerHTML = '';
    var dowTxt = '一二三四五六日';
    state.pending.forEach(function (c, i) {
      var el = document.createElement('div');
      el.className = 'cf-item';

      var cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = c.checked;
      cb.onchange = function () { c.checked = cb.checked; };
      el.appendChild(cb);

      var main = document.createElement('div');
      main.className = 'cf-main';
      var b = document.createElement('b');
      b.textContent = c.name;
      main.appendChild(b);

      var badge = document.createElement('span');
      badge.className = 'cf-badge';
      badge.textContent = '周' + dowTxt.charAt(c.day - 1) + ' ' + c.start + '-' + c.end + '节';
      main.appendChild(badge);

      var p = document.createElement('p');
      p.textContent = [c.teacher, c.place, S.formatWeeks(c.weeks) + '周'].filter(Boolean).join(' · ');
      main.appendChild(p);

      ['teacher', 'place'].forEach(function (k) {
        var inp = document.createElement('input');
        inp.className = 'editable';
        inp.value = c[k] || '';
        inp.placeholder = k === 'teacher' ? '教师（可改）' : '地点（可改）';
        inp.oninput = function () { c[k] = inp.value; };
        main.appendChild(inp);
      });

      var wp = document.createElement('input');
      wp.className = 'editable';
      wp.value = S.formatWeeks(c.weeks);
      wp.placeholder = '周次，如 1-16';
      wp.oninput = function () { c.weeks = S.parseWeeks(wp.value, S.settings().totalWeeks); };
      main.appendChild(wp);

      el.appendChild(main);
      box.appendChild(el);
    });
  }

  function commitPending(replace) {
    var picked = state.pending.filter(function (c) { return c.checked && c.name; });
    if (!picked.length) { toast('没有勾选任何课程'); return; }
    if (replace) S.replaceAll(picked);
    else S.addMany(picked);
    closeSheet('sheet-confirm');
    goto('page-schedule');
    toast(replace ? ('已替换课表，共 ' + picked.length + ' 门') : ('已添加 ' + picked.length + ' 门课程'));
  }

  /* ---------------- 教务导入 ---------------- */

  // 验证码区状态：空 / 有图 / 出错
  function setCap(state) {
    var box = $('capBox'), tip = $('capTip');
    box.classList.remove('has', 'err');
    if (state === 'has') box.classList.add('has');
    if (state === 'err') {
      box.classList.add('err');
      tip.textContent = '取图失败';
    }
    if (state === 'empty') tip.innerHTML = '点下方<br>① 取图';
  }

  function jwReset() {
    state.jwCtx = null;
    $('jwCaptcha').src = '';
    $('jwCapRow').style.display = '';
    setCap('empty');
  }

  function jwPrepare() {
    var baseRaw = $('jwBase').value.trim() || S.settings().jw.base;
    var variant = $('jwVariant').value;
    clearLog($('jwLog'));
    if (!baseRaw) { toast('请先填写教务地址'); return; }
    $('jwWarn').classList.remove('show');
    var btn = $('jwGetCode');
    btn.disabled = true; btn.textContent = '正在连接…';
    setCap('empty');

    S.settings().jw.base = JwImport.normalizeBase(baseRaw);
    S.settings().jw.variant = variant;
    S.save();

    JwImport.prepare(baseRaw, variant, function (m) { log($('jwLog'), m); })
      .then(function (ctx) {
        state.jwCtx = ctx;
        state.jwCtx.variant = variant;
        btn.disabled = false;
        $('jwCode').value = '';
        if (ctx.needCode) {
          $('jwCapRow').style.display = '';
          $('jwCaptcha').src = ctx.captcha;
          setCap('has');
          btn.textContent = '① 重新取图';
          $('jwCode').focus();
          toast('验证码已出现，照图填进左侧输入框');
        } else {
          $('jwCapRow').style.display = 'none';
          btn.textContent = '① 重新检测';
          toast('该校无需验证码，直接填学号密码后点 ② 登录');
        }
      })
      .catch(function (e) {
        btn.disabled = false; btn.textContent = '① 获取验证码';
        setCap('err');
        $('jwWarn').textContent = '取验证码失败：' + e.message +
          '\n常见原因：不在校园网 / 需要 VPN、教务地址填写不对、或当前是浏览器预览（跨域被拦）。' +
          '\n抓不到时请改用「图片识别」或「文件导入」。';
        $('jwWarn').classList.add('show');
        log($('jwLog'), '✘ ' + e.message);
      });
  }

  function jwRun() {
    if (!state.jwCtx) { toast('请先点「① 获取验证码」，拿到图后再登录'); return; }
    var user = $('jwUser').value.trim();
    var pass = $('jwPass').value;
    var code = $('jwCode').value.trim();
    if (!user || !pass) { toast('请填写学号和密码'); return; }
    if (state.jwCtx.needCode !== false && !code) {
      toast('请把图片里的验证码填进输入框'); $('jwCode').focus(); return;
    }
    var btn = $('jwLogin');
    btn.disabled = true; btn.textContent = '抓取中…';

    var st = S.settings();
    st.jw.user = user;
    st.jw.xnm = $('jwXnm').value.trim();
    st.jw.xqm = $('jwXqm').value;
    S.save();

    JwImport.run(state.jwCtx, {
      user: user, pass: pass, code: code,
      xnm: $('jwXnm').value.trim(), xqm: $('jwXqm').value,
      rsaMode: 'pkcs1',
      totalWeeks: st.totalWeeks || 20,
      log: function (m) { log($('jwLog'), m); }
    }).then(function (r) {
      btn.disabled = false; btn.textContent = '② 登录并抓取';
      jwReset();
      showConfirm(r.courses, '教务导入');
    }).catch(function (e) {
      btn.disabled = false; btn.textContent = '② 登录并抓取';
      // 登录被拒提示验证码：说明该校其实要验证码，只是初次探测没命中
      if (/验证码|yzm|chk|captcha/i.test(e.message)) {
        $('jwWarn').textContent = '该校登录需要验证码（初次自动探测未命中，现已重新取图）。\n请看图填写后再点「② 登录并抓取」。';
        $('jwWarn').classList.add('show');
        log($('jwLog'), '✘ ' + e.message + ' → 自动重新探测验证码');
        jwReset();
        jwPrepare();
        return;
      }
      $('jwWarn').textContent = '抓取失败：' + e.message +
        '\n如果提示验证码错误，点「① 获取验证码」换一张重填再试。';
      $('jwWarn').classList.add('show');
      jwReset();
      log($('jwLog'), '✘ ' + e.message);
    });
  }

  /* ---------------- 图片导入 ---------------- */
  function onPickImage(file) {
    if (!file) return;
    Bridge.readFileAsDataURL(file).then(function (r) {
      state.imgDataUrl = r.dataUrl;
      $('imgPreview').innerHTML = '';
      var im = document.createElement('img');
      im.src = r.dataUrl;
      $('imgPreview').appendChild(im);
      $('ocrProgress').classList.remove('show');
      clearLog($('ocrRaw'));
    });
  }

  function runImageImport() {
    if (!state.imgDataUrl) { toast('请先选择或拍摄图片'); return; }
    var st = S.settings();
    var prog = $('ocrProgress'), bar = $('ocrBar'), msg = $('ocrMsg');
    prog.classList.add('show');
    bar.style.width = '0%'; msg.textContent = '准备中…';
    var btn = $('btnRunOcr');
    btn.disabled = true;

    function onP(m, p) {
      msg.textContent = m;
      if (p != null) bar.style.width = Math.round(p * 100) + '%';
    }

    var job = state.engine === 'llm'
      ? OcrImport.runLlm(state.imgDataUrl, st.api, onP, st.totalWeeks)
      : OcrImport.runOcr(state.imgDataUrl, onP, st.totalWeeks);

    job.then(function (r) {
      btn.disabled = false;
      bar.style.width = '100%';
      msg.textContent = '识别完成，共 ' + r.courses.length + ' 条';
      clearLog($('ocrRaw'));
      log($('ocrRaw'), r.raw || '(无文本输出)');
      if (!r.courses.length) { toast('没识别出课程，可换「AI 识别」试试'); return; }
      showConfirm(r.courses, '图片识别');
    }).catch(function (e) {
      btn.disabled = false;
      prog.classList.remove('show');
      toast(e.message);
      clearLog($('ocrRaw'));
      log($('ocrRaw'), '✘ ' + e.message);
    });
  }

  /* ---------------- 文件导入 ---------------- */
  function runFileImport(file, text) {
    clearLog($('fileLog'));
    var job = file
      ? FileImport.parseFile(file, S.settings().totalWeeks)
      : FileImport.parseText(text, S.settings().totalWeeks);
    job.then(function (r) {
      log($('fileLog'), '解析出 ' + r.courses.length + ' 条记录');
      showConfirm(r.courses, '文件导入');
    }).catch(function (e) {
      log($('fileLog'), '✘ ' + e.message);
      toast(e.message);
    });
  }

  /* ---------------- 设置 ---------------- */
  function loadSettingsUI() {
    var st = S.settings();
    $('setTotalWeeks').value = st.totalWeeks;
    $('setStartDate').value = st.startDate;
    $('setCurrentWeek').value = autoCurrentWeek();
    $('setShowWeekend').checked = !!st.showWeekend;
    $('setPeriods').value = st.periods;
    $('setApiBase').value = st.api.base || '';
    $('setApiModel').value = st.api.model || '';
    $('setApiKey').value = st.api.key || '';
    $('jwBase').value = st.jw.base || '';
    $('jwVariant').value = st.jw.variant || 'jwglxt';
    $('jwUser').value = st.jw.user || '';
    $('jwXnm').value = st.jw.xnm || '';
    $('jwXqm').value = st.jw.xqm || '3';
    var s = S.stat();
    $('dataStat').textContent = '当前共 ' + s.count + ' 门课程，占用 ' + s.slots + ' 个节次。';
  }

  function bindSettings() {
    function bindNum(id, key) {
      $(id).addEventListener('change', function () {
        var v = parseInt($(id).value, 10);
        if (isNaN(v)) return;
        S.settings()[key] = v; S.save(); render();
      });
    }
    bindNum('setTotalWeeks', 'totalWeeks');
    bindNum('setCurrentWeek', 'currentWeek');
    bindNum('setPeriods', 'periods');

    $('setStartDate').addEventListener('change', function () {
      S.settings().startDate = $('setStartDate').value; S.save();
      state.week = autoCurrentWeek(); render();
    });
    $('setShowWeekend').addEventListener('change', function () {
      S.settings().showWeekend = $('setShowWeekend').checked; S.save(); render();
    });
    ['setApiBase', 'setApiModel', 'setApiKey'].forEach(function (id) {
      $(id).addEventListener('change', function () {
        var st = S.settings();
        st.api = {
          base: $('setApiBase').value.trim(),
          model: $('setApiModel').value.trim(),
          key: $('setApiKey').value.trim()
        };
        S.save();
      });
    });

    $('btnClear').addEventListener('click', function () {
      if (!confirm('确定清空所有课程？此操作不可撤销。')) return;
      S.clear(); render(); toast('已清空');
    });

    $('btnExport').addEventListener('click', function () {
      var blob = new Blob([JSON.stringify(S.load(), null, 2)], { type: 'application/json' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'coursetable-' + new Date().toISOString().slice(0, 10) + '.json';
      a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
      toast('已导出 JSON');
    });

    $('btnImportJson').addEventListener('click', function () {
      var inp = document.createElement('input');
      inp.type = 'file'; inp.accept = 'application/json,.json';
      inp.onchange = function () {
        var f = inp.files[0]; if (!f) return;
        Bridge.readFileAsText(f).then(function (t) {
          var d = JSON.parse(t);
          if (!d || !Array.isArray(d.courses)) throw new Error('不是有效的课表文件');
          if (d.settings) { for (var k in d.settings) S.settings()[k] = d.settings[k]; }
          S.replaceAll(d.courses);
          loadSettingsUI(); render();
          toast('已导入 ' + d.courses.length + ' 门课程');
        }).catch(function (e) { toast('导入失败：' + e.message); });
      };
      inp.click();
    });
  }

  /* ---------------- 事件绑定 ---------------- */
  function bind() {
    // 底部导航 & 页面跳转
    document.addEventListener('click', function (e) {
      var g = e.target.closest('[data-goto]');
      if (g) { goto(g.dataset.goto); return; }
      var c = e.target.closest('[data-close]');
      if (c) { closeSheet(); return; }
      var o = e.target.closest('[data-open]');
      if (o) { openSheet('sheet-' + o.dataset.open); return; }
    });

    // 周次
    $('btnPrevWeek').addEventListener('click', function () { state.week--; render(); });
    $('btnNextWeek').addEventListener('click', function () { state.week++; render(); });
    $('btnToday').addEventListener('click', function () { state.week = autoCurrentWeek(); render(); });
    $('btnPickWeek').addEventListener('click', pickWeek);

    // 网格交互
    $('gridBody').addEventListener('click', function (e) {
      var course = e.target.closest('.course');
      if (course) { showDetail(course.dataset.id); return; }
      var cell = e.target.closest('.cell');
      if (cell) openManual(+cell.dataset.day, +cell.dataset.period);
    });

    // 手动表单
    $('mSave').addEventListener('click', function () {
      var name = $('mName').value.trim();
      if (!name) { toast('请填写课程名'); return; }
      var patch = {
        name: name,
        teacher: $('mTeacher').value.trim(),
        place: $('mPlace').value.trim(),
        day: +$('mDay').value,
        start: +$('mStart').value,
        end: Math.max(+$('mStart').value, +$('mEnd').value),
        weeks: S.parseWeeks($('mWeeks').value, S.settings().totalWeeks)
      };
      if (state.editingId) S.update(state.editingId, patch);
      else S.add(patch);
      closeSheet('sheet-manual');
      render();
      toast('已保存');
    });
    $('mDelete').addEventListener('click', function () {
      if (!state.editingId) return;
      S.remove(state.editingId);
      state.editingId = null;
      closeSheet('sheet-manual');
      render();
      toast('已删除');
    });
    $('dEdit').addEventListener('click', function () { openManual(null, null, state.editingId); });
    $('dDel').addEventListener('click', function () {
      if (!state.editingId) return;
      S.remove(state.editingId);
      state.editingId = null;
      closeSheet('sheet-detail');
      render();
      toast('已删除');
    });

    // 教务：① 取验证码 → ② 登录抓取
    $('jwGetCode').addEventListener('click', jwPrepare);
    $('jwLogin').addEventListener('click', jwRun);
    $('jwRefreshCode').addEventListener('click', function () { jwReset(); jwPrepare(); });
    $('jwVariant').addEventListener('change', jwReset);
    $('jwBase').addEventListener('change', jwReset);
    $('jwCaptcha').addEventListener('error', function () {
      // 图片加载不出来：多数是跨域被拦或取到的是空图
      if (this.getAttribute('src')) setCap('err');
    });
    // 网页预览环境下提前说明跨域限制
    if (!Bridge.isNative()) $('jwWebHint').classList.add('show');

    // 图片
    $('btnPickImg').addEventListener('click', function () { $('fileImg').click(); });
    $('btnTakeImg').addEventListener('click', function () { $('fileImgCam').click(); });
    $('fileImg').addEventListener('change', function () { onPickImage(this.files[0]); });
    $('fileImgCam').addEventListener('change', function () { onPickImage(this.files[0]); });
    $$('#ocrEngine .seg-i').forEach(function (b) {
      b.addEventListener('click', function () {
        $$('#ocrEngine .seg-i').forEach(function (x) { x.classList.remove('active'); });
        b.classList.add('active');
        state.engine = b.dataset.engine;
      });
    });
    $('btnRunOcr').addEventListener('click', runImageImport);

    // 文件
    $('btnPickFile').addEventListener('click', function () { $('fileDoc').click(); });
    $('fileDoc').addEventListener('change', function () {
      var f = this.files[0]; if (!f) return;
      log($('fileLog'), '已选择：' + f.name);
      runFileImport(f, null);
    });
    $('btnParseFile').addEventListener('click', function () {
      var t = $('pasteHtml').value;
      if (!t.trim()) { toast('请先粘贴内容或选择文件'); return; }
      runFileImport(null, t);
    });

    // 确认列表
    $('cfSaveAll').addEventListener('click', function () { commitPending(false); });
    $('cfReplace').addEventListener('click', function () {
      if (!confirm('替换会删除现有全部课程，确定继续？')) return;
      commitPending(true);
    });
  }

  /* 周次快速跳转 */
  function pickWeek() {
    var box = document.createElement('div');
    box.className = 'sheet open';
    box.innerHTML =
      '<div class="sheet-mask" data-close></div>' +
      '<div class="sheet-panel short"><div class="sheet-b">' +
      '<h3 style="margin-bottom:10px">跳到第几周</h3>' +
      '<div class="week-grid"></div></div></div>';
    var total = S.settings().totalWeeks || 20;
    var g = box.querySelector('.week-grid');
    g.style.cssText = 'display:grid;grid-template-columns:repeat(5,1fr);gap:8px';
    for (var i = 1; i <= total; i++) {
      var b = document.createElement('button');
      b.className = 'btn' + (i === state.week ? ' primary' : '');
      b.textContent = i;
      b.onclick = (function (n) {
        return function () {
          state.week = n; render(); box.remove();
        };
      })(i);
      g.appendChild(b);
    }
    box.addEventListener('click', function (e) {
      if (e.target === box || e.target.classList.contains('sheet-mask')) box.remove();
    });
    document.body.appendChild(box);
  }

  /* Android 返回键关闭弹层 */
  function bindBack() {
    var App = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.App;
    if (!App || !App.addListener) return;
    App.addListener('backButton', function () {
      var open = document.querySelector('.sheet.open');
      if (open) closeSheet();
      else if (App.exitApp) App.exitApp();
    });
  }

  /* ---------------- 启动 ---------------- */
  function init() {
    S.load();
    state.week = S.settings().currentWeek || autoCurrentWeek();
    S.settings().currentWeek = state.week;
    S.save();

    bind();
    bindSettings();
    bindBack();
    render();

    // 首次使用时，浏览器环境给出能力提醒
    if (!Bridge.isNative()) {
      var w = $('jwWarn');
      w.textContent = '当前运行在浏览器中。受浏览器的跨域（CORS）策略限制，「教务系统直连」需要打包成 APK 后才能正常登录抓取；在浏览器里请优先使用「图片识别」或「文件导入」。';
      w.classList.add('show');
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();

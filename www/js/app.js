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

  function addDays(d, n) {
    var x = new Date(d.getTime());
    x.setDate(x.getDate() + n);
    return x;
  }

  /* 日期显示：本周标题下面写完整日期「2026/10/11」，其他周写范围「10/5 – 10/11」 */
  function fmtDate(d, withYear) {
    var m = d.getMonth() + 1, day = d.getDate();
    return (withYear ? d.getFullYear() + '/' : '') + m + '/' + day;
  }

  /* 同一天的课按「重叠簇」分列：两门课节次撞车时并排显示，而不是互相盖住。
     每门课被标注一个 _lane（第几列），每个簇记录总列数 lanes。 */
  function layoutDay(list) {
    var cs = list.slice().sort(function (a, b) {
      return a.start - b.start || a.end - b.end;
    });
    var groups = [], cur = null, curEnd = 0, lanes = [];
    cs.forEach(function (c) {
      if (!cur || c.start >= curEnd) {          // 与当前簇不重叠 → 另起一簇
        cur = { lanes: 0, list: [] };
        groups.push(cur);
        lanes = [];
        curEnd = c.end;
      } else if (c.end > curEnd) {
        curEnd = c.end;
      }
      var li = 0;
      while (li < lanes.length && lanes[li] >= c.start) li++;   // 找一条不冲突的列
      lanes[li] = c.end;
      c._lane = li;
      if (lanes.length > cur.lanes) cur.lanes = lanes.length;
      cur.list.push(c);
    });
    return groups;
  }

  /* ---------------- 课表渲染 ---------------- */
  function render() {
    var st = S.settings();
    var total = st.totalWeeks || 20;
    if (state.week < 1) state.week = 1;
    if (state.week > total) state.week = total;

    var days = st.showWeekend ? 7 : 5;
    var ws = weekStartDate(state.week);
    var isThisWeek = state.week === autoCurrentWeek();

    var today = new Date();
    today.setHours(0, 0, 0, 0);
    $('weekLabel').textContent = '第 ' + state.week + ' 周' +
      (isThisWeek ? ' 周' + DAY_CN_FULL[today.getDay()] : '');
    // 副标题：本周显示今天，其他周显示这一周的日期范围；后面缀上单/双周
    $('weekSub').textContent = (isThisWeek
      ? fmtDate(today, true)
      : fmtDate(ws) + ' – ' + fmtDate(addDays(ws, days - 1))) +
      ' · ' + (state.week % 2 ? '单周' : '双周');

    $('monthLabel').textContent = String(ws.getMonth() + 1);   // 只放数字，「月」字在 HTML 里

    // 「回到本周」只在不在当前周时出现——当前周点了也没意义，还挡课卡
    $('btnToday').hidden = isThisWeek;

    var todayStr = new Date().toDateString();
    $$('.grid-head .dow').forEach(function (el) {
      var d = +el.dataset.dow;
      var dt = addDays(ws, d - 1);
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
      var tm = S.periodTime(p);
      var pt = document.createElement('div');
      pt.className = 'pt';
      pt.style.gridColumn = '1';
      pt.style.gridRow = String(p);
      pt.innerHTML = '<b></b><span></span><span class="e"></span>';
      pt.querySelector('b').textContent = p;
      var ts = pt.querySelectorAll('span');
      ts[0].textContent = tm.start;
      ts[1].textContent = tm.end;
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

    var all = S.courses().filter(function (c) { return c.day <= days; });
    for (var d3 = 1; d3 <= days; d3++) {
      var dayList = all.filter(function (c) { return c.day === d3; });
      if (!dayList.length) continue;
      layoutDay(dayList).forEach(function (grp) {
        grp.list.forEach(function (c) { frag.appendChild(courseEl(c, grp.lanes, total)); });
      });
    }

    body.appendChild(frag);
    $('emptyHint').style.display = S.courses().length ? 'none' : 'block';
  }

  /* 一门课的一张卡片。lanes = 同簇总列数，c._lane = 自己占第几列。 */
  function courseEl(c, lanes, total) {
    var inWeek = !c.weeks.length || c.weeks.indexOf(state.week) >= 0;

    var el = document.createElement('div');
    el.className = 'course' + (inWeek ? '' : ' off');
    // 结束线必须写死成 span 1：只给起始线时，绝对/相对定位的包含块会被当成「起始列→最后一列」，
    // 卡片就会横铺整行、互相覆盖。写上 span 1 后，卡片严格只占自己那一列。
    el.style.gridColumn = (c.day + 1) + ' / span 1';
    el.style.gridRow = c.start + ' / span ' + Math.max(1, c.end - c.start + 1);
    var lane = c._lane || 0;
    // left/width 的百分比相对「自己的网格区域（一列）」算，正好把同簇课程并排分列
    el.style.left = (lane / lanes * 100) + '%';
    el.style.width = (100 / lanes) + '%';
    el.dataset.id = c.id;

    var cb = document.createElement('div');
    cb.className = 'cb';
    cb.style.background = c.color || S.colorFor(c.name);

    var b = document.createElement('b');
    b.textContent = c.name;
    cb.appendChild(b);

    if (c.place) {
      var pl = document.createElement('span');
      pl.className = 'pl';
      pl.textContent = '@' + c.place;
      cb.appendChild(pl);
    }

    var tag = '';
    if (!inWeek) {
      tag = '非本周';                       // 本周不上 → 整卡淡化
    } else {
      var par = S.courseParity(c, total);   // 显式单双周标记优先
      if (par) tag = par === 1 ? '单周' : '双周';
    }
    if (tag) {
      var wk = document.createElement('i');
      wk.className = 'wk';
      wk.textContent = tag;
      cb.appendChild(wk);
    }

    el.appendChild(cb);
    return el;
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
      '周次：' + (S.formatWeeks(c.weeks, S.settings().totalWeeks, c.parity) || '全部');
    openSheet('sheet-detail');
  }

  /* ---------------- 手动添加：点选控件 ---------------- */
  var DAY_CN = ['一', '二', '三', '四', '五', '六', '日'];
  var DAY_CN_FULL = ['日', '一', '二', '三', '四', '五', '六'];   // 索引 = getDay()

  function buildManualPicks() {
    var dp = $('mDayPick');
    if (dp && !dp.childElementCount) {
      DAY_CN.forEach(function (s, i) {
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'pk';
        b.dataset.day = String(i + 1);
        b.textContent = '周' + s;
        dp.appendChild(b);
      });
    }
    var pp = $('mPeriodPick');
    if (pp && !pp.childElementCount) {
      for (var p = 1; p <= 16; p++) {
        var b2 = document.createElement('button');
        b2.type = 'button';
        b2.className = 'pk';
        b2.dataset.period = String(p);
        b2.textContent = String(p);
        pp.appendChild(b2);
      }
    }
  }

  function syncManualPicks() {
    var day = +$('mDay').value || 1;
    var s = +$('mStart').value || 1;
    var e = +$('mEnd').value || s;
    var lo = Math.min(s, e), hi = Math.max(s, e);

    Array.prototype.forEach.call($('mDayPick').children, function (b) {
      b.classList.toggle('active', +b.dataset.day === day);
    });
    Array.prototype.forEach.call($('mPeriodPick').children, function (b) {
      var p = +b.dataset.period;
      b.classList.toggle('active', p === lo || p === hi);
      b.classList.toggle('span', p > lo && p < hi);
    });
    $('mDayHint').textContent = '周' + DAY_CN[day - 1];
    $('mPeriodHint').textContent = (lo === hi) ? ('第 ' + lo + ' 节') : ('第 ' + lo + '-' + hi + ' 节');
  }

  function syncWeekPick() {
    var v = $('mWeeks').value.trim();
    var total = S.settings().totalWeeks || 20;
    Array.prototype.forEach.call($('mWeekPick').children, function (b) {
      var want = b.dataset.weeks === 'full' ? ('1-' + total) : b.dataset.weeks;
      b.classList.toggle('active', v === want);
    });
  }

  /* 点格子选节次，用 anchor 记录起点：
     第一次点 → 该格即单节；再点另一格 → 扩成两格之间的区间；
     区间形成后 anchor 清空，下一次点击重新从单节开始。 */
  function onPeriodClick(p) {
    var mp = state.mpick || (state.mpick = { anchor: null });
    if (mp.anchor == null || mp.anchor === p) {
      $('mStart').value = p;
      $('mEnd').value = p;
      mp.anchor = p;
    } else {
      $('mStart').value = Math.min(mp.anchor, p);
      $('mEnd').value = Math.max(mp.anchor, p);
      mp.anchor = null;
    }
    syncManualPicks();
  }

  function saveManual(keepOpen) {
    var name = $('mName').value.trim();
    if (!name) { toast('请填写课程名'); $('mName').focus(); return false; }
    var total = S.settings().totalWeeks || 20;
    var weeksText = $('mWeeks').value;
    var weeks = S.parseWeeks(weeksText, total);
    if (!weeks.length) weeks = S.parseWeeks('1-' + total, total);
    var s = +$('mStart').value || 1;
    var patch = {
      name: name,
      teacher: $('mTeacher').value.trim(),
      place: $('mPlace').value.trim(),
      day: +$('mDay').value || 1,
      start: s,
      end: Math.max(s, +$('mEnd').value || s),
      weeks: weeks,
      // 用户在周次里写了「单周 / 双周」（或点了对应快捷键）就记住，
      // 否则 normalize 只看到数组，会把单双周标记丢掉
      parity: /单\s*周/.test(weeksText) ? 1 : (/双\s*周/.test(weeksText) ? 2 : 0)
    };
    if (state.editingId) S.update(state.editingId, patch);
    else S.add(patch);
    render();

    if (keepOpen) {
      state.editingId = null;
      $('manualTitle').textContent = '添加课程';
      $('mName').value = '';
      $('mTeacher').value = '';
      $('mPlace').value = '';
      $('mDelete').hidden = true;
      $('mName').focus();
      toast('已保存，继续加下一门');
    } else {
      closeSheet('sheet-manual');
      toast('已保存');
    }
    return true;
  }

  function openManual(day, period, id) {
    var c = id ? S.courses().filter(function (x) { return x.id === id; })[0] : null;
    state.editingId = id || null;
    buildManualPicks();
    $('manualTitle').textContent = c ? '编辑课程' : '添加课程';
    $('mName').value = c ? c.name : '';
    $('mTeacher').value = c ? c.teacher : '';
    $('mPlace').value = c ? c.place : '';
    $('mDay').value = c ? c.day : (day || 1);
    $('mStart').value = c ? c.start : (period || 1);
    $('mEnd').value = c ? c.end : (period || 1);
    $('mWeeks').value = c ? S.formatWeeks(c.weeks, S.settings().totalWeeks, c.parity) : ('1-' + (S.settings().totalWeeks || 20));
    $('mDelete').hidden = !c;
    $('mSaveNext').hidden = !!c;
    state.mpick = { anchor: null };
    syncManualPicks();
    syncWeekPick();
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
        weeks: c.weeks && c.weeks.length ? c.weeks : [1],
        // 单双周标记必须一起带过去，否则确认页和手改周次后角标会丢
        parity: c.parity || 0
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

      var wt = S.formatWeeks(c.weeks, S.settings().totalWeeks, c.parity);
      if (wt && !/周$/.test(wt)) wt += '周';   // 「单周」「双周」本身已带周字，别再加
      var p = document.createElement('p');
      p.textContent = [c.teacher, c.place, wt].filter(Boolean).join(' · ');
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
      wp.value = S.formatWeeks(c.weeks, S.settings().totalWeeks, c.parity);
      wp.placeholder = '周次，如 1-16 或 单周 / 双周';
      wp.oninput = function () {
        c.weeks = S.parseWeeks(wp.value, S.settings().totalWeeks);
        // 手改了周次串，单双周标记要跟着改，否则角标会和周次对不上
        c.parity = S.weekParity(c.weeks, S.settings().totalWeeks) ||
          (/单\s*周/.test(wp.value) ? 1 : (/双\s*周/.test(wp.value) ? 2 : 0));
      };
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

  // 把「要不要验证码」「连错几次锁多久」这类页面自述信息讲给用户
  function jwNotes(ctx) {
    var el = $('jwNote');
    var lines = [];
    if (ctx && ctx.maxFail && ctx.lockMin) {
      lines.push('⚠ 本校连错 ' + ctx.maxFail + ' 次会锁定 ' + ctx.lockMin +
        ' 分钟，App 不会自动重试，请核对好学号密码再点登录。');
    }
    if (ctx && ctx.captchaForced === false && !ctx.needCode) {
      lines.push('✔ 本校登录默认不需要验证码，填好学号密码直接点 ② 就行。');
    }
    if (ctx && ctx.pubkey) {
      lines.push('· 密码会先用教务系统的公钥加密再提交（RSA / PKCS#1 v1.5）。');
    }
    if (lines.length) {
      el.innerHTML = lines.map(function (s) {
        return '<div>' + s.replace(/&/g, '&amp;').replace(/</g, '&lt;') + '</div>';
      }).join('');
      el.classList.add('show');
    } else {
      el.classList.remove('show');
    }
  }

  function jwReset() {
    state.jwCtx = null;
    $('jwCaptcha').src = '';
    $('jwCapRow').style.display = '';
    $('jwNote').classList.remove('show');
    setCap('empty');
  }

  function jwPrepare(forceCode) {
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

    JwImport.prepare(baseRaw, variant, function (m) { log($('jwLog'), m); },
      { forceCode: !!forceCode })
      .then(function (ctx) {
        state.jwCtx = ctx;
        state.jwCtx.variant = variant;
        btn.disabled = false;
        $('jwCode').value = '';
        if (ctx.needCode) {
          $('jwCapRow').style.display = '';
          $('jwCaptcha').src = ctx.captcha;
          setCap('has');
          btn.textContent = '① 换一张验证码';
          $('jwCode').focus();
          toast('验证码已出现，照图填进上面输入框，再点 ②');
        } else {
          $('jwCapRow').style.display = 'none';
          btn.textContent = '① 重新连接';
          toast('连接成功，填学号密码后点 ②');
        }
        jwNotes(ctx);
      })
      .catch(function (e) {
        btn.disabled = false; btn.textContent = '① 连接教务系统';
        setCap('err');
        $('jwWarn').textContent = '连接失败：' + e.message +
          '\n常见原因：不在校园网 / 需要 VPN、教务地址填写不对、或当前是浏览器预览（跨域被拦）。' +
          '\n抓不到时请改用「文件 / PDF 导入」或「图片识别」。';
        $('jwWarn').classList.add('show');
        log($('jwLog'), '✘ ' + e.message);
      });
  }

  function jwRun() {
    if (!state.jwCtx) { toast('请先点「① 连接教务系统」'); return; }
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
      // 留空时由 App 自己打开课表页读「当前学年 / 学期」，一般不用填
      xnm: $('jwXnm').value.trim(), xqm: $('jwXnm').value.trim() ? $('jwXqm').value : '',
      rsaMode: 'pkcs1',
      totalWeeks: st.totalWeeks || 20,
      log: function (m) { log($('jwLog'), m); }
    }).then(function (r) {
      btn.disabled = false; btn.textContent = '② 登录并抓取';
      // 把服务器认可的学年/学期回填，下次直接复用
      if (r.term) {
        $('jwXnm').value = r.term.xnm || '';
        $('jwXqm').value = r.term.xqm || '3';
        st.jw.xnm = r.term.xnm || '';
        st.jw.xqm = r.term.xqm || '3';
        S.save();
      }
      jwReset();
      showConfirm(r.courses, '教务导入');
    }).catch(function (e) {
      btn.disabled = false; btn.textContent = '② 登录并抓取';
      var msg = e.message || String(e);

      // 服务器明确要验证码（比如连错几次后）→ 此时才去取图，且只取一次
      if (e.needCode) {
        $('jwWarn').textContent = msg + '\n正在取一张验证码，请照图填写后再点「②」。';
        $('jwWarn').classList.add('show');
        log($('jwLog'), '✘ ' + msg);
        jwPrepare(true);
        return;
      }

      // 密码错 / 被锁定：绝不自动重试，避免把仅有的尝试次数耗光
      if (/密码不正确|锁|901|未登录/.test(msg)) {
        $('jwWarn').textContent = '登录没有成功：' + msg +
          '\n\n已经停下来没有自动重试——很多学校连错几次就会锁定账号。' +
          '\n请核对学号密码。如果实在抓不通，直接用学校的课表截图走「图片识别」，' +
          '或把导出的课表文件走「文件 / PDF 导入」，这两条路更稳。';
        $('jwWarn').classList.add('show');
        log($('jwLog'), '✘ ' + msg);
        return;
      }

      $('jwWarn').textContent = '抓取失败：' + msg +
        '\n可以点「① 连接教务系统」重来一次；反复失败请改用「文件 / PDF 导入」或「图片识别」。';
      $('jwWarn').classList.add('show');
      jwReset();
      log($('jwLog'), '✘ ' + msg);
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

  /* 图片识别：切换引擎时同步下面的说明文字 */
  function syncEngineTip() {
    $('ocrTip').innerHTML = state.engine === 'llm'
      ? 'AI 识别会把图片发给你在「设置」里配置的模型服务（需支持图片输入的模型），更准但需要联网和 API Key。识别不动时，先到「设置 → AI 识别 → 测试连接」看看服务端怎么回。<b>AI 失败会自动改用本地 OCR 兜底</b>，不用你手动切换。'
      : '首次识别要加载中文模型（约 20MB，已随 App 打包，无需联网），大约十几秒；之后同一台手机上再识别会快很多。识别过程随时可以点「取消识别」。';
  }

  function runImageImport() {
    if (!state.imgDataUrl) { toast('请先选择或拍摄图片'); return; }
    var st = S.settings();
    var prog = $('ocrProgress'), bar = $('ocrBar'), msg = $('ocrMsg');
    prog.classList.add('show');
    bar.style.width = '0%'; msg.textContent = '准备中…';
    var btn = $('btnRunOcr'), cancelBtn = $('btnCancelOcr');
    btn.disabled = true;
    cancelBtn.hidden = false;
    $('ocrTip').style.display = 'none';
    var t0 = Date.now();
    var usedFallback = false;

    function onP(m, p) {
      var sec = Math.round((Date.now() - t0) / 1000);
      msg.textContent = m + (sec > 4 ? '（' + sec + ' 秒）' : '');
      if (p != null) bar.style.width = Math.round(p * 100) + '%';
    }

    function finish() {
      btn.disabled = false;
      cancelBtn.hidden = true;
    }

    function firstLine(s) { return String(s).split('\n')[0]; }

    var job;
    if (state.engine === 'llm') {
      // AI 识别失败时，自动改用本地 OCR 再试一次（同一张图）——
      // 这样「图片识别导入」这条功能永远不会是死路。
      job = OcrImport.runLlm(state.imgDataUrl, st.api, onP, st.totalWeeks)
        .catch(function (e) {
          var aiErr = e && e.message ? e.message : String(e);
          usedFallback = true;
          onP('AI 识别失败（原话：' + firstLine(aiErr) + '），已自动改用本地 OCR', null);
          return OcrImport.runOcr(state.imgDataUrl, onP, st.totalWeeks)
            .then(function (r) { r._aiError = aiErr; return r; })
            .catch(function (e2) {
              var ocrErr = e2 && e2.message ? e2.message : String(e2);
              // 两条错误一起展示，用户能一次看全
              throw new Error('AI 识别失败：' + aiErr +
                '\n\n已自动改用本地 OCR，但本地 OCR 也失败：' + ocrErr);
            });
        });
    } else {
      job = OcrImport.runOcr(state.imgDataUrl, onP, st.totalWeeks);
    }

    job.then(function (r) {
      finish();
      bar.style.width = '100%';
      msg.textContent = '识别完成，共 ' + r.courses.length + ' 条' + (usedFallback ? '（本地 OCR 兜底）' : '');
      clearLog($('ocrRaw'));
      if (usedFallback && r._aiError) log($('ocrRaw'), 'AI 识别失败：' + r._aiError + '\n');
      log($('ocrRaw'), r.raw || '(无文本输出)');
      if (!r.courses.length) { toast('没识别出课程，换个方式再试'); return; }
      showConfirm(r.courses, '图片识别');
    }).catch(function (e) {
      finish();
      prog.classList.remove('show');
      $('ocrTip').style.display = '';
      var full = e && e.message ? e.message : String(e);
      toast(full.split('\n')[0]);          // 吐司只放第一行，完整原因在下面的日志里
      clearLog($('ocrRaw'));
      log($('ocrRaw'), '✘ ' + full);
    });
  }

  /* ---------------- 文件导入 ---------------- */
  function runFileImport(file, text) {
    clearLog($('fileLog'));
    var job = file
      ? FileImport.parseFile(file, S.settings().totalWeeks, function (m) { log($('fileLog'), m); })
      : FileImport.parseText(text, S.settings().totalWeeks);
    job.then(function (r) {
      log($('fileLog'), '解析出 ' + r.courses.length + ' 条记录');
      showConfirm(r.courses, '文件导入');
    }).catch(function (e) {
      log($('fileLog'), '✘ ' + e.message);
      toast(e.message);
    });
  }

  /* ---------------- AI 接口连通性测试 ----------------
     图片识别报错时，用户常分不清是自己配置的问题还是服务端的问题。
     这里发一条最小请求，把服务端的原话直接摆出来。 */
  function testApi() {
    var el = $('apiLog');
    clearLog(el);

    var st = S.settings();
    var base = (st.api.base || '').trim();
    var key = (st.api.key || '').trim();
    var model = (st.api.model || '').trim();
    if (!base) {
      log(el, '✘ 请先填写接口地址，例如 https://api.openai.com/v1');
      toast('请先填写接口地址');
      return;
    }

    log(el, '→ ' + OcrImport.chatUrl(base));
    log(el, '→ 模型：' + (model || '(未填，按 gpt-4o-mini 请求)'));
    log(el, '正在请求…');

    OcrImport.testApi({ base: base, key: key, model: model }).then(function (r) {
      log(el, '✔ 连接正常（HTTP ' + r.status + '）');
      log(el, '模型回复：' + String(r.text).slice(0, 200));
      toast('连接正常');
    }).catch(function (e) {
      log(el, '✘ ' + (e && e.message ? e.message : e));
      toast('连接失败，看下面的详情');
    });
  }

  /* 设置页：把服务商预设填进下拉，选中即自动填好「接口地址 + 常用模型名」 */
  function buildApiPresets() {
    var sel = $('setApiPreset');
    if (!sel || sel.dataset.built) return;
    sel.dataset.built = '1';
    var list = OcrImport.PROVIDERS || [];
    list.forEach(function (p) {
      var o = document.createElement('option');
      o.value = p.id;
      o.textContent = p.name + (p.model ? '（' + p.model + '）' : '') + (p.warn ? '（不支持图片）' : '');
      sel.appendChild(o);
    });
    sel.addEventListener('change', function () {
      var p = list.filter(function (x) { return x.id === sel.value; })[0];
      if (!p) return;
      // 选「自定义」= 清空上一家的地址/模型，避免残留；
      // 其余预设：有值才覆盖，空值（自定义那条）就留空。
      $('setApiBase').value = p.base || '';
      $('setApiModel').value = p.model || '';
      var st = S.settings();
      st.api = {
        base: $('setApiBase').value.trim(),
        model: $('setApiModel').value.trim(),
        key: $('setApiKey').value.trim()
      };
      S.save();
      if (p.warn) toast(p.warn);
      else if (p.id === 'custom') toast('请自行填写需支持图片输入的模型');
      else toast('已填入 ' + p.name);
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
    $('setTimes').value = (st.periodTimes && st.periodTimes.length ? st.periodTimes : S.DEFAULT_TIMES).join('\n');
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
    buildApiPresets();
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

    // 作息时间：每行一节，写成 08:00-08:45
    $('setTimes').addEventListener('change', function () {
      var arr = $('setTimes').value.split('\n')
        .map(function (s) { return s.trim(); })
        .filter(Boolean);
      var st = S.settings();
      if (!arr.length) {
        $('setTimes').value = (st.periodTimes || S.DEFAULT_TIMES).join('\n');
        toast('至少要保留一节课的时间');
        return;
      }
      if (arr.length > 24) arr = arr.slice(0, 24);
      st.periodTimes = arr;
      if (arr.length > st.periods) st.periods = arr.length;   // 别让时间轴比节数还长
      S.save();
      $('setPeriods').value = st.periods;
      render();
      toast('作息时间已保存');
    });

    $('btnResetTimes').addEventListener('click', function () {
      var st = S.settings();
      st.periodTimes = S.DEFAULT_TIMES.slice();
      S.save();
      loadSettingsUI();
      render();
      toast('已恢复默认作息');
    });

    $('btnTestApi').addEventListener('click', testApi);

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
      if (o) {
        // 手动添加走 openManual，这样点选控件会被正确初始化并填好默认值
        if (o.dataset.open === 'manual') { openManual(null, null, null); return; }
        openSheet('sheet-' + o.dataset.open);
        return;
      }
    });

    // 课表顶栏
    $('btnPickWeek').addEventListener('click', pickWeek);
    $('btnToday').addEventListener('click', function () {
      state.week = autoCurrentWeek();
      render();
      toast('已回到第 ' + state.week + ' 周');
    });
    $('btnAdd').addEventListener('click', function () { openManual(null, null, null); });
    $('btnImport').addEventListener('click', function () { goto('page-import'); });
    $('btnShare').addEventListener('click', shareSchedule);
    $('btnMore').addEventListener('click', function () { goto('page-import'); });
    bindSwipe();

    // 网格交互
    $('gridBody').addEventListener('click', function (e) {
      var course = e.target.closest('.course');
      if (course) { showDetail(course.dataset.id); return; }
      var cell = e.target.closest('.cell');
      if (cell) openManual(+cell.dataset.day, +cell.dataset.period);
    });

    // 手动表单：点选式星期 / 节次 / 周次
    $('mSave').addEventListener('click', function () { saveManual(false); });
    $('mSaveNext').addEventListener('click', function () { saveManual(true); });
    $('mDayPick').addEventListener('click', function (e) {
      var b = e.target.closest('.pk');
      if (!b) return;
      $('mDay').value = b.dataset.day;
      syncManualPicks();
    });
    $('mPeriodPick').addEventListener('click', function (e) {
      var b = e.target.closest('.pk');
      if (!b) return;
      onPeriodClick(+b.dataset.period);
    });
    $('mWeekPick').addEventListener('click', function (e) {
      var b = e.target.closest('.pk');
      if (!b) return;
      var total = S.settings().totalWeeks || 20;
      $('mWeeks').value = b.dataset.weeks === 'full' ? ('1-' + total) : b.dataset.weeks;
      syncWeekPick();
    });
    $('mWeeks').addEventListener('input', syncWeekPick);
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
    // 注意：这里必须包一层。直接把 jwPrepare 绑上去的话，点击事件对象会
    // 当成 forceCode 参数传进去，导致「页面声明不要验证码」的学校也被强行取图。
    $('jwGetCode').addEventListener('click', function () { jwPrepare(false); });
    $('jwLogin').addEventListener('click', jwRun);
    $('jwRefreshCode').addEventListener('click', function () { jwReset(); jwPrepare(true); });
    $('jwFillSchool').addEventListener('click', function () {
      var list = JwImport.SCHOOL_PRESETS || [];
      if (!list.length) return;
      $('jwBase').value = list[0].base;
      $('jwVariant').value = 'jwglxt';
      jwReset();
      toast('已填入 ' + list[0].name + '，点「① 连接教务系统」试试');
    });
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
        syncEngineTip();
      });
    });
    syncEngineTip();
    $('btnRunOcr').addEventListener('click', runImageImport);
    $('btnCancelOcr').addEventListener('click', function () {
      if (!OcrImport.cancel()) { toast('AI 请求已经发出去了，只能等它返回'); return; }
      toast('已取消识别');
    });

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

  /* ---------------- 导出 / 分享 ---------------- */
  function shareSchedule() {
    var data = JSON.stringify(S.load(), null, 2);
    var name = 'coursetable-' + new Date().toISOString().slice(0, 10) + '.json';

    // 手机上优先走系统分享（可以直接发给微信 / 存到文件）
    try {
      var file = new File([data], name, { type: 'application/json' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        navigator.share({ files: [file], title: '我的课表' }).then(function () {
          toast('已分享');
        }).catch(function () { /* 用户取消，不算错 */ });
        return;
      }
    } catch (e) { /* 不支持就退回下载 */ }

    var blob = new Blob([data], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
    toast('已导出课表 JSON');
  }

  /* ---------------- 左右滑动切换周 ---------------- */
  function bindSwipe() {
    var el = $('page-schedule');
    var x0 = 0, y0 = 0, t0 = 0, tracking = false;

    el.addEventListener('touchstart', function (e) {
      if (e.touches.length !== 1) { tracking = false; return; }
      x0 = e.touches[0].clientX;
      y0 = e.touches[0].clientY;
      t0 = Date.now();
      tracking = true;
    }, { passive: true });

    el.addEventListener('touchend', function (e) {
      if (!tracking) return;
      tracking = false;
      if (e.target.closest('button')) return;      // 点在顶栏图标上不算滑动
      if (Date.now() - t0 > 800) return;           // 慢动作不算
      var t = e.changedTouches[0];
      var dx = t.clientX - x0, dy = t.clientY - y0;
      // 横向位移要够大、且明显大于纵向，才算切周（否则是在上下滚课表）
      if (Math.abs(dx) < 55 || Math.abs(dx) < Math.abs(dy) * 1.6) return;
      state.week += dx < 0 ? 1 : -1;
      render();
    }, { passive: true });
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

    // 列宽是百分比，转屏 / 改变窗口后要重排，否则分列会错位
    window.addEventListener('resize', render);
    window.addEventListener('orientationchange', render);

    // 引擎选择以界面上高亮的那一个为准（默认 AI 识别）
    var segActive = $('ocrEngine').querySelector('.seg-i.active');
    if (segActive) state.engine = segActive.dataset.engine;
    syncEngineTip();

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

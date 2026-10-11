# -*- coding: utf-8 -*-
"""
真实账号实测（第 3 版，完整链路）：
  登录 → 打开「个人课表查询」页面 → 读页面里 xnm/xqm 下拉框的真实值
       → 用该值查课表 → 存 JSON 供离线分析

用法：python scripts/live-hntou-probe3.py <学号> <密码>
"""
import base64, json, os, random, re, sys, time
import urllib.parse, urllib.request, http.cookiejar

BASE = 'http://zfjw.hntou.edu.cn'
UA = ('Mozilla/5.0 (Linux; Android 12; Mobile) AppleWebKit/537.36 '
      '(KHTML, like Gecko) Chrome/120 Mobile Safari/537.36')
FIX = 'scripts/fixtures'

cj = http.cookiejar.CookieJar()
opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))
NORE = urllib.request.build_opener(
    urllib.request.HTTPCookieProcessor(cj),
    type('NR', (urllib.request.HTTPRedirectHandler,), {'redirect_request': lambda s, *a, **k: None})())


def fetch(url, data=None, headers=None, timeout=40, tries=4, nore=False):
    last = None
    for a in range(tries):
        h = {'User-Agent': UA, 'Accept-Language': 'zh-CN,zh;q=0.9', 'Connection': 'close'}
        h.update(headers or {})
        body = None
        if data is not None:
            body = data.encode() if isinstance(data, str) else urllib.parse.urlencode(data).encode()
            h.setdefault('Content-Type', 'application/x-www-form-urlencoded')
        try:
            with (NORE if nore else opener).open(
                    urllib.request.Request(url, data=body, headers=h), timeout=timeout) as r:
                return r.status, dict(r.headers), r.read()
        except urllib.error.HTTPError as e:
            return e.code, dict(e.headers), e.read()
        except Exception as e:
            last = e
            if a < tries - 1:
                print('    (重试: %s)' % e)
                time.sleep(4 * (a + 1))
    raise last


def hidden(html, name):
    m = re.search(r'<input[^>]*\bname=["\']?%s["\']?[^>]*>' % re.escape(name), html, re.I)
    if not m:
        return ''
    v = re.search(r'\bvalue\s*=\s*(?:"([^"]*)"|\'([^\']*)\'|([^\s>]*))', m.group(0), re.I)
    if not v:
        return ''
    return (v.group(1) if v.group(1) is not None else
            v.group(2) if v.group(2) is not None else v.group(3)).strip()


def b64int(s):
    return int.from_bytes(base64.b64decode(s), 'big')


def rsa(pw, mod, exp):
    n, e = b64int(mod), b64int(exp)
    nb = (n.bit_length() + 7) // 8
    msg = pw.encode()
    ps = bytes(random.randint(1, 255) for _ in range(nb - 3 - len(msg)))
    return base64.b64encode(
        pow(int.from_bytes(b'\x00\x02' + ps + b'\x00' + msg, 'big'), e, n).to_bytes(nb, 'big')).decode()


def banner(s):
    print('\n' + '=' * 72 + '\n' + s + '\n' + '=' * 72)


def selects(html):
    """返回 {select_id: {name:.., options:[(value,text,selected)]}}"""
    out = {}
    for sm in re.finditer(r'<select\b([^>]*)>([\s\S]*?)</select>', html, re.I):
        attrs, inner = sm.group(1), sm.group(2)
        sid = re.search(r'\bid\s*=\s*["\']?([^"\'\s>]+)', attrs, re.I)
        sid = sid.group(1) if sid else '?'
        nm = re.search(r'\bname\s*=\s*["\']?([^"\'\s>]+)', attrs, re.I)
        opts = []
        for om in re.finditer(r'<option\b([^>]*)>([\s\S]*?)</option>', inner, re.I):
            oa, ot = om.group(1), re.sub(r'\s+', ' ', re.sub(r'<[^>]+>', '', om.group(2))).strip()
            v = re.search(r'\bvalue\s*=\s*["\']?([^"\'>]*)', oa, re.I)
            opts.append((v.group(1).strip() if v else '', ot, 'selected' in oa.lower()))
        out[sid] = {'name': nm.group(1) if nm else '', 'options': opts}
    return out


USER, PASS = (sys.argv[1], sys.argv[2]) if len(sys.argv) >= 3 else (None, None)
if not USER:
    print('用法: python scripts/live-hntou-probe3.py <学号> <密码>')
    sys.exit(2)
os.makedirs(FIX, exist_ok=True)

# ---- 登录 ----
banner('① 登录')
st, hd, raw = fetch(BASE + '/jwglxt/xtgl/login_slogin.html')
html = raw.decode('utf-8', 'replace')
fields = {}
for t in re.findall(r'<input\b[^>]*>', html, re.I):
    nm = re.search(r'\bname\s*=\s*["\']?([^"\'\s>]+)', t, re.I)
    if nm:
        fields[nm.group(1)] = hidden(html, nm.group(1))
time.sleep(0.9)
st, hd, raw = fetch(BASE + '/jwglxt/xtgl/login_getPublicKey.html?time=%d' % int(time.time() * 1000))
key = json.loads(raw.decode())
enc = rsa(PASS, key['modulus'], key['exponent'])
form = {k: v for k, v in fields.items() if k not in ('yhm', 'mm', 'yzm')}
form['yhm'], form['mm'], form['yzm'] = USER, enc, ''
time.sleep(0.9)
st, hd, raw = fetch(BASE + '/jwglxt/xtgl/login_slogin.html?time=%d' % int(time.time() * 1000),
                    data=form, nore=True, headers={
                        'Referer': BASE + '/jwglxt/xtgl/login_slogin.html',
                        'X-Requested-With': 'XMLHttpRequest', 'Origin': BASE})
print('POST → HTTP %s  Location=%s' % (st, hd.get('Location', '(无)')))
time.sleep(0.9)
st, hd, raw = fetch(BASE + '/jwglxt/xtgl/index_initMenu.html')
print('菜单页 HTTP %s  %d 字节' % (st, len(raw)))

# ---- 打开课表页面 ----
banner('② 打开「个人课表查询」页面（菜单里找到的真实入口）')
PAGE = '/jwglxt/kbcx/xskbcx_cxXskbcxIndex.html?gnmkdm=N253508'
XHR = {'X-Requested-With': 'XMLHttpRequest',
       'Referer': BASE + '/jwglxt/xtgl/index_initMenu.html'}
st, hd, raw = fetch(BASE + PAGE, headers=XHR)
page = raw.decode('utf-8', 'replace')
print('%s → HTTP %s  %d 字节' % (PAGE, st, len(page)))
open(FIX + '/hntou-kbpage.html', 'w', encoding='utf-8').write(page)
print('页面片段：%r' % page[:130])

sel = selects(page)
print('\n页面里的下拉框 %d 个：' % len(sel))
for sid, info in sel.items():
    print('   #%-10s name=%-10s %d 个选项  %s' % (
        sid, info['name'], len(info['options']),
        ''.join('[%s:%s%s]' % (v, t, '*' if s else '') for v, t, s in info['options'][:12])))

cur_xnm = cur_xqm = None
if 'xnm' in sel:
    for v, t, s in sel['xnm']['options']:
        if s:
            cur_xnm = v
    cur_xnm = cur_xnm or (sel['xnm']['options'][0][0] if sel['xnm']['options'] else None)
if 'xqm' in sel:
    for v, t, s in sel['xqm']['options']:
        if s:
            cur_xqm = v
    cur_xqm = cur_xqm or (sel['xqm']['options'][0][0] if sel['xqm']['options'] else None)
print('\n★ 默认选中：xnm=%s  xqm=%s' % (cur_xnm, cur_xqm))

if not (cur_xnm and cur_xqm):
    print('页面里没读到，改用页面里写死的 JS 变量找：')
    for kw in ['xnm', 'xqm', 'XNM', 'XQM']:
        for m in re.finditer(r'[^\n;]{0,50}\b%s\b\s*[:=]\s*[^\n;]{0,50}' % kw, page)[:3] if False else []:
            pass
    for m in re.finditer(r'[^\n;]{0,45}(?:xnm|xqm)\s*[:=]\s*[^\n;]{0,45}', page, re.I):
        print('   ' + m.group(0).strip()[:110])

# ---- 查课表 ----
banner('③ 用页面里的学年学期查课表')
KB = '/jwglxt/kbcx/xskbcx_cxXsgrkb.html?gnmkdm=N2151'
body = 'xnm=%s&xqm=%s&kzlx=ck' % (cur_xnm or '', cur_xqm or '')
time.sleep(0.9)
st, hd, raw = fetch(BASE + KB, data=body, headers=XHR)
print('POST %s  body=%s' % (KB, body))
print('→ HTTP %s  %d 字节' % (st, len(raw)))
s = raw.decode('utf-8', 'replace')
if s.strip() != 'null':
    open(FIX + '/hntou-kb.json', 'w', encoding='utf-8').write(s)
    j = json.loads(s)
    print('✔ 顶层键：%s' % list(j.keys()))
    for k, v in j.items():
        if isinstance(v, list):
            print('   %s: list(%d)' % (k, len(v)))
        elif isinstance(v, dict):
            print('   %s: dict(%s)' % (k, list(v.keys())[:8]))
        else:
            print('   %s: %r' % (k, v))
    lists = [(k, v) for k, v in j.items() if isinstance(v, list) and v]
    if lists:
        k, v = max(lists, key=lambda kv: len(kv[1]))
        print('\n★ 主列表 "%s" 共 %d 条，第 1 条字段：' % (k, len(v)))
        print(json.dumps(v[0], ensure_ascii=False, indent=2))
else:
    print('仍是 null')
print('\ndone')

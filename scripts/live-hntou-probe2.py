# -*- coding: utf-8 -*-
"""
真实账号端到端实测（第 2 版）：登录成功后抓「菜单页」找出课表真实入口，
再从菜单/页面里挖出学年(xnm)学期(xqm)的真实取值。

用法：python scripts/live-hntou-probe2.py <学号> <密码>
"""
import base64
import json
import random
import re
import sys
import time
import urllib.parse
import urllib.request
import http.cookiejar
import os

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
                print('    (重试 %d/%d: %s)' % (a + 1, tries - 1, e))
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
    m = int.from_bytes(b'\x00\x02' + ps + b'\x00' + msg, 'big')
    return base64.b64encode(pow(m, e, n).to_bytes(nb, 'big')).decode()


def banner(s):
    print('\n' + '=' * 72 + '\n' + s + '\n' + '=' * 72)


USER, PASS = (sys.argv[1], sys.argv[2]) if len(sys.argv) >= 3 else (None, None)
if not USER:
    print('用法: python scripts/live-hntou-probe2.py <学号> <密码>')
    sys.exit(2)

os.makedirs(FIX, exist_ok=True)

# ---- 登录 ----
banner('登录')
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
print('登录页 %d 字段，公钥 %d bit，密文 %d 字符'
      % (len(fields), b64int(key['modulus']).bit_length(), len(enc)))

form = {k: v for k, v in fields.items() if k not in ('yhm', 'mm', 'yzm')}
form['yhm'], form['mm'], form['yzm'] = USER, enc, ''
time.sleep(0.9)
st, hd, raw = fetch(BASE + '/jwglxt/xtgl/login_slogin.html?time=%d' % int(time.time() * 1000),
                    data=form, nore=True, headers={
                        'Referer': BASE + '/jwglxt/xtgl/login_slogin.html',
                        'X-Requested-With': 'XMLHttpRequest', 'Origin': BASE})
print('登录 POST → HTTP %s  Location=%s' % (st, hd.get('Location', '(无)')))
print('cookie: %s' % '; '.join(c.name for c in cj))

time.sleep(0.9)
# ---- 菜单页：既验证会话，又拿真实入口 ----
banner('抓主菜单页（同时验证会话）')
st, hd, raw = fetch(BASE + '/jwglxt/xtgl/index_initMenu.html')
menu = raw.decode('utf-8', 'replace')
is_login = bool(re.search(r'login_slogin|id=["\']?yzm["\']?', menu))
print('HTTP %s  %d 字节  是登录页吗：%s' % (st, len(menu), is_login))
open(FIX + '/hntou-menu.html', 'w', encoding='utf-8').write(menu)

if is_login:
    print('\n会话无效 → 登录没成功。停止。')
    sys.exit(1)

links = re.findall(r'href=["\']([^"\']*gnmkdm[^"\']*)["\']', menu, re.I)
print('\n菜单里带 gnmkdm 的链接 %d 个：' % len(links))
seen = []
for l in links:
    if l not in seen:
        seen.append(l)
for l in seen:
    print('   ' + l)

print('\n菜单里和课表/成绩相关的文字：')
for m in re.finditer(r'([^>]{0,20}(?:课表|选课|成绩|考试|个人)[^<]{0,20})', menu):
    s = m.group(1).strip()
    if s and len(s) > 1:
        print('   · ' + s)

# ---- 找学年学期 ----
banner('从菜单页/课表页挖 xnm / xqm')
for kw in ['xnm', 'xqm', 'xnmmc', 'xqjmc', 'xnxq']:
    hits = re.findall(r'[^;\n]{0,70}\b%s\b[^;\n]{0,70}' % kw, menu)
    if hits:
        print('  [菜单页] %s :' % kw)
        for h in hits[:4]:
            print('      ' + h.strip()[:120])

# ---- 探测课表候选 ----
banner('探测课表接口（带 XHR，901=未登录，null=参数不足）')
XHR = {'X-Requested-With': 'XMLHttpRequest', 'Referer': BASE + '/jwglxt/xtgl/index_initMenu.html'}
cands = [
    ('GET', '/jwglxt/kbcx/xskbcx_cxXsgrkb.html?gnmkdm=N2151', None),
    ('POST', '/jwglxt/kbcx/xskbcx_cxXsgrkb.html?gnmkdm=N2151', 'xnm=&xqm=&kzlx=ck'),
    ('POST', '/jwglxt/kbcx/xskbcx_cxXsgrkb.html?gnmkdm=N2151', 'xnm=2026&xqm=3&kzlx=ck'),
    ('POST', '/jwglxt/kbcx/xskbcx_cxXsgrkb.html?gnmkdm=N2151&doType=query', 'xnm=2026&xqm=3&kzlx=ck'),
    ('GET', '/jwglxt/kbcx/xskbcx_cxXsgrkb.html', None),
    ('GET', '/jwglxt/kbcx/xskbcx_cxXsgrkb.html?gnmkdm=N2151&xnm=2026&xqm=3', None),
]
for method, path, body in cands:
    time.sleep(0.9)
    st, hd, raw = fetch(BASE + path, data=body, headers=XHR)
    s = raw.decode('utf-8', 'replace')
    print('%-4s %-62s → %s %d字节  %r' % (method, path, st, len(s), s[:80].replace('\n', ' ')))
print('\ndone')

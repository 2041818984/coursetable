# -*- coding: utf-8 -*-
"""探测课表接口路径是否存在（未登录状态下，302 跳登录=路径存在，404=路径不存在）。"""
import http.cookiejar
import time
import urllib.parse
import urllib.request

BASE = 'http://zfjw.hntou.edu.cn'
UA = 'Mozilla/5.0 (Linux; Android 12; Mobile) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36'

cj = http.cookiejar.CookieJar()
opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *a, **k):
        return None


probe = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj), NoRedirect)


def get(url, data=None, tries=5):
    for i in range(tries):
        try:
            body = urllib.parse.urlencode(data).encode() if data is not None else None
            req = urllib.request.Request(url, data=body, headers={
                'User-Agent': UA, 'Connection': 'close',
                'X-Requested-With': 'XMLHttpRequest',
                'Referer': BASE + '/jwglxt/xtgl/login_slogin.html',
            })
            if data is not None:
                req.add_header('Content-Type', 'application/x-www-form-urlencoded')
            with probe.open(req, timeout=25) as r:
                return r.status, dict(r.headers), r.read()
        except urllib.error.HTTPError as e:
            return e.code, dict(e.headers), e.read()
        except Exception as e:
            if i < tries - 1:
                time.sleep(6)
            else:
                return None, {'err': str(e)}, b''
    return None, {}, b''


CANDS = [
    # (方法, 路径, 说明)
    ('POST', '/jwglxt/kbcx/xskbcx_cxXsgrkb.html?gnmkdm=N2151', '规范做法：kbcx 目录 + N2151'),
    ('POST', '/jwglxt/xskbcx/xskbcx_cxXsgrkb.html?gnmkdm=N2535', '本 App 现在用的（可疑）'),
    ('POST', '/jwglxt/xskbcx/xskbcx_cxXsKb.html?gnmkdm=N2535', '另一种常见写法'),
    ('POST', '/jwglxt/kbcx/xskbcx_cxXsKb.html?gnmkdm=N2151', 'kbcx 目录 + Kb 结尾'),
    ('GET', '/jwglxt/kbcx/xskbcx_cxXsgrkb.html?gnmkdm=N2151&xnm=2026&xqm=3&kzlx=ck', '同上但 GET'),
    ('POST', '/jwglxt/xsxk/zzxkyzb_cxZzxkYzbIndex.html?gnmkdm=N253512', '选课页（判断目录结构）'),
    ('GET', '/jwglxt/kaptcha', '验证码图片'),
    ('GET', '/jwglxt/xtgl/index_initMenu.html', '登录后首页'),
]

print('未登录探测课表接口（302=存在但需登录 / 404=不存在）')
print('=' * 78)
for method, path, note in CANDS:
    url = BASE + path
    data = {'xnm': '2026', 'xqm': '3', 'kzlx': 'ck'} if method == 'POST' else None
    st, hd, raw = get(url, data)
    if st is None:
        print('%-58s 超时/不可达  (%s)' % (path[:58], note))
    else:
        loc = hd.get('Location', '')
        size = len(raw)
        # 判断返回内容性质
        kind = ''
        if loc:
            kind = '跳转→' + (loc[:40] if loc else '')
        elif b'<html' in raw[:400].lower() or b'<!doctype' in raw[:400].lower():
            t = raw.decode('utf-8', 'replace')
            if '登录' in t:
                kind = 'HTML（要求登录）'
            else:
                kind = 'HTML'
        elif raw[:1] in (b'{', b'['):
            kind = 'JSON'
        print('%-58s HTTP %-4s %6d字节  %s' % (path[:58], st, size, kind or ('-> ' + loc[:40])))
    time.sleep(4)

# -*- coding: utf-8 -*-
"""不消耗密码尝试次数的对照探测：
   同一个未登录会话里访问若干受保护路径，看服务器用什么状态码拒绝。
   用来判断「上一次登录到底成没成功」。"""
import re
import sys
import time
import urllib.parse
import urllib.request
import http.cookiejar

BASE = 'http://zfjw.hntou.edu.cn'
UA = ('Mozilla/5.0 (Linux; Android 12; Mobile) AppleWebKit/537.36 '
      '(KHTML, like Gecko) Chrome/120 Mobile Safari/537.36')

cj = http.cookiejar.CookieJar()
opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))


def fetch(url, data=None, headers=None, timeout=40, tries=3):
    last = None
    for a in range(tries):
        h = {'User-Agent': UA, 'Accept-Language': 'zh-CN,zh;q=0.9', 'Connection': 'close'}
        h.update(headers or {})
        body = None
        if data is not None:
            body = data.encode() if isinstance(data, str) else urllib.parse.urlencode(data).encode()
            h.setdefault('Content-Type', 'application/x-www-form-urlencoded')
        try:
            with opener.open(urllib.request.Request(url, data=body, headers=h), timeout=timeout) as r:
                return r.status, dict(r.headers), r.read()
        except urllib.error.HTTPError as e:
            return e.code, dict(e.headers), e.read()
        except Exception as e:
            last = e
            if a < tries - 1:
                time.sleep(4 * (a + 1))
    raise last


PATHS = [
    '/jwglxt/xtgl/index_initMenu.html',
    '/jwglxt/kbcx/xskbcx_cxXsgrkb.html?gnmkdm=N2151',
    '/jwglxt/xskbcx/xskbcx_cxXsgrkb.html?gnmkdm=N2535',
    '/jwglxt/xtgl/login_getPublicKey.html?time=1',
    '/jwglxt/kaptcha',
    '/jwglxt/xtgl/login_slogin.html',
    '/jwglxt/',
]

print('未登录会话下的响应（用于判定 901 的适用范围）：')
print('-' * 70)
for p in PATHS:
    try:
        st, hd, raw = fetch(BASE + p)
    except Exception as e:
        print('%-58s  传输失败 %s' % (p, e))
        continue
    ct = hd.get('Content-Type', '')
    snippet = raw[:70].decode('utf-8', 'replace').replace('\n', ' ')
    print('%-58s  %s  %-24s %r' % (p, st, ct[:24], snippet))
    time.sleep(0.9)

# -*- coding: utf-8 -*-
"""
真实服务器端到端验证：登录 -> 读课表页下拉框 -> 查课表。
用法： python scripts/live-verify-login.py <学号> <密码>
凭据只从命令行传入，不落盘。
"""
import sys, re, time, json, urllib.parse, urllib.request, urllib.error, http.cookiejar, base64

BASE = 'http://zfjw.hntou.edu.cn'
UA = ('Mozilla/5.0 (Linux; Android 12; Mobile) AppleWebKit/537.36 '
      '(KHTML, like Gecko) Chrome/120 Mobile Safari/537.36')

cj = http.cookiejar.CookieJar()
op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))


def req(url, data=None, headers=None, method=None, timeout=40):
    h = {'User-Agent': UA, 'Accept-Language': 'zh-CN,zh;q=0.9', 'Connection': 'close'}
    h.update(headers or {})
    body = None
    if data is not None:
        body = data.encode() if isinstance(data, str) else urllib.parse.urlencode(data).encode()
        h.setdefault('Content-Type', 'application/x-www-form-urlencoded')
    r = urllib.request.Request(url, data=body, headers=h, method=method)
    try:
        with op.open(r, timeout=timeout) as resp:
            return resp.status, dict(resp.headers), resp.read()
    except urllib.error.HTTPError as e:
        return e.code, dict(e.headers), e.read()


def attr(tag, name):
    m = re.search(r'\b' + name + r'\s*=\s*(?:"([^"]*)"|\'([^\']*)\'|([^\s>]*))', tag, re.I)
    if not m:
        return None
    for g in m.groups():
        if g is not None:
            return g
    return ''


def hidden_fields(html):
    fields = {}
    for tag in re.findall(r'<input\b[^>]*>', html, re.I):
        n = attr(tag, 'name')
        if n:
            fields[n] = attr(tag, 'value') or ''
    return fields


def rsa_encrypt(password, modulus_b64, exponent_b64):
    n = int.from_bytes(base64.b64decode(modulus_b64), 'big')
    e = int.from_bytes(base64.b64decode(exponent_b64), 'big')
    msg = password.encode('utf-8')
    # PKCS#1 v1.5
    k = (n.bit_length() + 7) // 8
    ps = bytearray()
    while len(ps) < k - 3 - len(msg):
        b = 0
        while b == 0:
            b = int.from_bytes(__import__('os').urandom(1), 'big')
        ps.append(b)
    em = b'\x00\x02' + bytes(ps) + b'\x00' + msg
    c = pow(int.from_bytes(em, 'big'), e, n)
    return base64.b64encode(c.to_bytes(k, 'big')).decode()


def main():
    user, pw = sys.argv[1], sys.argv[2]
    print('学号 = %s' % user)
    print('密码长度 = %d  (%s)' % (len(pw), '*' * len(pw)))
    print('-' * 70)

    # 1. 登录页
    t0 = time.time()
    st, hd, raw = req(BASE + '/jwglxt/xtgl/login_slogin.html?time=%d' % int(time.time() * 1000))
    html = raw.decode('utf-8', 'replace')
    print('[1] 登录页 HTTP %s  %d 字节  %.2fs' % (st, len(raw), time.time() - t0))
    print('    Cookie: %s' % [(c.name, c.value[:20]) for c in cj])
    fields = hidden_fields(html)
    print('    隐藏字段: %s' % {k: (v[:24] + '…' if len(v) > 24 else v) for k, v in fields.items()})
    for k in ['dlsfbxyzm', 'yzcskz', 'dlsbsdsj', 'mmsfjm']:
        print('    %-10s = %r' % (k, fields.get(k)))
    action = re.search(r'<form[^>]*action\s*=\s*"([^"]*)"', html, re.I)
    action = action.group(1) if action else '/jwglxt/xtgl/login_slogin.html'
    print('    form action = %s' % action)

    # 2. 公钥
    time.sleep(0.9)
    st, hd, raw = req(BASE + '/jwglxt/xtgl/login_getPublicKey.html?time=%d' % int(time.time() * 1000))
    pk = json.loads(raw.decode('utf-8', 'replace'))
    print('[2] 公钥 HTTP %s  modulus %d 字符  exponent %r'
          % (st, len(pk['modulus']), pk['exponent']))

    enc = rsa_encrypt(pw, pk['modulus'], pk['exponent'])
    print('[3] 密文 %d 字符  %s…' % (len(enc), enc[:24]))

    # 3. 登录
    time.sleep(0.9)
    body = dict(fields)
    body['yhm'] = user
    body['mm'] = enc
    if 'yzm' not in body:
        body['yzm'] = ''
    url = BASE + (action if action.startswith('/') else '/' + action)
    st, hd, raw = req(url, data=body, headers={
        'Content-Type': 'application/x-www-form-urlencoded',
        'Origin': BASE, 'Referer': BASE + '/jwglxt/xtgl/login_slogin.html'
    })
    text = raw.decode('utf-8', 'replace')
    loc = hd.get('Location') or hd.get('location') or ''
    print('[4] 登录 POST -> HTTP %s   Location=%s   %d 字节' % (st, loc or '(无)', len(raw)))

    # 4. 跟随跳转，读真实错误
    final = text
    if loc:
        if loc.startswith('http'):
            u2 = loc
        elif loc.startswith('/'):
            u2 = BASE + loc
        else:
            u2 = BASE + '/jwglxt/xtgl/' + loc
        time.sleep(0.9)
        st2, hd2, raw2 = req(u2)
        final = raw2.decode('utf-8', 'replace')
        print('[5] 跟随跳转 -> HTTP %s  %d 字节  %s' % (st2, len(raw2), u2))

    ok = bool(re.search(r'index_initMenu|initMenu', final))
    errs = []
    for pat in [r'用户名或密码不正确[^<"\n]{0,20}', r'用户名或密码错误[^<"\n]{0,20}',
                r'[^<>\n]{0,12}(?:账号|密码|验证码)[^<>\n]{0,6}(?:不正确|错误|为空|失效)[^<>\n]{0,14}',
                r'[^<>\n]{0,16}(?:锁定|次数超限|请稍后)[^<>\n]{0,16}']:
        errs += re.findall(pat, final)
    print('[6] 含首页标记 index_initMenu: %s' % ok)
    print('[6] 服务器错误原话: %s' % (list(dict.fromkeys(errs))[:6] or '(无)'))
    for kw in ['showError', 'alert(', 'errormsg', 'dlcount']:
        for m in list(re.finditer(re.escape(kw), final))[:1]:
            print('    ...%s' % final[max(0, m.start() - 70):m.start() + 130].replace('\n', ' ')[:190])

    if not ok:
        print('\n>>> 登录未成功，停止（不消耗更多次数）。')
        return 1

    print('\n>>> 登录成功！会话已建立。')

    # 5. 打课表页面，读学年学期
    time.sleep(0.9)
    st, hd, raw = req(BASE + '/jwglxt/kbcx/xskbcx_cxXskbcxIndex.html?gnmkdm=N253508',
                      headers={'Referer': BASE + '/jwglxt/xtgl/index_initMenu.html'})
    page = raw.decode('utf-8', 'replace')
    print('[7] 课表页面 HTTP %s  %d 字节' % (st, len(page)))

    def selected(sel_id):
        m = re.search(r'<select\b[^>]*id\s*=\s*["\']?' + sel_id + r'["\']?[^>]*>([\s\S]*?)</select>',
                      page, re.I)
        if not m:
            return None, []
        opts = []
        sel = None
        for om in re.finditer(r'<option\b([^>]*)>([\s\S]*?)</option>', m.group(1), re.I):
            v = attr(om.group(1), 'value')
            label = re.sub(r'<[^>]+>', '', om.group(2)).strip()
            opts.append((v, label))
            if 'selected' in om.group(1).lower():
                sel = v
        return sel, opts

    xnm, xnm_opts = selected('xnm')
    xqm, xqm_opts = selected('xqm')
    print('    #xnm 选中=%r  选项=%s' % (xnm, xnm_opts))
    print('    #xqm 选中=%r  选项=%s' % (xqm, xqm_opts))

    # 6. 查课表
    time.sleep(0.9)
    kb_url = BASE + '/jwglxt/kbcx/xskbcx_cxXsgrkb.html?gnmkdm=N2151'
    payload = 'xnm=%s&xqm=%s&kzlx=ck' % (xnm or '', xqm or '')
    st, hd, raw = req(kb_url, data=payload, headers={
        'X-Requested-With': 'XMLHttpRequest',
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'Referer': BASE + '/jwglxt/kbcx/xskbcx_cxXskbcxIndex.html?gnmkdm=N253508'
    })
    txt = raw.decode('utf-8', 'replace')
    print('[8] 课表接口 HTTP %s  %d 字节' % (st, len(raw)))
    if len(raw) < 20:
        print('    返回体: %r  ← 空值通常意味着 xnm/xqm 没传对' % txt[:40])
        return 1
    j = json.loads(txt)
    kb = j.get('kbList') or []
    xs = j.get('xsxx') or {}
    print('    ✔ 课程 %d 条   学生=%s  班级=%s  学院=%s  学年=%s'
          % (len(kb), xs.get('XM'), xs.get('BJMC'), xs.get('YXMC'), xs.get('XNMC')))
    print('-' * 70)
    for it in kb:
        name = re.sub(r'<[^>]+>', '', it.get('kcmc', ''))
        print('  %-22s 周%-2s 节%-6s %-14s %-12s %s'
              % (name[:22], it.get('xqj'), it.get('jc'), it.get('zcd'), it.get('cdmc'), it.get('xm')))
    return 0


if __name__ == '__main__':
    sys.exit(main())

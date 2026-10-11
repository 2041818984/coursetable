# -*- coding: utf-8 -*-
"""
海南热带海洋学院教务系统 —— 真实账号端到端实测（只读，不改任何数据）。

用法（账号密码只从命令行读，绝不写进文件/仓库）：
    python scripts/live-hntou-login.py <学号> <密码>

流程完全照抄 App 里 www/js/import-jw.js 的做法：
    1. GET  登录页          → 抠隐藏字段 csrftoken/language/xxdm/mmsfjm/dlsfbxyzm…
    2. POST login_getPublicKey.html → 取 RSA 公钥（base64 的 modulus/exponent）
    3. RSA PKCS#1 v1.5 加密密码 → base64
    4. POST 登录页（?time=）→ 看响应判定成功/密码错/要验证码
    5. GET  课表页面        → 读页面里 xnm/xqm 下拉框的真实值
    6. POST 课表查询接口    → 逐条试候选路径，找出真正可用的那个
    7. 解析 kbList → 打印课程，和 App 的 Parser.parseJwList 结果对照

安全：密码错误只提交 1 次，绝不自动重试（该校连错 3 次锁 3 分钟）。
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

BASE = 'http://zfjw.hntou.edu.cn'
UA = ('Mozilla/5.0 (Linux; Android 12; Mobile) AppleWebKit/537.36 '
      '(KHTML, like Gecko) Chrome/120 Mobile Safari/537.36')

cj = http.cookiejar.CookieJar()
opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))
NO_REDIRECT = urllib.request.build_opener(
    urllib.request.HTTPCookieProcessor(cj), type('NoRedirect', (urllib.request.HTTPRedirectHandler,), {
        'redirect_request': lambda self, *a, **k: None})())

REQ_COUNT = [0]


def fetch(url, data=None, headers=None, timeout=40, tries=4, no_redirect=False, tag=''):
    last = None
    for attempt in range(tries):
        h = {'User-Agent': UA, 'Accept-Language': 'zh-CN,zh;q=0.9',
             'Connection': 'close'}
        h.update(headers or {})
        body = None
        if data is not None:
            if isinstance(data, str):
                body = data.encode()
            else:
                body = urllib.parse.urlencode(data).encode()
            h.setdefault('Content-Type', 'application/x-www-form-urlencoded')
        req = urllib.request.Request(url, data=body, headers=h)
        op = NO_REDIRECT if no_redirect else opener
        REQ_COUNT[0] += 1
        try:
            with op.open(req, timeout=timeout) as r:
                return r.status, dict(r.headers), r.read(), r.geturl()
        except urllib.error.HTTPError as e:
            return e.code, dict(e.headers), e.read(), url
        except Exception as e:
            last = e
            if attempt < tries - 1:
                wait = 4 * (attempt + 1)
                print('    (第 %d 次失败：%s，等 %ds 重试) %s' % (attempt + 1, e, wait, tag))
                time.sleep(wait)
    raise last


def throttle(ms=900):
    time.sleep(ms / 1000.0)


def hidden(html, name):
    m = re.search(r'<input[^>]*\bname=["\']?%s["\']?[^>]*>' % re.escape(name), html, re.I)
    if not m:
        return None
    tag = m.group(0)
    v = re.search(r'\bvalue\s*=\s*(?:"([^"]*)"|\'([^\']*)\'|([^\s>]*))', tag, re.I)
    if not v:
        return ''
    return (v.group(1) if v.group(1) is not None
            else v.group(2) if v.group(2) is not None
            else v.group(3)).strip()


def b64_to_int(s):
    return int.from_bytes(base64.b64decode(s), 'big')


def pkcs1_v15_pad(msg, n_bytes):
    pad_len = n_bytes - 3 - len(msg)
    ps = bytes(random.randint(1, 255) for _ in range(pad_len))
    return b'\x00\x02' + ps + b'\x00' + msg


def rsa_encrypt_b64(password, modulus_b64, exponent_b64):
    n = b64_to_int(modulus_b64)
    e = b64_to_int(exponent_b64)
    n_bytes = (n.bit_length() + 7) // 8
    msg = password.encode('utf-8')
    if len(msg) > n_bytes - 11:
        raise ValueError('密码过长')
    return base64.b64encode(
        pow(int.from_bytes(pkcs1_v15_pad(msg, n_bytes), 'big'), e, n).to_bytes(n_bytes, 'big')
    ).decode()


def text_of(html):
    t = re.sub(r'<script[\s\S]*?</script>|<style[\s\S]*?</style>', ' ', html)
    t = re.sub(r'<[^>]+>', ' ', t)
    t = t.replace('&nbsp;', ' ').replace('&amp;', '&')
    return re.sub(r'\s+', ' ', t).strip()


def banner(s):
    print()
    print('=' * 70)
    print(s)
    print('=' * 70)


def main():
    if len(sys.argv) < 3:
        print('用法: python scripts/live-hntou-login.py <学号> <密码>')
        return 2
    USER, PASS = sys.argv[1], sys.argv[2]
    mask = USER[:4] + '*' * max(0, len(USER) - 4)

    # ---------- 1. 登录页 ----------
    banner('第 1 步 / 共 6 步：读取登录页 + 隐藏字段')
    st, hd, raw, _ = fetch(BASE + '/jwglxt/xtgl/login_slogin.html', tag='login page')
    html = raw.decode('utf-8', 'replace')
    print('HTTP %s，%d 字节' % (st, len(html)))
    print('Set-Cookie : %s' % (hd.get('Set-Cookie', '(无)')[:70]))

    fields = {}
    for name in re.findall(r'<input\b[^>]*>', html, re.I):
        nm = re.search(r'\bname\s*=\s*["\']?([^"\'\s>]+)', name, re.I)
        if nm:
            fields[nm.group(1)] = hidden(html, nm.group(1)) or ''
    print('表单字段 %d 个：' % len(fields))
    for k, v in fields.items():
        if k in ('yhm', 'mm', 'yzm'):
            print('   %-14s = <用户输入>' % k)
        else:
            print('   %-14s = %s' % (k, v))

    need_captcha_default = fields.get('dlsfbxyzm') == '1'
    print()
    print('  → dlsfbxyzm=%s  默认%s验证码' % (
        fields.get('dlsfbxyzm'), '需要' if need_captcha_default else '不需要'))
    print('  → mmsfjm=%s  密码%s' % (
        fields.get('mmsfjm'), '需 RSA 加密' if fields.get('mmsfjm') == '1' else '明文提交'))
    print('  → 连错 %s 次锁定 %s 分钟' % (fields.get('yzcskz'), fields.get('dlsbsdsj')))

    slider = bool(re.search(r'zfcaptchaLogin|zfdun|slideVerify', html, re.I))
    print('  → 滑块拼图：%s' % ('检测到（自动登录不可行）' if slider else '无'))
    if slider:
        print('\n检测到滑块验证码，停止。')
        return 1

    # ---------- 2. RSA 公钥 ----------
    throttle()
    banner('第 2 步 / 共 6 步：取 RSA 公钥')
    st, hd, raw, _ = fetch(BASE + '/jwglxt/xtgl/login_getPublicKey.html?time=%d'
                           % int(time.time() * 1000), tag='pubkey')
    key = json.loads(raw.decode('utf-8', 'replace'))
    n = b64_to_int(key['modulus'])
    print('HTTP %s  modulus=%d 字符 base64（%d bit）  exponent=%s'
          % (st, len(key['modulus']), n.bit_length(), key['exponent']))

    # ---------- 3. 加密 ----------
    banner('第 3 步 / 共 6 步：RSA PKCS#1 v1.5 加密密码')
    enc = rsa_encrypt_b64(PASS, key['modulus'], key['exponent'])
    print('明文 %d 字符 → 密文 %d 字符 base64' % (len(PASS), len(enc)))
    print('密文前缀 %s…' % enc[:40])

    # ---------- 4. 登录 ----------
    throttle()
    banner('第 4 步 / 共 6 步：提交登录（只提交一次，不自动重试）')
    form = {}
    for k, v in fields.items():
        if k in ('yhm', 'mm', 'yzm'):
            continue
        form[k] = v
    form.setdefault('language', 'zh_CN')
    form['yhm'] = USER
    form['mm'] = enc
    form['yzm'] = ''
    login_url = BASE + '/jwglxt/xtgl/login_slogin.html?time=%d' % int(time.time() * 1000)
    st, hd, raw, final_url = fetch(
        login_url, data=form, no_redirect=True,
        headers={'Referer': BASE + '/jwglxt/xtgl/login_slogin.html',
                 'X-Requested-With': 'XMLHttpRequest',
                 'Origin': BASE},
        tag='login POST')
    body = raw.decode('utf-8', 'replace')
    print('HTTP %s，%d 字节' % (st, len(body)))
    print('Location   : %s' % hd.get('Location', '(无)'))
    print('Set-Cookie : %s' % (hd.get('Set-Cookie', '(无)')[:80]))
    print('Cookie jar : %s' % '; '.join(c.name for c in cj))

    verdict = 'unknown'
    if re.search(r'用户名或密码不正确|用户名或密码错误|密码错误|账号或密码|用户名不存在|账户不存在', body):
        verdict = 'badpass'
    elif re.search(r'验证码', body) and re.search(r'不正确|错误|为空|请输入|失效', body):
        verdict = 'captcha'
    elif st in (301, 302, 303, 307, 308) or re.search(r'index_initMenu|initMenu', body + hd.get('Location', '')):
        verdict = 'ok'
    elif st == 200 and not re.search(r'name=["\']?mm', body, re.I):
        verdict = 'ok'

    print('页面提示片段：')
    for frag in re.findall(r'[^ ]*(?:密码|用户名|学号|验证码|错误|不正确|不存在|锁定|失败)[^ ]*',
                           text_of(body))[:6]:
        print('   · ' + frag)

    print()
    if verdict == 'ok':
        print('✔✔ 登录成功')
    elif verdict == 'badpass':
        print('✘ 服务器回「用户名或密码不正确」')
    elif verdict == 'captcha':
        print('⚠ 服务器要求验证码（可能已触发失败计数），停止，不再试第二个密码')
    else:
        print('? 结果不明，响应片段：' + text_of(body)[:200])

    if verdict != 'ok':
        print()
        print('共发出 %d 个请求。未登录成功，后续课表探测跳过。' % REQ_COUNT[0])
        return 1

    # ---------- 5. 课表页面 ----------
    throttle()
    banner('第 5 步 / 共 6 步：读课表页面里的学年/学期真实取值')
    kb_page = BASE + '/jwglxt/kbcx/xskbcx_cxXsgrkb.html?gnmkdm=N2151'
    st, hd, raw, fu = fetch(kb_page, headers={'Referer': BASE + '/jwglxt/xtgl/index_initMenu.html'},
                            tag='kb page')
    phtml = raw.decode('utf-8', 'replace')
    print('HTTP %s，%d 字节，最终 URL %s' % (st, len(phtml), fu))
    print('是登录页吗：%s' % ('是（会话失效）' if re.search(r'login_slogin|name=["\']?mm', phtml) else '否'))

    def options(select_id):
        m = re.search(r'<select[^>]*id=["\']?%s["\']?[^>]*>([\s\S]*?)</select>' % select_id, phtml, re.I)
        if not m:
            return []
        out = []
        for om in re.finditer(r'<option[^>]*>', m.group(1), re.I):
            tag = om.group(0)
            val = re.search(r'\bvalue\s*=\s*["\']?([^"\'>\s]*)', tag, re.I)
            if val:
                out.append(val.group(1))
        return out

    xnms, xqms = options('xnm'), options('xqm')
    print('学年下拉 xnm = %s' % xnms)
    print('学期下拉 xqm = %s' % xqms)

    sel = re.search(r'<select[^>]*id=["\']?xnm["\']?[^>]*>([\s\S]*?)</select>', phtml, re.I)
    cur_xnm = None
    if sel:
        for om in re.finditer(r'<option[^>]*>', sel.group(1), re.I):
            if 'selected' in om.group(0).lower():
                v = re.search(r'\bvalue\s*=\s*["\']?([^"\'>\s]*)', om.group(0), re.I)
                cur_xnm = v.group(1) if v else None
    if not cur_xnm and xnms:
        cur_xnm = xnms[0]
    sel = re.search(r'<select[^>]*id=["\']?xqm["\']?[^>]*>([\s\S]*?)</select>', phtml, re.I)
    cur_xqm = None
    if sel:
        for om in re.finditer(r'<option[^>]*>', sel.group(1), re.I):
            if 'selected' in om.group(0).lower():
                v = re.search(r'\bvalue\s*=\s*["\']?([^"\'>\s]*)', om.group(0), re.I)
                cur_xqm = v.group(1) if v else None
    if not cur_xqm and xqms:
        cur_xqm = xqms[0]
    print('默认选中：xnm=%s  xqm=%s' % (cur_xnm, cur_xqm))

    # ---------- 6. 课表查询 ----------
    banner('第 6 步 / 共 6 步：POST 课表接口，逐条验证候选路径')
    candidates = [
        '/jwglxt/kbcx/xskbcx_cxXsgrkb.html?gnmkdm=N2151',
        '/jwglxt/xskbcx/xskbcx_cxXsgrkb.html?gnmkdm=N2535',
        '/jwglxt/kbcx/xskbcx_cxXsgrkb.html?gnmkdm=N253508',
        '/jwglxt/xskbcx/xskbcx_cxXsKb.html?gnmkdm=N2535',
    ]
    ok_path, ok_list = None, None
    for path in candidates:
        throttle()
        url = BASE + path
        body = 'xnm=%s&xqm=%s&kzlx=ck' % (urllib.parse.quote(cur_xnm or ''), urllib.parse.quote(cur_xqm or ''))
        print()
        print('→ POST %s' % path)
        try:
            st, hd, raw, _ = fetch(url, data=body, headers={
                'Referer': kb_page,
                'X-Requested-With': 'XMLHttpRequest',
                'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
                'Origin': BASE,
            }, tag=path)
        except Exception as e:
            print('   传输失败：%s' % e)
            continue
        s = raw.decode('utf-8', 'replace')
        print('   HTTP %s  %d 字节  前缀 %r' % (st, len(s), s[:90]))
        j = None
        try:
            j = json.loads(s)
        except Exception:
            pass
        if isinstance(j, dict) and j.get('kbList'):
            print('   ✔✔✔ 成功！kbList 有 %d 条记录' % len(j['kbList']))
            ok_path, ok_list = path, j['kbList']
            if j.get('xqjmc') or j.get('xnmmc'):
                print('   返回的学年/学期：%s / %s' % (j.get('xnmmc'), j.get('xqjmc')))
            break
        if isinstance(j, dict):
            print('   是 JSON 但无 kbList，键=%s' % list(j.keys())[:12])
        elif st == 901:
            print('   未登录（901）')
        else:
            print('   非 JSON（可能是登录页或 HTML）')

    print()
    print('=' * 70)
    if not ok_list:
        print('结论：登录成功，但 4 个课表候选路径都没返回 kbList。')
        print('      共发出 %d 个请求。' % REQ_COUNT[0])
        return 1

    print('结论：路径 %s 可用，共 %d 条课程记录' % (ok_path, len(ok_list)))
    print('=' * 70)
    print()
    print('第一手的原始记录（第 1 条）：')
    print(json.dumps(ok_list[0], ensure_ascii=False, indent=2)[:1200])

    print()
    print('-' * 70)
    print('按「课程名 @ 星期 第几节」汇总：')
    print('-' * 70)
    from collections import OrderedDict
    agg = OrderedDict()
    for it in ok_list:
        if not isinstance(it, dict):
            continue
        name = it.get('kcmc') or it.get('courseName') or '?'
        name = re.sub(r'<[^>]+>', '', name).strip()
        key = (name, it.get('xqj'), it.get('jc'), it.get('zcd'), it.get('cdmc'))
        agg.setdefault(key, []).append(it.get('jsxm') or it.get('xm') or '')
    for (name, xqj, jc, zcd, cdmc), teachers in agg.items():
        print('  %-28s 周%s 第%s节  周次[%s]  @%s  %s'
              % (name[:28], xqj, jc, zcd, cdmc, teachers[0]))

    print()
    print('共发出 %d 个请求。' % REQ_COUNT[0])
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except Exception as e:
        print('\n实测中断：%s: %s' % (type(e).__name__, e))
        sys.exit(1)

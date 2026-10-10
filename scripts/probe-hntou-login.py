# -*- coding: utf-8 -*-
"""
针对 zfjw.hntou.edu.cn 的登录链路实测脚本（只读探测 + 一次假账号登录）。

目的：验证我们 App 里的 RSA 加密方式（PKCS#1 v1.5 + base64）是否被该服务器接受。
如果服务器回「用户名或密码不正确」，说明它成功解密了我们的密文 → 加密方案正确。
如果回解密/参数类错误，说明方案不对。

用一个不存在的学号提交，不会影响任何真实账号。
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


def fetch(url, data=None, headers=None, timeout=30, tries=4):
    """该校服务器会间歇性超时（疑似限流），所以带退避重试。"""
    last = None
    for attempt in range(tries):
        h = {'User-Agent': UA, 'Accept-Language': 'zh-CN,zh;q=0.9',
             'Connection': 'close'}
        h.update(headers or {})
        body = None
        if data is not None:
            body = urllib.parse.urlencode(data).encode()
            h['Content-Type'] = 'application/x-www-form-urlencoded'
        req = urllib.request.Request(url, data=body, headers=h)
        try:
            with opener.open(req, timeout=timeout) as r:
                return r.status, dict(r.headers), r.read()
        except Exception as e:
            last = e
            if attempt < tries - 1:
                wait = 5 * (attempt + 1)
                print('    (第 %d 次超时：%s，等 %ds 重试)' % (attempt + 1, e, wait))
                time.sleep(wait)
    raise last


def hidden(html, name):
    """取 <input name="xxx" ... value=...>，注意正方页面里 value 可能不带引号
    （形如 value= 1，等号后还有空格），所以不能只按引号匹配。"""
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


# ---------- RSA（照抄 App 里的做法：PKCS#1 v1.5，输出 base64）----------
def b64_to_int(s):
    """正方返回的 modulus/exponent 是 base64（不是 hex）"""
    return int.from_bytes(base64.b64decode(s), 'big')


def pkcs1_v15_pad(msg: bytes, n_bytes: int) -> bytes:
    if len(msg) > n_bytes - 11:
        raise ValueError('密码过长')
    pad_len = n_bytes - 3 - len(msg)
    ps = bytes(random.randint(1, 255) for _ in range(pad_len))
    return b'\x00\x02' + ps + b'\x00' + msg


def rsa_encrypt_b64(password: str, modulus_b64: str, exponent_b64: str, mode='pkcs1') -> str:
    n = b64_to_int(modulus_b64)
    e = b64_to_int(exponent_b64)
    n_bytes = (n.bit_length() + 7) // 8
    msg = password.encode('utf-8')
    if mode == 'raw':
        m = int.from_bytes(b'\x00' + msg, 'big')
    else:
        m = int.from_bytes(pkcs1_v15_pad(msg, n_bytes), 'big')
    c = pow(m, e, n)
    return base64.b64encode(c.to_bytes(n_bytes, 'big')).decode()


def main():
    print('=' * 66)
    print('第 1 步：打开登录页，读隐藏字段')
    print('=' * 66)
    st, hd, raw = fetch(BASE + '/jwglxt/xtgl/login_slogin.html')
    html = raw.decode('utf-8', 'replace')
    print('HTTP %s，页面 %d 字节' % (st, len(html)))

    def hidden_val(name):
        return hidden(html, name)

    fields = {}
    for f in ['csrftoken', 'language', 'xxdm', 'mmsfjm', 'dlsfbxyzm',
              'yzcskz', 'dlsbsdsj', 'mmsrddcshkzfs', 'sfzywqh', 'dlmmsfknt']:
        v = hidden_val(f)
        fields[f] = v
        print('  %-16s = %s' % (f, v))

    print()
    print('  解读：')
    print('    mmsfjm    = %s  → %s' % (fields['mmsfjm'],
          '密码需要 RSA 加密' if fields['mmsfjm'] == '1' else '密码明文提交'))
    print('    dlsfbxyzm = %s  → %s' % (fields['dlsfbxyzm'],
          '登录时必须输验证码' if fields['dlsfbxyzm'] == '1' else '默认不要求验证码'))
    print('    yzcskz    = %s  → 连错 %s 次会触发验证码/锁定' % (fields['yzcskz'], fields['yzcskz']))
    print('    dlsbsdsj  = %s  → 锁定 %s 分钟' % (fields['dlsbsdsj'], fields['dlsbsdsj']))

    print()
    print('=' * 66)
    print('第 2 步：取 RSA 公钥')
    print('=' * 66)
    st, hd, raw = fetch(BASE + '/jwglxt/xtgl/login_getPublicKey.html?time=%d'
                        % (int(random.random() * 1e13)))
    key = json.loads(raw.decode())
    print('HTTP %s  modulus 长度 %d 字符，exponent = %s'
          % (st, len(key['modulus']), key['exponent']))
    n = b64_to_int(key['modulus'])
    print('  模数位数 = %d bit（2048 位是标准值）' % n.bit_length())

    print()
    print('=' * 66)
    print('第 3 步：用 App 的加密方式加密一个假密码并提交登录')
    print('=' * 66)
    fake_user = 'test000000'
    fake_pass = 'TestPass1234'
    enc = rsa_encrypt_b64(fake_pass, key['modulus'], key['exponent'], 'pkcs1')
    print('  明文密码 : %s' % fake_pass)
    print('  密文长度 : %d 字符（base64）' % len(enc))
    print('  密文前缀 : %s…' % enc[:32])

    form = {
        'yhm': fake_user,
        'mm': enc,
        'yzm': '',
        'csrftoken': fields['csrftoken'] or '',
        'language': fields['language'] or 'zh_CN',
        'xxdm': fields['xxdm'] or '',
        'mmsfjm': fields['mmsfjm'] or '1',
    }
    st, hd, raw = fetch(
        BASE + '/jwglxt/xtgl/login_slogin.html?time=%d' % (int(random.random() * 1e13)),
        data=form,
        headers={
            'X-Requested-With': 'XMLHttpRequest',
            'Referer': BASE + '/jwglxt/xtgl/login_slogin.html',
        })
    body = raw.decode('utf-8', 'replace')
    print('  HTTP %s，响应 %d 字节' % (st, len(body)))
    print('  重定向目标 : %s' % hd.get('Location', '(无)'))

    # 提取页面里的提示文字，判断服务器怎么看待这次提交
    text = re.sub(r'<script[\s\S]*?</script>', ' ', body)
    text = re.sub(r'<[^>]+>', ' ', text)
    text = re.sub(r'\s+', ' ', text).strip()
    print()
    print('  页面文本片段：')
    for frag in re.findall(r'[^ ]*(?:密码|用户名|学号|验证码|错误|不正确|不存在|锁定|失败)[^ ]*', text)[:8]:
        print('    · ' + frag)

    print()
    print('=' * 66)
    print('判定')
    print('=' * 66)
    if re.search(r'用户名或密码|密码错误|账号或密码|用户名不存在|用户名或密码不正确', body):
        print('  ✔ 服务器回「用户名或密码不正确」')
        print('    → 说明它成功解密了我们按 PKCS#1 v1.5 加密的密码，')
        print('      只是账号是假的。**App 的加密方式对该校有效。**')
    elif re.search(r'验证码', body):
        print('  ⚠ 服务器要求验证码（可能已触发失败计数）')
    else:
        print('  ? 未识别到明确提示，需要人工看响应')
        print('    响应片段：' + text[:300])

    print()
    print('  提示：本次探测共向教务系统发了 3 个请求（读页面 / 取公钥 / 登录）。')
    print('        该校连错 %s 次会锁 %s 分钟，但用的是不存在的账号 %s，不影响真实账号。'
          % (fields['yzcskz'], fields['dlsbsdsj'], fake_user))


if __name__ == '__main__':
    try:
        main()
    except Exception as e:
        print('探测失败：%s: %s' % (type(e).__name__, e))
        sys.exit(1)

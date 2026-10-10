#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
在没有 github.com:443 通道的网络里推送改动。

本机只能访问 api.github.com，`git push`/`git fetch` 都会报
「CONNECT tunnel failed, response 502」，于是改用 Git Data API：
上传变化的 blob → 以远端已有的 tree 为 base 建新 tree → 建 commit → 更新 ref。

只上传相对父提交有变化的文件，其余文件通过 base_tree 沿用远端已有 blob，
所以不会重传 30MB 的 OCR 模型。

因为父提交可能只存在于远端（本地 fetch 不了），变化文件是用
「本地 git ls-tree 的 blob sha」对比「远端 API 的 tree sha」算出来的，
不依赖本地有父提交这个对象。

上传的内容一律从 git 对象库取（`git cat-file blob`），不读工作区文件：
Windows 上 core.autocrlf=true 会把工作区变成 CRLF，直接读磁盘会
把 CRLF 写进仓库、并让 blob sha 对不上，导致每次都重复上传同一个文件。

凭据：先读环境变量 GH_TOKEN；没有就问系统凭据管理器，依次试
`git credential fill` 和 `git-credential-manager get`（后者是必要的——
本仓库 credential.helper 是 helper-selector，`git credential fill`
经常直接报 fatal: could not read Username，但 GCM 自己拿得到同一份凭据）。

用法：
    python scripts/push-via-api.py <远端当前 main 的 sha> [本地提交，默认 HEAD]
例：
    python scripts/push-via-api.py 5f0778f6e16a47f818039b8c730e5db1671200b1
"""
import base64
import json
import os
import subprocess
import sys
import urllib.error
import urllib.request

REPO = '2041818984/coursetable'
BRANCH = 'main'
API = 'https://api.github.com'


def sh(args, **kw):
    return subprocess.run(args, capture_output=True, text=True, **kw)


def sh_bytes(args):
    """取二进制输出"""
    return subprocess.run(args, capture_output=True).stdout


def get_token():
    tok = os.environ.get('GH_TOKEN')
    if tok:
        return tok.strip()

    # 该仓库的 credential.helper 是 helper-selector（选中了 GCM）。实践中
    # `git credential fill` 有时会因为拿不到用户名而直接失败
    # （fatal: could not read Username，且 GIT_TERMINAL_PROMPT=0 不给重试），
    # 但同一份凭据 GCM 自己是拿得到的，所以两条路都试。
    attempts = [
        (['git', 'credential', 'fill'], 'git credential fill'),
        (['git-credential-manager', 'get'], 'git-credential-manager get'),
    ]
    for args, label in attempts:
        try:
            out = subprocess.run(args, input='protocol=https\nhost=github.com\n\n',
                                 capture_output=True, text=True)
        except FileNotFoundError:
            continue
        if out.returncode != 0:
            continue
        for line in out.stdout.splitlines():
            if line.startswith('password='):
                return line[len('password='):].strip()

    print('拿不到 GitHub 凭据。试过：' + '、'.join(l for _, l in attempts))
    print('可以手动传：GH_TOKEN=<token> python scripts/push-via-api.py <父提交>')
    sys.exit(1)


TOKEN = get_token()


def api(method, path, body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(API + path, data=data, method=method)
    req.add_header('Authorization', 'Bearer ' + TOKEN)
    req.add_header('Accept', 'application/vnd.github+json')
    req.add_header('X-GitHub-Api-Version', '2022-11-28')
    if data:
        req.add_header('Content-Type', 'application/json')
    try:
        with urllib.request.urlopen(req, timeout=180) as resp:
            raw = resp.read().decode()
            return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        print('  ✘ HTTP %s  %s\n    %s' % (e.code, path, e.read().decode()[:800]))
        sys.exit(1)


def local_blobs(rev):
    """本地提交里 path -> (mode, blob sha)"""
    out = sh(['git', 'ls-tree', '-r', rev]).stdout
    d = {}
    for line in out.splitlines():
        meta, path = line.split('\t', 1)
        mode, _typ, sha = meta.split()
        d[path] = (mode, sha)
    return d


def remote_blobs(sha):
    """远端提交里 path -> (mode, blob sha)"""
    r = api('GET', '/repos/%s/git/trees/%s?recursive=1' % (REPO, sha))
    d = {}
    for e in r.get('tree', []):
        if e.get('type') == 'blob':
            d[e['path']] = (e.get('mode'), e['sha'])
    return d


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)

    base = sys.argv[1].strip()                    # 远端当前 main 的 sha
    local = sh(['git', 'rev-parse', sys.argv[2] if len(sys.argv) > 2 else 'HEAD']).stdout.strip()

    print('父提交  : ' + base)
    print('内容来源: ' + local)

    # --- 0) 确认远端 main 仍指向父提交，避免覆盖别人的提交 ---
    ref = api('GET', '/repos/%s/git/ref/heads/%s' % (REPO, BRANCH))
    now = ref.get('object', {}).get('sha')
    if now != base:
        print('  ✘ 远端 %s 已经不在 %s（现在是 %s），终止。' %
              (BRANCH, base[:7], (now or '?')[:7]))
        sys.exit(1)
    print('远端 %s 仍指向 %s，可以安全快进。' % (BRANCH, base[:7]))

    # --- 1) 算出差异（不依赖本地拥有父提交对象）---
    lset, rset = local_blobs(local), remote_blobs(base)
    changed = []
    for path, (mode, sha) in lset.items():
        if path not in rset or rset[path][1] != sha:
            changed.append((path, mode, sha))
    deleted = [p for p in rset if p not in lset]
    changed.sort()

    if not changed and not deleted:
        print('\n没有差异，什么都不用做。')
        return
    print('\n需要上传 %d 个，删除 %d 个：' % (len(changed), len(deleted)))
    for p, mode, _sha in changed:
        print('  M %s' % p)
    for p in deleted:
        print('  D %s' % p)

    # --- 2) 上传新 blob ---
    print('\n上传 blob：')
    entries = []
    for path, mode, sha in changed:
        # 关键：从 git 对象库取内容，不读工作区文件。
        # Windows 上 core.autocrlf=true 会把工作区文件变成 CRLF，
        # 直接读磁盘会把 CRLF 写进仓库（仓库里其它文件都是 LF），
        # 而且 blob sha 会和本地不一致，导致每次推送都重复上传同一个文件。
        content = sh_bytes(['git', 'cat-file', 'blob', sha])
        r = api('POST', '/repos/%s/git/blobs' % REPO, {
            'content': base64.b64encode(content).decode(),
            'encoding': 'base64',
        })
        entries.append({'path': path, 'mode': mode, 'type': 'blob', 'sha': r['sha']})
        if r['sha'] != sha:
            print('  ! %s 上传后的 sha 与本地不一致：%s ≠ %s' %
                  (path, r['sha'][:8], sha[:8]))
        print('  ✔ %-30s %7d 字节 → %s' % (path, len(content), r['sha'][:8]))
    for path in deleted:
        entries.append({'path': path, 'mode': '100644', 'type': 'blob', 'sha': None})

    # --- 3) 以远端的 tree 为底建新 tree ---
    base_tree = api('GET', '/repos/%s/git/commits/%s' % (REPO, base))['tree']['sha']
    tree = api('POST', '/repos/%s/git/trees' % REPO,
               {'base_tree': base_tree, 'tree': entries})
    print('\n新 tree: ' + tree['sha'])

    # --- 4) 建提交 ---
    msg = sh(['git', 'log', '-1', '--format=%B', local]).stdout.strip()
    commit = api('POST', '/repos/%s/git/commits' % REPO, {
        'message': msg, 'tree': tree['sha'], 'parents': [base],
    })
    print('新提交: %s' % commit['sha'])

    # --- 5) 更新 ref（非强制，不是快进就会失败，不会覆盖别人的提交）---
    upd = api('PATCH', '/repos/%s/git/refs/heads/%s' % (REPO, BRANCH),
              {'sha': commit['sha'], 'force': False})
    print('已更新 %s → %s' % (BRANCH, upd['object']['sha'][:8]))

    # --- 6) 复核 ---
    got = api('GET', '/repos/%s/commits/%s' % (REPO, commit['sha']))
    print('\n复核：%s' % got['sha'][:8])
    print('  提交信息首行: ' + got['commit']['message'].splitlines()[0])
    print('  文件树 sha  : ' + got['commit']['tree']['sha'])
    print('\n✔ 推送成功。下次再推，把这个 sha 当父提交传进来：')
    print('  python scripts/push-via-api.py ' + commit['sha'])


if __name__ == '__main__':
    main()

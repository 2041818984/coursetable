#!/usr/bin/env bash
# 把本仓库推送到 GitHub，触发云端构建出 APK。
#
# 用法（先在 GitHub 网页上建好一个**空**仓库，不要勾 README / .gitignore）：
#   bash scripts/push-to-github.sh https://github.com/<用户名>/<仓库名>.git
#
# 如果仓库地址带 .git 结尾或不带都可以，脚本都能处理。
set -e

REPO="$1"
if [ -z "$REPO" ]; then
  echo "✘ 缺少仓库地址"
  echo "用法：bash scripts/push-to-github.sh https://github.com/<用户名>/<仓库名>.git"
  exit 1
fi

cd "$(dirname "$0")/.."

echo "== 配置远端 =="
if git remote get-url origin >/dev/null 2>&1; then
  git remote set-url origin "$REPO"
  echo "已更新 origin → $REPO"
else
  git remote add origin "$REPO"
  echo "已添加 origin → $REPO"
fi

echo "== 分支改为 main =="
git branch -M main

echo "== 推送 =="
git push -u origin main

cat <<'EOF'

✔ 推送完成。接下来在浏览器里完成最后两步：

  1. 打开 https://github.com/<用户名>/<仓库名>/actions
  2. 左侧点「Build Android APK」→ 右上角 Run workflow → 选 main → 绿色按钮确认
     （推送本身也会自动触发一次，可以等它跑完，不用手动点）

  约 10 分钟后，点进那次运行记录，在页面最下方 Artifacts 区下载
  「coursetable-debug」，解压出来就是 app-debug.apk。

  下载后传到手机安装（微信会把它改名为 .apk.1，记得去掉 .1，或改用 QQ / USB 传）。
EOF

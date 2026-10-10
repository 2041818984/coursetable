#!/usr/bin/env bash
# 本地打包 APK —— 需要本机已安装 JDK 17+ 与 Android SDK
# 用法：bash scripts/build-android.sh
set -e

if [ -z "$ANDROID_HOME" ] && [ -z "$ANDROID_SDK_ROOT" ]; then
  echo "未检测到 ANDROID_HOME / ANDROID_SDK_ROOT。"
  echo "请先安装 Android Studio，或改用 GitHub Actions 云端构建（见 README）。"
  exit 1
fi

if ! command -v java >/dev/null 2>&1; then
  echo "未检测到 java，请先安装 JDK 17 或更高版本。"
  exit 1
fi

cd "$(dirname "$0")/.."

echo "==> 安装依赖"
npm install --no-audit --no-fund

if [ ! -d android ]; then
  echo "==> 生成 android 工程"
  npx cap add android
fi

echo "==> 同步前端资源"
npx cap sync android

F=android/app/src/main/AndroidManifest.xml
if ! grep -q usesCleartextTraffic "$F"; then
  echo "==> 允许 HTTP 明文访问"
  sed -i.bak '0,/<application /s//<application android:usesCleartextTraffic="true" /' "$F"
  rm -f "$F.bak"
fi

echo "==> 编译 Debug APK"
cd android
chmod +x gradlew 2>/dev/null || true
./gradlew assembleDebug

echo
echo "完成：android/app/build/outputs/apk/debug/app-debug.apk"

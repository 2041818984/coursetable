# 课表 · CourseTable

一个手机端课程表 App。前端是纯静态网页（HTML/CSS/JS），用 Capacitor 打包成安卓 APK。
所有数据保存在手机本地，不经过任何第三方服务器。

## 功能

| 功能 | 说明 |
| --- | --- |
| 周课表 | 周次切换、本周高亮、按周次过滤课程、点击空白格直接加课 |
| 教务系统导入 | 填学号密码 → 自动识别验证码 → RSA 加密密码登录 → 抓取课表 |
| 图片识别导入 | 相册选图 / 拍照 → 本地 OCR 或云端视觉大模型识别 |
| 文件导入 | 教务导出的 xls / xlsx / csv，或粘贴课表页面 HTML |
| 手动维护 | 添加、编辑、删除单门课程 |
| 数据备份 | 导出 / 导入 JSON |

三种导入都会先进入「待确认列表」，可以逐条改教师、地点、周次，勾选后再写入，不会直接覆盖已有课表。

## 目录结构

```
www/                     前端（Capacitor 的 webDir）
  index.html
  css/app.css
  js/store.js            数据模型 + localStorage 持久化
  js/bridge.js           原生 HTTP（绕过 CORS）、RSA 加密、文件读取
  js/parser.js           课表解析：周次/节次/地点/教师识别，表格与 OCR 词块还原
  js/import-jw.js        正方教务抓取流程
  js/import-ocr.js       Tesseract 本地 OCR + 视觉大模型
  js/import-file.js      xls/xlsx/csv/html 解析
  js/app.js              渲染与交互
  lib/                   已下载的 tesseract、xlsx 离线库
capacitor.config.json
.github/workflows/       云端构建 APK
scripts/build-android.sh 本地构建 APK
```

## 三种导入怎么用

### 1. 教务系统导入

1. 打开「导入 → 正方教务系统导入」
2. 填教务地址（如 `https://jwgl.你的学校.edu.cn`）和系统版本（`/jwglxt` 新版或 `/jsxsd` 旧版）
3. 点「① 获取验证码」——验证码图片会出现在「验证码」输入框右侧
4. 照图把字符填进输入框（不区分大小写；看不清就点「换一张」）
5. 填好学号、密码，点「② 登录并抓取」

**关于验证码**

- 验证码必须**先取图再填写**，顺序是 ① → ②，两步分开，不是点一次就登录。
- 如果点 ① 后验证码区域显示「取图失败」：常见原因是没连校园网 / 没开 VPN、教务地址填错、或者当前是浏览器预览（跨域被拦）。
- 有的学校登录**不需要验证码**。这时 App 会自动隐藏验证码输入框，直接填学号密码点 ② 即可。
- 登录失败提示验证码错误时，点 ① 重新取一张再填。
- 验证码接口探测不到时，展开「高级：接口路径」手动填验证码接口地址。

**注意**
- 这一路**必须在 APK 里使用**。浏览器有跨域（CORS）策略，直连一定会被拦截。
- 不少学校要求连校园网或 VPN，校外访问会连不上。
- 部分学校证书链不完整，安卓 WebView 会拒绝连接。遇到这种情况只能改用图片/文件导入。
- 如果自动探测的接口路径不对，展开面板底部「高级：接口路径」手动改。验证码、公钥、课表三个接口都能单独指定。

### 2. 图片识别导入

- **本地 OCR**：Tesseract.js 在手机上跑，先按坐标把词块还原成表格再解析，不联网也能用（首次需要下载中文模型，约十几 MB，之后缓存在本机）。复杂排版识别率一般。
- **AI 识别**：在「设置」里填接口地址、模型名、API Key（OpenAI 兼容格式）。 App 会把图片压缩后发给模型，让它直接返回结构化 JSON。准确率高很多，需要联网。

### 3. 文件 / 网页导入

最稳的兜底路线：在手机浏览器登录教务系统，打开课表页，把页面源码复制粘贴进 App；或者直接选教务导出的 xls/xlsx/csv。

## 打包 APK

`android/` 目录已经生成好了（Capacitor 工程），所以云端和本地两条路都不需要再执行 `cap add android`。

### 路线 A：GitHub Actions 云端构建（不需要本机装 Android SDK）

1. 把整个目录推到一个 GitHub 仓库
2. Settings → Secrets and variables → Actions 里不需要配任何密钥
3. Actions 页面选中 `Build Android APK`，点 Run workflow
4. 跑完后在 Artifacts 里下载 `coursetable-debug`，解压得到 `app-debug.apk`，传到手机安装

也可以直接在仓库根执行 `git push` 触发（workflow 监听 main/master 分支）。

### 路线 B：本机构建（需要 JDK 17+ 和 Android SDK）

```bash
bash scripts/build-android.sh
```

产物在 `android/app/build/outputs/apk/debug/app-debug.apk`。

想改应用名、包名、图标，编辑 `capacitor.config.json` 里的 `appName` / `appId`，图标放在 `android/app/src/main/res/` 下。

## 先在电脑上看效果

```bash
cd www
python -m http.server 8123
```

然后浏览器打开 **http://127.0.0.1:8123** 。

几个注意点：

- 端口可以随便换。**8000 经常被别的程序占用**（占着的时候访问会返回 502），如果打不开就换一个，比如 `8123`、`8899`，启动后用命令行里显示的那个端口访问。
- Windows 如果提示找不到 python，用完整路径：
  `"C:/Users/<你的用户名>/.workbuddy/binaries/python/versions/3.13.12/python.exe" -m http.server 8123`
- 服务只监听本机（`127.0.0.1`），手机连同一个 WiFi 也访问不了。想在手机上看，把项目发布成一个在线链接更省事。
- 浏览器版无法直连教务系统，这是跨域策略导致的预期行为，不是故障。

## 自测

改了解析逻辑后可以跑一遍，验证周次 / 单元格 / 表格 / 教务 JSON / OCR 词块还原 / RSA 是否被改坏：

```bash
node scripts/selftest.js
```

RSA 那几项会用 Node 内置 crypto 生成真实密钥对，再用私钥解密比对，不是自说自话。

## 已知限制

- 教务直连的成功率取决于学校的具体部署。本项目按正方系统的通用约定做了自动探测 + 手动覆盖，但**不能保证所有学校都能直接抓通**。抓不通时请用图片或文件导入。
- 本地 OCR 对合并单元格、斜线表头这类复杂排版的还原有限，识别后务必在确认列表里核对。
- 数据只存在本机，卸载 App 会清空，建议定期用「导出课表 JSON」备份。

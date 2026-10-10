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

## 最终产物在哪

**源码里没有 APK**，仓库里也不可能有——必须先在云端编译一次。完整链路：

```
本地源码（本目录）
   │  git push
   ▼
GitHub Actions 构建机（ubuntu-latest，自带 JDK 17 + Android SDK）
   │  ./gradlew assembleDebug
   ▼
构建机上的 android/app/build/outputs/apk/debug/app-debug.apk
   │  打包成 artifact
   ▼
GitHub 网页 → 那次运行记录 → 页面最下方 Artifacts → coursetable-debug.zip
   │  下载解压
   ▼
app-debug.apk  ← 你要的成品，传到手机安装
```

`android/app/build/outputs/apk/debug/app-debug.apk` 是**构建机上的路径**，在本地不存在。你拿到的地方是 GitHub 的 Artifacts 下载区。

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

1. 在 GitHub 网页上新建一个**空**仓库（不要勾 README、不要选 .gitignore，否则推送会冲突）
2. 一条命令完成推送（本地仓库已初始化并提交过，直接推即可）：

   ```bash
   bash scripts/push-to-github.sh https://github.com/<用户名>/<仓库名>.git
   ```

3. 推送本身就会自动触发一次构建（workflow 监听 main/master）。也可以手动触发：
   Actions 页面 → 左侧选 `Build Android APK` → 右上角 **Run workflow** → 选 main → 确认
4. 约 10 分钟后，点进那次运行记录，在页面最下方 **Artifacts** 区下载 `coursetable-debug`，
   解压得到 `app-debug.apk`，传到手机安装

不需要配任何密钥（Settings → Secrets 里什么都不用加），构建不依赖仓库密钥。

> `android/app/build/outputs/apk/debug/app-debug.apk` 是**构建成功后产物出现的位置**，源码里没有这个文件。
> 看到这个路径不等于 APK 已经存在——本机没有 JDK / Android SDK，从未编译过。

### 拿到 app-debug.apk 之后：装到手机上

**能不能直接用？能。** 它是 Gradle 打的 debug 包，已用 debug keystore 自动签名，装上去就能打开，不需要你再做签名。

安装步骤：

1. 把 APK 传到手机（USB 数据线拷贝、QQ「我的电脑」、邮件附件都行）
2. 手机上点开这个 APK
3. 系统问「是否允许安装未知应用」→ 给对应的来源开一次授权（Android 8+ 是按来源授权的，不是全局开关）
4. 若弹出「无法识别的应用 / Play 保护机制」提示 → 点「仍然安装」。debug 包没上架，这是正常提示

**几个真实的坑**

- **微信传 APK 会改后缀**（变成 `xxx.apk.1`），安卓认不出来装不了。传到手机后在文件管理器里把 `.1` 去掉，或者改用 QQ / USB 传。
- **要求 Android 6.0 以上**（`minSdkVersion 23`），2016 年后的机器基本都满足。
- **debug 包有时间限制吗？没有。** 但它是开发版，Android 15+ 可能在安装时多一步确认，不影响使用。

**装好之后**

- 课表、手动添加、文件导入、图片识别 —— 都能离线用（图片识别的本地 OCR 首次要联网下载十几 MB 的中文模型，之后离线可用）。
- **教务系统直连需要手机在校园网里**，或者先连学校 VPN。校外 4G/5G 大概率连不上教务服务器，这是学校网络策略，不是 App 的问题。
- 教务直连这条路我没法针对你们学校实测，抓不通就用图片或文件导入。

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

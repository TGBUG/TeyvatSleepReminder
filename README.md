# 提瓦特 · 歇息之铃

一个原神风格的 Windows 睡觉提醒小工具。在设定时段内，按设定频率在屏幕上方弹出一条金色横幅，提醒旅行者放下手柄、去好好休息。

![设置界面](docs/preview-settings.png)

![屏幕顶部提醒](docs/preview-banner.png)

## 功能

- **自定时段**：支持跨午夜，例如 23:00 → 07:00；起止时间相同视为全天。
- **自定频率**：每 N 分钟提醒一次，可设置每次显示时长。
- **屏幕上方横幅**：无边框、置顶、不抢焦点，支持所有显示器。
- **原神风视觉**：金色描边、深蓝夜幕、小铃吉祥物、星屑与呼吸动画。
- **提示音**：内置竖琴 / 风铃两种合成音色，可调音量或静音。
- **托盘常驻**：暂停 / 恢复、立即提醒、打开设置、开机自启、退出。
- **鼠标穿透**：默认只有横幅本身可点击，四周空白区域不阻挡桌面操作。
- **本地配置**：所有设置保存在 %APPDATA%\TeyvatSleepReminder\config.json，不联网。

## 直接使用

1. 解压 TeyvatSleepReminder-v1.0.1-win64.zip。
2. 双击 TeyvatSleepReminder.exe。
3. 设置时段与频率，点击「保存并应用」。

无需安装。适用 Windows 10 / 11 x64。

默认是 **23:00 – 07:00，每 30 分钟一次，显示 12 秒**。启动时如果正处在时段内，会立即提醒一次，之后按「时段起点 + 间隔」对齐；例如 23:00 开始、30 分钟间隔，就在 23:00、23:30、00:00……出现。

关闭设置窗口不会退出程序，横幅和托盘会继续工作。彻底退出请使用托盘菜单的「退出」。

> 首次运行可能被 SmartScreen 提示「未知发布者」，这是未签名便携程序的正常现象；可选择「更多信息 → 仍要运行」。

## 开发与测试

需要 Node.js 20+。

~~~bash
npm install
npm start          # 启动设置界面
npm run demo       # 同时展示一条预览横幅
npm test           # 时段 / 频率纯逻辑单元测试
npm run selftest   # Electron 端到端自测（保存、预览、定时触发）
~~~

Linux 下如需无显示器运行，可配合 Xvfb：

~~~bash
DISPLAY=:99 TZ=Asia/Shanghai TEYVAT_DATA_DIR=$PWD/devdata \
  ./node_modules/.bin/electron --no-sandbox --disable-dev-shm-usage --disable-gpu . --selftest
~~~

## 构建 Windows 包

在 Linux 上交叉构建（需要 curl、unzip、zip、Node.js）：

~~~bash
bash scripts/build-win.sh
~~~

脚本会下载 Electron 38.8.6 win32-x64、组装便携目录、写入 exe 图标与版本信息，输出：

- dist/TeyvatSleepReminder-win32-x64/
- dist/TeyvatSleepReminder-v1.0.1-win64.zip
- dist/TeyvatSleepReminder-v1.0.1-win64.sha256.txt

## 说明与限制

- 这是**非官方同人风格**工具；界面为原创 CSS / SVG，吉祥物素材由用户提供并已做透明圆角处理。
- Electron 的无边框透明窗口在 Windows 10/11 的 DWM 合成下正常；独占全屏游戏可能盖不住横幅，建议游戏使用「无边框窗口」模式。
- 开机自启写入当前用户注册表 HKCU\Software\Microsoft\Windows\CurrentVersion\Run。移动解压目录后需要在设置里关闭再重新开启一次。
- 提醒只按本地时间计算；系统休眠错过的提醒不会补发多条，唤醒后最多显示当前时段的一条。
- 程序未做代码签名；企业环境或 SmartScreen 严格模式可能拦截。

## 目录

~~~
src/main.js               Electron 主进程、托盘、调度、窗口
src/preload.js            安全 IPC 桥
src/core/schedule.js      时段 / 槽位计算（纯函数）
src/core/config.js        配置校验与默认值
src/core/autostart.js     Windows 注册表开机自启
src/renderer/             设置页、横幅、音效
assets/                   应用图标、小铃、tray 图标
test/                     单元测试
scripts/build-win.sh      Windows 便携包构建
~~~

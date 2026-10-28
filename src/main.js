'use strict';

const {
  app, BrowserWindow, ipcMain, screen, Tray, Menu, nativeImage, shell, powerMonitor
} = require('electron');
const path = require('path');
const fs = require('fs');
const { DEFAULT_CONFIG, normalizeConfig } = require('./core/config');
const { getScheduleState, formatClock, describeWindow } = require('./core/schedule');
const { setAutoStart, isAutoStartEnabled, supported: autoStartSupported } = require('./core/autostart');

const IS_CAPTURE = process.argv.includes('--capture') && !app.isPackaged;
const IS_HIDDEN = process.argv.includes('--hidden');
const IS_DEMO = process.argv.includes('--demo');
const IS_SELFTEST = process.argv.includes('--selftest') && !app.isPackaged;

if (process.env.TEYVAT_DATA_DIR) {
  fs.mkdirSync(process.env.TEYVAT_DATA_DIR, { recursive: true });
  app.setPath('userData', path.resolve(process.env.TEYVAT_DATA_DIR));
}

app.setName('TeyvatSleepReminder');
app.setAppUserModelId('com.teyvat.sleepreminder');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

const DATA_DIR = app.getPath('userData');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');
const LOG_FILE = path.join(DATA_DIR, 'app.log');
const RENDERER_DIR = path.join(__dirname, 'renderer');
const ASSET_DIR = path.join(__dirname, '..', 'assets');
const ICON_FILE = path.join(ASSET_DIR, 'icon.png');
const TRAY_FILE = path.join(ASSET_DIR, 'tray.png');
const TRAY_FILE_2X = path.join(ASSET_DIR, 'tray@2x.png');
const MAX_LOG_BYTES = 512 * 1024;

let config = { ...DEFAULT_CONFIG };
let settingsWindow = null;
let tray = null;
let isQuitting = false;
let lastSlotKey = null;
let lastFiredAt = null;
let screenLocked = false;
let captureMode = IS_CAPTURE || IS_SELFTEST;
let tickTimer = null;
let overlayHideTimer = null;
let overlayGeneration = 0;
let lastTrayTooltip = '';
let trayHintShown = false;
const overlayWindows = new Map();
const hideTimers = new Set();

fs.mkdirSync(DATA_DIR, { recursive: true });
rotateLog();

function rotateLog() {
  try {
    if (fs.existsSync(LOG_FILE) && fs.statSync(LOG_FILE).size > MAX_LOG_BYTES) {
      fs.renameSync(LOG_FILE, LOG_FILE + '.old');
    }
  } catch (_) { /* logging must never break the app */ }
}

function log(...args) {
  const line = '[' + new Date().toISOString() + '] ' + args.map((value) => {
    if (value instanceof Error) return value.stack || value.message;
    if (typeof value === 'object') {
      try { return JSON.stringify(value); } catch (_) { return String(value); }
    }
    return String(value);
  }).join(' ');
  try { fs.appendFileSync(LOG_FILE, line + '\n'); } catch (_) { /* ignore */ }
  console.log(line);
}

function loadConfig() {
  try {
    if (!fs.existsSync(CONFIG_FILE)) {
      config = normalizeConfig(DEFAULT_CONFIG);
      return;
    }
    const raw = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    config = normalizeConfig(raw);
  } catch (error) {
    log('读取配置失败，使用默认配置:', error);
    config = normalizeConfig(DEFAULT_CONFIG);
  }
}

function saveConfigFile() {
  try {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf8');
  } catch (error) {
    log('保存配置失败:', error);
  }
}

loadConfig();

function getPrimaryDisplay() {
  return screen.getPrimaryDisplay();
}

function targetDisplays(cfg = config) {
  if (cfg.allDisplays) return screen.getAllDisplays();
  return [getPrimaryDisplay()];
}

function displayKey(display) {
  return String(display.id);
}

function makeWindowIcon() {
  try {
    if (fs.existsSync(ICON_FILE)) return nativeImage.createFromPath(ICON_FILE);
  } catch (_) { /* ignore */ }
  return nativeImage.createEmpty();
}

function formatRelativeDay(target, now = new Date()) {
  const start = (date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const diff = Math.round((start(target) - start(now)) / (24 * 60 * 60 * 1000));
  if (diff === 0) return '今天';
  if (diff === 1) return '明天';
  if (diff === 2) return '后天';
  return '周' + '日一二三四五六'[target.getDay()];
}

function nextLabel(iso, now = new Date()) {
  if (!iso) return '—';
  const date = new Date(iso);
  return formatRelativeDay(date, now) + ' ' + formatClock(date);
}

function buildStatus() {
  const now = new Date();
  const schedule = getScheduleState(now, config);
  const window = describeWindow(config);
  return {
    enabled: config.enabled,
    active: config.enabled && schedule.active,
    inWindow: schedule.inWindow,
    nextAt: schedule.nextAt,
    nextLabel: nextLabel(schedule.nextAt, now),
    secondsToNext: schedule.secondsToNext,
    secondsToWindowEnd: schedule.secondsToWindowEnd,
    windowStart: schedule.windowStart,
    windowEnd: schedule.windowEnd,
    lastFiredAt,
    now: now.toISOString(),
    window,
    meta: {
      version: app.getVersion(),
      isPackaged: app.isPackaged,
      autoStartSupported: autoStartSupported(),
      dataDir: DATA_DIR,
      platform: process.platform
    }
  };
}

function broadcastStatus() {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.webContents.send('status:update', buildStatus());
  }
}

function updateTrayTooltip(status) {
  if (!tray) return;
  let text;
  if (!config.enabled) text = '提瓦特歇息之铃 · 已暂停';
  else if (status.inWindow) text = '提瓦特歇息之铃 · 下次 ' + status.nextLabel;
  else text = '提瓦特歇息之铃 · 等待 ' + config.startTime;
  if (text !== lastTrayTooltip) {
    lastTrayTooltip = text;
    tray.setToolTip(text);
  }
}

function showTrayHint() {
  if (trayHintShown || !tray || process.platform !== 'win32') return;
  trayHintShown = true;
  try {
    tray.displayBalloon({
      title: '提瓦特歇息之铃',
      content: '已收起到系统托盘，休息提醒会继续生效。',
      iconType: 'info'
    });
  } catch (error) {
    log('显示托盘提示失败:', error);
  }
}

function createSettingsWindow() {
  if (settingsWindow && !settingsWindow.isDestroyed()) return settingsWindow;

  const display = getPrimaryDisplay();
  const width = Math.min(1080, Math.max(780, display.workArea.width - 80));
  const height = Math.min(760, Math.max(540, display.workArea.height - 60));

  settingsWindow = new BrowserWindow({
    width,
    height,
    minWidth: 780,
    minHeight: 540,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    roundedCorners: true,
    hasShadow: false,
    resizable: true,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: false,
    icon: makeWindowIcon(),
    title: '提瓦特歇息之铃',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false,
      backgroundThrottling: false
    }
  });

  settingsWindow.loadFile(path.join(RENDERER_DIR, 'settings.html'));
  settingsWindow.setMenuBarVisibility(false);
  settingsWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  settingsWindow.webContents.on('will-navigate', (event) => event.preventDefault());

  settingsWindow.once('ready-to-show', () => {
    if (!IS_HIDDEN && !captureMode) {
      settingsWindow.show();
      settingsWindow.focus();
    }
  });

  settingsWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      settingsWindow.hide();
      showTrayHint();
      if (!tray) {
        isQuitting = true;
        app.quit();
      }
    }
  });

  settingsWindow.on('closed', () => { settingsWindow = null; });
  settingsWindow.webContents.on('render-process-gone', (_event, details) => {
    log('设置窗口渲染进程退出:', details);
  });
  return settingsWindow;
}

function showSettings() {
  const win = createSettingsWindow();
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function overlayBounds(display) {
  const width = Math.min(940, Math.max(460, display.workArea.width));
  const height = 260;
  return {
    width,
    height,
    x: Math.round(display.workArea.x + (display.workArea.width - width) / 2),
    y: Math.round(display.workArea.y + 10)
  };
}

function ensureOverlayWindow(display) {
  const key = displayKey(display);
  let win = overlayWindows.get(key);
  if (win && !win.isDestroyed()) return win;

  const bounds = overlayBounds(display);
  win = new BrowserWindow({
    ...bounds,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    focusable: true,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    acceptFirstMouse: true,
    icon: makeWindowIcon(),
    title: '提瓦特歇息之铃',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false,
      backgroundThrottling: false
    }
  });

  win.setAlwaysOnTop(true, 'screen-saver');
  try {
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  } catch (_) { /* not supported on every platform */ }
  win.setSkipTaskbar(true);
  win.setIgnoreMouseEvents(config.clickThrough, { forward: true });
  win.__ready = false;
  win.__pending = null;
  win.__displayId = display.id;
  win.__clickThrough = Boolean(config.clickThrough);
  win.setIgnoreMouseEvents(true, { forward: true });

  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event) => event.preventDefault());
  win.webContents.on('did-start-loading', () => { win.__ready = false; });
  win.webContents.on('render-process-gone', (_event, details) => {
    log('提示窗口渲染进程退出:', details);
    win.__ready = false;
  });
  win.on('closed', () => {
    overlayWindows.delete(key);
  });

  win.loadFile(path.join(RENDERER_DIR, 'overlay.html'));
  overlayWindows.set(key, win);
  return win;
}

function syncOverlayWindows(cfg = config) {
  const targets = targetDisplays(cfg);
  const wanted = new Set(targets.map(displayKey));

  for (const [key, win] of overlayWindows.entries()) {
    if (!wanted.has(key)) {
      try { win.destroy(); } catch (_) { /* ignore */ }
      overlayWindows.delete(key);
    }
  }

  for (const display of targets) {
    const win = ensureOverlayWindow(display);
    const bounds = overlayBounds(display);
    try {
      win.setBounds(bounds);
      win.__clickThrough = Boolean(cfg.clickThrough);
      win.setIgnoreMouseEvents(true, { forward: true });
    } catch (_) { /* ignore */ }
  }
}

function setAllOverlaysClickThrough(enabled) {
  for (const win of overlayWindows.values()) {
    if (win.isDestroyed()) continue;
    win.__clickThrough = Boolean(enabled);
    try {
      if (enabled) win.setIgnoreMouseEvents(true, { forward: true });
    } catch (_) { /* ignore */ }
  }
}

function hideOverlays() {
  overlayGeneration += 1;
  const generation = overlayGeneration;
  clearTimeout(overlayHideTimer);
  overlayHideTimer = null;

  for (const win of overlayWindows.values()) {
    if (!win.isDestroyed() && win.__ready) {
      win.webContents.send('overlay:hide');
    }
  }

  const timer = setTimeout(() => {
    hideTimers.delete(timer);
    if (generation !== overlayGeneration) return;
    for (const win of overlayWindows.values()) {
      if (!win.isDestroyed()) {
        win.hide();
        try { win.setIgnoreMouseEvents(true, { forward: true }); } catch (_) { /* ignore */ }
      }
    }
  }, 480);
  hideTimers.add(timer);
}

function showOverlay(payload) {
  overlayGeneration += 1;
  const generation = overlayGeneration;
  clearTimeout(overlayHideTimer);
  overlayHideTimer = null;

  const targets = targetDisplays({ allDisplays: Boolean(payload.allDisplays) });
  const wanted = new Set(targets.map(displayKey));
  for (const [key, win] of overlayWindows.entries()) {
    if (!wanted.has(key)) {
      try { win.destroy(); } catch (_) { /* ignore */ }
      overlayWindows.delete(key);
    }
  }

  targets.forEach((display, index) => {
    const win = ensureOverlayWindow(display);
    const bounds = overlayBounds(display);
    try { win.setBounds(bounds); } catch (_) { /* ignore */ }
    const perWindow = {
      ...payload,
      playSound: index === 0 && payload.playSound !== false
    };
    win.__clickThrough = Boolean(payload.clickThrough);
    try { win.setIgnoreMouseEvents(true, { forward: true }); } catch (_) { /* ignore */ }

    if (win.__ready) {
      win.webContents.send('overlay:show', perWindow);
      win.showInactive();
    } else {
      win.__pending = perWindow;
    }
  });

  const durationMs = Math.max(4000, Number(payload.durationMs) || 12000);
  overlayHideTimer = setTimeout(() => {
    if (generation === overlayGeneration) hideOverlays();
  }, durationMs + 1500);
}

function showReminder(cfg, options = {}) {
  const schedule = getScheduleState(new Date(), cfg);
  const preview = Boolean(options.preview);
  const payload = {
    title: cfg.title,
    message: cfg.message,
    eyebrow: preview ? '提醒预览' : '小铃的提醒',
    badge: preview ? '预览' : '休息提醒',
    nextText: preview
      ? '预览模式 · 不会改变定时提醒'
      : cfg.enabled
        ? '下次提醒 · ' + nextLabel(schedule.nextAt)
        : '提醒已暂停 · 可在设置中恢复',
    durationMs: Math.max(4000, cfg.displaySeconds * 1000),
    showCountdown: cfg.showCountdown,
    sound: cfg.sound,
    volume: cfg.volume,
    playSound: cfg.sound !== 'none',
    clickThrough: cfg.clickThrough,
    allDisplays: cfg.allDisplays,
    preview
  };
  setAllOverlaysClickThrough(cfg.clickThrough);
  showOverlay(payload);
  log(preview ? '显示提醒预览' : '显示定时提醒', {
    title: cfg.title,
    nextAt: schedule.nextAt,
    displays: targetDisplays(cfg).length
  });
}

function markScheduleChanged() {
  lastSlotKey = null;
}

function scheduleTick() {
  if (!config.enabled || captureMode || screenLocked) return;
  const now = new Date();
  const schedule = getScheduleState(now, config);
  if (!schedule.active) {
    lastSlotKey = null;
    return;
  }
  if (schedule.slotKey && schedule.slotKey !== lastSlotKey) {
    lastSlotKey = schedule.slotKey;
    lastFiredAt = now.toISOString();
    showReminder(config);
  }
}

function startTicker() {
  let lastMinute = -1;
  tickTimer = setInterval(() => {
    const now = new Date();
    const status = buildStatus();
    updateTrayTooltip(status);
    if (settingsWindow && !settingsWindow.isDestroyed() && settingsWindow.isVisible()) {
      settingsWindow.webContents.send('status:update', status);
    }
    scheduleTick();
    if (now.getMinutes() !== lastMinute) {
      lastMinute = now.getMinutes();
      refreshTrayMenu();
    }
  }, 1000);
}

function updateTrayMenu() {
  if (!tray) return;
  const template = [
    {
      label: '立即提醒一次',
      click: () => showReminder(config)
    },
    {
      label: config.enabled ? '暂停提醒' : '恢复提醒',
      click: async () => {
        config = normalizeConfig({ ...config, enabled: !config.enabled });
        if (config.enabled) markScheduleChanged();
        saveConfigFile();
        refreshTrayMenu();
        broadcastStatus();
      }
    },
    { type: 'separator' },
    { label: '打开设置', accelerator: 'CmdOrCtrl+,', click: showSettings },
    {
      label: '开机自启',
      type: 'checkbox',
      checked: Boolean(config.autoStart),
      enabled: autoStartSupported(),
      click: async (item) => {
        config = normalizeConfig({ ...config, autoStart: item.checked });
        saveConfigFile();
        const result = await setAutoStart(item.checked);
        if (!result.ok) log('开机自启设置失败:', result.message);
        refreshTrayMenu();
        broadcastStatus();
      }
    },
    { type: 'separator' },
    {
      label: '退出',
      click: () => {
        isQuitting = true;
        app.quit();
      }
    }
  ];
  tray.setContextMenu(Menu.buildFromTemplate(template));
}

function refreshTrayMenu() {
  updateTrayMenu();
  updateTrayTooltip(buildStatus());
}

function createTray() {
  if (IS_CAPTURE) return;
  try {
    const image = fs.existsSync(TRAY_FILE) ? nativeImage.createFromPath(TRAY_FILE) : makeWindowIcon();
    if (fs.existsSync(TRAY_FILE_2X)) {
      try {
        const image2x = nativeImage.createFromPath(TRAY_FILE_2X);
        if (!image2x.isEmpty()) {
          image.addRepresentation({ scaleFactor: 2, buffer: fs.readFileSync(TRAY_FILE_2X) });
        }
      } catch (error) {
        log('加载高分屏托盘图标失败:', error);
      }
    }
    tray = new Tray(image);
    tray.on('click', showSettings);
    tray.on('double-click', showSettings);
    updateTrayMenu();
    updateTrayTooltip(buildStatus());
  } catch (error) {
    log('创建系统托盘失败，将以普通窗口模式运行:', error);
    tray = null;
  }
}

async function syncAutostartOnLaunch() {
  if (!autoStartSupported()) return;
  try {
    const registered = await isAutoStartEnabled();
    if (config.autoStart && !registered) {
      const result = await setAutoStart(true);
      if (!result.ok) log('启动时同步开机自启失败:', result.message);
    } else if (!config.autoStart && registered) {
      await setAutoStart(false);
    }
  } catch (error) {
    log('同步开机自启异常:', error);
  }
}

function registerIpc() {
  ipcMain.handle('config:get', () => ({
    config,
    status: buildStatus(),
    meta: buildStatus().meta
  }));

  ipcMain.handle('config:save', async (_event, raw) => {
    const previous = config;
    const next = normalizeConfig(raw);
    const scheduleChanged =
      previous.startTime !== next.startTime ||
      previous.endTime !== next.endTime ||
      previous.intervalMinutes !== next.intervalMinutes ||
      previous.enabled !== next.enabled;

    config = next;
    saveConfigFile();
    if (scheduleChanged) markScheduleChanged();

    const warnings = [];
    if (previous.autoStart !== next.autoStart) {
      const result = await setAutoStart(next.autoStart);
      if (!result.ok) warnings.push(result.message);
    }

    syncOverlayWindows();
    setAllOverlaysClickThrough(config.clickThrough);
    refreshTrayMenu();
    broadcastStatus();
    log('配置已保存', config);
    return { ok: true, config, status: buildStatus(), warnings, meta: buildStatus().meta };
  });

  ipcMain.handle('config:reset', async () => {
    const previous = config;
    config = normalizeConfig(DEFAULT_CONFIG);
    if (config.autoStart !== previous.autoStart) {
      await setAutoStart(config.autoStart);
    }
    saveConfigFile();
    markScheduleChanged();
    syncOverlayWindows();
    setAllOverlaysClickThrough(config.clickThrough);
    refreshTrayMenu();
    broadcastStatus();
    return { ok: true, config, status: buildStatus(), warnings: [], meta: buildStatus().meta };
  });

  ipcMain.handle('reminder:preview', (_event, raw) => {
    const draft = normalizeConfig(raw);
    showReminder(draft, { preview: true });
    return { ok: true };
  });

  ipcMain.handle('reminder:now', () => {
    showReminder(config);
    return { ok: true };
  });

  ipcMain.handle('status:get', () => buildStatus());

  ipcMain.handle('schedule:set-enabled', (_event, enabled) => {
    config = normalizeConfig({ ...config, enabled: Boolean(enabled) });
    if (config.enabled) markScheduleChanged();
    saveConfigFile();
    refreshTrayMenu();
    broadcastStatus();
    return { ok: true, config, status: buildStatus() };
  });

  ipcMain.handle('app:open-data', async () => {
    const result = await shell.openPath(DATA_DIR);
    return { ok: !result, error: result || null };
  });

  ipcMain.on('window:minimize', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win) win.minimize();
  });

  ipcMain.on('window:close', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win) win.close();
  });

  ipcMain.on('app:quit', () => {
    isQuitting = true;
    app.quit();
  });

  ipcMain.on('overlay:ready', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return;
    win.__ready = true;
    if (win.__pending) {
      const payload = win.__pending;
      win.__pending = null;
      win.webContents.send('overlay:show', payload);
      win.showInactive();
    }
  });

  ipcMain.on('overlay:dismiss', () => {
    hideOverlays();
  });

  ipcMain.on('overlay:set-interactive', (event, inside) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win || win.isDestroyed()) return;
    try {
      if (win.__clickThrough) {
        win.setIgnoreMouseEvents(true, { forward: true });
      } else {
        win.setIgnoreMouseEvents(!inside, { forward: true });
      }
    } catch (_) { /* not supported */ }
  });
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runSelfTest() {
  const checks = [];
  const assert = (condition, name, details) => {
    checks.push({ name, ok: Boolean(condition), details: details === undefined ? null : details });
    if (!condition) {
      throw new Error('SELFTEST FAILED: ' + name + (details ? ' — ' + JSON.stringify(details) : ''));
    }
  };

  try {
    const win = settingsWindow || createSettingsWindow();
    if (win.webContents.isLoading()) {
      await new Promise((resolve) => win.webContents.once('did-finish-load', resolve));
    }
    await wait(1100);

    const initial = await win.webContents.executeJavaScript('window.sleepAPI.getConfig()');
    assert(initial && initial.config && initial.status, 'getConfig returns config and status', initial);
    assert(initial.config.startTime === '23:00', 'default start time is 23:00', initial.config.startTime);

    const saved = await win.webContents.executeJavaScript(`(async () => {
      const set = (id, value) => {
        const el = document.getElementById(id);
        if (el.type === 'checkbox') el.checked = value;
        else el.value = value;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      };
      set('startTime', '23:30');
      set('endTime', '07:30');
      set('intervalMinutes', '45');
      set('displaySeconds', '9');
      set('title', '自测提醒');
      set('message', '第一行测试文案\\n第二行测试文案');
      set('volume', '35');
      set('showCountdown', false);
      set('clickThrough', false);
      set('allDisplays', false);
      set('enabled', true);
      document.getElementById('saveBtn').click();
      await new Promise((resolve) => setTimeout(resolve, 1000));
      return window.sleepAPI.getConfig();
    })()`);
    assert(saved.config.startTime === '23:30', 'save persists start time', saved.config.startTime);
    assert(saved.config.endTime === '07:30', 'save persists end time', saved.config.endTime);
    assert(saved.config.intervalMinutes === 45, 'save persists interval', saved.config.intervalMinutes);
    assert(saved.config.displaySeconds === 9, 'save persists duration', saved.config.displaySeconds);
    assert(saved.config.title === '自测提醒', 'save persists title', saved.config.title);

    const fileConfig = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    assert(fileConfig.title === '自测提醒', 'config file matches saved title', fileConfig.title);
    assert(fileConfig.intervalMinutes === 45, 'config file matches interval', fileConfig.intervalMinutes);

    const midnight = await win.webContents.executeJavaScript(`(async () => {
      const set = (id, value) => {
        const el = document.getElementById(id);
        el.value = value;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      };
      set('startTime', '00:00');
      set('endTime', '08:00');
      document.getElementById('saveBtn').click();
      await new Promise((resolve) => setTimeout(resolve, 900));
      return window.sleepAPI.getConfig();
    })()`);
    assert(midnight.config.startTime === '00:00', 'midnight start time saves', midnight.config.startTime);
    assert(midnight.config.endTime === '08:00', 'midnight end time saves', midnight.config.endTime);

    await win.webContents.executeJavaScript(`window.sleepAPI.preview({
      startTime: '23:30', endTime: '07:30', intervalMinutes: 45, displaySeconds: 9,
      title: '预览测试', message: '预览第一行\\n预览第二行', sound: 'none', volume: 0.3,
      showCountdown: true, clickThrough: false, allDisplays: false
    })`);
    await wait(700);
    const previewWin = overlayWindows.get(displayKey(getPrimaryDisplay()));
    assert(previewWin && previewWin.isVisible(), 'preview makes overlay visible');
    const previewTitle = await previewWin.webContents.executeJavaScript("document.getElementById('title').textContent");
    assert(previewTitle === '预览测试', 'preview renders title', previewTitle);

    // Now verify the real scheduler fires a reminder by placing the window
    // around the current local time and letting the one-second ticker run.
    const now = new Date();
    const start = new Date(now.getTime() - 2 * 60 * 1000);
    const end = new Date(now.getTime() + 30 * 60 * 1000);
    config = normalizeConfig({
      ...config,
      enabled: true,
      startTime: formatClock(start),
      endTime: formatClock(end),
      intervalMinutes: 1,
      title: '定时测试',
      message: '调度器按时出现。',
      sound: 'none',
      displaySeconds: 8
    });
    markScheduleChanged();
    captureMode = false;
    await wait(1800);
    const scheduledWin = overlayWindows.get(displayKey(getPrimaryDisplay()));
    assert(scheduledWin && scheduledWin.isVisible(), 'scheduler makes overlay visible');
    const scheduledText = await scheduledWin.webContents.executeJavaScript("(() => ({ title: document.getElementById('title').textContent, eyebrow: document.getElementById('eyebrow').textContent }))()");
    assert(scheduledText.title === '定时测试', 'scheduler renders configured title', scheduledText);
    assert(scheduledText.eyebrow === '小铃的提醒', 'scheduler uses reminder eyebrow', scheduledText.eyebrow);

    const status = buildStatus();
    assert(status.active === true, 'status reports active window', status);
    assert(status.nextAt, 'status includes next reminder timestamp', status.nextAt);

    log('SELFTEST PASS', { count: checks.length, checks });
    isQuitting = true;
    app.exit(0);
  } catch (error) {
    log('SELFTEST FAIL', { error: error.message, checks });
    isQuitting = true;
    app.exit(1);
  }
}

async function captureScreens() {
  const outDir = path.join(app.getAppPath(), 'build', 'screenshots');
  fs.mkdirSync(outDir, { recursive: true });

  const win = createSettingsWindow();
  if (win.webContents.isLoading()) {
    await new Promise((resolve) => win.webContents.once('did-finish-load', resolve));
  }
  if (process.env.TEYVAT_CAPTURE_SIZE) {
    const match = /^(\d+)x(\d+)$/.exec(process.env.TEYVAT_CAPTURE_SIZE);
    if (match) {
      win.setContentSize(Number(match[1]), Number(match[2]));
      await new Promise((resolve) => setTimeout(resolve, 500));
      try {
        const layoutDebug = await win.webContents.executeJavaScript(`(() => {
          const rect = (sel) => {
            const el = document.querySelector(sel);
            if (!el) return null;
            const r = el.getBoundingClientRect();
            const cs = getComputedStyle(el);
            return { x: r.x, y: r.y, w: r.width, h: r.height, display: cs.display, grid: cs.gridTemplateColumns, overflowX: cs.overflowX, minWidth: cs.minWidth };
          };
          return {
            inner: [innerWidth, innerHeight],
            doc: [document.documentElement.clientWidth, document.documentElement.clientHeight],
            app: rect('.app'), sidebar: rect('.sidebar'), main: rect('.main'),
            scroll: rect('.main-scroll'), hero: rect('.hero'), card: rect('.card'),
            footer: rect('.footer'), actions: rect('.footer-actions'), note: rect('.footer-note')
          };
        })()`);
        log('layout debug', layoutDebug);
      } catch (error) { log('layout debug failed', error); }
    }
  }
  win.showInactive();
  await new Promise((resolve) => setTimeout(resolve, 1800));
  const settingsImage = await win.webContents.capturePage();
  fs.writeFileSync(path.join(outDir, 'settings.png'), settingsImage.toPNG());

  for (const id of ['section-frequency', 'section-content', 'section-sound', 'section-behavior']) {
    await win.webContents.executeJavaScript(`(() => {
      const scroller = document.getElementById('mainScroll');
      const section = document.getElementById('${id}');
      scroller.scrollTop = section.offsetTop - 18;
    })()`);
    await new Promise((resolve) => setTimeout(resolve, 500));
    const sectionImage = await win.webContents.capturePage();
    fs.writeFileSync(path.join(outDir, 'settings-' + id.replace('section-', '') + '.png'), sectionImage.toPNG());
  }

  showReminder({ ...config, enabled: true }, { preview: true });
  await new Promise((resolve) => setTimeout(resolve, 1700));
  const target = overlayWindows.get(displayKey(getPrimaryDisplay()));
  if (target) {
    const overlayImage = await target.webContents.capturePage();
    fs.writeFileSync(path.join(outDir, 'overlay.png'), overlayImage.toPNG());
    try {
      const debug = await target.webContents.executeJavaScript(`(() => {
        const p = document.getElementById('progress');
        const b = document.getElementById('banner');
        const cs = getComputedStyle(p);
        const r = p.getBoundingClientRect();
        const br = b.getBoundingClientRect();
        return {
          progress: { x: r.x, y: r.y, width: r.width, height: r.height, display: cs.display, opacity: cs.opacity, transform: cs.transform, animation: cs.animationName, bg: cs.backgroundColor },
          banner: { x: br.x, y: br.y, width: br.width, height: br.height },
          viewport: { width: innerWidth, height: innerHeight }
        };
      })()`);
      log('overlay debug', debug);
    } catch (error) {
      log('overlay debug failed', error);
    }
  }

  await new Promise((resolve) => setTimeout(resolve, 300));
  isQuitting = true;
  app.quit();
}

const hasLock = app.requestSingleInstanceLock();
if (!hasLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (settingsWindow && !settingsWindow.isDestroyed()) {
      if (settingsWindow.isMinimized()) settingsWindow.restore();
      settingsWindow.show();
      settingsWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    log('应用启动', { version: app.getVersion(), packaged: app.isPackaged, dataDir: DATA_DIR });
    registerIpc();
    createSettingsWindow();
    createTray();
    syncOverlayWindows();
    startTicker();
    await syncAutostartOnLaunch();

    if (IS_CAPTURE) {
      try {
        await captureScreens();
      } catch (error) {
        log('截图失败:', error);
        isQuitting = true;
        app.quit();
      }
      return;
    }

    if (IS_SELFTEST) {
      await runSelfTest();
      return;
    }

    if (IS_DEMO) {
      setTimeout(() => showReminder(config, { preview: true }), 900);
    }

    powerMonitor.on('resume', () => {
      log('系统从睡眠中恢复');
      scheduleTick();
      broadcastStatus();
    });

    powerMonitor.on('lock-screen', () => {
      screenLocked = true;
      log('系统锁屏，暂停提醒');
      hideOverlays();
    });

    powerMonitor.on('unlock-screen', () => {
      screenLocked = false;
      log('系统解锁，恢复提醒');
      markScheduleChanged();
      scheduleTick();
      broadcastStatus();
    });

    screen.on('display-metrics-changed', () => {
      syncOverlayWindows();
    });
    screen.on('display-added', () => {
      syncOverlayWindows();
    });
    screen.on('display-removed', () => {
      syncOverlayWindows();
    });
  }).catch((error) => {
    log('启动失败:', error);
    isQuitting = true;
    app.quit();
  });

  app.on('activate', showSettings);

  app.on('before-quit', () => {
    isQuitting = true;
    if (tickTimer) clearInterval(tickTimer);
    if (overlayHideTimer) clearTimeout(overlayHideTimer);
    for (const timer of hideTimers) clearTimeout(timer);
    hideTimers.clear();
    if (tray) {
      try { tray.destroy(); } catch (_) { /* ignore */ }
      tray = null;
    }
  });

  app.on('window-all-closed', () => {
    // Tray application: keep running even when every window is hidden.
  });

  app.on('will-quit', () => {
    try {
      screen.removeAllListeners('display-metrics-changed');
      screen.removeAllListeners('display-added');
      screen.removeAllListeners('display-removed');
    } catch (_) { /* screen may already be unavailable */ }
  });

  process.on('uncaughtException', (error) => {
    log('未捕获异常:', error);
  });
  process.on('unhandledRejection', (error) => {
    log('未处理的 Promise 拒绝:', error);
  });
}

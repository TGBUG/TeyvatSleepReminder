'use strict';

const { app } = require('electron');
const { execFile } = require('child_process');

const RUN_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';
const VALUE_NAME = 'TeyvatSleepReminder';

function run(command, args) {
  return new Promise((resolve) => {
    execFile(command, args, { windowsHide: true }, (error, stdout, stderr) => {
      resolve({
        ok: !error,
        code: error && typeof error.code === 'number' ? error.code : 0,
        stdout: String(stdout || ''),
        stderr: String(stderr || '')
      });
    });
  });
}

function supported() {
  return process.platform === 'win32' && app.isPackaged;
}

async function setAutoStart(enabled) {
  if (process.platform !== 'win32') {
    return { ok: false, reason: 'platform', message: '仅 Windows 支持开机自启。' };
  }
  if (!app.isPackaged) {
    return { ok: false, reason: 'dev', message: '开发模式下不写入开机启动，打包版会自动生效。' };
  }

  if (enabled) {
    const command = '"' + process.execPath + '" --hidden';
    const result = await run('reg.exe', [
      'add', RUN_KEY, '/v', VALUE_NAME, '/t', 'REG_SZ', '/d', command, '/f'
    ]);
    return result.ok
      ? { ok: true, enabled: true }
      : { ok: false, reason: 'registry', message: result.stderr || '写入注册表失败。' };
  }

  const result = await run('reg.exe', ['delete', RUN_KEY, '/v', VALUE_NAME, '/f']);
  return { ok: true, enabled: false, removed: result.ok };
}

async function isAutoStartEnabled() {
  if (process.platform !== 'win32' || !app.isPackaged) return false;
  const result = await run('reg.exe', ['query', RUN_KEY, '/v', VALUE_NAME]);
  if (!result.ok) return false;
  return result.stdout.includes(process.execPath);
}

module.exports = { setAutoStart, isAutoStartEnabled, supported, RUN_KEY, VALUE_NAME };

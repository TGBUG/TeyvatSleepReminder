'use strict';

const { contextBridge, ipcRenderer } = require('electron');

function subscribe(channel, callback) {
  const listener = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld('sleepAPI', {
  getConfig: () => ipcRenderer.invoke('config:get'),
  saveConfig: (config) => ipcRenderer.invoke('config:save', config),
  resetConfig: () => ipcRenderer.invoke('config:reset'),
  preview: (config) => ipcRenderer.invoke('reminder:preview', config),
  remindNow: () => ipcRenderer.invoke('reminder:now'),
  getStatus: () => ipcRenderer.invoke('status:get'),
  setEnabled: (enabled) => ipcRenderer.invoke('schedule:set-enabled', enabled),
  openDataDir: () => ipcRenderer.invoke('app:open-data'),
  minimize: () => ipcRenderer.send('window:minimize'),
  close: () => ipcRenderer.send('window:close'),
  quit: () => ipcRenderer.send('app:quit'),
  overlayReady: () => ipcRenderer.send('overlay:ready'),
  overlayDismiss: () => ipcRenderer.send('overlay:dismiss'),
  setInteractive: (inside) => ipcRenderer.send('overlay:set-interactive', Boolean(inside)),
  onOverlayShow: (callback) => subscribe('overlay:show', callback),
  onOverlayHide: (callback) => subscribe('overlay:hide', callback),
  onStatus: (callback) => subscribe('status:update', callback)
});

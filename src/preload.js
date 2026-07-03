const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktopApi', {
  getConfig: () => ipcRenderer.invoke('app:get-config'),
  getDevice: () => ipcRenderer.invoke('app:get-device'),
  getAutomationStatus: () => ipcRenderer.invoke('automation:get-status'),
  getAutomationConfig: () => ipcRenderer.invoke('automation:get-config'),
  saveAutomationConfig: (payload) => ipcRenderer.invoke('automation:save-config', payload),
  importCodes: () => ipcRenderer.invoke('automation:import-codes'),
  clearCodes: () => ipcRenderer.invoke('automation:clear-codes'),
  getHistory: () => ipcRenderer.invoke('history:get'),
  exportHistory: (rows) => ipcRenderer.invoke('history:export', rows),
  startAutomation: (payload) => ipcRenderer.invoke('automation:start', payload),
  stopAutomation: () => ipcRenderer.invoke('automation:stop'),
  openAutomationFolder: () => ipcRenderer.invoke('automation:open-folder'),
  openBilling: (url) => ipcRenderer.invoke('billing:open', url),
  installAutoHotkey: () => ipcRenderer.invoke('autohotkey:install'),
  onAutomationStatus: (callback) => {
    ipcRenderer.on('automation:status', (_event, status) => callback(status));
  }
});

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktopApi', {
  getConfig: () => ipcRenderer.invoke('app:get-config'),
  getAutomationStatus: () => ipcRenderer.invoke('automation:get-status'),
  startAutomation: (payload) => ipcRenderer.invoke('automation:start', payload),
  stopAutomation: () => ipcRenderer.invoke('automation:stop'),
  openAutomationFolder: () => ipcRenderer.invoke('automation:open-folder'),
  openBilling: (url) => ipcRenderer.invoke('billing:open', url),
  installAutoHotkey: () => ipcRenderer.invoke('autohotkey:install'),
  onAutomationStatus: (callback) => {
    ipcRenderer.on('automation:status', (_event, status) => callback(status));
  }
});

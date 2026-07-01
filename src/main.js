const { app, BrowserWindow, Menu, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

let mainWindow;
let automationProcess = null;

const isDev = !app.isPackaged;
const appRoot = isDev ? path.join(__dirname, '..') : process.resourcesPath;
const bundledAutomationDir = path.join(appRoot, 'automation');

function loadEnv() {
  const envPath = path.join(isDev ? appRoot : path.dirname(app.getPath('exe')), '.env');
  if (!fs.existsSync(envPath)) return {};

  const values = {};
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const index = trimmed.indexOf('=');
    if (index === -1) continue;
    values[trimmed.slice(0, index).trim()] = trimmed.slice(index + 1).trim().replace(/^["']|["']$/g, '');
  }
  return values;
}

function getRuntimeAutomationDir() {
  const dir = path.join(app.getPath('userData'), 'automation');
  fs.mkdirSync(dir, { recursive: true });

  const scriptSource = path.join(bundledAutomationDir, 'AutoScanner.ah');
  const scriptTarget = path.join(dir, 'AutoScanner.ah');
  if (fs.existsSync(scriptSource)) {
    const shouldCopyScript = !fs.existsSync(scriptTarget)
      || fs.statSync(scriptSource).mtimeMs > fs.statSync(scriptTarget).mtimeMs;
    if (shouldCopyScript) {
      fs.copyFileSync(scriptSource, scriptTarget);
    }
  }

  const configSource = path.join(bundledAutomationDir, 'app.ini');
  const configTarget = path.join(dir, 'app.ini');
  if (!fs.existsSync(configTarget) && fs.existsSync(configSource)) {
    fs.copyFileSync(configSource, configTarget);
  }

  return dir;
}

function findAutoHotkey() {
  const candidates = [
    process.env.AUTOHOTKEY_EXE,
    path.join(process.env.LOCALAPPDATA || '', 'Programs\\AutoHotkey\\v2\\AutoHotkey64.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Programs\\AutoHotkey\\v2\\AutoHotkey32.exe'),
    'C:\\Program Files\\AutoHotkey\\v2\\AutoHotkey64.exe',
    'C:\\Program Files\\AutoHotkey\\AutoHotkey64.exe',
    'C:\\Program Files\\AutoHotkey\\AutoHotkey.exe',
    'C:\\Program Files (x86)\\AutoHotkey\\AutoHotkey.exe'
  ].filter(Boolean);

  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

function emitStatus() {
  if (!mainWindow) return;
  mainWindow.webContents.send('automation:status', {
    running: Boolean(automationProcess),
    autohotkeyPath: findAutoHotkey(),
    automationDir: getRuntimeAutomationDir()
  });
}

function createWindow() {
  Menu.setApplicationMenu(null);

  mainWindow = new BrowserWindow({
    width: 1040,
    height: 720,
    minWidth: 900,
    minHeight: 620,
    title: 'Bipe Único',
    backgroundColor: '#f6f7f9',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));
}

ipcMain.handle('app:get-config', () => {
  const env = loadEnv();
  return {
    supabaseUrl: process.env.SUPABASE_URL || env.SUPABASE_URL || '',
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY || env.SUPABASE_ANON_KEY || '',
    subscriptionTable: process.env.SUBSCRIPTION_TABLE || env.SUBSCRIPTION_TABLE || 'subscriptions',
    billingUrl: process.env.BILLING_URL || env.BILLING_URL || ''
  };
});

ipcMain.handle('billing:open', (_event, url) => {
  if (!url) throw new Error('Configure BILLING_URL no arquivo .env.');
  shell.openExternal(url);
});

ipcMain.handle('automation:get-status', () => ({
  running: Boolean(automationProcess),
  autohotkeyPath: findAutoHotkey(),
  automationDir: getRuntimeAutomationDir()
}));

ipcMain.handle('automation:start', (_event, { subscriptionActive }) => {
  if (!subscriptionActive) {
    throw new Error('Assinatura inativa. A automação não foi iniciada.');
  }
  if (automationProcess) return { running: true };

  const ahkPath = findAutoHotkey();
  if (!ahkPath) {
    throw new Error('AutoHotkey v2 não encontrado. Instale pelo botão do app e tente novamente.');
  }

  const automationDir = getRuntimeAutomationDir();
  automationProcess = spawn(ahkPath, [path.join(automationDir, 'AutoScanner.ah')], {
    cwd: automationDir,
    windowsHide: true
  });

  automationProcess.once('exit', () => {
    automationProcess = null;
    emitStatus();
  });

  emitStatus();
  return { running: true };
});

ipcMain.handle('automation:stop', () => {
  if (automationProcess) {
    automationProcess.kill();
    automationProcess = null;
  }
  emitStatus();
  return { running: false };
});

ipcMain.handle('automation:open-folder', () => {
  shell.openPath(getRuntimeAutomationDir());
});

ipcMain.handle('autohotkey:install', () => {
  if (findAutoHotkey()) {
    return { started: false, alreadyInstalled: true };
  }

  shell.openExternal('https://www.autohotkey.com/download/ahk-v2.exe');
  return { started: true, alreadyInstalled: false };
});

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('before-quit', () => {
  if (automationProcess) automationProcess.kill();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

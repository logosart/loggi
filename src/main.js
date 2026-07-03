const { app, BrowserWindow, Menu, dialog, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { execFileSync, spawn } = require('child_process');
const XLSX = require('xlsx');

let mainWindow;
let automationProcess = null;

const isDev = !app.isPackaged;
const appRoot = isDev ? path.join(__dirname, '..') : process.resourcesPath;
const bundledAutomationDir = path.join(appRoot, 'automation');
const publicConfigPath = path.join(__dirname, 'app-config.json');
const DEFAULT_SOURCE_TITLE = 'Origem';
const DEFAULT_TARGET_TITLE = 'Destino';
const DEVICE_HASH_NAMESPACE = 'bipe-unico-device-v1';

function loadEnv() {
  if (!isDev) return {};

  const envPath = path.join(appRoot, '.env');
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

function loadPublicConfig() {
  if (!fs.existsSync(publicConfigPath)) return {};

  try {
    return JSON.parse(fs.readFileSync(publicConfigPath, 'utf8'));
  } catch {
    return {};
  }
}

function getMachineSeed() {
  if (process.platform === 'win32') {
    try {
      const output = execFileSync('reg', [
        'query',
        'HKLM\\SOFTWARE\\Microsoft\\Cryptography',
        '/v',
        'MachineGuid'
      ], {
        encoding: 'utf8',
        windowsHide: true,
        timeout: 2000
      });
      const match = output.match(/MachineGuid\s+REG_SZ\s+([^\r\n]+)/i);
      if (match?.[1]) return `win:${match[1].trim()}`;
    } catch {
      // Fallback below.
    }
  }

  const username = os.userInfo?.().username || 'unknown-user';
  return `fallback:${os.hostname()}:${username}:${app.getPath('userData')}`;
}

function getDeviceIdentity() {
  const seed = getMachineSeed();
  return {
    id: crypto
      .createHash('sha256')
      .update(`${DEVICE_HASH_NAMESPACE}:${seed}`)
      .digest('hex'),
    name: os.hostname() || 'Computador'
  };
}

function parseIni(filePath) {
  if (!fs.existsSync(filePath)) return {};

  const values = {};
  let section = '';
  for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith(';') || trimmed.startsWith('#')) continue;
    const sectionMatch = trimmed.match(/^\[(.+)]$/);
    if (sectionMatch) {
      section = sectionMatch[1];
      values[section] ||= {};
      continue;
    }
    const index = trimmed.indexOf('=');
    if (index === -1 || !section) continue;
    values[section][trimmed.slice(0, index).trim()] = trimmed.slice(index + 1).trim();
  }
  return values;
}

function serializeIni(values) {
  return Object.entries(values)
    .map(([section, entries]) => {
      const lines = Object.entries(entries).map(([key, value]) => `${key} = ${value}`);
      return [`[${section}]`, ...lines].join('\n');
    })
    .join('\n\n') + '\n';
}

function getAutomationConfig() {
  const automationDir = getRuntimeAutomationDir();
  const iniPath = path.join(automationDir, 'app.ini');
  const ini = parseIni(iniPath);
  const behavior = ini.behavior || {};
  const windows = ini.windows || {};

  return {
    sourceTitle: windows.source_title || DEFAULT_SOURCE_TITLE,
    targetTitle: windows.target_title || DEFAULT_TARGET_TITLE,
    copyDelayMs: Number(behavior.copy_delay_ms || 80),
    pasteDelayMs: Number(behavior.paste_delay_ms || 80),
    enterDelayMs: Number(behavior.enter_delay_ms || 120),
    returnDelayMs: Number(behavior.return_delay_ms || 80),
    queueIntervalMs: Number(behavior.queue_interval_ms || 500),
    returnSelectAll: String(behavior.return_select_all ?? '1') === '1',
    queue: getQueueInfo()
  };
}

function saveAutomationConfig(config) {
  const automationDir = getRuntimeAutomationDir();
  const iniPath = path.join(automationDir, 'app.ini');
  const ini = parseIni(iniPath);
  ini.windows ||= {};
  ini.behavior ||= {};

  const clamp = (value, fallback, min, max) => {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.min(Math.max(Math.round(number), min), max);
  };

  ini.windows.source_title = String(config.sourceTitle || DEFAULT_SOURCE_TITLE).trim() || DEFAULT_SOURCE_TITLE;
  ini.windows.target_title = String(config.targetTitle || DEFAULT_TARGET_TITLE).trim() || DEFAULT_TARGET_TITLE;
  ini.behavior.copy_delay_ms = clamp(config.copyDelayMs, 80, 20, 2000);
  ini.behavior.paste_delay_ms = clamp(config.pasteDelayMs, 80, 20, 2000);
  ini.behavior.enter_delay_ms = clamp(config.enterDelayMs, 120, 20, 2500);
  ini.behavior.return_delay_ms = clamp(config.returnDelayMs, 80, 20, 2500);
  ini.behavior.queue_interval_ms = clamp(config.queueIntervalMs, 500, 100, 10000);
  ini.behavior.return_select_all = config.returnSelectAll ? '1' : '0';

  fs.writeFileSync(iniPath, serializeIni(ini), 'utf8');
  return getAutomationConfig();
}

function extractCodesFromText(text) {
  const matches = text.toUpperCase().match(/[A-Z]{2}\d{8,}[A-Z]/g);
  if (matches?.length) return [...new Set(matches)];

  return [...new Set(text
    .split(/\r?\n|;|,/)
    .map((value) => value.trim().toUpperCase())
    .filter(Boolean))];
}

function extractCodesFromSpreadsheet(filePath) {
  const workbook = XLSX.readFile(filePath);
  const values = [];

  for (const sheetName of workbook.SheetNames) {
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], {
      header: 1,
      blankrows: false
    });

    for (const row of rows) {
      for (const cell of row) {
        if (cell !== null && cell !== undefined) values.push(String(cell));
      }
    }
  }

  return extractCodesFromText(values.join('\n'));
}

function getQueueInfo() {
  const automationDir = getRuntimeAutomationDir();
  const queuePath = path.join(automationDir, 'codes.txt');
  const sourcePath = path.join(automationDir, 'codes-source.txt');
  const codes = fs.existsSync(queuePath)
    ? fs.readFileSync(queuePath, 'utf8').split(/\r?\n/).filter(Boolean)
    : [];
  const sourceName = fs.existsSync(sourcePath)
    ? fs.readFileSync(sourcePath, 'utf8').trim()
    : '';

  return {
    count: codes.length,
    fileName: sourceName || '',
    path: queuePath
  };
}

function parseCsvLine(line) {
  const values = [];
  let current = '';
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];

    if (char === '"' && quoted && next === '"') {
      current += '"';
      index += 1;
      continue;
    }

    if (char === '"') {
      quoted = !quoted;
      continue;
    }

    if (char === ',' && !quoted) {
      values.push(current);
      current = '';
      continue;
    }

    current += char;
  }

  values.push(current);
  return values;
}

function getAutomationHistory() {
  const historyPath = path.join(getRuntimeAutomationDir(), 'history.csv');
  if (!fs.existsSync(historyPath)) return [];

  const lines = fs.readFileSync(historyPath, 'utf8')
    .split(/\r?\n/)
    .filter(Boolean);

  return lines.slice(1).map((line, index) => {
    const [createdAt, source, code, status] = parseCsvLine(line);
    return {
      id: index + 1,
      createdAt: createdAt || '',
      source: source || '',
      code: code || '',
      status: status || ''
    };
  }).reverse();
}

async function exportAutomationHistory(rows) {
  const exportRows = Array.isArray(rows) ? rows : getAutomationHistory();
  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Exportar historico',
    defaultPath: `historico-bipe-unico-${new Date().toISOString().slice(0, 10)}.xlsx`,
    filters: [
      { name: 'Excel', extensions: ['xlsx'] }
    ]
  });

  if (result.canceled || !result.filePath) return { exported: false };

  const sheetRows = exportRows.map((row) => ({
    Data: row.createdAt,
    Origem: row.source,
    Codigo: row.code,
    Status: row.status
  }));
  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.json_to_sheet(sheetRows);
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Historico');
  XLSX.writeFile(workbook, result.filePath);

  return { exported: true, filePath: result.filePath, count: sheetRows.length };
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

  const ini = parseIni(configTarget);
  ini.windows ||= {};
  ini.windows.source_title ||= DEFAULT_SOURCE_TITLE;
  ini.windows.target_title ||= DEFAULT_TARGET_TITLE;
  fs.writeFileSync(configTarget, serializeIni(ini), 'utf8');

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
  const publicConfig = loadPublicConfig();
  return {
    supabaseUrl: process.env.SUPABASE_URL || env.SUPABASE_URL || publicConfig.supabaseUrl || '',
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY || env.SUPABASE_ANON_KEY || publicConfig.supabaseAnonKey || '',
    subscriptionTable: process.env.SUBSCRIPTION_TABLE || env.SUBSCRIPTION_TABLE || publicConfig.subscriptionTable || 'subscriptions',
    billingUrl: process.env.BILLING_URL || env.BILLING_URL || publicConfig.billingUrl || ''
  };
});

ipcMain.handle('app:get-device', () => getDeviceIdentity());

ipcMain.handle('billing:open', (_event, url) => {
  if (!url) throw new Error('A cobrança do aplicativo não está configurada.');
  shell.openExternal(url);
});

ipcMain.handle('automation:get-status', () => ({
  running: Boolean(automationProcess),
  autohotkeyPath: findAutoHotkey(),
  automationDir: getRuntimeAutomationDir(),
  queue: getQueueInfo()
}));

ipcMain.handle('automation:get-config', () => getAutomationConfig());

ipcMain.handle('automation:save-config', (_event, payload) => saveAutomationConfig(payload || {}));

ipcMain.handle('automation:import-codes', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Importar lista de códigos',
    properties: ['openFile'],
    filters: [
      { name: 'Planilhas e listas de códigos', extensions: ['xlsx', 'xls', 'csv', 'txt'] },
      { name: 'Todos os arquivos', extensions: ['*'] }
    ]
  });

  if (result.canceled || !result.filePaths[0]) return getQueueInfo();

  const filePath = result.filePaths[0];
  const extension = path.extname(filePath).toLowerCase();
  const codes = ['.xlsx', '.xls'].includes(extension)
    ? extractCodesFromSpreadsheet(filePath)
    : extractCodesFromText(fs.readFileSync(filePath, 'utf8'));
  const automationDir = getRuntimeAutomationDir();
  fs.writeFileSync(path.join(automationDir, 'codes.txt'), codes.join('\n') + (codes.length ? '\n' : ''), 'utf8');
  fs.writeFileSync(path.join(automationDir, 'codes-source.txt'), path.basename(filePath), 'utf8');
  return getQueueInfo();
});

ipcMain.handle('automation:clear-codes', () => {
  const automationDir = getRuntimeAutomationDir();
  for (const fileName of ['codes.txt', 'codes-source.txt']) {
    const target = path.join(automationDir, fileName);
    if (fs.existsSync(target)) fs.unlinkSync(target);
  }
  return getQueueInfo();
});

ipcMain.handle('history:get', () => getAutomationHistory());

ipcMain.handle('history:export', (_event, rows) => exportAutomationHistory(rows));

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

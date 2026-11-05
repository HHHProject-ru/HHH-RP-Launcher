
const http = require('http');
const { app, BrowserWindow, ipcMain, shell, dialog, safeStorage, Notification } = require('electron');
const net = require('net');
const crypto = require('crypto');
const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

let mainWindow;
let isLaunching = false;
let authBridgeServer = null;
let authBridgeConfigFile = null;
let bridgeCredentials = null;
const CREDENTIALS_FILE = path.join(app.getPath('userData'), 'beammp-credentials.dat');
function checkGameServer() {
  return new Promise((resolve, reject) => {
    const req = http.get('http://26.53.75.232:3000/health', (res) => {
      let data = '';

      res.on('data', chunk => data += chunk);

      res.on('end', () => {
        try {
          const result = JSON.parse(data);
          resolve(result.status === 'online');
        } catch {
          reject(new Error('РќРµРєРѕСЂСЂРµРєС‚РЅС‹Р№ РѕС‚РІРµС‚ СЃРµСЂРІРµСЂР°'));
        }
      });
    });

    req.setTimeout(5000, () => {
      req.destroy(new Error('РџСЂРµРІС‹С€РµРЅРѕ РІСЂРµРјСЏ РѕР¶РёРґР°РЅРёСЏ'));
    });

    req.on('error', reject);
  });
}

const DEFAULT_BEAMMP_PATH = path.join(
  app.getPath('appData'),
  'BeamMP-Launcher'
);

const SETTINGS_FILE = path.join(
  app.getPath('userData'),
  'settings.json'
);

function readSettings() {
  const defaults = {
    beammpPath: DEFAULT_BEAMMP_PATH,
    beammpModsPath: path.join(DEFAULT_BEAMMP_PATH, 'Resources'),
    beamngPath: '',
    launcherPrefs: { minimizeAfterPlay: true, closeAfterGame: false, launchOnStartup: false, confirmExit: true, notifyModsChecked: false, notifyLaunchErrors: true, notifyServerUnavailable: true }
  };

  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      const saved = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
      return { ...defaults, ...saved, launcherPrefs: { ...defaults.launcherPrefs, ...(saved.launcherPrefs || {}) } };
    }
  } catch (error) {
    console.error('Р С›РЎв‚¬Р С‘Р В±Р С”Р В° РЎвЂЎРЎвЂљР ВµР Р…Р С‘РЎРЏ Р Р…Р В°РЎРѓРЎвЂљРЎР‚Р С•Р ВµР С”:', error);
  }

  return defaults;
}

let settings = readSettings();

function saveSettingsFile() {
  fs.mkdirSync(path.dirname(SETTINGS_FILE), { recursive: true });
  fs.writeFileSync(
    SETTINGS_FILE,
    JSON.stringify(settings, null, 2),
    'utf8'
  );
}

function isDirectory(folder) {
  try {
    return fs.statSync(folder).isDirectory();
  } catch {
    return false;
  }
}

function detectBeamNG() {
  const candidates = [];

  const registryKeys = [
    'HKLM\\SOFTWARE\\WOW6432Node\\Valve\\Steam',
    'HKLM\\SOFTWARE\\Valve\\Steam',
    'HKCU\\Software\\Valve\\Steam'
  ];

  for (const key of registryKeys) {
    try {
      const output = execFileSync(
        'reg.exe',
        ['query', key, '/v', 'InstallPath'],
        { encoding: 'utf8', windowsHide: true }
      );

      const match = output.match(/InstallPath\s+REG_SZ\s+(.+)/i);
      if (match) candidates.push(match[1].trim());
    } catch {}
  }

  candidates.push(
    path.join(
      process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)',
      'Steam'
    ),
    path.join(
      process.env.ProgramFiles || 'C:\\Program Files',
      'Steam'
    )
  );

  const libraries = new Set();

  for (const steamPath of candidates) {
    if (!isDirectory(steamPath)) continue;

    libraries.add(steamPath);

    const libraryFile = path.join(
      steamPath,
      'steamapps',
      'libraryfolders.vdf'
    );

    try {
      const content = fs.readFileSync(libraryFile, 'utf8');
      const matches = content.matchAll(/"path"\s+"([^"]+)"/g);

      for (const match of matches) {
        libraries.add(match[1].replace(/\\\\/g, '\\'));
      }
    } catch {}
  }

  for (const library of libraries) {
    const gameFolder = path.join(
      library,
      'steamapps',
      'common',
      'BeamNG.drive'
    );

    if (fs.existsSync(path.join(gameFolder, 'BeamNG.drive.exe'))) {
      return gameFolder;
    }
  }

  return '';
}

function getSettingsStatus() {
  return {
    beammpPathValid: fs.existsSync(
      path.join(settings.beammpPath, 'BeamMP-Launcher.exe')
    ),
    modsPathValid: isDirectory(settings.beammpModsPath),
    beamngPathValid: fs.existsSync(
      path.join(settings.beamngPath, 'BeamNG.drive.exe')
    )
  };
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 720,
    autoHideMenuBar: true,
    backgroundColor: '#101318',
    title: 'HH RP Launcher',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  mainWindow.loadFile('index.html');

  // Перехватываем закрытие окна до его уничтожения.
  // before-quit для крестика окна срабатывает слишком поздно:
  // к этому моменту последнее окно уже может быть уничтожено.
  mainWindow.on('close', (event) => {
    if (allowWindowClose || !settings.launcherPrefs?.confirmExit) return;

    event.preventDefault();
    const choice = dialog.showMessageBoxSync(mainWindow, {
      type: 'question',
      buttons: ['Выйти', 'Отмена'],
      defaultId: 1,
      cancelId: 1,
      title: 'HHH RP Launcher',
      message: 'Закрыть лаунчер?'
    });

    if (choice === 0) {
      allowWindowClose = true;
      mainWindow.close();
    }
  });
}

function sendStatus(message) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('sync-status', message);
  }
  const prefs = settings.launcherPrefs || {};
  let notification = null;
  if (/моды проверены|модификации проверены/i.test(String(message)) && prefs.notifyModsChecked) {
    notification = ['HHH RP', 'Моды проверены. Можно запускать игру.'];
  } else if (/сервер.*(выключен|недоступен)|не удалось проверить сервер/i.test(String(message)) && prefs.notifyServerUnavailable) {
    notification = ['HHH RP', 'Сервер сейчас недоступен. Проверь подключение к Radmin VPN.'];
  } else if (/ошибка|не удалось|не найден/i.test(String(message)) && prefs.notifyLaunchErrors) {
    notification = ['Ошибка HHH RP Launcher', String(message).slice(0, 180)];
  }
  if (notification && Notification.isSupported()) new Notification({ title: notification[0], body: notification[1] }).show();
}

function notifyGameClosed() {
  isLaunching = false;
  sendStatus('BeamMP Р В·Р В°Р С”РЎР‚РЎвЂ№РЎвЂљ. Р СљР С•Р В¶Р Р…Р С• Р С‘Р С–РЎР‚Р В°РЎвЂљРЎРЉ РЎРѓР Р…Р С•Р Р†Р В°.');

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('beammp-exited');
  }
}

function installHHHLuaFiles() {
  const sourceDir = path.join(__dirname, 'lua', 'ge', 'extensions');
  const localAppData = process.env.LOCALAPPDATA ||
    path.join(app.getPath('home'), 'AppData', 'Local');
  const targetDir = path.join(localAppData, 'BeamNG', 'BeamNG.drive', 'current', 'lua', 'ge', 'extensions');
  const files = ['HHHTest.lua', 'HHHAuthBridge.lua', 'HHHBootstrap.lua'];

  fs.mkdirSync(targetDir, { recursive: true });
  for (const file of files) {
    const sourceFile = path.join(sourceDir, file);
    const targetFile = path.join(targetDir, file);
    if (!fs.existsSync(sourceFile)) throw new Error('В сборке лаунчера отсутствует Lua-файл ' + file);
    const incoming = fs.readFileSync(sourceFile);
    if (fs.existsSync(targetFile)) {
      const current = fs.readFileSync(targetFile);
      if (!current.equals(incoming)) {
        const backupFile = targetFile + '.hhh-backup';
        if (!fs.existsSync(backupFile)) fs.copyFileSync(targetFile, backupFile);
        fs.copyFileSync(sourceFile, targetFile);
      }
    } else {
      fs.copyFileSync(sourceFile, targetFile);
    }
  }
  return files.map(file => path.join(targetDir, file)).join('; ');
}

function readBeamMPCredentials() {
  try {
    if (!fs.existsSync(CREDENTIALS_FILE) || !safeStorage.isEncryptionAvailable()) return null;
    const encrypted = fs.readFileSync(CREDENTIALS_FILE);
    const parsed = JSON.parse(safeStorage.decryptString(encrypted));
    if (typeof parsed.username !== 'string' || typeof parsed.password !== 'string') return null;
    if (!parsed.username.trim() || !parsed.password) return null;
    return { username: parsed.username.trim(), password: parsed.password };
  } catch {
    return null;
  }
}

function stopAuthBridge() {
  if (authBridgeServer) {
    try { authBridgeServer.close(); } catch {}
    authBridgeServer = null;
  }
  bridgeCredentials = null;
  if (authBridgeConfigFile) {
    try { fs.unlinkSync(authBridgeConfigFile); } catch {}
    authBridgeConfigFile = null;
  }
}

function luaQuote(value) {
  return '"' + String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\r/g, '').replace(/\n/g, '') + '"';
}

async function startAuthBridge(mode = 'account') {
  if (mode === 'guest') {
    stopAuthBridge();
    const localAppData = process.env.LOCALAPPDATA || path.join(app.getPath('home'), 'AppData', 'Local');
    const extensionsDir = path.join(localAppData, 'BeamNG', 'BeamNG.drive', 'current', 'lua', 'ge', 'extensions');
    fs.mkdirSync(extensionsDir, { recursive: true });
    authBridgeConfigFile = path.join(extensionsDir, 'HHHAuthBridgeConfig.lua');
    fs.writeFileSync(authBridgeConfigFile, 'return { mode = "guest" }' + '\n', { encoding: 'utf8', mode: 0o600 });
    return;
  }

  const credentials = readBeamMPCredentials();
  if (!credentials) {
    throw new Error('Сначала укажи логин и пароль BeamMP во вкладке «Профиль».');
  }
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('Windows не предоставил защищённое хранилище. Пароль не сохранён.');
  }

  stopAuthBridge();
  const token = crypto.randomBytes(32).toString('hex');
  bridgeCredentials = credentials;

  authBridgeServer = net.createServer((socket) => {
    socket.setTimeout(5000);
    let input = '';
    socket.on('data', (chunk) => {
      input += chunk.toString('utf8');
      if (!input.includes('\n')) return;
      const supplied = input.split('\n', 1)[0].trim();
      const expected = Buffer.from(token, 'utf8');
      const actual = Buffer.from(supplied, 'utf8');
      const valid = actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
      if (!valid || !bridgeCredentials) {
        socket.end('{"error":"unauthorized"}\n');
        return;
      }
      const payload = JSON.stringify(bridgeCredentials) + '\n';
      socket.end(payload);
      bridgeCredentials = null;
    });
    socket.on('error', () => {});
  });

  await new Promise((resolve, reject) => {
    authBridgeServer.once('error', reject);
    authBridgeServer.listen(0, '127.0.0.1', resolve);
  });
  const port = authBridgeServer.address()?.port;
  if (!port) throw new Error('Не удалось запустить локальный мост авторизации BeamMP.');

  const localAppData = process.env.LOCALAPPDATA || path.join(app.getPath('home'), 'AppData', 'Local');
  const extensionsDir = path.join(localAppData, 'BeamNG', 'BeamNG.drive', 'current', 'lua', 'ge', 'extensions');
  fs.mkdirSync(extensionsDir, { recursive: true });
  authBridgeConfigFile = path.join(extensionsDir, 'HHHAuthBridgeConfig.lua');
  const configSource = `return { host = ${luaQuote('127.0.0.1')}, port = ${port}, token = ${luaQuote(token)} }\n`;
  fs.writeFileSync(authBridgeConfigFile, configSource, { encoding: 'utf8', mode: 0o600 });
}

async function launchBeamMP(mode = 'account') {
  const beammpExe = path.join(settings.beammpPath, 'BeamMP-Launcher.exe');

  try { await startAuthBridge(mode); }
  catch (error) {
    isLaunching = false;
    stopAuthBridge();
    sendStatus(error.message);
    throw error;
  }

  // Keep the Lua chunk a single token: BeamMP's Windows forwarding may drop
  const child = spawn(
    beammpExe,
    ['--game', '-luafile', 'HHHBootstrap'],
    { cwd: __dirname }
  );

  child.on('error', (err) => {
    stopAuthBridge();
    notifyGameClosed();
    sendStatus('Ошибка запуска BeamMP: ' + err.message);
  });

  child.on('spawn', () => {
    sendStatus('BeamMP запускается...');
    if (settings.launcherPrefs?.minimizeAfterPlay && mainWindow && !mainWindow.isDestroyed()) mainWindow.minimize();
  });

  child.on('close', (code) => {
    stopAuthBridge();
    notifyGameClosed();
    if (code !== 0) sendStatus('BeamMP завершился с кодом ' + code + '. Можно попробовать снова.');
    if (settings.launcherPrefs?.closeAfterGame) { allowAppQuit = true; app.quit(); }
  });
}


ipcMain.handle('get-beampm-auth-status', async () => {
  const credentials = readBeamMPCredentials();
  return { saved: !!credentials, username: credentials?.username || '', encryptionAvailable: safeStorage.isEncryptionAvailable() };
});

ipcMain.handle('save-beampm-credentials', async (_event, data) => {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('Защищённое хранилище Windows недоступно.');
  const username = String(data?.username || '').trim();
  const password = String(data?.password || '');
  if (!username || !password) throw new Error('Введи логин и пароль BeamMP.');
  if (username.length > 128 || password.length > 512) throw new Error('Слишком длинный логин или пароль.');
  fs.mkdirSync(path.dirname(CREDENTIALS_FILE), { recursive: true });
  const encrypted = safeStorage.encryptString(JSON.stringify({ username, password }));
  fs.writeFileSync(CREDENTIALS_FILE, encrypted);
  return { saved: true, username, encryptionAvailable: true };
});

ipcMain.handle('clear-beampm-credentials', async () => {
  try { fs.unlinkSync(CREDENTIALS_FILE); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  return { saved: false, username: '', encryptionAvailable: safeStorage.isEncryptionAvailable() };
});

ipcMain.handle('get-settings', async () => {
  return {
    ...settings,
    status: getSettingsStatus()
  };
});

ipcMain.handle('select-folder', async (_event, settingName) => {
  const allowed = [
    'beammpPath',
    'beammpModsPath',
    'beamngPath'
  ];

  if (!allowed.includes(settingName)) {
    throw new Error('Р СњР ВµР С‘Р В·Р Р†Р ВµРЎРѓРЎвЂљР Р…РЎвЂ№Р в„– РЎвЂљР С‘Р С— Р С—Р В°Р С—Р С”Р С‘');
  }

  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Р вЂ™РЎвЂ№Р В±Р ВµРЎР‚Р С‘РЎвЂљР Вµ Р С—Р В°Р С—Р С”РЎС“',
    properties: ['openDirectory']
  });

  if (result.canceled || !result.filePaths.length) {
    return null;
  }

  return result.filePaths[0];
});

ipcMain.handle('save-settings', async (_event, newSettings) => {
  if (!newSettings || typeof newSettings !== 'object') {
    throw new Error('Р СњР ВµР С”Р С•РЎР‚РЎР‚Р ВµР С”РЎвЂљР Р…РЎвЂ№Р Вµ Р Р…Р В°РЎРѓРЎвЂљРЎР‚Р С•Р в„–Р С”Р С‘');
  }

  settings = {
    beammpPath: String(newSettings.beammpPath || '').trim(),
    beammpModsPath: String(newSettings.beammpModsPath || '').trim(),
    beamngPath: String(newSettings.beamngPath || '').trim(),
    launcherPrefs: { ...settings.launcherPrefs, ...(newSettings.launcherPrefs || {}) }
  };

  saveSettingsFile();

  return {
    ...settings,
    status: getSettingsStatus()
  };
});



ipcMain.handle('save-launcher-prefs', async (_event, prefs) => {
  const allowed = ['minimizeAfterPlay', 'closeAfterGame', 'launchOnStartup', 'confirmExit', 'notifyModsChecked', 'notifyLaunchErrors', 'notifyServerUnavailable'];
  const next = { ...settings.launcherPrefs };
  for (const key of allowed) if (typeof prefs?.[key] === 'boolean') next[key] = prefs[key];
  settings.launcherPrefs = next;
  saveSettingsFile();
  app.setLoginItemSettings({ openAtLogin: !!next.launchOnStartup, path: process.execPath, args: ['.'] });
  return next;
});

ipcMain.handle('open-maintenance-location', async (_event, target) => {
  const locations = { launcher: __dirname, logs: app.getPath('logs') };
  if (target === 'logs') fs.mkdirSync(locations.logs, { recursive: true });
  if (!locations[target]) throw new Error('Неизвестное расположение.');
  const error = await shell.openPath(locations[target]);
  if (error) throw new Error(error);
  return true;
});

ipcMain.handle('reset-launcher-prefs', async () => {
  const defaults = { minimizeAfterPlay: true, closeAfterGame: false, launchOnStartup: false, confirmExit: true, notifyModsChecked: false, notifyLaunchErrors: true, notifyServerUnavailable: true };
  settings.launcherPrefs = defaults;
  saveSettingsFile();
  app.setLoginItemSettings({ openAtLogin: false, path: process.execPath, args: ['.'] });
  return defaults;
});

ipcMain.handle('launch-beammp', async (_event, mode = 'account') => {
  if (isLaunching) return false;

    sendStatus('РџСЂРѕРІРµСЂСЏРµРј РґРѕСЃС‚СѓРїРЅРѕСЃС‚СЊ HHH RP...');

  try {
    const serverOnline = await checkGameServer();

    if (!serverOnline) {
      throw new Error('РЎРµСЂРІРµСЂ HHH RP СЃРµР№С‡Р°СЃ РІС‹РєР»СЋС‡РµРЅ');
    }
  } catch (error) {
    sendStatus('Сервер HHH RP недоступен. Проверь подключение к Radmin VPN.');
    throw new Error('Сервер HHH RP выключен или недоступен. Проверь подключение к Radmin VPN.');
  }

  const status = getSettingsStatus();

  if (!status.beammpPathValid) {
    throw new Error('Р СњР Вµ Р Р…Р В°Р в„–Р Т‘Р ВµР Р…Р В° Р С—Р В°Р С—Р С”Р В° BeamMP');
  }

  if (!status.modsPathValid) {
    throw new Error('Р СњР Вµ Р Р…Р В°Р в„–Р Т‘Р ВµР Р…Р В° Р С—Р В°Р С—Р С”Р В° Resources');
  }

  if (!status.beamngPathValid) {
    throw new Error('Р Р€Р С”Р В°Р В¶Р С‘РЎвЂљР Вµ Р С—Р В°Р С—Р С”РЎС“ РЎС“РЎРѓРЎвЂљР В°Р Р…Р С•Р Р†Р С”Р С‘ BeamNG.drive Р Р† Р Р…Р В°РЎРѓРЎвЂљРЎР‚Р С•Р в„–Р С”Р В°РЎвЂ¦');
  }

  isLaunching = true;

  sendStatus('Р СџР С•Р В»РЎС“РЎвЂЎР В°Р ВµР С РЎРѓР С—Р С‘РЎРѓР С•Р С” Р СР С•Р Т‘Р С•Р Р†...');

  return new Promise((resolve, reject) => {
    const sync = spawn(
      'py',
      ['-u', path.join(__dirname, 'sync_mods.py'), path.join(__dirname, 'Resources')],
      {
        cwd: __dirname,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe']
      }
    );

    let outputBuffer = '';
    let errorOutput = '';

    sync.stdout.on('data', (data) => {
      outputBuffer += data.toString();

      const lines = outputBuffer.split(/\r?\n/);
      outputBuffer = lines.pop() || '';

      for (const line of lines) {
        try {
          const status = JSON.parse(line);
          sendStatus(status.message);
        } catch {}
      }
    });

    sync.stderr.on('data', (data) => {
      errorOutput += data.toString();
    });

    sync.on('error', (err) => {
      isLaunching = false;
      sendStatus('Р СњР Вµ РЎС“Р Т‘Р В°Р В»Р С•РЎРѓРЎРЉ Р В·Р В°Р С—РЎС“РЎРѓРЎвЂљР С‘РЎвЂљРЎРЉ Р С—РЎР‚Р С•Р Р†Р ВµРЎР‚Р С”РЎС“ Р СР С•Р Т‘Р С•Р Р†: ' + err.message);
      reject(err);
    });

    sync.on('close', (code) => {
      if (outputBuffer.trim()) {
        try {
          const status = JSON.parse(outputBuffer);
          sendStatus(status.message);
        } catch {}
      }

      if (code !== 0) {
        isLaunching = false;
        const message = errorOutput.trim() || 'Р С›РЎв‚¬Р С‘Р В±Р С”Р В° РЎРѓР С‘Р Р…РЎвЂ¦РЎР‚Р С•Р Р…Р С‘Р В·Р В°РЎвЂ Р С‘Р С‘ Р СР С•Р Т‘Р С•Р Р†';
        sendStatus(message);
        reject(new Error(message));
        return;
      }

      sendStatus('Р СљР С•Р Т‘РЎвЂ№ Р С—РЎР‚Р С•Р Р†Р ВµРЎР‚Р ВµР Р…РЎвЂ№. Р вЂ”Р В°Р С—РЎС“РЎРѓР С”Р В°Р ВµР С Р С‘Р С–РЎР‚РЎС“...');
      try {
        sendStatus('Устанавливаем Lua-файлы HHH RP...');
        const installedLua = installHHHLuaFiles();
        sendStatus('Lua-файлы установлены: ' + installedLua);
      } catch (error) {
        isLaunching = false;
        sendStatus('Не удалось установить Lua-файлы: ' + error.message);
        reject(error);
        return;
      }

      sendStatus('Моды проверены. Запускаем игру...');
      launchBeamMP(mode).then(() => resolve(true)).catch((error) => {
        isLaunching = false;
        reject(error);
      });
    });
  });
});

ipcMain.handle('open-community-link', async (_event, target) => {
  const links = {
    site: 'http://netlify-site-copy.netlify.app',
    discord: 'https://discord.gg/UQzmchxJTv',
    youtube: 'https://youtube.com/@hhhrp_project?si=4DvkDodpZ1Oc62KJ'
  };
  const url = links[target];
  if (!url) throw new Error('Неизвестная ссылка сообщества.');
  await shell.openExternal(url);
  return true;
});

ipcMain.handle('open-mods-link', async () => {
  await shell.openExternal(
    'https://drive.google.com/drive/folders/1GDkKjoU9PQedH_xgI1WTly2WtmpPee68?usp=drive_link'
  );
  return true;
});

app.whenReady().then(() => {
  if (!settings.beamngPath || !getSettingsStatus().beamngPathValid) {
    settings.beamngPath = detectBeamNG();
  }

  createWindow();
});

let allowAppQuit = false;
let allowWindowClose = false;
app.on('before-quit', (event) => {
  if (allowAppQuit || !settings.launcherPrefs?.confirmExit || !mainWindow || mainWindow.isDestroyed()) return;
  event.preventDefault();
  const choice = dialog.showMessageBoxSync(mainWindow, {
    type: 'question',
    buttons: ['Выйти', 'Отмена'],
    defaultId: 1,
    cancelId: 1,
    title: 'HHH RP Launcher',
    message: 'Закрыть лаунчер?'
  });
  if (choice === 0) {
    allowAppQuit = true;
    allowWindowClose = true;
    app.quit();
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

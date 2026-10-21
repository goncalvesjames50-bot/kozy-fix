const { app, BrowserWindow, ipcMain, globalShortcut, Tray, Menu, safeStorage, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const os = require('os');
const { execFile } = require('child_process');
const { setSaturation, cleanup } = require('./saturation');
const { uIOhook } = require('uiohook-napi');

let mainWindow = null;
let currentMouseBind = null;
let tray = null;
let minimizeToTray = false;
let licenseIsActive = false;
let valorantPriorityTimer = null;
const fivemCpuSamples = new Map();

const licenseConfigPath = path.join(__dirname, 'license-config.json');
const getLicenseStatePath = () => path.join(app.getPath('userData'), 'license-state.dat');
const valorantCloseableApps = new Set(['chrome', 'msedge', 'firefox', 'brave', 'opera', 'Spotify', 'OneDrive']);

function checkWindowsProcess(processName) {
  return new Promise((resolve, reject) => {
    execFile('tasklist.exe', ['/FI', `IMAGENAME eq ${processName}.exe`, '/FO', 'CSV', '/NH'], { windowsHide: true }, (error, stdout) => {
      if (error) {
        reject(new Error(`Não foi possível verificar o estado de ${processName}: ${error.message}`));
        return;
      }
      resolve(stdout.split(/\r?\n/).some(line => line.toLowerCase().startsWith(`"${processName.toLowerCase()}.exe"`)));
    });
  });
}

async function getValorantStatus() {
  const [riotClientRunning, valorantRunning] = await Promise.all([
    checkWindowsProcess('RiotClientServices'),
    checkWindowsProcess('VALORANT-Win64-Shipping')
  ]);
  return { riotClientRunning, valorantRunning };
}

function requestCloseSelectedApps(processNames) {
  const selectedApps = processNames.filter(name => valorantCloseableApps.has(name));
  if (selectedApps.length === 0) return Promise.resolve();

  const powershellNames = selectedApps.map(name => `'${name}'`).join(', ');
  const script = `$names = @(${powershellNames}); Get-Process -Name $names -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | ForEach-Object { [void]$_.CloseMainWindow() }`;
  return new Promise((resolve, reject) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true }, error => {
      if (error) reject(new Error(`Não foi possível pedir o fecho das aplicações selecionadas: ${error.message}`));
      else resolve();
    });
  });
}

function readFiveMHardwareSensors() {
  const script = [
    "$games = @(Get-Process -Name 'FiveM','FiveM_GTAProcess' -ErrorAction SilentlyContinue | Select-Object ProcessName,Id,CPU,WorkingSet64)",
    "$zones = @()",
    "try { $zones = @(Get-CimInstance -Namespace root/wmi -ClassName MSAcpi_ThermalZoneTemperature -ErrorAction Stop | Select-Object InstanceName,CurrentTemperature) } catch {}",
    "[pscustomobject]@{ processes = $games; thermalZones = $zones } | ConvertTo-Json -Compress -Depth 3"
  ].join('; ');

  return new Promise((resolve, reject) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', script],
      { windowsHide: true, timeout: 10000, maxBuffer: 1024 * 1024 },
      (error, stdout) => {
        if (error) {
          reject(new Error(`Não foi possível ler as métricas do FiveM: ${error.message}`));
          return;
        }
        try {
          resolve(JSON.parse(stdout.trim()));
        } catch (parseError) {
          reject(new Error(`A resposta de métricas do Windows era inválida: ${parseError.message}`));
        }
      }
    );
  });
}

ipcMain.handle('fivem:get-metrics', async () => {
  if (!licenseIsActive) return { success: false, message: 'Ativa a licença para consultar as métricas.' };

  try {
    const now = Date.now();
    const data = await readFiveMHardwareSensors();
    const processes = Array.isArray(data.processes) ? data.processes : data.processes ? [data.processes] : [];
    const activePids = new Set(processes.map(process => Number(process.Id)));
    const processMetrics = processes.map(process => {
      const pid = Number(process.Id);
      const cpuSeconds = Number(process.CPU) || 0;
      const previous = fivemCpuSamples.get(pid);
      const elapsedMs = previous ? now - previous.sampledAt : 0;
      const cpuPercent = previous && elapsedMs > 0
        ? Math.max(0, ((cpuSeconds - previous.cpuSeconds) * 1000 / elapsedMs / os.cpus().length) * 100)
        : null;

      fivemCpuSamples.set(pid, { cpuSeconds, sampledAt: now });
      return {
        name: String(process.ProcessName || ''),
        memoryBytes: Number(process.WorkingSet64) || 0,
        cpuPercent: cpuPercent === null ? null : Math.min(100, cpuPercent)
      };
    });
    for (const pid of fivemCpuSamples.keys()) {
      if (!activePids.has(pid)) fivemCpuSamples.delete(pid);
    }

    const thermalZones = Array.isArray(data.thermalZones)
      ? data.thermalZones
      : data.thermalZones ? [data.thermalZones] : [];
    const temperatures = thermalZones
      .map(zone => (Number(zone.CurrentTemperature) / 10) - 273.15)
      .filter(value => Number.isFinite(value) && value >= 0 && value <= 120);

    const totalMemory = os.totalmem();
    const availableMemory = os.freemem();
    return {
      success: true,
      sampledAt: now,
      systemMemory: {
        totalBytes: totalMemory,
        usedBytes: totalMemory - availableMemory,
        usedPercent: Math.round(((totalMemory - availableMemory) / totalMemory) * 100)
      },
      processes: processMetrics,
      thermal: temperatures.length ? { minC: Math.min(...temperatures), maxC: Math.max(...temperatures) } : null
    };
  } catch (error) {
    console.error('Falha ao consultar métricas do FiveM:', error);
    return { success: false, message: error.message };
  }
});

function monitorValorantPriority(webContents) {
  if (valorantPriorityTimer) clearInterval(valorantPriorityTimer);
  let attempts = 0;
  valorantPriorityTimer = setInterval(async () => {
    attempts += 1;
    if (webContents.isDestroyed()) {
      clearInterval(valorantPriorityTimer);
      valorantPriorityTimer = null;
      return;
    }

    try {
      const status = await getValorantStatus();
      if (status.valorantRunning) {
        clearInterval(valorantPriorityTimer);
        valorantPriorityTimer = null;
        execFile(
          'powershell.exe',
          ['-NoProfile', '-NonInteractive', '-Command', "$game = Get-Process -Name 'VALORANT-Win64-Shipping' -ErrorAction Stop; $game.PriorityClass = 'High'"],
          { windowsHide: true },
          error => {
            if (webContents.isDestroyed()) return;
            if (error) {
              webContents.send('valorant:priority-result', { success: false, message: `O jogo abriu, mas não foi possível alterar a prioridade: ${error.message}` });
            } else {
              webContents.send('valorant:priority-result', { success: true, message: 'Prioridade alta aplicada ao VALORANT.' });
            }
          }
        );
        return;
      }
    } catch (error) {
      console.error('Falha ao verificar VALORANT para ajustar a prioridade:', error);
    }

    if (attempts >= 24) {
      clearInterval(valorantPriorityTimer);
      valorantPriorityTimer = null;
      if (!webContents.isDestroyed()) {
        webContents.send('valorant:priority-result', { success: false, message: 'Não foi possível detetar o VALORANT para ajustar a prioridade.' });
      }
    }
  }, 5000);
}

function getLicenseConfig() {
  try {
    const config = JSON.parse(fs.readFileSync(licenseConfigPath, 'utf8'));
    if (typeof config.supabaseUrl !== 'string' || typeof config.supabaseAnonKey !== 'string') {
      throw new Error('license-config.json precisa conter supabaseUrl e supabaseAnonKey.');
    }

    const url = config.supabaseUrl.trim().replace(/\/+$/, '');
    const isLocalDevelopmentUrl = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(url);
    if (!url || (!url.startsWith('https://') && !isLocalDevelopmentUrl) || !config.supabaseAnonKey.trim()) {
      return null;
    }

    return { url, anonKey: config.supabaseAnonKey.trim() };
  } catch (error) {
    if (error.code !== 'ENOENT') console.error('Falha ao ler a configuração de licença:', error);
    return null;
  }
}

function readLicenseState() {
  const licenseStatePath = getLicenseStatePath();
  if (!fs.existsSync(licenseStatePath)) return null;
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('A encriptação segura do Windows não está disponível.');
  }

  try {
    const encrypted = fs.readFileSync(licenseStatePath);
    const state = JSON.parse(safeStorage.decryptString(encrypted));
    if (typeof state.licenseKey !== 'string' || typeof state.deviceId !== 'string') {
      throw new Error('O ficheiro de licença está inválido.');
    }
    return state;
  } catch (error) {
    throw new Error(`Não foi possível ler a licença guardada: ${error.message}`);
  }
}

function saveLicenseState(state) {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('A encriptação segura do Windows não está disponível.');
  }
  const licenseStatePath = getLicenseStatePath();
  fs.mkdirSync(path.dirname(licenseStatePath), { recursive: true });
  fs.writeFileSync(licenseStatePath, safeStorage.encryptString(JSON.stringify(state)));
}

async function validateLicenseKey(licenseKey, deviceId) {
  const config = getLicenseConfig();
  if (!config) return { valid: false, status: 'configuration_missing', message: 'A validação ainda não está configurada. Preenche license-config.json e publica a função validate-license do Supabase.' };

  const normalizedKey = licenseKey.trim().toUpperCase();
  if (!/^PF-[A-F0-9]{48}$/.test(normalizedKey)) {
    return { valid: false, status: 'invalid_key', message: 'A chave de licença não é válida.' };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(`${config.url}/functions/v1/validate-license`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: config.anonKey,
        Authorization: `Bearer ${config.anonKey}`
      },
      body: JSON.stringify({ key: normalizedKey, deviceId }),
      signal: controller.signal
    });

    let result;
    try {
      result = await response.json();
    } catch {
      throw new Error(`O servidor de licenças respondeu com uma resposta inválida (HTTP ${response.status}).`);
    }

    if (typeof result.valid !== 'boolean' || typeof result.status !== 'string') {
      throw new Error(typeof result.message === 'string' ? result.message : `Falha no servidor de licenças (HTTP ${response.status}).`);
    }
    return result;
  } catch (error) {
    console.error('Falha na validação online da licença:', error);
    if (error.name === 'AbortError') {
      return { valid: false, status: 'network_error', message: 'A validação demorou demasiado. Verifica a ligação à internet e tenta novamente.' };
    }
    return { valid: false, status: 'network_error', message: `Não foi possível validar a licença: ${error.message}` };
  } finally {
    clearTimeout(timeout);
  }
}

async function checkSavedLicense() {
  licenseIsActive = false;
  if (!getLicenseConfig()) {
    return { valid: false, status: 'configuration_missing', message: 'A validação ainda não está configurada. Preenche license-config.json e publica a função validate-license do Supabase.' };
  }
  if (!safeStorage.isEncryptionAvailable()) {
    return { valid: false, status: 'secure_storage_unavailable', message: 'O armazenamento seguro do Windows não está disponível.' };
  }

  let state;
  try {
    state = readLicenseState();
  } catch (error) {
    console.error(error);
    return { valid: false, status: 'storage_error', message: error.message };
  }
  if (!state) return { valid: false, status: 'activation_required', message: 'Introduz a tua chave de licença para ativar este computador.' };

  const result = await validateLicenseKey(state.licenseKey, state.deviceId);
  if (result.valid && (!state.displayName || !state.displayName.trim())) {
    return { ...result, valid: false, status: 'profile_required', message: 'Introduz o nome que queres mostrar no perfil.' };
  }
  licenseIsActive = result.valid === true;
  return { ...result, displayName: state.displayName };
}

ipcMain.handle('license:check', checkSavedLicense);

function normalizeDisplayName(value) {
  if (typeof value !== 'string') return null;
  const displayName = value.trim().replace(/\s+/g, ' ');
  if (!displayName || [...displayName].length > 32 || /[\u0000-\u001f\u007f]/.test(displayName)) return null;
  return displayName;
}

ipcMain.handle('license:activate', async (_event, activation = {}) => {
  licenseIsActive = false;
  const licenseKey = activation && typeof activation === 'object' ? activation.licenseKey : null;
  const displayName = normalizeDisplayName(activation && typeof activation === 'object' ? activation.displayName : null);
  if (typeof licenseKey !== 'string' || licenseKey.length > 128) {
    return { valid: false, status: 'invalid_key', message: 'Introduz uma chave de licença válida.' };
  }
  if (!displayName) {
    return { valid: false, status: 'invalid_name', message: 'Introduz um nome com até 32 caracteres.' };
  }
  if (!getLicenseConfig()) {
    return { valid: false, status: 'configuration_missing', message: 'A validação ainda não está configurada. Preenche license-config.json e publica a função validate-license do Supabase.' };
  }
  if (!safeStorage.isEncryptionAvailable()) {
    return { valid: false, status: 'secure_storage_unavailable', message: 'O armazenamento seguro do Windows não está disponível.' };
  }

  let state;
  try {
    state = readLicenseState();
  } catch (error) {
    console.error(error);
    return { valid: false, status: 'storage_error', message: error.message };
  }

  const deviceId = state?.deviceId || crypto.randomUUID();
  const result = await validateLicenseKey(licenseKey, deviceId);
  if (!result.valid) return result;

  try {
    saveLicenseState({ licenseKey: licenseKey.trim().toUpperCase(), deviceId, displayName });
    licenseIsActive = true;
    return { ...result, displayName };
  } catch (error) {
    console.error('Falha ao guardar a licença:', error);
    return { valid: false, status: 'storage_error', message: `A licença foi validada, mas não pôde ser guardada: ${error.message}` };
  }
});

ipcMain.handle('license:set-display-name', async (_event, requestedName) => {
  licenseIsActive = false;
  const displayName = normalizeDisplayName(requestedName);
  if (!displayName) {
    return { valid: false, status: 'invalid_name', message: 'Introduz um nome com até 32 caracteres.' };
  }
  if (!safeStorage.isEncryptionAvailable()) {
    return { valid: false, status: 'secure_storage_unavailable', message: 'O armazenamento seguro do Windows não está disponível.' };
  }

  let state;
  try {
    state = readLicenseState();
  } catch (error) {
    console.error(error);
    return { valid: false, status: 'storage_error', message: error.message };
  }
  if (!state) {
    return { valid: false, status: 'activation_required', message: 'Introduz primeiro a chave de licença.' };
  }

  const result = await validateLicenseKey(state.licenseKey, state.deviceId);
  if (!result.valid) return result;

  try {
    saveLicenseState({ ...state, displayName });
    licenseIsActive = true;
    return { ...result, displayName };
  } catch (error) {
    console.error('Falha ao guardar o nome do perfil:', error);
    return { valid: false, status: 'storage_error', message: `Não foi possível guardar o nome: ${error.message}` };
  }
});

function createWindow () {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#00000000', // Transparent background to show rounded corners
    transparent: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false // Habilita o uso de require() dentro do frontend (útil no futuro para bibliotecas USB)
    },
    autoHideMenuBar: true, // Esconde o menu padrao do Windows
    frame: false, // Remove as bordas do SO
    icon: path.join(__dirname, 'GPRO SUPER.png') // Um icone temporario baseado nas imagens existentes
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));
  
  mainWindow.on('close', (event) => {
    if (minimizeToTray && !app.isQuiting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });

  const { exec } = require('child_process');

  if (!tray) {
    tray = new Tray(path.join(__dirname, 'ico.png'));
    tray.setToolTip('PrecisionFix');
    const contextMenu = Menu.buildFromTemplate([
      { label: 'Abrir Painel', click: () => { mainWindow.show(); mainWindow.focus(); } },
      { type: 'separator' },
      { label: 'Sair', click: () => { app.isQuiting = true; app.quit(); } }
    ]);
    tray.setContextMenu(contextMenu);
    tray.on('click', () => {
      mainWindow.show();
      mainWindow.focus();
    });
  }
}

ipcMain.on('set-autostart', (event, enabled) => {
  if (!licenseIsActive) return;
  app.setLoginItemSettings({
    openAtLogin: enabled,
    path: app.getPath('exe')
  });
});

ipcMain.on('set-min-tray', (event, enabled) => {
  if (!licenseIsActive) return;
  minimizeToTray = enabled;
});

ipcMain.handle('valorant:status', async () => {
  if (!licenseIsActive) return { success: false, message: 'Ativa a licença para consultar o estado do jogo.' };
  try {
    return { success: true, ...await getValorantStatus() };
  } catch (error) {
    console.error('Falha ao consultar o estado do VALORANT:', error);
    return { success: false, message: error.message };
  }
});

ipcMain.handle('valorant:launch', async (event, options = {}) => {
  if (!licenseIsActive) return { success: false, message: 'Ativa a licença para abrir o jogo.' };
  const selectedApps = Array.isArray(options.closeApps)
    ? options.closeApps.filter(name => typeof name === 'string' && valorantCloseableApps.has(name))
    : [];

  try {
    await requestCloseSelectedApps(selectedApps);
    await shell.openExternal('com.riotgames.launcher://launch-product=valorant&launch-patchline=live');
    if (options.highPriority === true) monitorValorantPriority(event.sender);
    return {
      success: true,
      message: options.highPriority === true
        ? 'A abertura do VALORANT foi pedida ao Riot Client. A prioridade será ajustada se o jogo for detetado.'
        : 'A abertura do VALORANT foi pedida ao Riot Client.'
    };
  } catch (error) {
    console.error('Falha ao abrir o VALORANT:', error);
    return { success: false, message: `Não foi possível abrir o VALORANT: ${error.message}` };
  }
});

ipcMain.on('window-min', (event) => {
  const webContents = event.sender;
  const win = BrowserWindow.fromWebContents(webContents);
  if (win) win.minimize();
});

ipcMain.on('window-close', (event) => {
  const webContents = event.sender;
  const win = BrowserWindow.fromWebContents(webContents);
  if (win === mainWindow) {
    if (minimizeToTray && !app.isQuiting) {
      win.hide();
    } else {
      app.isQuiting = true;
      app.quit();
    }
  } else if (win) {
    win.close();
  }
});

ipcMain.handle('launch-fivem', async (event, options = {}) => {
  if (!licenseIsActive) return { success: false, message: 'Ativa a licença antes de iniciar o FiveM.' };

  const localAppData = process.env.LOCALAPPDATA;
  if (!localAppData) return { success: false, message: 'Não foi possível encontrar a pasta local de aplicações do Windows.' };

  const fivemPath = path.join(localAppData, 'FiveM', 'FiveM.exe');
  const completedSteps = [];

  try {
    if (options.closeApps === true) {
      await requestCloseSelectedApps(['chrome', 'msedge', 'firefox', 'opera', 'brave', 'Spotify', 'OneDrive']);
      completedSteps.push('Foi pedido o fecho normal das aplicações selecionadas.');
    }

    if (options.clearCache === true) {
      const dataPath = path.join(localAppData, 'FiveM', 'FiveM.app', 'data');
      for (const folder of ['cache', 'server-cache', 'server-cache-priv']) {
        const folderPath = path.join(dataPath, folder);
        if (fs.existsSync(folderPath)) fs.rmSync(folderPath, { recursive: true, force: true });
      }
      completedSteps.push('Cache local do FiveM limpa.');
    }

    if (options.flushDns === true) {
      await new Promise((resolve, reject) => {
        execFile('ipconfig.exe', ['/flushdns'], { windowsHide: true }, error => {
          if (error) reject(new Error(`Não foi possível limpar a cache DNS: ${error.message}`));
          else resolve();
        });
      });
      completedSteps.push('Cache DNS limpa.');
    }

    if (fs.existsSync(fivemPath)) {
      const openError = await shell.openPath(fivemPath);
      if (openError) throw new Error(`Não foi possível abrir o FiveM: ${openError}`);
    } else {
      await shell.openExternal('fivem://');
    }
    completedSteps.push('Pedido de abertura do FiveM enviado.');

    if (options.highPriority === true) {
      const sender = event.sender;
      setTimeout(() => {
        execFile(
          'powershell.exe',
          ['-NoProfile', '-NonInteractive', '-Command', "$games = Get-Process -Name 'FiveM','FiveM_GTAProcess' -ErrorAction SilentlyContinue; if (-not $games) { exit 2 }; $games | ForEach-Object { $_.PriorityClass = 'High' }"],
          { windowsHide: true },
          error => {
            if (sender.isDestroyed()) return;
            sender.send('fivem:priority-result', {
              success: !error,
              message: error
                ? 'O FiveM abriu, mas não foi possível aplicar prioridade alta. Confirma se o jogo já iniciou.'
                : 'Prioridade alta aplicada ao processo do FiveM.'
            });
          }
        );
      }, 12000);
      completedSteps.push('A prioridade alta será tentada depois de o jogo iniciar.');
    }

    return { success: true, message: completedSteps.join(' ') };
  } catch (error) {
    console.error('Falha ao preparar o FiveM:', error);
    const completedMessage = completedSteps.length ? ` Já concluído: ${completedSteps.join(' ')}` : '';
    return { success: false, message: `${error.message}${completedMessage}` };
  }
});

ipcMain.on('apply-sensi', (event, options) => {
  if (!licenseIsActive) return;
  const { exec } = require('child_process');
  const fs = require('fs');
  const path = require('path');
  
  const psScript = `
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class Mouse {
    [DllImport("user32.dll")]
    public static extern bool SystemParametersInfo(uint uiAction, uint uiParam, IntPtr pvParam, uint fWinIni);
    
    [DllImport("user32.dll")]
    public static extern bool SystemParametersInfo(uint uiAction, uint uiParam, int[] pvParam, uint fWinIni);
}
"@
[Mouse]::SystemParametersInfo(0x0071, 0, [IntPtr]${options.speed}, 3)
` + "$mouseParams = New-Object 'int[]' 3; $mouseParams[0] = 0; $mouseParams[1] = 0; $mouseParams[2] = " + (options.accel ? "1" : "0") + ";" + `
[Mouse]::SystemParametersInfo(0x0004, 0, $mouseParams, 3)
  `;
  
  const tempScriptPath = path.join(require('os').tmpdir(), 'set_mouse.ps1');
  fs.writeFileSync(tempScriptPath, psScript);
  exec(`powershell -ExecutionPolicy Bypass -WindowStyle Hidden -Command "Start-Process powershell -WindowStyle Hidden -ArgumentList '-ExecutionPolicy Bypass -WindowStyle Hidden -File \\"${tempScriptPath}\\"' -Verb RunAs -Wait"`, (error) => {
    if (error) console.error("Error setting mouse:", error);
    try { fs.unlinkSync(tempScriptPath); } catch(e){}
    event.sender.send('apply-sensi-reply', error ? false : true);
  });
});

const precisionScripts = {
    "mouse-precision": {
        "apply": "Set-ItemProperty -Path 'HKCU:\\Control Panel\\Mouse' -Name 'MouseSpeed' -Value '0'; Set-ItemProperty -Path 'HKCU:\\Control Panel\\Mouse' -Name 'MouseThreshold1' -Value '0'; Set-ItemProperty -Path 'HKCU:\\Control Panel\\Mouse' -Name 'MouseThreshold2' -Value '0'"
    },
    "network-latency": {
        "apply": "netsh int tcp set global autotuninglevel=normal; netsh int tcp set global chimney=enabled; netsh int tcp set global dca=enabled; netsh int tcp set global netdma=enabled"
    },
    "performance-boost": {
        "apply": "powercfg /setactive 01001011-0100-1111-0101-001188888883 2>$null; if ($LASTEXITCODE -ne 0) { powercfg /setactive e9a42b02-d5df-448d-aa00-03f14749eb61 2>$null; if ($LASTEXITCODE -ne 0) { powercfg /duplicatescheme e9a42b02-d5df-448d-aa00-03f14749eb61 2>$null; powercfg /setactive e9a42b02-d5df-448d-aa00-03f14749eb61 2>$null; if ($LASTEXITCODE -ne 0) { powercfg /setactive 8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c 2>$null; if ($LASTEXITCODE -ne 0) { powercfg /duplicatescheme 8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c 2>$null; powercfg /setactive 8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c 2>$null } } } }; exit 0"
    },
    "k1ng-tracking": {
        "apply": "Set-ItemProperty -Path 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\PriorityControl' -Name 'Win32PrioritySeparation' -Value 40"
    },
    "k1ng-sensi": {
        "apply": "Set-ItemProperty -Path 'HKCU:\\Control Panel\\Mouse' -Name 'SmoothMouseXCurve' -Value ([byte[]](0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0xC0,0xCC,0x0C,0x00,0x00,0x00,0x00,0x00,0x80,0x99,0x19,0x00,0x00,0x00,0x00,0x00,0x40,0x66,0x26,0x00,0x00,0x00,0x00,0x00,0x00,0x33,0x33,0x00,0x00,0x00,0x00,0x00)); Set-ItemProperty -Path 'HKCU:\\Control Panel\\Mouse' -Name 'SmoothMouseYCurve' -Value ([byte[]](0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x38,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x70,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0xA8,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0xE0,0x00,0x00,0x00,0x00,0x00))"
    },
    "k1ng-flick": {
        "apply": "Set-ItemProperty -Path 'HKCU:\\Control Panel\\Mouse' -Name 'MouseHoverTime' -Value '8'; powercfg /SETACVALUEINDEX SCHEME_CURRENT SUB_NONE 898f7e35-505a-40a8-9cd7-813468f6b736 0 2>$null; powercfg /SETDCVALUEINDEX SCHEME_CURRENT SUB_NONE 898f7e35-505a-40a8-9cd7-813468f6b736 0 2>$null; exit 0"
    },
    "k1ng-0.5ms": {
        "apply": "bcdedit /set disabledynamictick yes 2>$null; bcdedit /set useplatformtick yes 2>$null; exit 0"
    },
    "k1ng-filterkeys": {
        "apply": "Set-ItemProperty -Path 'HKCU:\\Control Panel\\Accessibility\\Keyboard Response' -Name 'Flags' -Value '0'; Set-ItemProperty -Path 'HKCU:\\Control Panel\\Accessibility\\Keyboard Response' -Name 'AutoRepeatRate' -Value '13'; Set-ItemProperty -Path 'HKCU:\\Control Panel\\Accessibility\\Keyboard Response' -Name 'AutoRepeatDelay' -Value '200'; Set-ItemProperty -Path 'HKCU:\\Control Panel\\Accessibility\\Keyboard Response' -Name 'BounceTime' -Value '0'; Set-ItemProperty -Path 'HKCU:\\Control Panel\\Accessibility\\Keyboard Response' -Name 'DelayBeforeAccept' -Value '0'"
    },
    "k1ng-registros-mouse": {
        "apply": "if (-not (Test-Path 'HKLM:\\SYSTEM\\CurrentControlSet\\Services\\Mouclass\\Parameters')) { New-Item -Path 'HKLM:\\SYSTEM\\CurrentControlSet\\Services\\Mouclass\\Parameters' -Force | Out-Null }; Set-ItemProperty -Path 'HKLM:\\SYSTEM\\CurrentControlSet\\Services\\Mouclass\\Parameters' -Name 'MouseDataQueueSize' -Value 20"
    },
    "k1ng-islc": {
        "apply": "Set-ItemProperty -Path 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Memory Management' -Name 'DisablePagingExecutive' -Value 1; Set-ItemProperty -Path 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Memory Management' -Name 'LargeSystemCache' -Value 0"
    },
    "k1ng-sensi-x-y": {
        "apply": "Set-ItemProperty -Path 'HKCU:\\Control Panel\\Mouse' -Name 'MouseSensitivity' -Value '10'; Set-ItemProperty -Path 'HKCU:\\Control Panel\\Mouse' -Name 'MouseSpeed' -Value '0'"
    },
    "k1ng-flags": {
        "apply": "Set-ItemProperty -Path 'HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Multimedia\\SystemProfile\\Tasks\\Games' -Name 'GPU Priority' -Value '8'; Set-ItemProperty -Path 'HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Multimedia\\SystemProfile\\Tasks\\Games' -Name 'Priority' -Value '6'"
    },
    "k1ng-accessibility": {
        "apply": "Set-ItemProperty -Path 'HKCU:\\Control Panel\\Accessibility\\MouseKeys' -Name 'Flags' -Value '0'; Set-ItemProperty -Path 'HKCU:\\Control Panel\\Accessibility\\StickyKeys' -Name 'Flags' -Value '0'; Set-ItemProperty -Path 'HKCU:\\Control Panel\\Accessibility\\Keyboard Response' -Name 'Flags' -Value '0'; Set-ItemProperty -Path 'HKCU:\\Control Panel\\Accessibility\\ToggleKeys' -Name 'Flags' -Value '0'"
    },
    "k1ng-boost-fivem": {
        "apply": "New-Item -Path 'HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Image File Execution Options\\FiveM.exe\\PerfOptions' -Force | Out-Null; Set-ItemProperty -Path 'HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Image File Execution Options\\FiveM.exe\\PerfOptions' -Name 'CpuPriorityClass' -Value 3; New-Item -Path 'HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Image File Execution Options\\FiveM_GTAProcess.exe\\PerfOptions' -Force | Out-Null; Set-ItemProperty -Path 'HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Image File Execution Options\\FiveM_GTAProcess.exe\\PerfOptions' -Name 'CpuPriorityClass' -Value 3; Set-ItemProperty -Path 'HKCU:\\System\\GameConfigStore' -Name 'GameDVR_FSEBehaviorMode' -Value 2; Set-ItemProperty -Path 'HKCU:\\System\\GameConfigStore' -Name 'GameDVR_HonorUserFSEBehaviorMode' -Value 1; Set-ItemProperty -Path 'HKCU:\\System\\GameConfigStore' -Name 'GameDVR_Enabled' -Value 0"
    },
    "disp-inputlag": {
        "apply": "Set-ItemProperty -Path 'HKLM:\\SOFTWARE\\Microsoft\\DirectX' -Name 'MaxPreRenderedFrames' -Value 1 -ErrorAction SilentlyContinue"
    },
    "disp-priority": {
        "apply": "Set-ItemProperty -Path 'HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Multimedia\\SystemProfile\\Tasks\\Games' -Name 'GPU Priority' -Value 8 -ErrorAction SilentlyContinue"
    },
    "disp-saturation": {
        "apply": "$appDir = '__APP_DIR__'; if (Test-Path \"$appDir\\vibranceGUI.exe\") { Start-Process -FilePath \"$appDir\\vibranceGUI.exe\" -WindowStyle Hidden } else { Write-Host 'vibranceGUI.exe nao encontrado' }"
    },
    "revert-all": {
        "apply": "Set-ItemProperty -Path 'HKCU:\\Control Panel\\Mouse' -Name 'MouseSpeed' -Value '1'; Set-ItemProperty -Path 'HKCU:\\Control Panel\\Mouse' -Name 'MouseThreshold1' -Value '6'; Set-ItemProperty -Path 'HKCU:\\Control Panel\\Mouse' -Name 'MouseThreshold2' -Value '10'; Set-ItemProperty -Path 'HKCU:\\Control Panel\\Mouse' -Name 'SmoothMouseXCurve' -Value ([byte[]](0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x15,0x6e,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x40,0x01,0x00,0x00,0x00,0x00,0x00,0x29,0xdc,0x03,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x28,0x00,0x00,0x00,0x00,0x00)); Set-ItemProperty -Path 'HKCU:\\Control Panel\\Mouse' -Name 'SmoothMouseYCurve' -Value ([byte[]](0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0xfd,0x11,0x01,0x00,0x00,0x00,0x00,0x00,0x00,0x24,0x04,0x00,0x00,0x00,0x00,0x00,0x00,0xfc,0x12,0x00,0x00,0x00,0x00,0x00,0x00,0xc0,0xbb,0x01,0x00,0x00,0x00,0x00)); netsh int tcp set global autotuninglevel=normal; netsh int tcp set global chimney=default; netsh int tcp set global dca=disabled; netsh int tcp set global netdma=disabled; powercfg /setactive 381b4222-f694-41f0-9685-ff5bb260df2e 2>$null; Set-ItemProperty -Path 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\PriorityControl' -Name 'Win32PrioritySeparation' -Value 2; bcdedit /deletevalue disabledynamictick 2>$null; bcdedit /deletevalue useplatformtick 2>$null; Set-ItemProperty -Path 'HKCU:\\Control Panel\\Accessibility\\Keyboard Response' -Name 'Flags' -Value '126'; if (-not (Test-Path 'HKLM:\\SYSTEM\\CurrentControlSet\\Services\\Mouclass\\Parameters')) { New-Item -Path 'HKLM:\\SYSTEM\\CurrentControlSet\\Services\\Mouclass\\Parameters' -Force | Out-Null }; Set-ItemProperty -Path 'HKLM:\\SYSTEM\\CurrentControlSet\\Services\\Mouclass\\Parameters' -Name 'MouseDataQueueSize' -Value 100; Set-ItemProperty -Path 'HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Multimedia\\SystemProfile\\Tasks\\Games' -Name 'GPU Priority' -Value '8'; Set-ItemProperty -Path 'HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Multimedia\\SystemProfile\\Tasks\\Games' -Name 'Priority' -Value '2'; Set-ItemProperty -Path 'HKCU:\\Control Panel\\Accessibility\\MouseKeys' -Name 'Flags' -Value '62'; Set-ItemProperty -Path 'HKCU:\\Control Panel\\Accessibility\\StickyKeys' -Name 'Flags' -Value '510'; Set-ItemProperty -Path 'HKCU:\\Control Panel\\Accessibility\\ToggleKeys' -Name 'Flags' -Value '62'; Set-ItemProperty -Path 'HKCU:\\Control Panel\\Accessibility\\Keyboard Response' -Name 'Flags' -Value '126'; Remove-Item -Path 'HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Image File Execution Options\\FiveM.exe\\PerfOptions' -Recurse -ErrorAction SilentlyContinue; Remove-Item -Path 'HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Image File Execution Options\\FiveM_GTAProcess.exe\\PerfOptions' -Recurse -ErrorAction SilentlyContinue; Set-ItemProperty -Path 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Memory Management' -Name 'DisablePagingExecutive' -Value 0; Set-ItemProperty -Path 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Memory Management' -Name 'LargeSystemCache' -Value 0"
    }
};

ipcMain.on('apply-precision-tweaks', (event, selectedTweaks) => {
  if (!licenseIsActive) return;
  const { exec } = require('child_process');
  const path = require('path');
  const fs = require('fs');

  let psLines = [];
  
  for (const [key, isChecked] of Object.entries(selectedTweaks)) {
    if (isChecked && precisionScripts[key] && precisionScripts[key].apply) {
      let script = precisionScripts[key].apply;
      const appDir = __dirname.replace('app.asar', 'app.asar.unpacked').replace(/\\/g, '\\\\');
      script = script.replace(/__APP_DIR__/g, appDir);
      psLines.push(script);
    }
  }

  if (psLines.length === 0) {
    return event.sender.send('precision-tweaks-reply', true);
  }

  const psScript = psLines.join('; ');
  const tempScriptPath = path.join(require('os').tmpdir(), 'apply_tweaks.ps1');
  fs.writeFileSync(tempScriptPath, psScript);

  exec(`powershell -ExecutionPolicy Bypass -WindowStyle Hidden -Command "Start-Process powershell -WindowStyle Hidden -ArgumentList '-ExecutionPolicy Bypass -WindowStyle Hidden -File \\"${tempScriptPath}\\"' -Verb RunAs -Wait"`, (error) => {
    try { fs.unlinkSync(tempScriptPath); } catch(e){}
    event.sender.send('precision-tweaks-reply', error ? false : true);
  });
});

ipcMain.on('revert-precision-tweaks', (event) => {
  if (!licenseIsActive) return;
  const { exec } = require('child_process');
  const path = require('path');
  const fs = require('fs');

  const psScript = precisionScripts['revert-all'].apply;
  const tempScriptPath = path.join(require('os').tmpdir(), 'revert_tweaks.ps1');
  fs.writeFileSync(tempScriptPath, psScript);

  exec(`powershell -ExecutionPolicy Bypass -WindowStyle Hidden -Command "Start-Process powershell -WindowStyle Hidden -ArgumentList '-ExecutionPolicy Bypass -WindowStyle Hidden -File \\"${tempScriptPath}\\"' -Verb RunAs -Wait"`, (error) => {
    try { fs.unlinkSync(tempScriptPath); } catch(e){}
    event.sender.send('revert-tweaks-reply', error ? false : true);
  });
});

let crosshairWin = null;
ipcMain.on('apply-mira', (event, config) => {
  if (!licenseIsActive) return;
  if (!crosshairWin) {
    const { screen } = require('electron');
    const primaryDisplay = screen.getPrimaryDisplay();
    const { width, height } = primaryDisplay.bounds;
    
    crosshairWin = new BrowserWindow({
      width: width,
      height: height,
      transparent: true,
      frame: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      hasShadow: false,
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false
      }
    });
    crosshairWin.setIgnoreMouseEvents(true);
    crosshairWin.setAlwaysOnTop(true, 'screen-saver');
    crosshairWin.maximize();
    crosshairWin.loadFile(path.join(__dirname, 'crosshair.html'));
  } else {
    crosshairWin.showInactive();
  }
  
  // Controle 100% sem delay feito apenas via CSS interno
  if (crosshairWin) {
    crosshairWin.webContents.send('set-visibility', config.active);
  }
});

ipcMain.on('update-crosshair', (event, config) => {
  if (!licenseIsActive) return;
  if (crosshairWin) {
    crosshairWin.webContents.send('update-crosshair', config);
  }
});

ipcMain.on('set-mira-bind', (event, bindInfo) => {
  if (!licenseIsActive) return;
  globalShortcut.unregisterAll();
  currentMouseBind = null;

  if (bindInfo && bindInfo.type === 'key' && bindInfo.keyStr) {
    try {
      const success = globalShortcut.register(bindInfo.keyStr, () => {
        if (mainWindow) {
          mainWindow.webContents.send('trigger-mira-bind');
        }
      });
      event.sender.send('bind-status', { success, keyStr: bindInfo.keyStr });
    } catch (e) {
      console.error('Failed to register global shortcut:', e);
      event.sender.send('bind-status', { success: false, keyStr: bindInfo.keyStr });
    }
  } else if (bindInfo && bindInfo.type === 'mouse') {
    let uioButton = 1;
    if (bindInfo.button === 0) uioButton = 1;
    else if (bindInfo.button === 1) uioButton = 3;
    else if (bindInfo.button === 2) uioButton = 2;
    else if (bindInfo.button === 3) uioButton = 4;
    else if (bindInfo.button === 4) uioButton = 5;
    
    currentMouseBind = uioButton;
    event.sender.send('bind-status', { success: true, keyStr: 'Mouse ' + uioButton });
  } else {
    event.sender.send('bind-status', { success: true, keyStr: null });
  }
});

app.whenReady().then(() => {
  createWindow();

  uIOhook.on('mousedown', (event) => {
    if (currentMouseBind !== null && event.button === currentMouseBind) {
      if (mainWindow) {
        mainWindow.webContents.send('trigger-mira-bind');
      }
    }
  });
  uIOhook.start();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

ipcMain.on('change-saturation', (event, value) => {
  if (!licenseIsActive) return;
  setSaturation(value);
});

const keyboardTweaks = require('./keyboard-tweaks');

ipcMain.on('apply-keyboard-tweaks', async (event, tweaks) => {
  if (!licenseIsActive) return;
  try {
    if (tweaks.precision) await keyboardTweaks.aplicarPerfilPrecisao({ incluirPrioridade: tweaks.input, incluirUsb: tweaks.usb });
    else if (tweaks.registros) await keyboardTweaks.aplicarAjustesRegistro();
    
    if (tweaks.delay) await keyboardTweaks.setAtrasoRepeticao(0);
    if (tweaks.rate) await keyboardTweaks.setTaxaRepeticao(31);
    if (tweaks.filterKeys) await keyboardTweaks.setFilterKeys(false);
    if (tweaks.bounce) await keyboardTweaks.setStickyToggleKeys(false);
    
    // As chaves individuais de HKLM
    if (!tweaks.precision) {
      if (tweaks.input) await keyboardTweaks.setPrioridadeProcesso(true);
      if (tweaks.usb) await keyboardTweaks.setSuspensaoUsbSeletiva(true);
    }
    
    event.sender.send('keyboard-tweaks-reply', { success: true });
  } catch (err) {
    console.error('Erro no teclado:', err);
    event.sender.send('keyboard-tweaks-reply', { success: false, error: err.message });
  }
});

ipcMain.on('revert-keyboard-tweaks', async (event) => {
  if (!licenseIsActive) return;
  try {
    await keyboardTweaks.restaurarPadrao();
    event.sender.send('revert-keyboard-tweaks-reply', { success: true });
  } catch (err) {
    console.error('Erro ao restaurar teclado:', err);
    event.sender.send('revert-keyboard-tweaks-reply', { success: false, error: err.message });
  }
});

app.on('before-quit', () => {
  if (valorantPriorityTimer) clearInterval(valorantPriorityTimer);
  globalShortcut.unregisterAll();
  uIOhook.stop();
  cleanup();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

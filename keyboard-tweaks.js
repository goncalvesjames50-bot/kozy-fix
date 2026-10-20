// keyboard-tweaks.js
// Módulo Electron com os 8 ajustes reais mapeados nos nomes da sua UI.
// TUDO aqui é regedit puro (comando `reg add`). Nada de powercfg ou outra API.
// Só funciona no Windows.
//
// Instalar (só é necessário pros itens que mexem em HKLM, ver nota mais abaixo):
//   npm install sudo-prompt
//
// Chaves em HKCU (usuário atual) NÃO precisam de admin.
// Chaves em HKLM (máquina toda) PRECISAM de admin -> usamos sudo-prompt pra
// pedir elevação (UAC) só na hora de aplicar aquele item específico.
// HKLM nesse módulo: Prioridade de Processo (item 5) e Suspensão USB Seletiva (item 6).

const { exec } = require('child_process');
const os = require('os');


function run(cmd) {
  return new Promise((resolve, reject) => {
    if (os.platform() !== 'win32') return reject(new Error('Só funciona no Windows.'));
    exec(cmd, (error, stdout, stderr) => {
      if (error) return reject(new Error(stderr || error.message));
      resolve(stdout);
    });
  });
}

function runComoAdmin(cmd) {
  return new Promise((resolve, reject) => {
    if (os.platform() !== 'win32') return reject(new Error('Só funciona no Windows.'));
    const fs = require('fs');
    const path = require('path');
    const tempScriptPath = path.join(os.tmpdir(), 'kb_tweak_' + Date.now() + '.bat');
    fs.writeFileSync(tempScriptPath, `@echo off\n${cmd}\n`);
    
    exec(`powershell -ExecutionPolicy Bypass -WindowStyle Hidden -Command "Start-Process cmd -ArgumentList '/c \\"${tempScriptPath}\\"' -Verb RunAs -WindowStyle Hidden -Wait"`, (error, stdout, stderr) => {
      try { fs.unlinkSync(tempScriptPath); } catch(e){}
      if (error) return reject(new Error(stderr || error.message));
      resolve(stdout);
    });
  });
}

// ---------------------------------------------------------------
// 1) Atraso de Repetição Mínimo  (KeyboardDelay: 0-3, menor = mais rápido)
// ---------------------------------------------------------------
async function setAtrasoRepeticao(valor = 0) {
  if (valor < 0 || valor > 3) throw new Error('Valor deve ser 0-3.');
  return run(`reg add "HKCU\\Control Panel\\Keyboard" /v KeyboardDelay /t REG_SZ /d ${valor} /f`);
}

// ---------------------------------------------------------------
// 2) Taxa de Repetição Máxima  (KeyboardSpeed: 0-31, maior = mais rápido)
// ---------------------------------------------------------------
async function setTaxaRepeticao(valor = 31) {
  if (valor < 0 || valor > 31) throw new Error('Valor deve ser 0-31.');
  return run(`reg add "HKCU\\Control Panel\\Keyboard" /v KeyboardSpeed /t REG_SZ /d ${valor} /f`);
}

// ---------------------------------------------------------------
// 3) Desativar Filter Keys (para de "filtrar" toques rápidos/repetidos)
// ---------------------------------------------------------------
async function setFilterKeys(ativar) {
  const flags = ativar ? '126' : '122'; // 122 = desligado, sem popup/hotkey
  return run(`reg add "HKCU\\Control Panel\\Accessibility\\Keyboard Response" /v Flags /t REG_SZ /d ${flags} /f`);
}

// ---------------------------------------------------------------
// 4) Desativar Sticky/Toggle Keys (sem os popups de acessibilidade no meio do jogo)
// ---------------------------------------------------------------
async function setStickyToggleKeys(ativar) {
  const stickyFlags = ativar ? '510' : '506';
  const toggleFlags = ativar ? '62' : '58';
  await run(`reg add "HKCU\\Control Panel\\Accessibility\\StickyKeys" /v Flags /t REG_SZ /d ${stickyFlags} /f`);
  return run(`reg add "HKCU\\Control Panel\\Accessibility\\ToggleKeys" /v Flags /t REG_SZ /d ${toggleFlags} /f`);
}

// ---------------------------------------------------------------
// 5) Prioridade de Processo em Jogo (Win32PrioritySeparation)
//    PRECISA DE ADMIN (chave fica em HKLM). Precisa reiniciar pra valer.
// ---------------------------------------------------------------
async function setPrioridadeProcesso(ativar) {
  const valor = ativar ? 38 : 2; // 38 = favorece app em primeiro plano; 2 = padrão do Windows
  const cmd = `reg add "HKLM\\SYSTEM\\CurrentControlSet\\Control\\PriorityControl" /v Win32PrioritySeparation /t REG_DWORD /d ${valor} /f`;
  return runComoAdmin(cmd);
}

// ---------------------------------------------------------------
// 6) Suspensão USB Seletiva OFF (evita delay do periférico "acordando" do idle)
//    Puro regedit (HKLM) — PRECISA DE ADMIN. Pode exigir replug do periférico
//    ou reinício pra valer em todos os dispositivos USB.
// ---------------------------------------------------------------
async function setSuspensaoUsbSeletiva(desativar) {
  const valor = desativar ? 1 : 0; // 1 = suspensão seletiva desativada, 0 = padrão do Windows
  const cmd = `reg add "HKLM\\SYSTEM\\CurrentControlSet\\Services\\USB" /v DisableSelectiveSuspend /t REG_DWORD /d ${valor} /f`;
  return runComoAdmin(cmd);
}

// ---------------------------------------------------------------
// 7) Aplicar Ajustes de Registro (grupo: delay + speed + filter keys)
// ---------------------------------------------------------------
async function aplicarAjustesRegistro() {
  await setAtrasoRepeticao(0);
  await setTaxaRepeticao(31);
  await setFilterKeys(false);
  return 'Ajustes de registro aplicados. Faça logoff/login pra valer 100%.';
}

// ---------------------------------------------------------------
// 8) Perfil de Precisão (combo geral - liga tudo que não precisa admin + avisa sobre o resto)
// ---------------------------------------------------------------
async function aplicarPerfilPrecisao({ incluirPrioridade = false, incluirUsb = false } = {}) {
  await aplicarAjustesRegistro();
  await setStickyToggleKeys(false);
  if (incluirUsb) await setSuspensaoUsbSeletiva(true);
  if (incluirPrioridade) await setPrioridadeProcesso(true); // vai pedir UAC

  return 'Perfil de Precisão aplicado.';
}

// ---------------------------------------------------------------
// Restaurar tudo ao padrão de fábrica do Windows
// ---------------------------------------------------------------
async function restaurarPadrao() {
  await setAtrasoRepeticao(1);
  await setTaxaRepeticao(31);
  await setFilterKeys(true);
  await setStickyToggleKeys(true);
  await setSuspensaoUsbSeletiva(false);
  try { await setPrioridadeProcesso(false); } catch (_) { /* usuário pode ter negado o UAC */ }
  return 'Configurações restauradas ao padrão do Windows.';
}

module.exports = {
  setAtrasoRepeticao,
  setTaxaRepeticao,
  setFilterKeys,
  setStickyToggleKeys,
  setPrioridadeProcesso,
  setSuspensaoUsbSeletiva,
  aplicarAjustesRegistro,
  aplicarPerfilPrecisao,
  restaurarPadrao,
};

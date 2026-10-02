import { app, BrowserWindow, ipcMain, Menu, screen } from 'electron';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { petMenuModel, sanitizePetState } from './pet-menu.mjs';

const root = dirname(fileURLToPath(import.meta.url));
const sourceUrl = new URL(process.argv.find(argument => argument.startsWith('--url='))?.slice('--url='.length) || 'http://127.0.0.1:4174/');
sourceUrl.searchParams.set('mode', 'pet');
sourceUrl.searchParams.set('compact', '1');
let petWindow;
let petState = Object.freeze({ connection: 'disconnected', microphone: 'off', activity: 'idle' });
const petSize = { width: 470, height: 610 };
function sendPetCommand(command) {
  if (!petWindow || petWindow.isDestroyed() || petWindow.webContents.isDestroyed()) return;
  petWindow.webContents.send('desktop-pet:command', command);
}
function nativeAction(item) {
  return { label: item.label, enabled: item.enabled, ...(item.checked ? { type: 'checkbox', checked: true } : {}),
    ...(item.command ? { click: () => sendPetCommand(item.command) } : {}) };
}
function buildPetMenu(state) {
  const model = petMenuModel(state);
  return Menu.buildFromTemplate([
    { label: model.status, enabled: false },
    { type: 'separator' },
    nativeAction(model.connect),
    nativeAction(model.microphone),
    nativeAction(model.disconnect),
    { label: '互动动作', submenu: [
      { label: '打个招呼', click: () => sendPetCommand('react-greet') },
      { label: '开心', click: () => sendPetCommand('react-happy') },
      { label: '小生气', click: () => sendPetCommand('react-angry') }
    ] },
    { type: 'separator' },
    { label: '关闭数字人', click: () => app.quit() }
  ]);
}
function createPetWindow() {
  const workArea = screen.getPrimaryDisplay().workArea;
  const size = petSize;
  petState = sanitizePetState();
  petWindow = new BrowserWindow({
    ...size,
    minWidth: 390,
    minHeight: 440,
    x: Math.max(workArea.x, workArea.x + workArea.width - size.width - 32),
    y: Math.max(workArea.y, workArea.y + 56),
    transparent: true,
    frame: false,
    hasShadow: true,
    alwaysOnTop: true,
    resizable: true,
    title: 'Muxiva 数字人桌宠',
    backgroundColor: '#00000000',
    webPreferences: {
      preload: join(root, 'pet-preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  petWindow.setAlwaysOnTop(true, 'floating');
  petWindow.webContents.session.setPermissionRequestHandler((contents, permission, callback, details) => {
    const localPet = contents === petWindow.webContents && details.requestingUrl?.startsWith(sourceUrl.origin + '/');
    callback(localPet && permission === 'media');
  });
  petWindow.loadURL(sourceUrl.toString());
  petWindow.on('closed', () => { petWindow = undefined; });
}

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.whenReady().then(() => {
  const belongsToPet = event => event.sender === petWindow?.webContents;
  ipcMain.handle('desktop-pet:close', event => {
    if (belongsToPet(event)) petWindow?.close();
  });
  ipcMain.on('desktop-pet:state', (event, state) => {
    if (belongsToPet(event)) petState = sanitizePetState(state);
  });
  ipcMain.on('desktop-pet:open-menu', event => {
    if (!belongsToPet(event)) return;
    buildPetMenu(petState).popup({ window: petWindow });
  });
  let drag;
  const validPoint = point => Number.isFinite(point?.screenX) && Number.isFinite(point?.screenY);
  ipcMain.on('desktop-pet:drag-start', (event, point) => {
    if (!belongsToPet(event) || !validPoint(point)) return;
    const [windowX, windowY] = petWindow.getPosition();
    drag = { screenX: point.screenX, screenY: point.screenY, windowX, windowY };
  });
  ipcMain.on('desktop-pet:drag-move', (event, point) => {
    if (!belongsToPet(event) || !drag || !validPoint(point)) return;
    petWindow.setPosition(Math.round(drag.windowX + point.screenX - drag.screenX), Math.round(drag.windowY + point.screenY - drag.screenY));
  });
  ipcMain.on('desktop-pet:drag-end', event => { if (belongsToPet(event)) drag = undefined; });
  createPetWindow();
});
app.on('window-all-closed', () => app.quit());
app.on('activate', () => { if (!petWindow) createPetWindow(); });

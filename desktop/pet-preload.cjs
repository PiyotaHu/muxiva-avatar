const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('muxivaDesktopPet', Object.freeze({
  close: () => ipcRenderer.invoke('desktop-pet:close'),
  startDrag: point => ipcRenderer.send('desktop-pet:drag-start', point),
  moveDrag: point => ipcRenderer.send('desktop-pet:drag-move', point),
  endDrag: () => ipcRenderer.send('desktop-pet:drag-end'),
  openMenu: () => ipcRenderer.send('desktop-pet:open-menu'),
  setState: state => ipcRenderer.send('desktop-pet:state', state),
  onCommand: listener => {
    if (typeof listener !== 'function') return () => {};
    const callback = (_event, command) => listener(command);
    ipcRenderer.on('desktop-pet:command', callback);
    return () => ipcRenderer.removeListener('desktop-pet:command', callback);
  }
}));
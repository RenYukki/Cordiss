const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    onUpdateReady: (callback) => ipcRenderer.on('update-ready', () => callback()),
    quitAndInstall: () => ipcRenderer.send('quit-and-install')
});
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    // Güncellemeyi kurmak için ana sürece sinyal gönderir
    quitAndInstall: () => ipcRenderer.send('quit-and-install'),

                                // Güncelleme penceresini kapatmak için ana sürece sinyal gönderir
                                closeWindow: () => ipcRenderer.send('close-update-window')
});

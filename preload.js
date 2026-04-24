// Preload — runs in the renderer context before page scripts, with access to Node APIs.
// Exposes a minimal, safe bridge between the main process and the web page via contextBridge.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // Renderer calls this to register a handler for when an update has been downloaded
  onUpdateReady: (callback) => ipcRenderer.on('update-ready', callback),
  // Renderer calls this to trigger a restart-and-install
  restartApp: () => ipcRenderer.send('restart-app'),
});

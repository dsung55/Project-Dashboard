// Preload — runs in the renderer context before page scripts, with access to Node APIs.
// Exposes a minimal, safe bridge between the main process and the web page via contextBridge.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // Renderer registers a handler for when an update has been downloaded (Windows auto-install)
  onUpdateReady: (callback) => ipcRenderer.on('update-ready', (_e, payload) => callback(payload)),
  // Renderer registers a handler for Mac "download available" notification
  onUpdateAvailableDownload: (callback) => ipcRenderer.on('update-available-download', (_e, payload) => callback(payload)),
  // Renderer registers a handler for general updater status changes (checking, error, etc.)
  onUpdateStatus: (callback) => ipcRenderer.on('update-status', (_e, payload) => callback(payload)),
  // Renderer triggers a restart-and-install when the user clicks "Restart Now"
  restartApp: () => ipcRenderer.send('restart-app'),
  // Renderer triggers a manual update check (Settings → Check for Updates button)
  checkForUpdates: () => ipcRenderer.send('check-for-updates'),
  // Renderer fetches the current updater state on demand (so a freshly opened
  // Settings page can show the latest status even if events fired before load)
  getUpdateStatus: () => ipcRenderer.invoke('get-update-status'),
  // Opens a URL in the system's default browser (used for Mac download link)
  openExternal: (url) => ipcRenderer.send('open-external', url),
});

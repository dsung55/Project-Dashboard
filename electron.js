// Electron main process — starts Express server, then opens the app window
const { app, BrowserWindow, shell, ipcMain } = require('electron');
const path = require('path');

let mainWindow;

// Open the BrowserWindow pointed at the local Express server
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 600,
    webPreferences: {
      nodeIntegration: false,   // keep renderer isolated from Node
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
    title: 'Project Dashboard',
    show: false,  // reveal only after content is ready to avoid a white flash
  });

  mainWindow.loadURL('http://localhost:3000');

  // Show window once the page has finished loading
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // Open external links in the system browser, not inside the app
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// Check GitHub releases for a newer version and prompt to restart if found.
// Only runs in the packaged app — skipped entirely during dev (electron .).
function initAutoUpdater() {
  if (!app.isPackaged) return;

  const { autoUpdater } = require('electron-updater');

  autoUpdater.autoDownload = true;       // download silently in the background
  autoUpdater.autoInstallOnAppQuit = true; // also install automatically on next quit

  // When the update has been downloaded, show a toast in the renderer instead of a system dialog
  autoUpdater.on('update-downloaded', () => {
    if (mainWindow) mainWindow.webContents.send('update-ready');
  });

  // Renderer's "Restart Now" button sends this — apply the downloaded update immediately
  ipcMain.on('restart-app', () => {
    autoUpdater.quitAndInstall();
  });

  // Log errors silently — don't interrupt the user if update check fails
  autoUpdater.on('error', (err) => {
    console.error('[updater] error:', err.message);
  });

  // Wait 5 seconds after launch before checking so startup feels instant
  setTimeout(() => autoUpdater.checkForUpdates(), 5000);
}

app.whenReady().then(() => {
  // Redirect data storage to the OS user-data folder so it is writable
  // when the app is packaged (the install directory is read-only).
  // On Windows this resolves to: %APPDATA%\Project Dashboard\data
  process.env.DATA_DIR = path.join(app.getPath('userData'), 'data');

  // Start Express, then open the window once the server is listening
  const { startServer } = require('./server');
  startServer(() => {
    createWindow();
    initAutoUpdater();
  });

  // macOS: re-open window when clicking the dock icon with no windows open
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// Quit when all windows are closed (all platforms, including macOS)
app.on('window-all-closed', () => {
  app.quit();
});

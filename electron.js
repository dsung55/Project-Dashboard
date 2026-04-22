// Electron main process — starts Express server, then opens the app window
const { app, BrowserWindow, shell } = require('electron');
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

app.whenReady().then(() => {
  // Redirect data storage to the OS user-data folder so it is writable
  // when the app is packaged (the install directory is read-only).
  // On Windows this resolves to: %APPDATA%\Project Dashboard\data
  process.env.DATA_DIR = path.join(app.getPath('userData'), 'data');

  // Start Express, then open the window once the server is listening
  const { startServer } = require('./server');
  startServer(() => {
    createWindow();
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

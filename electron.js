// Electron main process — starts Express server, then opens the app window
const { app, BrowserWindow, shell, ipcMain, net } = require('electron');
const path = require('path');

// Only allow one running instance — a second launch focuses the existing window
// rather than spawning a second server that collides on the port.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  let mainWindow;
  let serverPort;

  // Focus the running window when the user tries to launch the app a second time
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

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

    mainWindow.loadURL(`http://localhost:${serverPort}`);

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
    const log = require('electron-log');

    // Wire electron-log into electron-updater so every check, download, and
    // error is captured to %APPDATA%\Project Dashboard\logs\main.log — the user
    // can open that file to diagnose update failures even on shipped builds.
    log.transports.file.level = 'info';
    autoUpdater.logger = log;

    autoUpdater.autoDownload = true;         // download silently in the background
    autoUpdater.autoInstallOnAppQuit = true; // also install automatically on next quit

    // Track the last-known update state so the renderer can query it on demand
    // (e.g. after the user clicks "Check for Updates" in Settings).
    // downloadUrl is set on macOS when a newer version is found but can't be
    // auto-installed (no code signing), so the renderer shows a "Download" link.
    let updateState = { status: 'idle', message: '', version: null, downloadUrl: null };

    function setState(status, message, version, downloadUrl) {
      updateState = { status, message: message || '', version: version || null, downloadUrl: downloadUrl || null };
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('update-status', updateState);
      }
    }

    // --- macOS fallback: electron-updater requires code signing on macOS. -----
    // When it throws a signing error we fall back to checking the GitHub releases
    // API directly. If a newer version exists we send 'update-available-download'
    // so the renderer can show a "Download" toast with a link to the release page.
    function compareVersions(a, b) {
      const pa = String(a).split('.').map(Number);
      const pb = String(b).split('.').map(Number);
      for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
        const na = pa[i] || 0, nb = pb[i] || 0;
        if (na > nb) return 1;
        if (na < nb) return -1;
      }
      return 0;
    }

    function checkGitHubReleasesManually() {
      setState('checking', 'Checking for updates…');
      const request = net.request({
        method: 'GET',
        url: 'https://api.github.com/repos/dsung55/Project-Dashboard/releases/latest',
        headers: { 'User-Agent': 'Project-Dashboard-App' },
      });

      request.on('response', (response) => {
        let data = '';
        response.on('data', (chunk) => { data += chunk; });
        response.on('end', () => {
          try {
            const release = JSON.parse(data);
            const latestVersion = release.tag_name.replace(/^v/, '');
            const currentVersion = app.getVersion();
            log.info(`[updater] GitHub check — current: ${currentVersion}, latest: ${latestVersion}`);

            if (compareVersions(latestVersion, currentVersion) > 0) {
              setState('available', `Update ${latestVersion} available — click to download.`, latestVersion, release.html_url);
              if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('update-available-download', {
                  version: latestVersion,
                  url: release.html_url,
                });
              }
            } else {
              setState('not-available', 'You are on the latest version.', currentVersion);
            }
          } catch (e) {
            log.error('[updater] GitHub API parse error:', e);
            setState('error', 'Could not parse update information.');
          }
        });
      });

      request.on('error', (err) => {
        log.error('[updater] GitHub API request failed:', err);
        setState('error', 'Could not reach update server.');
      });

      request.end();
    }

    autoUpdater.on('checking-for-update', () => setState('checking', 'Checking for updates…'));
    autoUpdater.on('update-available', (info) => setState('available', `Update ${info.version} found — downloading…`, info.version));
    autoUpdater.on('update-not-available', (info) => setState('not-available', 'You are on the latest version.', info && info.version));
    autoUpdater.on('download-progress', (p) => setState('downloading', `Downloading update: ${Math.round(p.percent)}%`));

    // When the update has been downloaded, show a toast in the renderer instead of a system dialog
    autoUpdater.on('update-downloaded', (info) => {
      setState('downloaded', `Update ${info.version} ready — restart to install.`, info.version);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('update-ready', { version: info.version });
      }
    });

    // Surface errors — on macOS a code-signing error is expected when the app is
    // unsigned; fall back to the GitHub API check so Mac users still get notified.
    autoUpdater.on('error', (err) => {
      const message = (err && err.message) ? err.message : 'Unknown updater error';
      log.error('[updater] error:', err);

      const isMacSigningError = process.platform === 'darwin' && (
        message.includes('Could not get code signature') ||
        message.includes('code signature') ||
        message.includes('ENOENT') ||
        message.includes('No published versions')
      );

      if (isMacSigningError) {
        log.info('[updater] macOS signing error detected — falling back to GitHub API check');
        checkGitHubReleasesManually();
        return; // don't propagate as a user-visible error
      }

      setState('error', message);
    });

    // Renderer's "Restart Now" button sends this — apply the downloaded update immediately.
    ipcMain.on('restart-app', () => {
      log.info('[updater] user requested restart-and-install');
      autoUpdater.quitAndInstall(false, true);
    });

    // Renderer's "Check for Updates" button (Settings page).
    // On macOS we skip electron-updater entirely and hit the GitHub API directly.
    ipcMain.on('check-for-updates', () => {
      log.info('[updater] manual check-for-updates requested');
      if (process.platform === 'darwin') {
        checkGitHubReleasesManually();
        return;
      }
      autoUpdater.checkForUpdates().catch((err) => {
        log.error('[updater] manual check failed:', err);
        setState('error', err && err.message ? err.message : 'Update check failed');
      });
    });

    // Renderer can read the current update state at any time (e.g. when the
    // Settings page first renders) so it doesn't miss events fired before page load.
    ipcMain.handle('get-update-status', () => updateState);

    // Wait 5 seconds after launch before the first check so startup feels instant.
    setTimeout(() => {
      if (process.platform === 'darwin') {
        checkGitHubReleasesManually();
      } else {
        autoUpdater.checkForUpdates().catch((err) => {
          log.error('[updater] startup check failed:', err);
          setState('error', err && err.message ? err.message : 'Update check failed');
        });
      }
    }, 5000);
  }

  // Opens a URL in the system browser — used by the Mac "Download" toast button.
  ipcMain.on('open-external', (_event, url) => {
    if (typeof url === 'string' && (url.startsWith('https://') || url.startsWith('http://'))) {
      shell.openExternal(url);
    }
  });

  app.whenReady().then(() => {
    // Redirect data storage to the OS user-data folder so it is writable
    // when the app is packaged (the install directory is read-only).
    // On Windows this resolves to: %APPDATA%\Project Dashboard\data
    process.env.DATA_DIR = path.join(app.getPath('userData'), 'data');

    // Start Express on an OS-assigned free port (port 0) so a stray dev server
    // or any other process holding :3000 cannot prevent the app from launching.
    const { startServer } = require('./server');
    startServer(0, (port) => {
      serverPort = port;
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
}

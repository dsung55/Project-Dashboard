// Auto-update UX:
//   - Toast appears bottom-right when an update is downloaded and ready
//   - "Check for Updates" button + live status row on Settings → Update Log
// Only activates when running inside Electron (window.electronAPI is injected by preload.js).
(function () {
  if (!window.electronAPI) return;

  // --- "Update ready" toast -------------------------------------------------
  function showUpdateReadyToast() {
    if (document.getElementById('update-toast')) return;

    const toast = document.createElement('div');
    toast.id = 'update-toast';
    toast.innerHTML = `
      <div class="update-toast-body">
        <div class="update-toast-icon">↑</div>
        <div class="update-toast-text">
          <strong>Update ready</strong>
          <span>Restart to apply the latest version.</span>
        </div>
      </div>
      <div class="update-toast-actions">
        <button class="update-toast-restart">Restart Now</button>
        <button class="update-toast-dismiss" aria-label="Dismiss">✕</button>
      </div>
    `;

    document.body.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add('update-toast-visible'));

    toast.querySelector('.update-toast-restart').addEventListener('click', () => {
      window.electronAPI.restartApp();
    });

    toast.querySelector('.update-toast-dismiss').addEventListener('click', () => {
      toast.classList.remove('update-toast-visible');
      toast.addEventListener('transitionend', () => toast.remove(), { once: true });
    });
  }

  window.electronAPI.onUpdateReady(() => showUpdateReadyToast());

  // --- Settings page updater controls --------------------------------------
  // Reveals the "Check for Updates" panel only inside Electron (the controls
  // are hidden by default in settings.html so a plain browser doesn't see them)
  // and keeps the live status text in sync with main-process events.
  function initUpdaterControls() {
    const controls = document.getElementById('updater-controls');
    const btn = document.getElementById('btn-check-updates');
    const statusEl = document.getElementById('updater-status');
    if (!controls || !btn || !statusEl) return;

    controls.style.display = '';

    function applyStatus(state) {
      if (!state) return;
      statusEl.textContent = state.message || state.status || 'Idle.';
      btn.disabled = state.status === 'checking' || state.status === 'downloading';
      // If we hit an error path, show a quick toast so users see it even if
      // they never open Settings.
      if (state.status === 'error') showErrorToast(state.message);
    }

    btn.addEventListener('click', () => {
      btn.disabled = true;
      statusEl.textContent = 'Checking for updates…';
      window.electronAPI.checkForUpdates();
    });

    // Initial state when the Settings page renders
    window.electronAPI.getUpdateStatus().then(applyStatus).catch(() => {});

    // Live updates while the page is open
    window.electronAPI.onUpdateStatus((state) => applyStatus(state));
  }

  function showErrorToast(message) {
    if (document.getElementById('update-error-toast')) return;
    const toast = document.createElement('div');
    toast.id = 'update-error-toast';
    toast.className = 'update-toast update-toast-error update-toast-visible';
    toast.innerHTML = `
      <div class="update-toast-body">
        <div class="update-toast-icon">!</div>
        <div class="update-toast-text">
          <strong>Update check failed</strong>
          <span>${(message || 'Unknown error').replace(/[<>&]/g, '')}</span>
        </div>
      </div>
      <div class="update-toast-actions">
        <button class="update-toast-dismiss" aria-label="Dismiss">✕</button>
      </div>
    `;
    document.body.appendChild(toast);
    toast.querySelector('.update-toast-dismiss').addEventListener('click', () => toast.remove());
    setTimeout(() => toast.remove(), 8000);
  }

  // Settings page may render after this script runs, so wait for DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initUpdaterControls);
  } else {
    initUpdaterControls();
  }

  // Also listen for status updates on every page so error toasts surface
  // even outside the Settings tab.
  window.electronAPI.onUpdateStatus((state) => {
    if (state && state.status === 'error') showErrorToast(state.message);
  });
})();

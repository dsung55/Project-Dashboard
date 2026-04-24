// Shows a persistent bottom-right toast when an app update has been downloaded.
// Only activates when running inside Electron (window.electronAPI is injected by preload.js).
(function () {
  if (!window.electronAPI) return;

  window.electronAPI.onUpdateReady(() => {
    // Don't show a second toast if one is already visible
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

    // Trigger slide-in on next frame so the CSS transition fires
    requestAnimationFrame(() => toast.classList.add('update-toast-visible'));

    toast.querySelector('.update-toast-restart').addEventListener('click', () => {
      window.electronAPI.restartApp();
    });

    toast.querySelector('.update-toast-dismiss').addEventListener('click', () => {
      toast.classList.remove('update-toast-visible');
      toast.addEventListener('transitionend', () => toast.remove(), { once: true });
    });
  });
})();
